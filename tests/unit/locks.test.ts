// The cross-process store lock: a live holder's lock is never broken; a dead holder's lock is
// reclaimed even when its PID has been reused; malformed records and competing reclaimers are safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "calix-locks-"));
process.env.SETTINGS_DIR = dir;
const { withLock, processIdentity, identityOf, lockTestHooks, reclaimGuard } = await import("@/lib/settings/store");

const target = join(dir, "settings.json");
const lock = `${target}.lock`;
const old = () => new Date(Date.now() - 5 * 60 * 1000);
function plant(content: string, aged = true) {
  writeFileSync(lock, content);
  if (aged) utimesSync(lock, old(), old());
}
const plantAt = (path: string, content: string, aged = true) => {
  writeFileSync(path, content);
  if (aged) utimesSync(path, old(), old());
};
const guards = () => readdirSync(dir).filter((f) => f.includes(".reclaim-"));
const deadPid = () => Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);

test("the lock records the holder's process identity (boot + start time), not only its PID", async () => {
  let seen = "";
  await withLock(target, async () => {
    seen = readFileSync(lock, "utf8");
  });
  const record = JSON.parse(seen);
  assert.equal(record.pid, process.pid);
  assert.equal(record.start, processIdentity());
  assert.ok(processIdentity(), "this platform exposes /proc");
  assert.ok(!existsSync(lock), "released");
});

test("a live holder is never broken, however old", async () => {
  plant(JSON.stringify({ pid: process.pid, token: "live", start: processIdentity() }));
  assert.equal(await withLock(target, async () => "ran"), "busy");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "live");
  // PID 1 is alive; with its real identity the lock is live too.
  plant(JSON.stringify({ pid: 1, token: "init", start: identityOf(1) }));
  assert.equal(await withLock(target, async () => "ran"), "busy");
});

test("a dead holder's lock is reclaimed", async () => {
  plant(JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" }));
  assert.equal(await withLock(target, async () => "ran"), "ran");
  assert.ok(!existsSync(lock));
});

test("PID reuse: a lock whose PID now belongs to a different process is reclaimed", async () => {
  // The holder crashed; a new process (here: this one, or init) now has the same PID.
  plant(JSON.stringify({ pid: process.pid, token: "previous-life", start: `${processIdentity()!.split(":")[0]}:1` }));
  assert.equal(await withLock(target, async () => "ran"), "ran", "same PID as this process, different start");
  plant(JSON.stringify({ pid: 1, token: "previous-life", start: "another-boot:42" }));
  assert.equal(await withLock(target, async () => "ran"), "ran", "same PID as init, different identity");
});

test("records from the previous lock format (no identity) stay safe", async () => {
  // Another live process's legacy record: still never broken.
  plant(JSON.stringify({ pid: 1, token: "legacy" }));
  assert.equal(await withLock(target, async () => "ran"), "busy");
  // A legacy record naming this process's own PID can't be ours (we always record an identity).
  plant(JSON.stringify({ pid: process.pid, token: "legacy" }));
  assert.equal(await withLock(target, async () => "ran"), "ran");
});

test("malformed records are reclaimed once old, and never while young", async () => {
  for (const content of ["", "not json", "{}", '{"pid":"abc"}', '{"pid":-5}', '{"pid":1.5}', "[1,2]"]) {
    plant(content, false);
    assert.equal(await withLock(target, async () => "ran"), "busy", `young: ${JSON.stringify(content)}`);
    plant(content, true);
    assert.equal(await withLock(target, async () => "ran"), "ran", `old: ${JSON.stringify(content)}`);
  }
});

test("a holder only removes its own lock", async () => {
  await withLock(target, async () => {
    // Something else replaces the lock while we hold it (it must not be removed by us).
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "someone-else", start: processIdentity() }));
  });
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "someone-else");
  writeFileSync(lock, "");
  utimesSync(lock, old(), old());
  await withLock(target, async () => "cleanup");
});

test("competing reclaimers of one dead lock never run their critical sections at once", async () => {
  const marker = join(dir, "inside");
  plant(JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" }));
  const script = `
    const { withLock } = await import("@/lib/settings/store");
    const fs = await import("node:fs");
    for (let i = 0; i < 5; i++) {
      for (;;) {
        const r = await withLock(${JSON.stringify(target)}, async () => {
          fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid), { flag: "wx" }); // throws if another holder is inside
          await new Promise((r) => setTimeout(r, 15));
          fs.rmSync(${JSON.stringify(marker)});
          fs.appendFileSync(${JSON.stringify(join(dir, "count"))}, "x");
          return "ok";
        });
        if (r === "ok") break;
      }
    }`;
  const run = () =>
    new Promise<number>((res) => {
      const p = spawn(process.execPath, ["--import", "./scripts/register-ts.mjs", "--input-type=module", "-e", script], { cwd: root, env: process.env, stdio: "inherit" });
      p.on("exit", (code) => res(code ?? 1));
    });
  const codes = await Promise.all(Array.from({ length: 6 }, run));
  assert.deepEqual(codes, Array(6).fill(0), "no overlap (a child exits non-zero if it finds another inside)");
  assert.equal(readFileSync(join(dir, "count"), "utf8").length, 30);
});

test("a paused reclaimer can't delete the lock another reclaimer has just taken (deterministic)", async () => {
  plant(JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" }));
  let inside = 0;
  let overlap = false;
  // Long enough that B is still inside when A resumes.
  const critical = async () => {
    inside++;
    if (inside > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 700));
    inside--;
    return "ok";
  };
  let release!: () => void;
  const paused = new Promise<void>((r) => (release = r));
  let first = true;
  lockTestHooks.beforeReclaimRemove = async () => {
    if (!first) return;
    first = false;
    // Reclaimer A has confirmed the lock is stale. Let B run now; A continues afterwards.
    setTimeout(release, 300);
    await paused;
  };
  try {
    const a = withLock(target, critical);
    await new Promise((r) => setTimeout(r, 50));
    const b = withLock(target, critical);
    assert.deepEqual(await Promise.all([a, b]), ["ok", "ok"]);
    assert.equal(overlap, false, "the two critical sections never overlapped");
  } finally {
    lockTestHooks.beforeReclaimRemove = null;
  }
});

test("locks held for over a minute are listed by file name only (for the status page)", async () => {
  const { longHeldLocks } = await import("@/lib/settings/store");
  plant(JSON.stringify({ pid: process.pid, token: "live", start: processIdentity() }));
  const held = await longHeldLocks(60_000);
  assert.deepEqual(held.map((h) => h.file), ["settings.json"]);
  assert.ok(held[0].seconds >= 299);
  assert.ok(!JSON.stringify(held).includes(dir), "no paths");
  writeFileSync(lock, "");
  utimesSync(lock, old(), old());
  await withLock(target, async () => "cleanup");
  assert.deepEqual(await longHeldLocks(60_000), []);
});

test("a guard left by a crashed reclaimer is cleared, and the stale lock is then taken", async () => {
  const stale = JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" });
  plant(stale);
  plantAt(reclaimGuard(lock, stale), JSON.stringify({ pid: deadPid(), token: "crashed-reclaimer", start: "x:2" }));
  assert.equal(await withLock(target, async () => "ran"), "ran");
  assert.deepEqual(guards(), [], "no guard files left");
  assert.ok(!existsSync(lock));
});

test("guards left after a crash (their lock already gone) are swept on the next save", async () => {
  plantAt(reclaimGuard(lock, "content that no longer exists"), JSON.stringify({ pid: deadPid(), token: "crashed", start: "x:3" }));
  plantAt(`${reclaimGuard(lock, "other")}.reclaim-0123456789abcdef`, "");
  assert.equal(await withLock(target, async () => "ran"), "ran");
  assert.deepEqual(guards(), []);
});

test("a live reclaimer's guard is never removed: waiters back off and give up with 'busy' at the deadline", { timeout: 20_000 }, async () => {
  const stale = JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" });
  plant(stale);
  const guard = reclaimGuard(lock, stale);
  const live = JSON.stringify({ pid: process.pid, token: "live-reclaimer", start: processIdentity() });
  plantAt(guard, live); // old, but its holder is alive (hung, say)
  const cpu = process.cpuUsage();
  const t0 = Date.now();
  assert.equal(await withLock(target, async () => "ran"), "busy");
  const elapsed = Date.now() - t0;
  const used = process.cpuUsage(cpu);
  assert.ok(elapsed >= 5000 && elapsed < 7000, `gave up at the deadline (${elapsed} ms)`);
  assert.ok((used.user + used.system) / 1000 < 1500, `backed off instead of spinning (${Math.round((used.user + used.system) / 1000)} ms CPU)`);
  assert.equal(readFileSync(guard, "utf8"), live, "the live guard is untouched");
  assert.equal(readFileSync(lock, "utf8"), stale, "and so is the lock it protects");
  // Cleanup: the "hung" reclaimer goes away.
  writeFileSync(guard, "");
  utimesSync(guard, old(), old());
  assert.equal(await withLock(target, async () => "ran"), "ran");
  assert.deepEqual(guards(), []);
});

test("clearing an abandoned guard can't remove a guard another reclaimer holds (deterministic)", async () => {
  const stale = JSON.stringify({ pid: deadPid(), token: "dead", start: "x:1" });
  plant(stale);
  const guard = reclaimGuard(lock, stale);
  const abandoned = JSON.stringify({ pid: deadPid(), token: "crashed", start: "x:4" });
  plantAt(guard, abandoned);
  let inside = 0;
  let overlap = false;
  const critical = async () => {
    inside++;
    if (inside > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 100));
    inside--;
    return "ok";
  };
  let release!: () => void;
  const paused = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const atPause = new Promise<void>((r) => (reached = r));
  lockTestHooks.beforeReclaimRemove = async (path) => {
    if (path !== guard) return;
    lockTestHooks.beforeReclaimRemove = null;
    reached();
    await paused; // D has verified the abandoned guard and is about to remove it
  };
  try {
    const d = withLock(target, critical);
    await atPause;
    const c = withLock(target, critical); // C finds the same abandoned guard meanwhile
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(readFileSync(guard, "utf8"), abandoned, "C did not remove the guard D is clearing");
    assert.ok(existsSync(reclaimGuard(guard, abandoned)), "D holds the guard for clearing it");
    release();
    assert.deepEqual(await Promise.all([d, c]), ["ok", "ok"]);
    assert.equal(overlap, false);
    assert.deepEqual(guards(), []);
  } finally {
    lockTestHooks.beforeReclaimRemove = null;
  }
});
