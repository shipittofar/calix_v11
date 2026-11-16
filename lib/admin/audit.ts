import "server-only";
import { createHash, createHmac } from "node:crypto";
import { appendFile, open, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { storeDir, withLock } from "@/lib/settings/store";

/**
 * Audit logs (JSON Lines in SETTINGS_DIR). Never log secrets, passwords, codes or personal data:
 * callers pass redacted `changes`. Two streams, so anonymous traffic can't push security history
 * out by rotation:
 *
 * - `audit.log`: what signed-in administrators and the operator CLI did, plus successful sign-ins
 *   and sign-outs. Nothing an anonymous request can trigger is written here.
 * - `audit-access.log`: unauthenticated events (failed sign-in steps, refused anonymous requests).
 *   Throttled: one line per action and address per minute (repeats are counted into the next
 *   line), and at most `accessPerMinute` lines a minute in total (the rest are counted into one
 *   `access.suppressed` line the next minute). It rotates on its own.
 *
 * Each line carries the SHA-256 of the previous line in its file (`prevHash`), so editing or
 * removing a line in the middle is detectable. Limits: truncating the end of a file, deleting a
 * whole file, or rotation discarding the oldest file can't be detected from the files alone; copy
 * the logs off the server to keep them (docs/admin-panel-runbook.md §7).
 *
 * The server and the operator CLI both append, so each write re-reads the last line under the
 * store's cross-process lock rather than trusting an in-memory hash. Suppression counts are kept
 * per process.
 */

export type AuditEvent = {
  adminId: string; // or "anonymous" / "cli"
  action: string;
  outcome: "success" | "denied" | "error";
  ip?: string;
  changes?: Record<string, unknown>;
  detail?: string;
  /** Before sign-in completed (e.g. a wrong password for a real account): goes to the access log. */
  preAuth?: boolean;
};

export type Stream = "main" | "access";
const FILES: Record<Stream, string> = { main: "audit.log", access: "audit-access.log" };

/** Limits and clock; tests may lower them. */
export const auditTuning = {
  maxBytes: { main: 5 * 1024 * 1024, access: 5 * 1024 * 1024 } as Record<Stream, number>,
  keep: { main: 5, access: 3 } as Record<Stream, number>,
  accessPerMinute: 120,
  repeatWindowMs: 60_000,
  now: () => Date.now(),
};

let chain: Promise<void> = Promise.resolve();

export const ipHash = (ip: string) =>
  createHmac("sha256", process.env.SESSION_SECRET ?? "calix").update(ip).digest("base64url").slice(0, 16);

async function tailHash(path: string): Promise<string> {
  try {
    const fh = await open(path, "r");
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString("utf8").trimEnd().split("\n");
      const last = lines[lines.length - 1];
      return last ? createHash("sha256").update(last).digest("hex") : "genesis";
    } finally {
      await fh.close();
    }
  } catch {
    return "genesis";
  }
}

async function rotateIfNeeded(path: string, stream: Stream) {
  try {
    const s = await stat(path);
    if (s.size < auditTuning.maxBytes[stream]) return;
  } catch {
    return;
  }
  const keep = auditTuning.keep[stream];
  for (let i = keep - 1; i >= 1; i--) {
    await rename(`${path}.${i}`, `${path}.${i + 1}`).catch(() => {});
  }
  await rename(path, `${path}.1`);
}

/* ---------- Access-log throttle (per process) ---------- */

const MAX_KEYS = 5_000;
const repeats = new Map<string, { last: number; count: number }>();
let minute = { start: 0, written: 0 };
/** Events dropped by the per-minute cap, reported in one line with the next written entry. */
let pendingSuppressed = 0;

/** Decides whether an access event is written now. Never writes or logs itself. */
function throttle(event: AuditEvent): { write: false } | { write: true; repeats: number; suppressedBefore: number } {
  const now = auditTuning.now();
  if (now - minute.start >= 60_000) minute = { start: now, written: 0 };
  const key = `${event.action}\u0000${event.outcome}\u0000${event.adminId}\u0000${event.ip ? ipHash(event.ip) : ""}`;
  const seen = repeats.get(key);
  if (seen && now - seen.last < auditTuning.repeatWindowMs) {
    seen.count++;
    return { write: false };
  }
  if (minute.written >= auditTuning.accessPerMinute) {
    pendingSuppressed++;
    return { write: false };
  }
  minute.written++;
  const suppressedBefore = pendingSuppressed;
  pendingSuppressed = 0;
  repeats.delete(key);
  repeats.set(key, { last: now, count: 0 });
  if (repeats.size > MAX_KEYS) {
    for (const [k, v] of repeats) {
      if (repeats.size <= MAX_KEYS * 0.9) break;
      if (now - v.last >= auditTuning.repeatWindowMs) repeats.delete(k);
    }
    for (const k of repeats.keys()) {
      if (repeats.size <= MAX_KEYS) break;
      repeats.delete(k);
    }
  }
  return { write: true, repeats: seen?.count ?? 0, suppressedBefore };
}

function append(stream: Stream, entries: Record<string, unknown>[]): Promise<void> {
  const dir = storeDir();
  if (!dir) return Promise.resolve();
  const path = join(dir, FILES[stream]);
  chain = chain.then(async () => {
    try {
      const done = await withLock(path, async () => {
        await rotateIfNeeded(path, stream);
        let prevHash = await tailHash(path);
        let out = "";
        for (const entry of entries) {
          const line = JSON.stringify({ ...entry, prevHash });
          prevHash = createHash("sha256").update(line).digest("hex");
          out += `${line}\n`;
        }
        await appendFile(path, out, { mode: 0o600 });
      });
      if (done === "busy") console.error("[audit] audit log busy; entry not written");
    } catch {
      console.error("[audit] could not write the audit log");
    }
  });
  return chain;
}

function entryOf(event: AuditEvent, at: string, extra?: Record<string, unknown>) {
  const changes = { ...(event.changes ?? {}), ...(extra ?? {}) };
  return {
    at,
    adminId: event.adminId,
    action: event.action,
    outcome: event.outcome,
    ...(event.ip ? { ipHash: ipHash(event.ip) } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
  };
}

export function audit(event: AuditEvent): Promise<void> {
  if (!storeDir()) return Promise.resolve();
  const at = new Date(auditTuning.now()).toISOString();
  if (event.adminId !== "anonymous" && !event.preAuth) return append("main", [entryOf(event, at)]);

  const t = throttle(event);
  if (!t.write) return chain;
  const entries: Record<string, unknown>[] = [];
  if (t.suppressedBefore) {
    entries.push({ at, adminId: "system", action: "access.suppressed", outcome: "success", changes: { count: t.suppressedBefore } });
  }
  entries.push(entryOf(event, at, t.repeats ? { repeats: t.repeats } : undefined));
  return append("access", entries);
}

export type AuditLine = {
  at: string;
  adminId: string;
  action: string;
  outcome: string;
  ipHash?: string;
  changes?: Record<string, unknown>;
  detail?: string;
};

/** The most recent `n` entries of the security log, newest first. */
export async function recentAudit(n = 50): Promise<AuditLine[]> {
  const dir = storeDir();
  if (!dir) return [];
  try {
    const text = await readFile(join(dir, FILES.main), "utf8");
    return text
      .trimEnd()
      .split("\n")
      .slice(-n)
      .reverse()
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AuditLine];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Verifies the hash chain of the current file of a stream. */
export async function verifyAuditChain(stream: Stream = "main"): Promise<{ ok: boolean; lines: number; brokenAt?: number }> {
  const dir = storeDir();
  if (!dir) return { ok: true, lines: 0 };
  let text = "";
  try {
    text = await readFile(join(dir, FILES[stream]), "utf8");
  } catch {
    return { ok: true, lines: 0 };
  }
  const lines = text.trimEnd().split("\n").filter(Boolean);
  let prev: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    let entry: { prevHash?: unknown };
    try {
      entry = JSON.parse(lines[i]) as { prevHash?: unknown };
    } catch {
      return { ok: false, lines: lines.length, brokenAt: i + 1 };
    }
    if (prev !== null && entry.prevHash !== prev) return { ok: false, lines: lines.length, brokenAt: i + 1 };
    prev = createHash("sha256").update(lines[i]).digest("hex");
  }
  return { ok: true, lines: lines.length };
}
