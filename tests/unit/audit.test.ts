// The audit log under unauthenticated flooding: security history in audit.log can't be pushed out
// by anonymous traffic, the access log stays bounded, and suppression never logs recursively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "calix-audit-"));
process.env.SETTINGS_DIR = dir;
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const { audit, verifyAuditChain, auditTuning } = await import("@/lib/admin/audit");

const lines = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
let clock = 1_900_000_000_000;
auditTuning.now = () => clock;

test("20,000 anonymous denials leave the security log untouched and the access log small", async () => {
  await audit({ adminId: "adm_0123456789abcdef", action: "settings.general.save", outcome: "success", ip: "192.0.2.1" });
  const before = readFileSync(join(dir, "audit.log"), "utf8");
  const writes: Promise<void>[] = [];
  for (let i = 0; i < 20_000; i++) {
    writes.push(audit({ adminId: "anonymous", action: i % 2 ? "admin.access" : "auth.signin", outcome: "denied", ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, detail: "rate_limited" }));
  }
  await Promise.all(writes);
  assert.equal(readFileSync(join(dir, "audit.log"), "utf8"), before, "security log unchanged");
  const access = lines("audit-access.log");
  assert.ok(access.length <= auditTuning.accessPerMinute + 1, `${access.length} access lines`);
  assert.ok(statSync(join(dir, "audit-access.log")).size < 64 * 1024);

  // The next minute: one summary line counts what was suppressed (no recursion, no loss of the count).
  clock += 61_000;
  await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: "10.9.9.9" });
  const after = lines("audit-access.log");
  const summary = after.filter((l) => l.action === "access.suppressed");
  assert.equal(summary.length, 1);
  assert.equal(summary[0].changes.count, 20_000 - auditTuning.accessPerMinute);
  assert.deepEqual(await verifyAuditChain(), { ok: true, lines: 1 });
  assert.equal((await verifyAuditChain("access")).ok, true);
});

test("repeats from one address for one action are written once per minute, with a count", async () => {
  clock += 120_000;
  const start = lines("audit-access.log").length;
  for (let i = 0; i < 50; i++) await audit({ adminId: "anonymous", action: "auth.signin", outcome: "denied", ip: "198.51.100.7", detail: "password" });
  assert.equal(lines("audit-access.log").length - start, 1);
  clock += 61_000;
  await audit({ adminId: "anonymous", action: "auth.signin", outcome: "denied", ip: "198.51.100.7", detail: "password" });
  const last = lines("audit-access.log").at(-1);
  assert.equal(last.changes?.repeats, 49, "the 49 repeats are reported with the next entry");
});

test("each log rotates on its own; anonymous floods can't rotate the security log", async () => {
  auditTuning.maxBytes = { main: 4_096, access: 2_048 };
  auditTuning.keep = { main: 5, access: 2 };
  for (let m = 0; m < 40; m++) {
    clock += 61_000;
    for (let i = 0; i < 30; i++) await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: `172.16.${m}.${i}` });
  }
  const files = readdirSync(dir).sort();
  assert.ok(files.includes("audit-access.log.1") && files.includes("audit-access.log.2"));
  assert.ok(!files.includes("audit-access.log.3"), "only `keep` old access files are kept");
  assert.ok(!files.includes("audit.log.1"), "the security log did not rotate");
  // Authenticated activity still rotates the security log normally.
  for (let i = 0; i < 40; i++) await audit({ adminId: "adm_0123456789abcdef", action: "delivery.test.email", outcome: "success", detail: "x".repeat(100) });
  assert.ok(readdirSync(dir).includes("audit.log.1"));
  assert.equal((await verifyAuditChain()).ok, true);
});

test("pre-sign-in failures for a real account also go to the access log", async () => {
  clock += 61_000;
  const before = lines("audit.log").length;
  await audit({ adminId: "adm_0123456789abcdef", action: "auth.signin", outcome: "denied", ip: "203.0.113.50", detail: "password", preAuth: true });
  assert.equal(lines("audit.log").length, before);
  assert.equal(lines("audit-access.log").at(-1).adminId, "adm_0123456789abcdef");
});

test("a suppressed count survives a minute that starts with a throttled repeat", async () => {
  auditTuning.maxBytes = { main: 5 * 1024 * 1024, access: 5 * 1024 * 1024 };
  clock += 3_600_000;
  for (let i = 0; i < auditTuning.accessPerMinute + 7; i++) await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: `100.64.0.${i}` });
  auditTuning.repeatWindowMs = 120_000; // so the next minute's first event is still a repeat
  try {
    clock += 61_000;
    const before = lines("audit-access.log").length;
    await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: "100.64.0.0" }); // a repeat: throttled
    assert.equal(lines("audit-access.log").length, before, "the repeat was throttled");
    await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: "100.64.9.9" });
    const summaries = lines("audit-access.log").filter((l) => l.action === "access.suppressed");
    assert.equal(summaries.at(-1).changes.count, 7);
  } finally {
    auditTuning.repeatWindowMs = 60_000;
  }
});
