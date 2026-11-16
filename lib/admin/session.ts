import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/client-ip";
import { findAdminById, updateAdmin } from "./users";
import { restoreState } from "./restore";
import { audit } from "./audit";
import {
  ABSOLUTE_MS,
  PRE_COOKIE,
  PRE_MS,
  RECENT_AUTH_MS,
  SESSION_COOKIE,
  cookieOptions,
  expiredCookieOptions,
  sessionFresh,
  signToken,
  verifyToken,
  type PrePayload,
  type SessionPayload,
} from "./session-token";
import type { AdminRecord } from "@/lib/settings/schema";

export type AdminSession = { admin: AdminRecord; session: SessionPayload; ip: string };

/** The current administrator, or null. Checks signature, expiry, account status and sessionVersion. */
export async function currentAdmin(): Promise<AdminSession | null> {
  const jar = await cookies();
  const payload = verifyToken<SessionPayload>(jar.get(SESSION_COOKIE)?.value, "s");
  if (!payload || !sessionFresh(payload)) return null;
  // After a restore, no session is accepted until SESSION_SECRET has been changed (lib/admin/restore.ts).
  if ((await restoreState()).pending) return null;
  const admin = await findAdminById(payload.a);
  if (!admin || admin.status !== "active" || admin.sessionVersion !== payload.v || !admin.totp) return null;
  // Signed out (or issued before session ids existed): refused even with a valid signature.
  if (typeof payload.sid !== "string" || admin.revokedSessions?.some((r) => r.sid === payload.sid)) return null;
  return { admin, session: payload, ip: clientIp(await headers()) };
}

/**
 * The first call in every admin page, Server Action and route handler. Pages redirect to sign-in;
 * actions get a refusal they must return. Denials are audited.
 */
export async function requireAdmin(mode: "page" | "action" = "action"): Promise<AdminSession> {
  const s = await currentAdmin();
  if (s) return s;
  if (mode === "page") redirect("/admin/login");
  await audit({ adminId: "anonymous", action: "admin.access", outcome: "denied", ip: clientIp(await headers()) });
  throw new AdminAuthError();
}

/** requireAdmin() for actions that return a "signed out" state instead of throwing. Denials are audited. */
export async function sessionForAction(): Promise<AdminSession | null> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) return null;
    throw e;
  }
}

export class AdminAuthError extends Error {
  constructor() {
    super("Not signed in");
  }
}

export const recentlyAuthenticated = (s: AdminSession, now = Date.now()) => now - s.session.auth < RECENT_AUTH_MS;

export async function startSession(admin: AdminRecord) {
  const now = Date.now();
  const jar = await cookies();
  const sid = randomBytes(18).toString("base64url");
  jar.set(SESSION_COOKIE, signToken({ t: "s", sid, a: admin.id, v: admin.sessionVersion, iat: now, seen: now, auth: now }), cookieOptions(ABSOLUTE_MS));
  jar.set(PRE_COOKIE, "", expiredCookieOptions());
}

/** Marks a fresh password + code check within an existing session (for sensitive actions). */
export async function markReauthenticated(s: AdminSession) {
  const jar = await cookies();
  const now = Date.now();
  jar.set(SESSION_COOKIE, signToken({ ...s.session, seen: now, auth: now }), cookieOptions(ABSOLUTE_MS - (now - s.session.iat)));
}

/** Removes both admin cookies from the browser. */
export async function endSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", expiredCookieOptions());
  jar.set(PRE_COOKIE, "", expiredCookieOptions());
}

const MAX_REVOKED = 50;

/**
 * Revokes one session on the server, so a copy of its cookie stops working too. The entry is kept
 * until the session would have expired anyway. If too many are outstanding, the account's
 * sessionVersion is bumped instead, which ends every session of that account (fail safe).
 */
export async function revokeSession(s: AdminSession) {
  const now = Date.now();
  const until = s.session.iat + ABSOLUTE_MS;
  return updateAdmin(
    s.admin.id,
    (a) => {
      const live = (a.revokedSessions ?? []).filter((r) => r.until > now && r.sid !== s.session.sid);
      if (live.length >= MAX_REVOKED) return { sessionVersion: a.sessionVersion + 1, revokedSessions: undefined };
      return { revokedSessions: [...live, { sid: s.session.sid, until }] };
    },
    s.admin.id,
  );
}

export async function setPre(adminId: string, stage: PrePayload["stage"]) {
  (await cookies()).set(PRE_COOKIE, signToken({ t: "p", a: adminId, stage, iat: Date.now() }), cookieOptions(PRE_MS));
}

export async function readPre(): Promise<PrePayload | null> {
  const p = verifyToken<PrePayload>((await cookies()).get(PRE_COOKIE)?.value, "p");
  return p && Date.now() - p.iat < PRE_MS ? p : null;
}
