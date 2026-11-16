// Heartbeat files that let the status page notice a second process using the same settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "calix-inst-"));
process.env.SETTINGS_DIR = dir;
const { registerInstance, liveInstances, stopInstance } = await import("@/lib/admin/instances");

test("this process registers itself and is listed as live", async () => {
  await registerInstance();
  const live = await liveInstances();
  assert.deepEqual(live.map((i) => i.pid), [process.pid]);
});

test("a second live process is listed; dead or silent ones are not", async () => {
  const inst = join(dir, "instances");
  mkdirSync(inst, { recursive: true });
  const host = hostname();
  // A live process (the test runner's parent shell is alive: use PID 1, always present).
  writeFileSync(join(inst, `${host}-1.json`), JSON.stringify({ pid: 1, host, startedAt: new Date().toISOString() }));
  // A process that has exited.
  const gone = Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  writeFileSync(join(inst, `${host}-${gone}.json`), JSON.stringify({ pid: gone, host, startedAt: new Date().toISOString() }));
  // A heartbeat that stopped long ago, on another machine.
  writeFileSync(join(inst, "other-host-42.json"), JSON.stringify({ pid: 42, host: "other-host", startedAt: "x" }));
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(join(inst, "other-host-42.json"), old, old);
  const live = (await liveInstances()).map((i) => i.pid).sort((a, b) => a - b);
  assert.deepEqual(live, [1, process.pid]);
});

test("stopping removes this process's heartbeat", async () => {
  await stopInstance();
  assert.ok(!existsSync(join(dir, "instances", `${hostname()}-${process.pid}.json`)));
});
