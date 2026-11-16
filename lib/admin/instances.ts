import "server-only";
import { rmSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { storeDir } from "@/lib/settings/store";

/**
 * Heartbeats in SETTINGS_DIR/instances, one file per running process (written at start-up from
 * instrumentation.ts and refreshed every 30 s). The site must run as exactly one process: saved
 * settings refresh pages, and rate limits apply, only within the process that handled them.
 *
 * This detects a second process using the *same* settings folder on any machine that shares it.
 * It can't see a process configured with a different SETTINGS_DIR, so the runbook's server checks
 * (`pm2 jlist`, `ss -ltnp`) remain the authority (docs/admin-panel-runbook.md §2).
 */
const BEAT_MS = 30_000;
const LIVE_MS = 3 * BEAT_MS;
const host = hostname();
let timer: NodeJS.Timeout | null = null;

const folder = () => {
  const dir = storeDir();
  return dir ? join(dir, "instances") : null;
};
const ownFile = (dir: string) => join(dir, `${host}-${process.pid}.json`);

async function beat() {
  const dir = folder();
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(ownFile(dir), JSON.stringify({ pid: process.pid, host, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() }), { mode: 0o600 });
  } catch {
    // storage problems are reported by the status page's storage checks
  }
}

export async function registerInstance() {
  await beat();
  if (!timer) {
    timer = setInterval(beat, BEAT_MS);
    timer.unref();
    process.once("exit", () => {
      // Exit handlers must be synchronous. Best effort: a stale file is ignored after LIVE_MS.
      const dir = folder();
      try {
        if (dir) rmSync(ownFile(dir), { force: true });
      } catch {
        // ignore
      }
    });
  }
  const others = (await liveInstances()).filter((i) => !(i.pid === process.pid && i.host === host));
  if (others.length) console.error(`[admin] ${others.length} other process(es) are using the same SETTINGS_DIR; run exactly one (runbook §2)`);
}

export async function stopInstance() {
  if (timer) clearInterval(timer);
  timer = null;
  const dir = folder();
  if (dir) await rm(ownFile(dir), { force: true });
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type Instance = { pid: number; host: string; startedAt: string };

/** Processes with a recent heartbeat; on this machine, only those that are still running. */
export async function liveInstances(): Promise<Instance[]> {
  const dir = folder();
  if (!dir) return [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Instance[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const path = join(dir, name);
    try {
      const [s, raw] = await Promise.all([stat(path), readFile(path, "utf8")]);
      const i = JSON.parse(raw) as Instance;
      if (Date.now() - s.mtimeMs > LIVE_MS) {
        if (Date.now() - s.mtimeMs > 24 * 60 * 60 * 1000) await rm(path, { force: true });
        continue;
      }
      if (i.host === host && !alive(Number(i.pid))) continue;
      out.push({ pid: Number(i.pid), host: String(i.host), startedAt: String(i.startedAt) });
    } catch {
      // unreadable heartbeat: ignore
    }
  }
  return out;
}
