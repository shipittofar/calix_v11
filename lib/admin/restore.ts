import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { parseStoreText, readStore, replaceStore, storeDir, storeStatus, withLock } from "@/lib/settings/store";
import { unsealWith } from "@/lib/settings/crypto";
import type { AdminsFile, StoreName } from "@/lib/settings/schema";
import { liveInstances } from "./instances";
import { audit } from "./audit";

/**
 * Restoring the settings store from a backup (docs/admin-panel-runbook.md §5).
 *
 * An older admins.json carries older session versions, an older list of revoked sessions and
 * older account states, so a plain file restore could make old cookies valid again and re-enable
 * accounts disabled since the backup. The supported restore (`admin-user restore`) therefore:
 *
 * - runs only while the site is stopped, and changes nothing unless the whole archive is valid
 *   (allow-listed regular files, valid content, every encrypted value readable);
 * - keeps the live administrators by default; with `--restore-admins` (e.g. when the live file is
 *   lost) every restored account comes back *disabled*, to be re-enabled one by one;
 * - never overwrites audit logs, and never changes the archive.
 *
 * It runs as a journalled transaction, so an interruption at any point leaves a state that is
 * safe and recoverable:
 *
 * 1. validate everything (nothing written outside a scratch folder);
 * 2. copy the current files to `pre-restore-<time>/` and flush them to disk;
 * 3. write the marker `restore.json` as "in-progress" (atomic, flushed) *before* any live file
 *    changes. From here the admin refuses every session and sign-in;
 * 4. replace the data files (each one atomically);
 * 5. mark the restore "complete" (atomic, flushed). The admin stays unavailable until
 *    SESSION_SECRET has been changed, which invalidates every cookie signed before the restore.
 *
 * A restore that stopped after step 3 (error, kill, power loss) stays "in-progress": the admin
 * stays closed whatever the secret, a new restore is refused, and `admin-user restore --rollback`
 * puts the saved files back. A marker that can't be read or understood counts as an unfinished
 * restore, never as "no restore".
 */

const MARKER = "restore.json";
const DATA: StoreName[] = ["settings", "delivery", "status", "admins"];
const ALLOWED = /^(?:\.\/)?((?:settings|delivery|status|admins)\.json(?:\.bak)?|audit(?:-access)?\.log(?:\.\d+)?)$/;

/** A one-way value derived from SESSION_SECRET: shows whether it changed, never reveals it. */
export function secretCheck(secret = process.env.SESSION_SECRET ?? ""): string {
  return createHmac("sha256", secret).update("calix restore check v1").digest("base64url").slice(0, 22);
}

const FILE = /^(?:settings|delivery|status|admins)\.json(?:\.bak)?$/;
const markerSchema = z.object({
  v: z.literal(2),
  state: z.enum(["in-progress", "complete", "rolled-back"]),
  at: z.string(),
  archive: z.string(),
  aside: z.string().regex(/^pre-restore-[0-9A-Za-z]+(?:-\d+)?$/),
  check: z.string().min(1),
  /** Live files present before the restore (all copied into `aside`). */
  existed: z.array(z.string().regex(FILE)),
  /** Data files the restore replaces (only these are put back by a rollback). */
  replaces: z.array(z.enum(["settings", "delivery", "status", "admins"])),
});
type Marker = z.infer<typeof markerSchema>;

type Read = { kind: "none" } | { kind: "unreadable"; reason: string } | { kind: "ok"; marker: Marker };
let cached: { key: string; read: Read } | null = null;

async function readMarker(): Promise<Read> {
  const dir = storeDir();
  if (!dir) return { kind: "none" };
  const path = join(dir, MARKER);
  let key: string;
  try {
    const s = await stat(path);
    key = `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "unreadable", reason: (error as NodeJS.ErrnoException).code ?? "error" };
  }
  if (cached?.key === key) return cached.read;
  let read: Read;
  try {
    const parsed = markerSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    read = parsed.success ? { kind: "ok", marker: parsed.data } : { kind: "unreadable", reason: "invalid content" };
  } catch (error) {
    read = { kind: "unreadable", reason: (error as NodeJS.ErrnoException).code ?? "invalid content" };
  }
  cached = { key, read };
  return read;
}

export type RestoreState = {
  /** True while the admin must stay unavailable. */
  pending: boolean;
  state: "none" | "unreadable" | Marker["state"];
  at?: string;
  archive?: string;
  aside?: string;
};

/**
 * Whether the admin must stay unavailable because of a restore: an unfinished restore, an
 * unreadable marker, or a finished (or rolled back) restore while SESSION_SECRET is unchanged.
 */
export async function restoreState(): Promise<RestoreState> {
  const r = await readMarker();
  if (r.kind === "none") return { pending: false, state: "none" };
  if (r.kind === "unreadable") return { pending: true, state: "unreadable" };
  const m = r.marker;
  const pending = m.state === "in-progress" || m.check === secretCheck();
  return { pending, state: m.state, at: m.at, archive: m.archive, aside: m.aside };
}

export type RestoreOptions = { archive: string; restoreAdmins: boolean; now?: Date };
export type RestoreReport = { restored: string[]; keptAdmins: boolean; disabledAccounts: string[]; asideDir: string };

class RestoreError extends Error {}
const fail = (message: string): never => {
  throw new RestoreError(message);
};
const cause = (error: unknown) => (error instanceof RestoreError ? error.message : ((error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message ?? "unknown error"));

/** Test seams: simulate a failure or a kill at a given step. Unused otherwise. */
export const restoreTestHooks: {
  beforeMarker: null | (() => Promise<void> | void);
  afterReplace: null | ((name: StoreName) => Promise<void> | void);
  beforeComplete: null | (() => Promise<void> | void);
} = { beforeMarker: null, afterReplace: null, beforeComplete: null };

async function syncPath(path: string) {
  const fh = await open(path, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Writes `data` to `dir/name` atomically and durably (temporary file, fsync, rename, fsync dir). */
async function writeDurable(dir: string, name: string, data: string | Buffer) {
  const tmp = join(dir, `.restore-${randomBytes(6).toString("hex")}.tmp`);
  const fh = await open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, join(dir, name));
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  await syncPath(dir);
}

async function writeMarker(dir: string, m: Marker) {
  await writeDurable(dir, MARKER, JSON.stringify(m));
  cached = null;
}

const unfinished = (aside: string, why: string) =>
  `The restore stopped after it began changing live files (${why}). The admin stays unavailable. ` +
  `With the site stopped, run \`admin-user restore --rollback\` to put back the files saved in ${aside}/ inside SETTINGS_DIR, ` +
  "then start a new restore or change SESSION_SECRET and start the site (runbook §5).";

function listArchive(archive: string): { name: string; type: string }[] {
  const r = spawnSync("tar", ["-tvzf", archive], { encoding: "utf8" });
  if (r.status !== 0) fail("The archive can't be read (is it a backup made by deploy/backup-settings.sh?). Nothing was changed.");
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      // Links are listed as "name -> target" / "name link to target": match on the name alone.
      return { type: line[0], name: parts.slice(5).join(" ").replace(/ (->|link to) .*$/, "") };
    });
}

function sealedValues(name: StoreName, value: unknown): { what: string; sealed: string }[] {
  if (name === "admins") {
    return (value as AdminsFile).admins.flatMap((a) => [
      ...(a.totp ? [{ what: `authenticator secret of ${a.email}`, sealed: a.totp.sealed }] : []),
      ...(a.pendingTotp ? [{ what: `pending authenticator secret of ${a.email}`, sealed: a.pendingTotp.sealed }] : []),
    ]);
  }
  if (name === "delivery") {
    const d = value as { telegram: { botToken?: { sealed: string } }; whatsapp?: { accessToken?: { sealed: string } } };
    return [
      ...(d.telegram.botToken ? [{ what: "Telegram bot token", sealed: d.telegram.botToken.sealed }] : []),
      ...(d.whatsapp?.accessToken ? [{ what: "WhatsApp access token", sealed: d.whatsapp.accessToken.sealed }] : []),
    ];
  }
  return [];
}

/** Checks shared by restore and rollback: storage, secret, site stopped. */
async function preflight(): Promise<string> {
  const dir = storeDir();
  const store = await storeStatus({ probe: true });
  if (!dir || !store.ok) fail(`Settings storage unavailable: ${store.problem ?? "SETTINGS_DIR is not set"}. Nothing was changed.`);
  if ((process.env.SESSION_SECRET ?? "").length < 32) fail("SESSION_SECRET must be set (the same environment as the site). Nothing was changed.");
  if ((await liveInstances()).length) fail("The site is running. Stop it first (pm2 stop calix). Nothing was changed.");
  return dir!;
}

export async function performRestore(opts: RestoreOptions): Promise<RestoreReport> {
  const dir = await preflight();
  const previous = await restoreState();
  if (previous.state === "in-progress") {
    fail(`An earlier restore did not finish (files saved in ${previous.aside}/). Run \`admin-user restore --rollback\` first (runbook §5). Nothing was changed.`);
  }
  if (previous.state === "unreadable") fail(`${MARKER} in SETTINGS_DIR can't be read, so the state of an earlier restore is unknown (runbook §5). Nothing was changed.`);
  if (!existsSync(opts.archive) || !statSync(opts.archive).isFile()) fail("Archive not found. Nothing was changed.");

  // 1. The archive: only allow-listed names, only regular files.
  const entries = listArchive(opts.archive).filter((e) => e.name !== "./" && e.name !== ".");
  const wanted: string[] = [];
  for (const e of entries) {
    const clean = e.name.replace(/^\.\//, "");
    if (e.name.startsWith("/") || e.name.split("/").includes("..")) fail(`The archive contains an unsafe path (${e.name}). Nothing was changed.`);
    if (!ALLOWED.test(e.name)) continue; // heartbeats, older restore copies, anything else: ignored
    if (e.type !== "-") fail(`${clean} in the archive is not a regular file. Nothing was changed.`);
    wanted.push(e.name);
  }

  // Unpack only those names into a private scratch folder inside SETTINGS_DIR.
  const scratch = mkdtempSync(join(dir, ".restore-"));
  let aside = "";
  let liveChanged = false;
  try {
    if (wanted.length) {
      const x = spawnSync("tar", ["-xzf", opts.archive, "-C", scratch, "--no-same-owner", "--no-same-permissions", "--", ...wanted], { encoding: "utf8" });
      if (x.status !== 0) fail("The archive could not be unpacked. Nothing was changed.");
    }
    const fromArchive = (file: string) => {
      const p = join(scratch, file);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    };

    // Validate everything before changing anything.
    const values = new Map<StoreName, unknown>();
    for (const name of DATA) {
      const text = fromArchive(`${name}.json`);
      if (text === null) continue;
      const value = parseStoreText(name, text);
      if (!value) fail(`${name}.json in the archive is not valid. Nothing was changed.`);
      values.set(name, value);
    }
    if (!values.size) fail("The archive holds no settings files. Nothing was changed.");

    const current = await readStore("admins");
    const restoreAdmins = values.has("admins") && (opts.restoreAdmins || !current);
    if (!restoreAdmins) values.delete("admins");

    const unreadable = [...values].flatMap(([name, value]) => sealedValues(name, value)).filter((v) => !unsealWith(v.sealed));
    if (unreadable.length) {
      fail(
        `These encrypted values can't be read with SETTINGS_ENCRYPTION_KEY or SETTINGS_ENCRYPTION_KEY_PREVIOUS: ${unreadable.map((u) => u.what).join("; ")}. ` +
          "Set SETTINGS_ENCRYPTION_KEY_PREVIOUS to the key in use when the backup was made (runbook §5). Nothing was changed.",
      );
    }

    // 2. Copy what is there now aside (never deleted) and flush it, with the archive's audit logs.
    const at = (opts.now ?? new Date()).toISOString();
    const stamp = `pre-restore-${at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
    // A new folder each time (a retry within the same second gets a suffix); never reused.
    for (let n = 1; !aside; n++) {
      const name = n === 1 ? stamp : `${stamp}-${n}`;
      try {
        await mkdir(join(dir, name), { mode: 0o700 });
        aside = name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || n >= 50) throw error;
      }
    }
    const asidePath = join(dir, aside);
    const existed: string[] = [];
    for (const name of DATA) {
      for (const f of [`${name}.json`, `${name}.json.bak`]) {
        if (!existsSync(join(dir, f))) continue;
        await copyFile(join(dir, f), join(asidePath, f));
        await syncPath(join(asidePath, f));
        existed.push(f);
      }
    }
    for (const w of wanted.map((n) => n.replace(/^\.\//, "")).filter((n) => n.startsWith("audit"))) {
      await mkdir(join(asidePath, "archive-audit"), { recursive: true, mode: 0o700 });
      await copyFile(join(scratch, w), join(asidePath, "archive-audit", w));
    }
    await syncPath(asidePath);
    await syncPath(dir);

    // 3. Record the restore before any live file changes.
    const marker: Marker = { v: 2, state: "in-progress", at, archive: basename(opts.archive), aside, check: secretCheck(), existed, replaces: [...values.keys()] };
    await restoreTestHooks.beforeMarker?.();
    await writeMarker(dir, marker);
    liveChanged = true;

    // 4. Replace the data files (atomic, revision moves forward). Administrators come back disabled.
    const disabledAccounts: string[] = [];
    for (const [name, value] of values) {
      let v = value;
      if (name === "admins") {
        const a = value as AdminsFile;
        v = {
          ...a,
          admins: a.admins.map((r) => {
            disabledAccounts.push(r.email);
            const { revokedSessions: _drop, ...rest } = r;
            void _drop;
            return { ...rest, status: "disabled" as const, sessionVersion: r.sessionVersion + 1 };
          }),
        };
      }
      const r = await replaceStore(name, v as never, "restore");
      if (!r.ok) fail(unfinished(aside, `writing ${name}.json failed: ${r.reason}`));
      await restoreTestHooks.afterReplace?.(name);
    }

    // 5. Done. Until SESSION_SECRET changes, the admin stays unavailable (restoreState).
    await restoreTestHooks.beforeComplete?.();
    await writeMarker(dir, { ...marker, state: "complete" });

    await audit({
      adminId: "cli",
      action: "settings.restore",
      outcome: "success",
      changes: { archive: basename(opts.archive), restored: [...values.keys()], adminsRestored: restoreAdmins, accountsDisabled: disabledAccounts.length },
    });
    return { restored: [...values.keys()].map((n) => `${n}.json`), keptAdmins: !restoreAdmins, disabledAccounts, asideDir: aside };
  } catch (error) {
    if (liveChanged) {
      if (error instanceof RestoreError && error.message.startsWith("The restore stopped")) throw error;
      throw new RestoreError(unfinished(aside, cause(error)));
    }
    if (error instanceof RestoreError) throw error;
    throw new RestoreError(`The restore failed before changing any live file (${cause(error)}). Nothing was changed.${aside ? ` A partial copy may be left in ${aside}/.` : ""}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export type RollbackReport = { aside: string; putBack: string[]; removed: string[] };

/**
 * Puts back the files saved before the last restore, for a restore that did not finish or that
 * finished but is still waiting for the new SESSION_SECRET (so the admin has not been used since).
 * Only the data files that restore replaced are put back; administrators it kept are not touched.
 * Safe to run again if interrupted. Afterwards the admin stays unavailable until SESSION_SECRET
 * changes, as after a restore.
 */
export async function performRollback(): Promise<RollbackReport> {
  const dir = await preflight();
  const r = await readMarker();
  if (r.kind === "none") fail("There is no restore to roll back. Nothing was changed.");
  if (r.kind === "unreadable") fail(`${MARKER} in SETTINGS_DIR can't be read (${r.reason}); roll back by hand as described in runbook §5. Nothing was changed.`);
  const m = (r as { marker: Marker }).marker;
  if (m.state === "rolled-back") fail(`The restore of ${m.at} was already rolled back. Nothing was changed.`);
  if (m.state === "complete" && m.check !== secretCheck()) {
    fail("That restore finished and SESSION_SECRET has been changed since, so the admin may have been used: restore a backup instead (runbook §5). Nothing was changed.");
  }
  const asidePath = join(dir, m.aside);
  const files = m.replaces.flatMap((n) => [`${n}.json`, `${n}.json.bak`]);
  const missing = files.filter((f) => m.existed.includes(f) && !existsSync(join(asidePath, f)));
  if (missing.length) fail(`${m.aside}/ is missing ${missing.join(", ")}; roll back by hand (runbook §5). Nothing was changed.`);

  try {
    // From here until it finishes, the restore counts as unfinished again (admin closed).
    if (m.state !== "in-progress") await writeMarker(dir, { ...m, state: "in-progress" });
    const putBack: string[] = [];
    const removed: string[] = [];
    for (const name of m.replaces) {
      const done = await withLock(join(dir, `${name}.json`), async () => {
        for (const f of [`${name}.json`, `${name}.json.bak`]) {
          if (m.existed.includes(f)) {
            await writeDurable(dir, f, await readFile(join(asidePath, f)));
            putBack.push(f);
          } else if (existsSync(join(dir, f))) {
            await rm(join(dir, f), { force: true });
            await syncPath(dir);
            removed.push(f);
          }
        }
      });
      if (done === "busy") fail(`${name}.json is locked by another process; stop it and run the rollback again`);
    }
    await writeMarker(dir, { ...m, state: "rolled-back", check: secretCheck() });
    await audit({ adminId: "cli", action: "settings.restore.rollback", outcome: "success", changes: { aside: m.aside, putBack, removed } });
    return { aside: m.aside, putBack, removed };
  } catch (error) {
    throw new RestoreError(
      `The rollback stopped (${cause(error)}). The admin stays unavailable. Fix the cause and run \`admin-user restore --rollback\` again; it is safe to repeat (runbook §5).`,
    );
  }
}

export { RestoreError };
