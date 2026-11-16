import "server-only";
import { readFile, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { clientIp, trustedProxyHeader } from "@/lib/client-ip";
import { encryptionKey } from "@/lib/settings/crypto";
import { inspectStoreFile, longHeldLocks, readStore, storeDir, storeStatus } from "@/lib/settings/store";
import { STORE_FILES, type StoreName } from "@/lib/settings/schema";
import { currentPlan } from "@/lib/delivery/enquiry";
import { telegramAllowed } from "@/lib/delivery/plan";
import { explain } from "@/lib/delivery/codes";
import { verifyAuditChain } from "./audit";
import { pm2Info } from "./pm2";
import { liveInstances } from "./instances";
import { restoreState } from "./restore";

/**
 * Health checks for the admin status page (docs/admin-panel-runbook.md §7). Each check says what
 * it found in plain language. Environment variables are reported as set or not set, never with
 * their values; no paths, secrets or enquiry data are shown.
 */
export type Level = "ok" | "warn" | "problem" | "info";
export type Check = { id: string; label: string; level: Level; detail: string };
export type Section = { title: string; checks: Check[] };

const LOW_DISK_BYTES = 200 * 1024 * 1024;
const FILE_LABEL: Record<StoreName, string> = {
  settings: "Public settings (settings.json)",
  delivery: "Delivery channels (delivery.json)",
  status: "Delivery log (status.json)",
  admins: "Administrators (admins.json)",
};

async function readText(path: string) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

async function storage(): Promise<Check[]> {
  const s = await storeStatus({ probe: true });
  const checks: Check[] = [
    {
      id: "store",
      label: "Settings storage (SETTINGS_DIR)",
      level: s.ok ? "ok" : "problem",
      detail: s.ok ? "Set, readable and writable by the website." : (s.problem ?? "Unavailable."),
    },
  ];
  const dir = storeDir();
  if (!s.ok || !dir) return checks;
  const st = await stat(dir);
  const loose = (st.mode & 0o077) !== 0;
  const ownedBySelf = typeof process.getuid === "function" ? st.uid === process.getuid() : true;
  checks.push({
    id: "store-perms",
    label: "Storage permissions",
    level: loose || !ownedBySelf ? "warn" : "ok",
    detail: `Folder permissions ${(st.mode & 0o777).toString(8).padStart(3, "0")}${loose ? " (should be 700: only the website's user)" : ""}; ${ownedBySelf ? "owned by the website's user" : "owned by another user"}.`,
  });
  try {
    const fs = await statfs(dir);
    const free = fs.bavail * fs.bsize;
    checks.push({
      id: "disk",
      label: "Free disk space for settings",
      level: free < LOW_DISK_BYTES ? "warn" : "ok",
      detail: `${Math.floor(free / 1024 / 1024)} MB free.`,
    });
  } catch {
    // statfs unsupported: skip
  }
  for (const name of Object.keys(STORE_FILES) as StoreName[]) {
    const h = await inspectStoreFile(name);
    const perms = h.mode !== undefined && (h.mode & 0o077) !== 0 ? ` Permissions ${h.mode.toString(8)} (should be 600).` : "";
    checks.push({
      id: `file-${name}`,
      label: FILE_LABEL[name],
      level: h.state === "invalid" ? "problem" : perms ? "warn" : h.state === "missing" ? "info" : "ok",
      detail:
        h.state === "missing"
          ? "Not created yet: the website uses its defaults."
          : h.state === "invalid"
            ? `Unreadable or invalid: the website is using ${h.backup === "valid" ? "the backup copy" : "the last good copy in memory, or its defaults"}. Restore it (runbook §5).${perms}`
            : `Revision ${h.revision}, saved ${new Date(h.updatedAt ?? 0).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. Previous version kept: ${h.backup === "valid" ? "yes" : "no"}.${perms}`,
    });
  }
  const restore = await restoreState();
  if (restore.at) {
    checks.push({
      id: "restore",
      label: "Last restore from a backup",
      level: "info",
      detail: `${new Date(restore.at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC from ${restore.archive}${restore.state === "rolled-back" ? ", then rolled back" : ""}; SESSION_SECRET has been changed since.`,
    });
  }
  const held = await longHeldLocks(60_000);
  checks.push({
    id: "locks",
    label: "Write locks",
    level: held.length ? "warn" : "ok",
    detail: held.length
      ? `Held for over a minute: ${held.map((h) => `${h.file} (${h.seconds} s)`).join(", ")}. Saves to these files report "busy" until it clears. A lock whose process has gone is cleared automatically on the next save; one held by a running process is never broken: check the processes (runbook §4).`
      : "None held for long.",
  });
  const chain = await verifyAuditChain();
  checks.push({
    id: "audit",
    label: "Activity log",
    level: chain.ok ? "ok" : "problem",
    detail: chain.ok ? `Intact (${chain.lines} entries in the current file).` : `Broken at entry ${chain.brokenAt}: it may have been edited. Investigate before trusting it.`,
  });
  return checks;
}

function secrets(): Check[] {
  const set = (name: string, ok: boolean, why: string): Check => ({
    id: `env-${name}`,
    label: name,
    level: ok ? "ok" : "problem",
    detail: ok ? "Set." : `Not set or invalid. ${why}`,
  });
  return [
    set("SESSION_SECRET", (process.env.SESSION_SECRET ?? "").length >= 32, "Needed to sign in."),
    set("SETTINGS_ENCRYPTION_KEY", Boolean(encryptionKey()), "Needed for sign-in codes and the Telegram token."),
    set("FORM_SECRET", Boolean(process.env.FORM_SECRET), "Enquiries are refused without it."),
  ];
}

async function delivery(): Promise<Check[]> {
  const [plan, settings] = await Promise.all([currentPlan(), readStore("settings")]);
  const checks: Check[] = [];
  const accepting = settings?.form.acceptingEnquiries ?? true;
  checks.push({
    id: "form",
    label: "Contact form",
    level: accepting ? "ok" : "warn",
    detail: accepting ? "Open." : "Paused: visitors see the pause message and nothing is sent.",
  });
  if (plan.mode === "log") {
    checks.push({ id: "delivery", label: "Enquiry delivery", level: "info", detail: "Log mode (development or preview): enquiries are not sent." });
  } else if (plan.mode === "refused") {
    checks.push({ id: "delivery", label: "Enquiry delivery", level: "problem", detail: `Enquiries are refused. ${explain(plan.problem)}` });
  } else {
    const any = plan.email.ready || plan.telegram.ready || plan.whatsapp.ready;
    for (const [id, c, name] of [["email", plan.email, "Email"], ["telegram", plan.telegram, "Telegram"], ["whatsapp", plan.whatsapp, "WhatsApp"]] as const) {
      checks.push({
        id: `channel-${id}`,
        label: `${name} channel`,
        level: c.ready ? "ok" : !c.enabled ? "info" : "problem",
        detail: c.ready ? "On and configured." : !c.enabled ? "Off." : `On but not usable: ${explain(c.problem)}`,
      });
    }
    if (!any) checks.push({ id: "delivery", label: "Enquiry delivery", level: "problem", detail: "No channel can deliver: visitors are asked to try again later." });
  }
  checks.push({
    id: "telegram-gate",
    label: "TELEGRAM_DELIVERY_ALLOWED",
    level: "info",
    detail: telegramAllowed()
      ? "Set: the operator has confirmed the Telegram prerequisites (runbook §8)."
      : "Not set: Telegram can't receive enquiries (the privacy notice and server checks come first, runbook §8).",
  });
  return checks;
}

function network(headers: Headers): Check[] {
  const header = trustedProxyHeader();
  const present = header ? headers.get(header) : null;
  const seen = clientIp(headers);
  return [
    {
      id: "proxy-header",
      label: "Visitor address (TRUSTED_PROXY_HEADER)",
      level: !header ? "warn" : present ? "ok" : "problem",
      detail: !header
        ? `Not set: rate limits use X-Forwarded-For, which visitors can fake (runbook §3). Your address as seen now: ${seen}.`
        : present
          ? `Read from ${header}. Your address as seen now: ${seen}. It should match your real public address.`
          : `This request has no ${header} header: it did not come through the configured proxy, or the proxy doesn't set it (runbook §3).`,
    },
  ];
}

async function runtime(): Promise<Check[]> {
  const pm2 = pm2Info();
  const cwd = process.cwd();
  const [buildId, nextPkg] = await Promise.all([readText(join(cwd, ".next/BUILD_ID")), readText(join(cwd, "node_modules/next/package.json"))]);
  let nextVersion = "unknown";
  try {
    nextVersion = nextPkg ? (JSON.parse(nextPkg).version as string) : "unknown";
  } catch {
    // keep unknown
  }
  const single = pm2 ? pm2.mode === "fork_mode" && pm2.instances === "1" : null;
  const live = await liveInstances();
  return [
    {
      id: "instances",
      label: "Processes using these settings",
      level: live.length > 1 ? "problem" : live.length === 1 ? "ok" : "info",
      detail:
        live.length > 1
          ? `${live.length} running processes use this settings folder. Run exactly one: the others serve stale pages and keep separate rate limits (runbook §2).`
          : live.length === 1
            ? "One. (Processes started with a different SETTINGS_DIR can't be seen from here; the runbook's server checks cover those.)"
            : "No heartbeat yet (it is written when the server starts).",
    },
    {
      id: "process",
      label: "Process manager",
      level: pm2 === null ? "info" : single ? "ok" : "problem",
      detail:
        pm2 === null
          ? "Not running under PM2 (or PM2 did not pass its settings). Production must run exactly one process (runbook §2)."
          : single
            ? "PM2, one process in fork mode, as required."
            : `PM2 in ${pm2.mode} with ${pm2.instances} instance(s). Run exactly one process in fork mode: saved settings and rate limits are per process (runbook §2).`,
    },
    {
      id: "environment",
      label: "Environment",
      level: process.env.NODE_ENV === "production" ? "ok" : "info",
      detail: `NODE_ENV ${process.env.NODE_ENV ?? "not set"}; ${process.env.NOINDEX === "true" ? "NOINDEX=true (preview: not indexed)" : "indexable"}.`,
    },
    {
      id: "versions",
      label: "Versions",
      level: "info",
      detail: `Next.js ${nextVersion}, Node.js ${process.versions.node}, build ${buildId ?? "unknown"}.`,
    },
    {
      id: "uptime",
      label: "Running since",
      level: "info",
      detail: `${new Date(Date.now() - process.uptime() * 1000).toLocaleString("en-GB", { timeZone: "UTC" })} UTC (process ${process.pid}).`,
    },
    {
      id: "pages",
      label: "Public pages",
      level: "info",
      detail: "Saving settings refreshes every page at once; pages also refresh themselves every 5 minutes. After restoring a backup, use Refresh public pages below.",
    },
  ];
}

export async function systemStatus(headers: Headers): Promise<Section[]> {
  const [store, deliveryChecks, run] = await Promise.all([storage(), delivery(), runtime()]);
  return [
    { title: "Storage and records", checks: store },
    { title: "Secrets (set or not set only)", checks: secrets() },
    { title: "Enquiries", checks: deliveryChecks },
    { title: "Network", checks: network(headers) },
    { title: "Server", checks: run },
  ];
}
