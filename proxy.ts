import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { MOTION_BOOT_SCRIPT } from "@/lib/motion";
import { ABSOLUTE_MS, SESSION_COOKIE, cookieOptions, sessionFresh, signToken, verifyToken, type SessionPayload } from "@/lib/admin/session-token";

/**
 * Admin routes only (see `config.matcher`): a nonce-based Content-Security-Policy, no caching,
 * no indexing, and the session's idle timer refreshed on each visit.
 *
 * This is not an authorisation boundary: every admin page and Server Action calls requireAdmin()
 * itself (lib/admin/session.ts). Public pages are untouched by this file.
 */
const motionHash = `'sha256-${createHash("sha256").update(MOTION_BOOT_SCRIPT).digest("base64")}'`;
// next/image renders the logo (in the hidden public header and footer) with this exact style attribute.
const imageStyleHash = `'sha256-${createHash("sha256").update("color:transparent").digest("base64")}'`;

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${motionHash}${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-hashes' ${imageStyleHash}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Referrer-Policy", "no-referrer");

  // Keep an active session alive (idle timeout), without extending its absolute lifetime.
  const session = verifyToken<SessionPayload>(request.cookies.get(SESSION_COOKIE)?.value, "s");
  const now = Date.now();
  if (session && sessionFresh(session, now) && now - session.seen > 60_000) {
    response.cookies.set(SESSION_COOKIE, signToken({ ...session, seen: now }), cookieOptions(ABSOLUTE_MS - (now - session.iat)));
  }
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
