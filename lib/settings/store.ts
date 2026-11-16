import "server-only";
import { constants, readFileSync } from "node:fs";
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { STORE_FILES, STORE_VERSION, type StoreName, type StoreValue } from "./schema";

/**
 * File-based settings store (docs/admin-panel-audit/ADMIN_PANEL_AUDIT.md §6).
 *
 * - Files live in SETTINGS_DIR (absolute path, outside the repository, set by the operator).
 *   File names are fixed (STORE_FILES); no path ever comes from input.
 * - Writes are atomic: write a temporary file, fsync, keep the previous file as `.bak`, rename over
 *   the target, fsync the directory. A crash leaves either the old or the new file, never a mix.
 * - Writers are serialised in-process (a promise queue) and across processes (an exclusive lock
 *   file). Each write may carry the revision it was based on; a mismatch is refused ("conflict").
 * - Every read is validated. An invalid file is never used: the last valid in-memory copy, then the
 *   `.bak`, then "no value" (callers fall back to code defaults). Reads never throw.
 */

export type StoreStatus = { configured: boolean; ok: boolean; problem?: string; dir?: string };

export function storeDir(): string | null {
  const dir = process.env.SETTINGS_DIR?.trim();
  return dir && isAbsolute(dir) ? dir : null;
}

/**
 * Whether SETTINGS_DIR is usable. By default a permission check only (no files written), cheap
 * enough for any request. `probe: true` also writes and removes a small file, which catches a
 * read-only or full disk; the admin status page uses it.
 */
export async function storeStatus(opts: { probe?: boolean } = {}): Promise<StoreStatus> {
  const dir = storeDir();
  if (!dir) return { configured: false, ok: false, problem: "SETTINGS_DIR is not set to an absolute path." };
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return { configured: true, ok: false, dir, problem: "SETTINGS_DIR is not a directory." };
    // Windows has no POSIX permission bits (every directory reports as writable), so this check
    // applies on the Linux production server only.
    if (process.platform !== "win32" && (s.mode & 0o002) !== 0) return { configured: true, ok: false, dir, problem: "SETTINGS_DIR is world-writable." };
    await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    if (opts.probe) {
      const probe = join(dir, `.probe-${process.pid}`);
      const fh = await open(probe, "w", 0o600);
      await fh.close();
      await rm(probe, { force: true });
    }
    return { configured: true, ok: true, dir };
  } catch (error) {
    return { configured: true, ok: false, dir, problem: `SETTINGS_DIR is not writable (${(error as NodeJS.ErrnoException).code ?? "error"}).` };
  }
}

const fileOf = (dir: string, name: StoreName) => join(dir, `${name}.json`);

type Cached = { key: string; value: unknown };
const cache = new Map<string, Cached>();

async function parseFile<N extends StoreName>(path: string, name: N): Promise<StoreValue<N> | null> {
  const raw = await readFile(path, "utf8");
  const result = STORE_FILES[name].safeParse(JSON.parse(raw));
  if (!result.success) throw new Error("invalid");
  return result.data as StoreValue<N>;
}

/** Reads and validates a store file. `null` when not configured, missing or unusable. */
export async function readStore<N extends StoreName>(name: N): Promise<StoreValue<N> | null> {
  const dir = storeDir();
  if (!dir) return null;
  const path = fileOf(dir, name);
  let key: string;
  try {
    const s = await stat(path);
    key = `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch {
    return null; // no file yet: callers use defaults
  }
  const hit = cache.get(path);
  if (hit?.key === key) return hit.value as StoreValue<N>;
  try {
    const value = await parseFile(path, name);
    cache.set(path, { key, value });
    return value;
  } catch {
    console.error(`[settings] ${name}.json is unreadable or invalid; using the last valid copy`);
    if (hit) return hit.value as StoreValue<N>;
    try {
      return await parseFile(`${path}.bak`, name);
    } catch {
      return null;
    }
  }
}

export type WriteResult<N extends StoreName> =
  | { ok: true; value: StoreValue<N> }
  | { ok: false; reason: "unavailable" | "conflict" | "invalid" | "busy" | "unchanged"; issues?: { path: string; message: string }[] };

const queues = new Map<string, Promise<unknown>>();

function serialise<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(key, next.catch(() => {}));
  return next;
}

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const GUARD_STALE_MS = 10_000;

let bootId: string | null | undefined;
function boot(): string | null {
  if (bootId === undefined) {
    try {
      bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
    } catch {
      bootId = null;
    }
  }
  return bootId;
}

/**
 * A process's identity: the machine's boot ID plus the kernel's start time for that PID (field 22
 * of /proc/<pid>/stat). Unlike a PID alone, it changes when a PID is reused by another process,
 * including after a restart that hands the same PID to a new process. Null where /proc is missing.
 */
export function identityOf(pid: number): string | null {
  const b = boot();
  if (!b || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" "); // fields from 3 onwards
    return `${b}:${fields[19]}`;
  } catch {
    return null;
  }
}

let ownIdentity: string | null | undefined;
export function processIdentity(): string | null {
  if (ownIdentity === undefined) ownIdentity = identityOf(process.pid);
  return ownIdentity;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by another user
  }
}

type LockRecord = { pid?: unknown; token?: unknown; start?: unknown };

/**
 * Whether the process that wrote a lock record is still running. Requires a valid PID that exists
 * and, when the record and the platform carry a start identity, the same identity: a PID now used
 * by a different process (reuse after a crash or restart) counts as gone. Without /proc, the PID
 * check alone applies (documented residual).
 */
function holderAlive(raw: string): boolean {
  let record: LockRecord;
  try {
    record = JSON.parse(raw) as LockRecord;
  } catch {
    return false;
  }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
  const pid = record.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || !pidExists(pid)) return false;
  const now = identityOf(pid);
  if (typeof record.start === "string" && now !== null) return record.start === now;
  // A record without an identity on a platform that has one: written by an older version. If its
  // PID is this process, it can't be ours (we always record an identity), so it is stale.
  if (typeof record.start !== "string" && now !== null && pid === process.pid) return false;
  return true;
}

/** The lock's content when it may be taken over (old enough and its holder gone), else null. */
async function staleContent(path: string, staleMs: number): Promise<string | null> {
  let raw = "";
  let mtime = 0;
  try {
    [raw, mtime] = await Promise.all([readFile(path, "utf8"), stat(path).then((s) => s.mtimeMs)]);
  } catch {
    return null; // gone already: retry
  }
  if (Date.now() - mtime < staleMs) return null;
  return holderAlive(raw) ? null : raw;
}

const record = (token: string) => JSON.stringify({ pid: process.pid, token, start: processIdentity(), at: new Date().toISOString() });

/** Test seam: lets a test pause a reclaimer just before it removes `path`. Unused otherwise. */
export const lockTestHooks: { beforeReclaimRemove: null | ((path: string) => Promise<void>) } = { beforeReclaimRemove: null };

const GUARD = ".reclaim-";

/** The guard file that serialises removing exactly `content` from `path` (one name per content). */
export function reclaimGuard(path: string, content: string): string {
  return `${path}${GUARD}${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}

type Removal = "removed" | "gone" | "contended";

/**
 * Removes `path` (a stale lock, or an abandoned guard) if it still holds exactly `content`.
 *
 * Only the process that created reclaimGuard(path, content) with O_EXCL may remove that content,
 * so its check-then-remove can't race another remover. Because the guard's name comes from the
 * content, clearing an abandoned guard can never delete a newer guard: newer content has another
 * name. A guard left by a crashed reclaimer is cleared the same way (one level down) once it is
 * old and its holder is gone; a live holder's guard is never removed by anyone else.
 */
async function removeIfStill(path: string, content: string, depth = 0): Promise<Removal> {
  const guard = reclaimGuard(path, content);
  const token = randomBytes(9).toString("base64url");
  let fh;
  try {
    fh = await open(guard, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Someone else is removing this content, or crashed while doing so.
    const abandoned = depth < 3 ? await staleContent(guard, GUARD_STALE_MS) : null;
    if (abandoned !== null) await removeIfStill(guard, abandoned, depth + 1);
    return "contended";
  }
  try {
    await fh.writeFile(record(token));
  } catch (error) {
    await fh.close();
    await rm(guard, { force: true });
    throw error;
  }
  await fh.close();
  try {
    if ((await readFile(path, "utf8").catch(() => null)) !== content) return "gone";
    await lockTestHooks.beforeReclaimRemove?.(path);
    await rm(path, { force: true });
    return "removed";
  } finally {
    // Ours: while this process is alive nobody else removes it, and its name is ours alone.
    await rm(guard, { force: true });
  }
}

/** Clears guards left next to `lock` by reclaimers that crashed (old, holder gone). Best effort. */
async function sweepGuards(lock: string) {
  try {
    const prefix = `${basename(lock)}${GUARD}`;
    for (const name of await readdir(dirname(lock))) {
      if (!name.startsWith(prefix)) continue;
      const path = join(dirname(lock), name);
      const abandoned = await staleContent(path, GUARD_STALE_MS);
      if (abandoned !== null) await removeIfStill(path, abandoned);
    }
  } catch {
    // the next save tries again
  }
}

const pause = (attempt: number) => new Promise((r) => setTimeout(r, Math.min(400, 25 * 2 ** attempt) * (0.5 + Math.random())));

/**
 * Runs `task` holding an exclusive lock file next to `path`, across processes. The lock records
 * the holder's PID, start identity and a random token. Only its holder removes it; a lock is taken
 * over only when it is older than LOCK_STALE_MS *and* its holder is gone. A live holder's lock is
 * never broken. Waiting, including behind another reclaimer, backs off and gives up after
 * LOCK_WAIT_MS with "busy".
 */
export async function withLock<T>(path: string, task: () => Promise<T>): Promise<T | "busy"> {
  const lock = `${path}.lock`;
  const token = randomBytes(9).toString("base64url");
  const deadline = Date.now() + LOCK_WAIT_MS;
  let contended = 0;
  for (;;) {
    let fh;
    try {
      fh = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stale = await staleContent(lock, LOCK_STALE_MS);
      // Progress (the stale lock is gone): try again at once. Otherwise wait, within the deadline.
      if (stale !== null && (await removeIfStill(lock, stale)) !== "contended") continue;
      if (Date.now() > deadline) return "busy";
      await (stale !== null ? pause(contended++) : new Promise((r) => setTimeout(r, 25 + Math.random() * 50)));
      continue;
    }
    try {
      await fh.writeFile(record(token));
    } finally {
      await fh.close();
    }
    try {
      await sweepGuards(lock);
      return await task();
    } finally {
      const content = await readFile(lock, "utf8").catch(() => "");
      if (content.includes(`"token":"${token}"`)) await rm(lock, { force: true });
    }
  }
}

/** Lock files held longer than `olderThanMs`, by store file name (for the status page). */
export async function longHeldLocks(olderThanMs = 60_000): Promise<{ file: string; seconds: number }[]> {
  const dir = storeDir();
  if (!dir) return [];
  const out: { file: string; seconds: number }[] = [];
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".lock") && !name.includes(`.lock${GUARD}`)) continue;
      const age = Date.now() - (await stat(join(dir, name))).mtimeMs;
      if (age > olderThanMs) out.push({ file: name.replace(/\.lock(\.reclaim-.*)?$/, ""), seconds: Math.round(age / 1000) });
    }
  } catch {
    // unreadable folder: the storage check reports it
  }
  return out;
}

async function atomicWrite(dir: string, path: string, data: string) {
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  const fh = await open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await copyFile(path, `${path}.bak`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(tmp, path);
  // Windows can't fsync a directory (EPERM); the rename above is already complete there.
  if (process.platform === "win32") return;
  const d = await open(dir, "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}

/**
 * Updates a store file. `change` receives the current valid value (or null) and returns the new
 * content without the metadata. With `baseRevision`, the write is refused if the file changed since.
 */
export async function updateStore<N extends StoreName>(
  name: N,
  change: (current: StoreValue<N> | null) => Omit<StoreValue<N>, "version" | "revision" | "updatedAt" | "updatedBy"> | null,
  opts: { by: string; baseRevision?: number },
): Promise<WriteResult<N>> {
  const status = await storeStatus();
  const dir = status.ok ? storeDir() : null;
  if (!dir) return { ok: false, reason: "unavailable" };
  await mkdir(dir, { recursive: true });
  const path = fileOf(dir, name);
  return serialise(path, async () => {
    const outcome = await withLock(path, async (): Promise<WriteResult<N>> => {
      cache.delete(path);
      const current = await readStore(name);
      const currentRevision = current?.revision ?? 0;
      if (opts.baseRevision !== undefined && opts.baseRevision !== currentRevision) {
        return { ok: false, reason: "conflict" };
      }
      const changed = change(current);
      // `change` may decline (e.g. a code turned out to be already used): nothing is written.
      if (changed === null) return { ok: false, reason: "unchanged" };
      const next = {
        ...changed,
        version: STORE_VERSION,
        revision: currentRevision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: opts.by,
      };
      const parsed = STORE_FILES[name].safeParse(next);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "invalid",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
      }
      await atomicWrite(dir, path, `${JSON.stringify(parsed.data, null, 2)}\n`);
      cache.delete(path);
      return { ok: true, value: parsed.data as StoreValue<N> };
    });
    return outcome === "busy" ? { ok: false, reason: "busy" } : outcome;
  });
}

/** Test helper: forget cached reads. */
export function clearStoreCache() {
  cache.clear();
}

export type FileHealth = {
  name: StoreName;
  state: "missing" | "valid" | "invalid";
  revision?: number;
  updatedAt?: string;
  /** Permission bits, e.g. 0o600. */
  mode?: number;
  backup: "missing" | "valid" | "invalid";
};

/** Health of one store file and its `.bak`, for the admin status page. Never returns content. */
export async function inspectStoreFile(name: StoreName): Promise<FileHealth> {
  const dir = storeDir();
  if (!dir) return { name, state: "missing", backup: "missing" };
  const path = fileOf(dir, name);
  const check = async (p: string) => {
    try {
      const value = await parseFile(p, name);
      return { state: "valid" as const, value };
    } catch (error) {
      return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? ("missing" as const) : ("invalid" as const), value: null };
    }
  };
  const [main, bak] = await Promise.all([check(path), check(`${path}.bak`)]);
  let mode: number | undefined;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch {
    // missing
  }
  return {
    name,
    state: main.state,
    revision: main.value?.revision,
    updatedAt: main.value?.updatedAt,
    mode,
    backup: bak.state,
  };
}

/**
 * Replaces a whole store file with an already-validated value, keeping the revision moving
 * forward (restore only, lib/admin/restore.ts). Same lock and atomic write as updateStore.
 */
export async function replaceStore<N extends StoreName>(name: N, value: StoreValue<N>, by: string): Promise<WriteResult<N>> {
  return updateStore(
    name,
    () => {
      const { version: _v, revision: _r, updatedAt: _u, updatedBy: _b, ...content } = value as StoreValue<N> & Record<string, unknown>;
      void _v;
      void _r;
      void _u;
      void _b;
      return content as Omit<StoreValue<N>, "version" | "revision" | "updatedAt" | "updatedBy">;
    },
    { by },
  );
}

/** Parses and validates store content from text (restore only). Null when invalid. */
export function parseStoreText<N extends StoreName>(name: N, text: string): StoreValue<N> | null {
  try {
    const r = STORE_FILES[name].safeParse(JSON.parse(text));
    return r.success ? (r.data as StoreValue<N>) : null;
  } catch {
    return null;
  }
}
