/**
 * In-memory sliding-window limiter. Effective because the site runs as a single process
 * (deployment prerequisite, docs/admin-panel-runbook.md §2); back it with Nginx `limit_req`.
 *
 * Memory is bounded without ever resetting everything: when there are too many keys, expired
 * keys go first, then the least recently active keys that are *not* over their limit. Keys over
 * their limit are kept, so flooding with junk keys can't unlock a locked account or address. Only
 * past a hard cap (twice the key limit, which needs a very large number of locked keys) are the
 * oldest locked keys dropped: a documented residual risk (runbook §9).
 */
export class Limiter {
  private hits = new Map<string, number[]>(); // insertion order = least recently active first
  max: number;
  windowMs: number;
  maxKeys: number;
  constructor(max: number, windowMs: number, maxKeys = 10_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  private recent(key: string, now: number) {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  /** Attempts within the window. */
  count(key: string, now = Date.now()) {
    return this.recent(key, now).length;
  }

  /** True when another attempt would exceed the limit. Doesn't record anything. */
  blocked(key: string, now = Date.now()) {
    return this.count(key, now) >= this.max;
  }

  /** Records an attempt and returns the attempts within the window (saturating at max + 1). */
  record(key: string, now = Date.now()) {
    const r = this.recent(key, now);
    r.push(now);
    const kept = r.slice(-(this.max + 1));
    this.hits.delete(key);
    this.hits.set(key, kept);
    if (this.hits.size > this.maxKeys) this.evict(now);
    return kept.length;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  size() {
    return this.hits.size;
  }

  private evict(now: number) {
    const target = Math.floor(this.maxKeys * 0.9);
    for (const [k, t] of this.hits) {
      if (now - t[t.length - 1] >= this.windowMs) this.hits.delete(k);
    }
    if (this.hits.size <= target) return;
    for (const [k, t] of this.hits) {
      if (this.hits.size <= target) return;
      if (t.filter((x) => now - x < this.windowMs).length < this.max) this.hits.delete(k);
    }
    // Only locked keys remain over the target. Drop the oldest beyond the hard cap.
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys * 2) return;
      this.hits.delete(k);
    }
  }
}

const MIN = 60 * 1000;

/** Sign-in failures from one address for one account: 5 per 15 minutes. */
const byAccountAndIp = new Limiter(5, 15 * MIN);
/** Sign-in failures for one account from any mix of addresses: 25 per 15 minutes. */
const byAccount = new Limiter(25, 15 * MIN);
/** Sign-in failures from one address, any account: 20 per 15 minutes. */
const byIp = new Limiter(20, 15 * MIN);

const pairKey = (account: string, ip: string) => `${account.toLowerCase()}\u0000${ip}`;

/**
 * Whether a sign-in step (password, code, enrolment) may be tried for `account` from `ip`.
 * Separate per-address and per-account limits: an attacker at one address can't lock the account
 * for its owner elsewhere, while guessing from many addresses is still capped per account.
 * Residual: about two addresses' worth of failures (25) still locks the account for everyone for
 * 15 minutes; restarting the process clears it (runbook §9).
 */
export function signInAttempt(account: string, ip: string, now = Date.now()): "ok" | "locked" {
  if (byIp.blocked(ip, now) || byAccountAndIp.blocked(pairKey(account, ip), now) || byAccount.blocked(account.toLowerCase(), now)) {
    return "locked";
  }
  return "ok";
}

export function recordSignInFailure(account: string, ip: string, now = Date.now()) {
  byIp.record(ip, now);
  byAccountAndIp.record(pairKey(account, ip), now);
  byAccount.record(account.toLowerCase(), now);
}

/** After a successful sign-in from an address, its own failures for that account are forgotten. */
export function clearSignInFailures(account: string, ip: string) {
  byAccountAndIp.reset(pairKey(account, ip));
}

/**
 * Password + code checks inside admin forms, per administrator: 5 per 15 minutes. Separate from
 * sign-in, so anonymous failures can't lock a signed-in administrator out of sensitive changes.
 */
export const reauthFailures = new Limiter(5, 15 * MIN);

/** Test sends: 5 per administrator per channel in 10 minutes. */
export const testSends = new Limiter(5, 10 * MIN);
