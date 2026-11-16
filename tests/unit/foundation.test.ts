import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const env = process.env as Record<string, string | undefined>;
const dir = mkdtempSync(join(tmpdir(), "calix-store-"));
env.SETTINGS_DIR = dir;
env.SESSION_SECRET = randomBytes(32).toString("hex");
env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { readStore, updateStore, clearStoreCache, storeStatus } = await import("@/lib/settings/store");
const { seal, unseal, fingerprint } = await import("@/lib/settings/crypto");
const { totpAt, verifyTotp, base32Encode, generateTotpSecret, currentStep } = await import("@/lib/admin/totp");
const { hashPassword, verifyPassword, passwordProblem, generateRecoveryCodes, hashRecoveryCode } = await import("@/lib/admin/password");
const { signToken, verifyToken, sessionFresh, IDLE_MS, ABSOLUTE_MS } = await import("@/lib/admin/session-token");
const { audit, verifyAuditChain, recentAudit } = await import("@/lib/admin/audit");

after(() => rmSync(dir, { recursive: true, force: true }));

const settingsBody = (replyTime?: string) => ({
  business: {},
  contact: { phonesAdditional: [], ...(replyTime ? { replyTime } : {}) },
  social: { profiles: [] },
  footer: {},
  form: { acceptingEnquiries: true },
});

describe("settings store", () => {
  beforeEach(() => {
    for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
    clearStoreCache();
  });

  test("status reports a usable directory", async () => {
    assert.deepEqual(await storeStatus(), { configured: true, ok: true, dir });
  });

  test("missing file reads as null; first write creates revision 1 with 0600 permissions", async () => {
    assert.equal(await readStore("settings"), null);
    const r = await updateStore("settings", () => settingsBody("two days"), { by: "t", baseRevision: 0 });
    assert.equal(r.ok, true);
    const v = await readStore("settings");
    assert.equal(v?.revision, 1);
    assert.equal(v?.contact.replyTime, "two days");
    assert.equal(statSync(join(dir, "settings.json")).mode & 0o777, 0o600);
  });

  test("a stale base revision is refused and nothing is overwritten", async () => {
    await updateStore("settings", () => settingsBody("one"), { by: "a", baseRevision: 0 });
    await updateStore("settings", () => settingsBody("two"), { by: "b", baseRevision: 1 });
    const stale = await updateStore("settings", () => settingsBody("three"), { by: "c", baseRevision: 1 });
    assert.deepEqual(stale, { ok: false, reason: "conflict" });
    assert.equal((await readStore("settings"))?.contact.replyTime, "two");
  });

  test("invalid content is refused with field paths", async () => {
    const r = await updateStore("settings", () => ({ ...settingsBody(), contact: { phonesAdditional: [], email: "nope" } }), { by: "t" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "invalid");
      assert.ok(r.issues?.some((i) => i.path === "contact.email"));
    }
  });

  test("unknown fields are refused (no mass assignment)", async () => {
    const r = await updateStore("settings", () => ({ ...settingsBody(), extra: "x" }) as never, { by: "t" });
    assert.equal(r.ok, false);
  });

  test("a corrupted file falls back to the last valid copy, then to the backup", async () => {
    await updateStore("settings", () => settingsBody("first"), { by: "t" });
    await updateStore("settings", () => settingsBody("second"), { by: "t" });
    assert.equal((await readStore("settings"))?.contact.replyTime, "second");
    writeFileSync(join(dir, "settings.json"), "{ not json");
    assert.equal((await readStore("settings"))?.contact.replyTime, "second", "last valid in-memory copy");
    clearStoreCache();
    assert.equal((await readStore("settings"))?.contact.replyTime, "first", "backup after a restart");
  });

  test("concurrent writers are serialised; every update applies exactly once", async () => {
    await updateStore("status", () => ({ records: [], lastTest: {}, lastAlertAt: {} }), { by: "t" });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateStore(
          "status",
          (cur) => ({
            records: [...(cur?.records ?? []), { at: String(i), requestId: `r${i}`, kind: "enquiry" as const, results: [] }],
            lastTest: {},
            lastAlertAt: {},
          }),
          { by: "t" },
        ),
      ),
    );
    const v = await readStore("status");
    assert.equal(v?.records.length, 20);
    assert.equal(v?.revision, 21);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock")).length, 0);
  });

  test("delivery: at least one channel must be enabled", async () => {
    const r = await updateStore("delivery", () => ({ email: { enabled: false }, telegram: { enabled: false } }), { by: "t" });
    assert.equal(r.ok, false);
  });

  test("without SETTINGS_DIR the store is unavailable and reads are null", async () => {
    const saved = env.SETTINGS_DIR;
    delete env.SETTINGS_DIR;
    try {
      assert.equal(await readStore("settings"), null);
      assert.deepEqual(await updateStore("settings", () => settingsBody(), { by: "t" }), { ok: false, reason: "unavailable" });
    } finally {
      env.SETTINGS_DIR = saved;
    }
  });
});

describe("encryption at rest", () => {
  test("round trip, random IV, and tampering fails closed", () => {
    const a = seal("123456:secret-token");
    const b = seal("123456:secret-token");
    assert.notEqual(a, b);
    assert.ok(!a.includes("secret-token"));
    assert.equal(unseal(a), "123456:secret-token");
    const parts = a.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.equal(unseal(parts.join(":")), null);
  });

  test("a different key cannot decrypt", () => {
    const sealed = seal("x");
    const saved = env.SETTINGS_ENCRYPTION_KEY;
    env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
      assert.equal(unseal(sealed), null);
    } finally {
      env.SETTINGS_ENCRYPTION_KEY = saved;
    }
  });

  test("fingerprints are stable and keyed", () => {
    assert.equal(fingerprint("a", "b"), fingerprint("a", "b"));
    assert.notEqual(fingerprint("a", "b"), fingerprint("ab", ""));
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B, SHA-1, secret "12345678901234567890": T=59s → 94287082 (last 6 digits).
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  test("matches the RFC test vectors", () => {
    assert.equal(totpAt(secret, Math.floor(59 / 30)), "287082");
    assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), "081804");
    assert.equal(totpAt(secret, Math.floor(1234567890 / 30)), "005924");
  });
  test("accepts ±1 step, refuses replays and wrong codes", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    const step = currentStep(now);
    assert.equal(verifyTotp(s, totpAt(s, step), -1, now), step);
    assert.equal(verifyTotp(s, totpAt(s, step - 1), -1, now), step - 1);
    assert.equal(verifyTotp(s, totpAt(s, step), step, now), null, "replay");
    assert.equal(verifyTotp(s, totpAt(s, step - 3), -1, now), null, "too old");
    assert.equal(verifyTotp(s, "12345", -1, now), null);
  });
});

describe("passwords and recovery codes", () => {
  test("scrypt hash verifies only the right password", async () => {
    const h = await hashPassword("Correct-Horse-Battery-9");
    assert.match(h, /^scrypt\$32768\$8\$1\$/);
    assert.equal(await verifyPassword("Correct-Horse-Battery-9", h), true);
    assert.equal(await verifyPassword("correct-horse-battery-9", h), false);
  });
  test("policy", () => {
    assert.equal(passwordProblem("short", "a@b.com"), "Use at least 12 characters.");
    assert.equal(passwordProblem("owner-password-123", "owner@b.com"), "Don't include your email name in the password.");
    assert.equal(passwordProblem("Correct-Horse-Battery-9", "owner@b.com"), null);
  });
  test("recovery codes are random and stored only as hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    assert.equal(new Set(codes).size, 8);
    assert.equal(hashes[0], hashRecoveryCode(codes[0].toUpperCase()));
    assert.ok(!hashes.includes(codes[0]));
  });
});

describe("session cookies", () => {
  // Rendered by Next's own cookie serializer, as the app sends them.
  test("expiring a __Host- cookie keeps the attributes browsers require (Secure, Path=/)", async () => {
    const { expiredCookieOptions, cookieOptions } = await import("@/lib/admin/session-token");
    const { ResponseCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js" as string);
    const headers = new Headers();
    const jar = new ResponseCookies(headers);
    jar.set("__Host-calix_admin", "", expiredCookieOptions());
    const line = headers.getSetCookie()[0];
    assert.match(line, /^__Host-calix_admin=;/);
    assert.match(line, /; Path=\/(;|$)/);
    assert.match(line, /; Secure(;|$)/);
    assert.match(line, /; HttpOnly(;|$)/);
    assert.match(line, /; SameSite=strict(;|$)/i);
    assert.match(line, /; Max-Age=0(;|$)/);
    assert.doesNotMatch(line, /Domain=/i);
    const set = new Headers();
    new ResponseCookies(set).set("__Host-calix_admin", "x", cookieOptions(1000));
    assert.match(set.getSetCookie()[0], /; Secure;.*HttpOnly;.*SameSite=strict/i);
  });
});

describe("session tokens", () => {
  const now = Date.now();
  const payload = { t: "s" as const, sid: "sid_0123456789abcdef", a: "adm_0123456789abcdef", v: 1, iat: now, seen: now, auth: now };
  test("valid, tampered, wrong kind", () => {
    const token = signToken(payload);
    assert.deepEqual(verifyToken(token, "s"), payload);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, a: "adm_ffffffffffffffff" })).toString("base64url");
    assert.equal(verifyToken(`${forged}.${sig}`, "s"), null);
    assert.equal(verifyToken(`${body}.x${sig.slice(1)}`, "s"), null);
    assert.equal(verifyToken(token, "p"), null);
  });
  test("idle and absolute expiry", () => {
    assert.equal(sessionFresh(payload, now + 1000), true);
    assert.equal(sessionFresh({ ...payload, seen: now - IDLE_MS - 1 }, now), false);
    assert.equal(sessionFresh({ ...payload, iat: now - ABSOLUTE_MS - 1, seen: now }, now), false);
  });
  test("another secret cannot verify", () => {
    const token = signToken(payload);
    const saved = env.SESSION_SECRET;
    env.SESSION_SECRET = randomBytes(32).toString("hex");
    try {
      assert.equal(verifyToken(token, "s"), null);
    } finally {
      env.SESSION_SECRET = saved;
    }
  });
});

describe("audit log", () => {
  before(() => {
    for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  });
  test("hash chain verifies, and a tampered line is detected", async () => {
    await audit({ adminId: "a", action: "one", outcome: "success" });
    await audit({ adminId: "a", action: "two", outcome: "success", changes: { "contact.replyTime": ["x", "y"] } });
    // Unauthenticated events go to the separate access log (lib/admin/audit.ts).
    await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: "203.0.113.9" });
    assert.deepEqual(await verifyAuditChain(), { ok: true, lines: 2 });
    assert.deepEqual(await verifyAuditChain("access"), { ok: true, lines: 1 });
    const text = readFileSync(join(dir, "audit.log"), "utf8");
    const access = readFileSync(join(dir, "audit-access.log"), "utf8");
    assert.ok(!text.includes("203.0.113.9") && !access.includes("203.0.113.9"), "IP addresses are hashed");
    assert.match(access, /"action":"admin\.access"/);
    assert.equal((await recentAudit(1))[0].action, "two");
    await audit({ adminId: "a", action: "three", outcome: "success" });
    const full = readFileSync(join(dir, "audit.log"), "utf8");
    // An edited line followed by another line is detected.
    writeFileSync(join(dir, "audit.log"), full.replace('"two"', '"TWO"'));
    assert.deepEqual(await verifyAuditChain(), { ok: false, lines: 3, brokenAt: 3 });
    // Documented limit: editing (or cutting) the last line is not detectable from the file alone.
    writeFileSync(join(dir, "audit.log"), full.replace('"three"', '"THREE"'));
    assert.equal((await verifyAuditChain()).ok, true);
    writeFileSync(join(dir, "audit.log"), full);
  });
  test("file permissions", () => {
    assert.ok(existsSync(join(dir, "audit.log")));
    appendFileSync(join(dir, "audit.log"), "");
    assert.equal(statSync(join(dir, "audit.log")).mode & 0o777, 0o600);
  });
});

test("PM2 detection for the status page reads only PM2's own variables", async () => {
  const { pm2Info } = await import("@/lib/admin/pm2");
  assert.equal(pm2Info({}), null);
  assert.deepEqual(pm2Info({ pm_id: "0", exec_mode: "fork_mode", instances: "1" }), { mode: "fork_mode", instances: "1", id: "0" });
  assert.deepEqual(pm2Info({ pm_id: "3", exec_mode: "cluster_mode", instances: "4" }), { mode: "cluster_mode", instances: "4", id: "3" });
});
