// Encryption at rest (AES-256-GCM): full tags only, key rotation without data loss; and the
// cross-process store lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const root = resolve(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "calix-crypto-"));
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
process.env.SETTINGS_DIR = dir;
process.env.SETTINGS_ENCRYPTION_KEY = KEY_A;
const { seal, unseal } = await import("@/lib/settings/crypto");
const { updateStore, readStore, withLock, processIdentity } = await import("@/lib/settings/store");

const parts = (s: string) => s.split(":");
const b64 = (b: Buffer) => b.toString("base64");

test("a full 16-byte tag decrypts; truncated or malformed tags and IVs are refused", () => {
  const sealed = seal("123456789:token-value-for-tests-only-xxxxxxxxxxxx");
  assert.ok(unseal(sealed));
  const [v, iv, tag, ct] = parts(sealed);
  const t = Buffer.from(tag, "base64");
  assert.equal(t.length, 16);
  for (const n of [4, 8, 12, 15]) assert.equal(unseal([v, iv, b64(t.subarray(0, n)), ct].join(":")), null, `${n}-byte tag`);
  assert.equal(unseal([v, iv, b64(Buffer.concat([t, Buffer.from([0])])), ct].join(":")), null, "17-byte tag");
  assert.equal(unseal([v, b64(Buffer.from(iv, "base64").subarray(0, 8)), tag, ct].join(":")), null, "short IV");
  assert.equal(unseal([v, iv, "!!not-base64!!", ct].join(":")), null);
  assert.equal(unseal([v, iv, tag, ct, "extra"].join(":")), null, "extra field");
  const flipped = Buffer.from(ct, "base64");
  flipped[0] ^= 1;
  assert.equal(unseal([v, iv, tag, b64(flipped)].join(":")), null, "tampered ciphertext");
});

test("values sealed before this change still decrypt (no format change)", () => {
  // Same construction the earlier code used: v1:iv:tag:ciphertext, 12-byte IV, default 16-byte tag.
  const sealed = seal("legacy-secret");
  assert.match(sealed, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(unseal(sealed), "legacy-secret");
});

test("key rotation: the previous key still reads; a wrong key fails closed without touching data", () => {
  const sealed = seal("rotate-me");
  process.env.SETTINGS_ENCRYPTION_KEY = KEY_B;
  try {
    assert.equal(unseal(sealed), null, "the new key alone can't read it");
    process.env.SETTINGS_ENCRYPTION_KEY_PREVIOUS = KEY_A;
    assert.equal(unseal(sealed), "rotate-me", "read with the previous key");
    assert.ok(parts(seal("new")).length === 4);
    process.env.SETTINGS_ENCRYPTION_KEY_PREVIOUS = randomBytes(32).toString("base64");
    assert.equal(unseal(sealed), null);
  } finally {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_A;
    delete process.env.SETTINGS_ENCRYPTION_KEY_PREVIOUS;
  }
});

test("the rekey command re-encrypts stored secrets with the new key and reports what it couldn't read", async () => {
  const rdir = mkdtempSync(join(tmpdir(), "calix-rekey-"));
  const env = { ...process.env, SETTINGS_DIR: rdir, SETTINGS_ENCRYPTION_KEY: KEY_A, SESSION_SECRET: randomBytes(32).toString("hex") };
  const cli = (args: string[], e = env) =>
    spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "scripts/admin-user.mts", ...args], { cwd: root, env: e, input: "correct horse battery staple\ncorrect horse battery staple\n", encoding: "utf8" });
  assert.equal(cli(["add", "owner@example.com"]).status, 0);
  // Give the account a sealed authenticator secret and save a sealed Telegram token, with key A.
  process.env.SETTINGS_DIR = rdir;
  const { updateStore: upd } = await import("@/lib/settings/store");
  const totpSealed = seal("JBSWY3DPEHPK3PXP");
  await upd("admins", (cur) => ({ admins: cur!.admins.map((a) => ({ ...a, totp: { sealed: totpSealed, lastStep: 1 } })) }), { by: "test" });
  await upd("delivery", () => ({ email: { enabled: true }, telegram: { enabled: false, chatId: "-100123", botToken: { sealed: seal("111111:token-for-rekey-test-xxxxxxxxxxxxxxx"), savedAt: "x" } } }), { by: "test" });
  process.env.SETTINGS_DIR = dir;

  const rotated = { ...env, SETTINGS_ENCRYPTION_KEY: KEY_B, SETTINGS_ENCRYPTION_KEY_PREVIOUS: KEY_A };
  const r = cli(["rekey"], rotated);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Re-encrypted 2 value\(s\); 0 could not be read\./);
  assert.ok(!r.stdout.includes("JBSWY3DPEHPK3PXP") && !r.stdout.includes("token-for-rekey"), "no secrets printed");

  process.env.SETTINGS_ENCRYPTION_KEY = KEY_B;
  try {
    const admins = JSON.parse(readFileSync(join(rdir, "admins.json"), "utf8"));
    const delivery = JSON.parse(readFileSync(join(rdir, "delivery.json"), "utf8"));
    assert.equal(unseal(admins.admins[0].totp.sealed), "JBSWY3DPEHPK3PXP", "readable with the new key alone");
    assert.equal(unseal(delivery.telegram.botToken.sealed), "111111:token-for-rekey-test-xxxxxxxxxxxxxxx");
  } finally {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY_A;
  }
  // A value no key can read is left exactly as it was, and reported.
  const wrong = { ...env, SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  const before = readFileSync(join(rdir, "admins.json"), "utf8");
  const bad = cli(["rekey"], wrong);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout + bad.stderr, /could not be read/);
  assert.equal(readFileSync(join(rdir, "admins.json"), "utf8"), before, "unreadable values are not overwritten");
});

const mk = (v: string) => ({ business: {}, contact: { phonesAdditional: [] }, social: { profiles: [] }, footer: { copyrightText: v }, form: { acceptingEnquiries: true } });

test("an update can decline to write; nothing changes", async () => {
  await updateStore("settings", () => mk("A"), { by: "t" });
  const before = readFileSync(join(dir, "settings.json"), "utf8");
  const r = await updateStore("settings", () => null, { by: "t" });
  assert.deepEqual(r, { ok: false, reason: "unchanged" });
  assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), before);
});

test("a live lock is never broken for being old; a dead holder's lock is", async () => {
  const path = join(dir, "settings.json");
  const lock = `${path}.lock`;
  // Held by this (live) process, 5 minutes old.
  // A genuine holder's record, as the current code writes it (PID + start identity + token).
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "live", start: processIdentity() }));
  const old = new Date(Date.now() - 5 * 60 * 1000);
  utimesSync(lock, old, old);
  const r = await updateStore("settings", () => mk("B"), { by: "t" });
  assert.deepEqual(r, { ok: false, reason: "busy" });
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "live", "the live lock is untouched");

  // Held by a process that has exited.
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  writeFileSync(lock, JSON.stringify({ pid: Number(child.stdout), token: "dead" }));
  utimesSync(lock, old, old);
  const r2 = await updateStore("settings", () => mk("C"), { by: "t" });
  assert.equal(r2.ok, true);
  assert.equal((await readStore("settings"))!.footer.copyrightText, "C");
  assert.ok(!existsSync(lock));

  // Unreadable leftovers from a crash are reclaimed once old.
  writeFileSync(lock, "");
  utimesSync(lock, old, old);
  assert.equal((await withLock(path, async () => "ran")), "ran");
});

test("writers in separate processes lose no updates", async () => {
  const N = 4;
  const PER = 15;
  const script = `
    const { updateStore } = await import("@/lib/settings/store");
    let done = 0;
    while (done < ${PER}) {
      const r = await updateStore("status", (cur) => ({
        records: [...(cur?.records ?? []), { at: "x", requestId: "p" + process.pid + "-" + done, kind: "enquiry", results: [] }].slice(-200),
        lastTest: cur?.lastTest ?? {},
        lastAlertAt: cur?.lastAlertAt ?? {},
      }), { by: "proc" });
      if (r.ok) done++;
      else if (r.reason !== "busy") throw new Error(r.reason);
    }`;
  const run = () =>
    new Promise<number>((res) => {
      const p = spawn(process.execPath, ["--import", "./scripts/register-ts.mjs", "--input-type=module", "-e", script], { cwd: root, env: process.env, stdio: "inherit" });
      p.on("exit", (code) => res(code ?? 1));
    });
  const codes = await Promise.all(Array.from({ length: N }, run));
  assert.deepEqual(codes, Array(N).fill(0));
  const status = await readStore("status");
  assert.equal(status!.records.length, N * PER);
  assert.equal(new Set(status!.records.map((r) => r.requestId)).size, N * PER);
  assert.equal(status!.revision, N * PER);
});
