// deploy/backup-settings.sh: a failed or corrupt archive is never left looking like a backup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dirname, "../../deploy/backup-settings.sh");
const work = () => mkdtempSync(join(tmpdir(), "calix-backup-"));
const run = (args: string[], env: Record<string, string> = {}) => spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

function settings(dir: string) {
  mkdirSync(dir, { mode: 0o700 });
  writeFileSync(join(dir, "settings.json"), "{}\n", { mode: 0o600 });
  writeFileSync(join(dir, "admins.json"), "{}\n", { mode: 0o600 });
}

test("a good run writes a verified, private archive and keeps the newest N", () => {
  const w = work();
  settings(join(w, "src"));
  for (let i = 0; i < 3; i++) {
    const r = run([join(w, "src"), join(w, "out"), "2"], { BACKUP_STAMP: `2026010${i}T000000Z` });
    assert.equal(r.status, 0, r.stderr);
  }
  const files = readdirSync(join(w, "out")).sort();
  assert.deepEqual(files, ["settings-20260101T000000Z.tar.gz", "settings-20260102T000000Z.tar.gz"]);
  assert.equal(statSync(join(w, "out", files[1])).mode & 0o777, 0o600);
  const list = spawnSync("tar", ["-tzf", join(w, "out", files[1])], { encoding: "utf8" }).stdout;
  assert.match(list, /settings\.json/);
  assert.match(list, /admins\.json/);
});

test("a missing source fails and leaves nothing behind", () => {
  const w = work();
  const r = run([join(w, "missing"), join(w, "out")]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(join(w, "out")), []);
});

test("tar failing part-way leaves no partial archive and fails loudly", () => {
  const w = work();
  settings(join(w, "src"));
  const bin = join(w, "bin");
  mkdirSync(bin);
  // A tar that writes half an archive, then fails.
  writeFileSync(join(bin, "tar"), '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in *.partial) echo garbage > "$a";; esac; done\nexit 2\n');
  chmodSync(join(bin, "tar"), 0o755);
  const r = run([join(w, "src"), join(w, "out")], { PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(join(w, "out")), []);
});

test("an archive that doesn't verify is removed and the run fails", () => {
  const w = work();
  settings(join(w, "src"));
  const bin = join(w, "bin");
  mkdirSync(bin);
  // A tar that "succeeds" at creating a corrupt file; listing it then fails.
  writeFileSync(join(bin, "tar"), '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in *.partial) echo not-a-tarball > "$a";; esac; done\ncase " $* " in *" -tzf "*) exit 2;; esac\nexit 0\n');
  chmodSync(join(bin, "tar"), 0o755);
  const r = run([join(w, "src"), join(w, "out")], { PATH: `${bin}:${process.env.PATH}` });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /verif/i);
  assert.deepEqual(readdirSync(join(w, "out")), []);
});
