// Rate limiters: eviction must never reset a key that is currently over its limit, memory stays
// bounded, and the sign-in and identity-check limits are separate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Limiter, signInAttempt, recordSignInFailure, reauthFailures } from "@/lib/admin/rate-limit";
import { rateLimited } from "@/lib/enquiry/spam";

const MIN = 60 * 1000;

test("flooding with junk keys does not unlock a locked key (the reproduced attack)", () => {
  const l = new Limiter(5, 15 * MIN, 1_000);
  const t0 = 1_900_000_000_000;
  for (let i = 0; i < 5; i++) l.record("victim", t0 + i);
  assert.equal(l.blocked("victim", t0 + 10), true);
  for (let i = 0; i < 50_000; i++) l.record(`junk${i}`, t0 + 20 + i);
  assert.equal(l.blocked("victim", t0 + 60_000), true, "still locked after 50,000 junk keys");
  assert.ok(l.size() <= 2_000, `bounded: ${l.size()} keys`);
});

test("keys partway to the limit are evicted before locked ones; expired keys go first", () => {
  const l = new Limiter(3, 10 * MIN, 100);
  const t0 = 1_900_000_000_000;
  for (let i = 0; i < 3; i++) l.record("locked", t0);
  l.record("old", t0 - 11 * MIN);
  for (let i = 0; i < 150; i++) l.record(`k${i}`, t0 + i);
  assert.equal(l.blocked("locked", t0 + 1_000), true);
  assert.ok(l.size() <= 100, `size ${l.size()}`);
  assert.equal(l.count("old", t0 + 1_000), 0);
});

test("memory stays bounded even when an attacker locks very many keys (residual: oldest locks go)", () => {
  const l = new Limiter(1, 15 * MIN, 100);
  const t0 = 1_900_000_000_000;
  for (let i = 0; i < 1_000; i++) l.record(`locked${i}`, t0 + i);
  assert.ok(l.size() <= 200, `hard cap: ${l.size()}`);
  assert.equal(l.blocked("locked999", t0 + 2_000), true, "the most recent locks are kept");
});

test("a key's window still expires normally", () => {
  const l = new Limiter(2, 10 * MIN);
  const t0 = 1_900_000_000_000;
  l.record("a", t0);
  l.record("a", t0 + 1);
  assert.equal(l.blocked("a", t0 + 2), true);
  assert.equal(l.blocked("a", t0 + 10 * MIN + 2), false);
});

test("sign-in: one source is locked after 5 failures, other sources keep a separate allowance", () => {
  const email = `owner${Math.random()}@example.com`;
  for (let i = 0; i < 5; i++) recordSignInFailure(email, "198.51.100.1");
  assert.equal(signInAttempt(email, "198.51.100.1"), "locked");
  assert.equal(signInAttempt(email, "198.51.100.2"), "ok", "a different address is not locked out by the first");
});

test("sign-in: an account is locked for everyone after 25 failures from any mix of sources", () => {
  const email = `owner${Math.random()}@example.com`;
  for (let i = 0; i < 25; i++) recordSignInFailure(email, `203.0.113.${i % 5}`);
  assert.equal(signInAttempt(email, "192.0.2.77"), "locked");
});

test("identity checks in admin forms have their own limit, untouched by anonymous sign-in failures", () => {
  const id = `adm_${Math.random().toString(16).slice(2, 18).padEnd(16, "0")}`;
  const email = `owner${Math.random()}@example.com`;
  for (let i = 0; i < 25; i++) recordSignInFailure(email, `203.0.113.${i}`);
  assert.equal(reauthFailures.blocked(id), false);
});

test("enquiry limit: unchanged behaviour, and junk keys can't reset a limited address", () => {
  const t0 = 1_950_000_000_000;
  const key = `ip-${Math.random()}`;
  for (let i = 0; i < 5; i++) assert.equal(rateLimited(key, t0 + i), false);
  assert.equal(rateLimited(key, t0 + 10), true);
  for (let i = 0; i < 20_000; i++) rateLimited(`junk-${Math.random()}`, t0 + 20);
  assert.equal(rateLimited(key, t0 + 30), true, "still limited after 20,000 other addresses");
});
