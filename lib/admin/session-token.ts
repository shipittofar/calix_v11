import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed admin session tokens (HMAC-SHA256 with SESSION_SECRET). Pure functions, shared by the
 * session helpers and proxy.ts. A valid signature is not enough on its own: requireAdmin() also
 * checks the account and its sessionVersion in admins.json.
 */

export const SESSION_COOKIE = "__Host-calix_admin";
export const PRE_COOKIE = "__Host-calix_admin_pre";

export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const PRE_MS = 5 * 60 * 1000;
/** Sensitive actions need a password and code check within this window (or in the same form). */
export const RECENT_AUTH_MS = 5 * 60 * 1000;

export type SessionPayload = {
  t: "s";
  sid: string; // random session id, so one session can be revoked on its own
  a: string; // admin id
  v: number; // sessionVersion
  iat: number;
  seen: number;
  auth: number; // last full authentication (password + code)
};

export type PrePayload = { t: "p"; a: string; stage: "totp" | "enrol"; iat: number };

function secret(): string | null {
  const s = process.env.SESSION_SECRET ?? "";
  return s.length >= 32 ? s : null;
}

const mac = (key: string, body: string) => createHmac("sha256", key).update(body).digest("base64url");

export function signToken(payload: SessionPayload | PrePayload): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is missing or too short");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(key, body)}`;
}

export function verifyToken<T extends SessionPayload | PrePayload>(token: string | undefined, kind: T["t"]): T | null {
  const key = secret();
  if (!key || !token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(key, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return payload.t === kind ? payload : null;
  } catch {
    return null;
  }
}

/** Time checks for a session (signature already verified). */
export function sessionFresh(p: SessionPayload, now = Date.now()) {
  return now - p.iat < ABSOLUTE_MS && now - p.seen < IDLE_MS && p.iat <= now + 60_000;
}

export const cookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: Math.floor(maxAgeMs / 1000),
});

/**
 * Options that expire a cookie. A `__Host-` cookie can only be replaced (and so removed) by a
 * Set-Cookie that is itself `Secure` with `Path=/`; browsers ignore anything else. Next's
 * `cookies().delete()` omits `Secure`, so it must not be used for these cookies.
 */
export const expiredCookieOptions = () => ({ ...cookieOptions(0), maxAge: 0, expires: new Date(0) });
