// `admin-user restore`: refuses unsafe situations without changing anything, never revives
// disabled accounts or old sessions, never overwrites audit logs or the backup itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const backupScript = join(root, "deploy/backup-settings.sh");
const PW = "correct horse battery staple";
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

type Env = Record<string, string>;
function setup(key = KEY_A) {
  const work = mkdtempSync(join(tmpdir(), "calix-restore-"));
  const dir = join(work, "settings");
  mkdirSync(dir, { mode: 0o700 });
  const env: Env = { SETTINGS_DIR: dir, SESSION_SECRET: randomBytes(32).toString("hex"), SETTINGS_ENCRYPTION_KEY: key };
  return { work, dir, env };
}
const cli = (env: Env, ...args: string[]) =>
  spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "scripts/admin-user.mts", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    input: `${PW}\n${PW}\n`,
    encoding: "utf8",
  });
/** Runs code against the store as a separate process (fresh module state per call). */
function store(env: Env, code: string) {
  const r = spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const settings = (env: Env, footer: string) =>
  store(env, `const { updateStore } = await import("@/lib/settings/store");
    const r = await updateStore("settings", () => ({ business: {}, contact: { phonesAdditional: [] }, social: { profiles: [] }, footer: { copyrightText: ${JSON.stringify(footer)} }, form: { acceptingEnquiries: true } }), { by: "t" });
    if (!r.ok) throw new Error(r.reason);`);
const withTotp = (env: Env) =>
  store(env, `const { updateStore } = await import("@/lib/settings/store"); const { seal } = await import("@/lib/settings/crypto");
    await updateStore("admins", (cur) => ({ admins: cur.admins.map((a) => ({ ...a, totp: { sealed: seal("JBSWY3DPEHPK3PXP"), lastStep: 1 } })) }), { by: "t" });`);
const backup = (w: { work: string; dir: string }) => {
  const r = spawnSync("bash", [backupScript, w.dir, join(w.work, "backups")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const json = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const snapshot = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => !f.endsWith(".lock"))
      .sort()
      .map((f) => [f, existsSync(join(dir, f)) && !f.startsWith("pre-restore") && !f.startsWith("instances") ? sha(join(dir, f)) : "dir"]),
  );

test("refuses while the site is running (a live heartbeat), changing nothing", () => {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  settings(w.env, "A");
  const archive = backup(w);
  mkdirSync(join(w.dir, "instances"), { recursive: true });
  writeFileSync(join(w.dir, "instances", `${hostname()}-1.json`), JSON.stringify({ pid: 1, host: hostname(), startedAt: "x" }));
  const before = snapshot(w.dir);
  const r = cli(w.env, "restore", archive);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /The site is running\. Stop it first/);
  assert.deepEqual(snapshot(w.dir), before);
  rmSync(w.work, { recursive: true, force: true });
});

test("refuses unsafe or invalid archives, changing nothing", () => {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  settings(w.env, "A");
  const before = snapshot(w.dir);
  const craft = (name: string, build: string) => {
    const src = join(w.work, name);
    mkdirSync(src);
    spawnSync("bash", ["-c", build], { cwd: src });
    const out = join(w.work, `${name}.tar.gz`);
    spawnSync("tar", ["-C", src, "-czf", out, "."]);
    return out;
  };
  const traversal = join(w.work, "traversal.tar.gz");
  spawnSync("python3", ["-I", "-c", `import tarfile,io\nt=tarfile.open(${JSON.stringify(traversal)},"w:gz")\nd=b"{}"\ni=tarfile.TarInfo("../escape.json");i.size=len(d);t.addfile(i,io.BytesIO(d))\nt.close()`]);
  const cases: Array<[string, RegExp]> = [
    [traversal, /unsafe path/],
    [craft("symlink", "ln -s /etc/hostname settings.json"), /not a regular file/],
    [craft("badjson", "echo '{ not json' > settings.json"), /settings\.json in the archive is not valid/],
    [craft("empty", "echo hi > readme.txt"), /holds no settings files/],
    [join(w.work, "missing.tar.gz"), /Archive not found/],
  ];
  writeFileSync(join(w.work, "notgz.tar.gz"), "not an archive");
  cases.push([join(w.work, "notgz.tar.gz"), /can't be read/]);
  for (const [archive, message] of cases) {
    const r = cli(w.env, "restore", archive);
    assert.notEqual(r.status, 0, archive);
    assert.match(r.stderr, message, archive);
    assert.deepEqual(snapshot(w.dir), before, `unchanged after ${archive}`);
  }
  assert.ok(!existsSync(join(w.work, "escape.json")) && !existsSync(join(w.dir, "..", "escape.json")));
  rmSync(w.work, { recursive: true, force: true });
});

test("default: live administrators are kept, so a disabled account stays disabled; settings are restored", () => {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  assert.equal(cli(w.env, "add", "editor@example.com").status, 0);
  settings(w.env, "From the backup");
  const archive = backup(w);
  const archiveHash = sha(archive);
  settings(w.env, "Changed after the backup");
  assert.equal(cli(w.env, "disable", "editor@example.com").status, 0);
  const adminsBefore = readFileSync(join(w.dir, "admins.json"), "utf8");
  const auditBefore = readFileSync(join(w.dir, "audit.log"), "utf8");

  const r = cli(w.env, "restore", archive);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Administrators: kept from the live server/);
  assert.equal(json(w.dir, "settings.json").footer.copyrightText, "From the backup");
  assert.ok(json(w.dir, "settings.json").revision > 2, "revision moves forward");
  assert.equal(readFileSync(join(w.dir, "admins.json"), "utf8"), adminsBefore, "administrators untouched");
  assert.equal(json(w.dir, "admins.json").admins.find((a: { email: string }) => a.email === "editor@example.com").status, "disabled");
  // Audit history is never overwritten; the restore is appended.
  const auditAfter = readFileSync(join(w.dir, "audit.log"), "utf8");
  assert.ok(auditAfter.startsWith(auditBefore));
  assert.match(auditAfter.slice(auditBefore.length), /"action":"settings\.restore"/);
  // What was replaced is kept aside, with the archive's audit logs for reference.
  const aside = readdirSync(w.dir).find((f) => f.startsWith("pre-restore-"))!;
  assert.equal(json(join(w.dir, aside), "settings.json").footer.copyrightText, "Changed after the backup");
  assert.ok(existsSync(join(w.dir, aside, "archive-audit", "audit.log")));
  // The marker holds a one-way check, never the secret; the archive is unchanged.
  const marker = readFileSync(join(w.dir, "restore.json"), "utf8");
  assert.ok(!marker.includes(w.env.SESSION_SECRET));
  assert.equal(sha(archive), archiveHash);
  rmSync(w.work, { recursive: true, force: true });
});

test("--restore-admins brings every restored account back disabled, with a new session version", () => {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  const archive = backup(w);
  const version = json(w.dir, "admins.json").admins[0].sessionVersion;
  const r = cli(w.env, "restore", archive, "--restore-admins");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /all DISABLED: owner@example\.com/);
  const a = json(w.dir, "admins.json").admins[0];
  assert.equal(a.status, "disabled");
  assert.equal(a.sessionVersion, version + 1);
  assert.equal(a.revokedSessions, undefined);
  rmSync(w.work, { recursive: true, force: true });
});

test("a backup made with an earlier key: refused without the old key, restored with it, then rekeyed", () => {
  const w = setup(KEY_A);
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  withTotp(w.env);
  const archive = backup(w);
  // The key is rotated afterwards and the live admins file is lost (so admins come from the backup).
  rmSync(join(w.dir, "admins.json"));
  rmSync(join(w.dir, "admins.json.bak"), { force: true });
  const rotated = { ...w.env, SETTINGS_ENCRYPTION_KEY: KEY_B };
  const before = snapshot(w.dir);
  const refused = cli(rotated, "restore", archive);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /authenticator secret of owner@example\.com/);
  assert.match(refused.stderr, /SETTINGS_ENCRYPTION_KEY_PREVIOUS/);
  assert.ok(!refused.stderr.includes("JBSWY3DPEHPK3PXP"), "no secret printed");
  assert.deepEqual(snapshot(w.dir), before, "nothing changed");

  const withPrevious = { ...rotated, SETTINGS_ENCRYPTION_KEY_PREVIOUS: KEY_A };
  const ok = cli(withPrevious, "restore", archive);
  assert.equal(ok.status, 0, ok.stderr);
  const rekey = cli(withPrevious, "rekey");
  assert.equal(rekey.status, 0, rekey.stderr);
  assert.match(rekey.stdout, /Re-encrypted 1 value\(s\); 0 could not be read\./);
  const readable = store(rotated, `const { unseal } = await import("@/lib/settings/crypto"); const { readStore } = await import("@/lib/settings/store");
    const a = (await readStore("admins")).admins[0]; process.stdout.write(String(unseal(a.totp.sealed) === "JBSWY3DPEHPK3PXP"));`);
  assert.equal(readable, "true", "readable with the new key alone");
  rmSync(w.work, { recursive: true, force: true });
});

test("after a restore the admin refuses every session until SESSION_SECRET changes", () => {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  const archive = backup(w);
  assert.equal(cli(w.env, "restore", archive).status, 0);
  const check = (env: Env) =>
    store(env, `const { restoreState } = await import("@/lib/admin/restore"); const { adminProblems } = await import("@/lib/admin/config");
      process.stdout.write(JSON.stringify({ pending: (await restoreState()).pending, problems: await adminProblems() }));`);
  const same = JSON.parse(check(w.env));
  assert.equal(same.pending, true);
  assert.ok(same.problems.some((p: string) => /new SESSION_SECRET/.test(p)));
  const rotated = JSON.parse(check({ ...w.env, SESSION_SECRET: randomBytes(32).toString("hex") }));
  assert.equal(rotated.pending, false);
  assert.deepEqual(rotated.problems, []);
  rmSync(w.work, { recursive: true, force: true });
});

// ---- Crash safety: interrupted restores, failures after the first live change, unreadable markers.

/** Runs code in a separate process without asserting success (it may be killed on purpose). */
const child = (env: Env, code: string) =>
  spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
const restoreWith = (env: Env, archive: string, hook: string, restoreAdmins = true) =>
  child(
    env,
    `const { performRestore, restoreTestHooks } = await import("@/lib/admin/restore");
     ${hook}
     try { await performRestore({ archive: ${JSON.stringify(archive)}, restoreAdmins: ${restoreAdmins} }); console.log("finished"); }
     catch (e) { console.log("ERROR " + e.message); }`,
  );
const stateOf = (env: Env) =>
  JSON.parse(
    store(env, `const { restoreState } = await import("@/lib/admin/restore"); const { adminProblems } = await import("@/lib/admin/config");
      process.stdout.write(JSON.stringify({ ...(await restoreState()), problems: await adminProblems() }));`),
  ) as { pending: boolean; state: string; aside?: string; problems: string[] };
/** Hashes of every data file and its .bak (absent files included as null). */
const dataFiles = (dir: string) =>
  Object.fromEntries(
    ["settings", "delivery", "status", "admins"].flatMap((n) => [`${n}.json`, `${n}.json.bak`]).map((f) => [f, existsSync(join(dir, f)) ? sha(join(dir, f)) : null]),
  );
const rotate = (env: Env) => ({ ...env, SESSION_SECRET: randomBytes(32).toString("hex") });
/** Live state after the backup: settings changed, editor disabled (so a mix is visible). */
function prepared() {
  const w = setup();
  assert.equal(cli(w.env, "add", "owner@example.com").status, 0);
  assert.equal(cli(w.env, "add", "editor@example.com").status, 0);
  settings(w.env, "From the backup");
  const archive = backup(w);
  settings(w.env, "Live before the restore");
  assert.equal(cli(w.env, "disable", "editor@example.com").status, 0);
  return { ...w, archive, before: dataFiles(w.dir) };
}

for (const [label, hook] of [
  ["after the first live file was replaced", `restoreTestHooks.afterReplace = () => process.kill(process.pid, "SIGKILL");`],
  ["after every file was replaced, before the restore was marked complete", `restoreTestHooks.beforeComplete = () => process.kill(process.pid, "SIGKILL");`],
] as const) {
  test(`killed ${label}: the admin stays closed whatever the secret, a new restore is refused, rollback puts back the exact files`, () => {
    const w = prepared();
    const killed = restoreWith(w.env, w.archive, hook);
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    assert.notDeepEqual(dataFiles(w.dir), w.before, "live files were changed before the kill");

    for (const env of [w.env, rotate(w.env)]) {
      const s = stateOf(env);
      assert.equal(s.state, "in-progress");
      assert.equal(s.pending, true, "closed even after SESSION_SECRET changed");
      assert.ok(s.problems.some((p) => /unfinished restore to be rolled back/.test(p)));
    }
    const mixed = dataFiles(w.dir);
    const again = cli(w.env, "restore", w.archive);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /An earlier restore did not finish .*restore --rollback/);
    assert.deepEqual(dataFiles(w.dir), mixed, "a refused restore changes nothing");

    const rb = cli(w.env, "restore", "--rollback");
    assert.equal(rb.status, 0, rb.stderr);
    assert.match(rb.stdout, /Rolled back: put back .*admins\.json/);
    assert.deepEqual(dataFiles(w.dir), w.before, "byte-identical to before the restore (main files and .bak)");
    assert.equal(json(w.dir, "admins.json").admins.find((a: { email: string }) => a.email === "editor@example.com").status, "disabled");
    // Still closed until the secret changes; then open. A second rollback is refused.
    assert.deepEqual([stateOf(w.env).state, stateOf(w.env).pending], ["rolled-back", true]);
    assert.equal(stateOf(rotate(w.env)).pending, false);
    assert.match(cli(w.env, "restore", "--rollback").stderr, /already rolled back/);
    // An interrupted rollback (marker back to in-progress) is safe to run again.
    const m = json(w.dir, "restore.json");
    writeFileSync(join(w.dir, "restore.json"), JSON.stringify({ ...m, state: "in-progress" }));
    assert.equal(cli(w.env, "restore", "--rollback").status, 0);
    assert.deepEqual(dataFiles(w.dir), w.before);
    rmSync(w.work, { recursive: true, force: true });
  });
}

test("an unexpected error after the first live change names the cause and the rollback; before it, nothing changes", () => {
  const w = prepared();
  const failAt = (step: string, code: string) => `restoreTestHooks.${step} = () => { throw Object.assign(new Error("simulated"), { code: ${JSON.stringify(code)} }); };`;

  // Writing the restore record fails: no live file changes, no record.
  const early = restoreWith(w.env, w.archive, failAt("beforeMarker", "ENOSPC"));
  assert.match(early.stdout, /ERROR The restore failed before changing any live file \(ENOSPC\)\. Nothing was changed\./);
  assert.deepEqual(dataFiles(w.dir), w.before);
  assert.equal(stateOf(w.env).state, "none");

  for (const [step, code] of [["afterReplace", "EIO"], ["beforeComplete", "ENOSPC"]]) {
    const r = restoreWith(w.env, w.archive, failAt(step, code));
    assert.match(r.stdout, new RegExp(`ERROR The restore stopped after it began changing live files \\(${code}\\)\\. The admin stays unavailable\\..*restore --rollback.*pre-restore-[\\w-]+/`));
    assert.deepEqual([stateOf(w.env).state, stateOf(rotate(w.env)).pending], ["in-progress", true]);
    assert.equal(cli(w.env, "restore", "--rollback").status, 0);
    assert.deepEqual(dataFiles(w.dir), w.before);
    rmSync(join(w.dir, "restore.json"));
  }
  rmSync(w.work, { recursive: true, force: true });
});

test("an unreadable or invalid restore record counts as an unfinished restore, never as 'no restore'", () => {
  const w = prepared();
  assert.equal(cli(w.env, "restore", w.archive).status, 0);
  const rotated = rotate(w.env);
  assert.equal(stateOf(rotated).pending, false, "finished and rotated: open");
  const good = readFileSync(join(w.dir, "restore.json"), "utf8");
  const bad: Array<[string, () => void]> = [
    ["empty", () => writeFileSync(join(w.dir, "restore.json"), "")],
    ["truncated", () => writeFileSync(join(w.dir, "restore.json"), good.slice(0, 20))],
    ["null", () => writeFileSync(join(w.dir, "restore.json"), "null")],
    ["array", () => writeFileSync(join(w.dir, "restore.json"), "[]")],
    ["old format", () => writeFileSync(join(w.dir, "restore.json"), JSON.stringify({ at: "x", archive: "a", check: "c" }))],
    ["unknown state", () => writeFileSync(join(w.dir, "restore.json"), JSON.stringify({ ...JSON.parse(good), state: "done" }))],
    ["path in aside", () => writeFileSync(join(w.dir, "restore.json"), JSON.stringify({ ...JSON.parse(good), aside: "../x" }))],
    ["a directory", () => mkdirSync(join(w.dir, "restore.json"))],
  ];
  for (const [what, corrupt] of bad) {
    rmSync(join(w.dir, "restore.json"), { recursive: true, force: true });
    corrupt();
    const s = stateOf(rotated);
    assert.deepEqual([s.state, s.pending], ["unreadable", true], what);
    assert.ok(s.problems.some((p) => /readable restore\.json/.test(p)), what);
    const before = dataFiles(w.dir);
    assert.match(cli(rotated, "restore", w.archive).stderr, /restore\.json in SETTINGS_DIR can't be read/, what);
    assert.match(cli(rotated, "restore", "--rollback").stderr, /can't be read .*runbook §5/, what);
    assert.deepEqual(dataFiles(w.dir), before, `${what}: nothing changed`);
  }
  rmSync(w.work, { recursive: true, force: true });
});

test("rollback is refused when there is nothing to roll back, or once the restore finished and the secret changed", () => {
  const w = prepared();
  assert.match(cli(w.env, "restore", "--rollback").stderr, /no restore to roll back/);
  assert.equal(cli(w.env, "restore", w.archive).status, 0);
  const rotated = rotate(w.env);
  const r = cli(rotated, "restore", "--rollback");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SESSION_SECRET has been changed since/);
  // Before the secret changes, a finished restore can still be undone.
  assert.equal(cli(w.env, "restore", "--rollback").status, 0);
  assert.deepEqual(dataFiles(w.dir), w.before);
  rmSync(w.work, { recursive: true, force: true });
});

test("each restore saves the current files into a new folder, even twice in the same second", () => {
  const w = prepared();
  const now = new Date("2026-01-02T03:04:05.000Z");
  const twice = child(
    w.env,
    `const { performRestore, performRollback } = await import("@/lib/admin/restore");
     const a = await performRestore({ archive: ${JSON.stringify(w.archive)}, restoreAdmins: false, now: new Date(${now.getTime()}) });
     await performRollback();
     const b = await performRestore({ archive: ${JSON.stringify(w.archive)}, restoreAdmins: false, now: new Date(${now.getTime()}) });
     console.log(a.asideDir + " " + b.asideDir);`,
  );
  assert.equal(twice.status, 0, twice.stderr);
  assert.equal(twice.stdout.trim(), "pre-restore-20260102T030405Z pre-restore-20260102T030405Z-2");
  rmSync(w.work, { recursive: true, force: true });
});
