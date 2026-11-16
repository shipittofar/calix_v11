"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/client-ip";
import { adminProblems } from "@/lib/admin/config";
import { audit } from "@/lib/admin/audit";
import { dummyHash, generateRecoveryCodes, hashRecoveryCode, verifyPassword } from "@/lib/admin/password";
import { clearSignInFailures, recordSignInFailure, signInAttempt } from "@/lib/admin/rate-limit";
import { endSession, readPre, revokeSession, setPre, startSession, currentAdmin } from "@/lib/admin/session";
import { generateTotpSecret, verifyTotp } from "@/lib/admin/totp";
import { findAdminByEmail, findAdminById, updateAdmin } from "@/lib/admin/users";
import { seal, unseal } from "@/lib/settings/crypto";

export type LoginState = { error?: string; recoveryCodes?: string[] };

const GENERIC = "Email, password or code is incorrect.";
const LOCKED = "Too many attempts. Try again in 15 minutes.";

async function ip() {
  return clientIp(await headers());
}

/** Step 1: email and password. */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if ((await adminProblems()).length) return { error: "The admin is not available on this server." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const addr = await ip();
  if (signInAttempt(email, addr) === "locked") {
    await audit({ adminId: "anonymous", action: "auth.signin", outcome: "denied", ip: addr, detail: "rate_limited" });
    return { error: LOCKED };
  }
  const admin = await findAdminByEmail(email);
  // Same work whether or not the account exists, so timing doesn't reveal accounts.
  const ok = await verifyPassword(password, admin?.passwordHash ?? (await dummyHash()));
  if (!admin || !ok || admin.status !== "active") {
    recordSignInFailure(email, addr);
    await audit({ adminId: admin?.id ?? "anonymous", action: "auth.signin", outcome: "denied", ip: addr, detail: "password", preAuth: true });
    return { error: GENERIC };
  }
  if (admin.totp) {
    await setPre(admin.id, "totp");
    redirect("/admin/login?step=code");
  }
  if (!admin.pendingTotp) {
    await updateAdmin(admin.id, { pendingTotp: { sealed: seal(generateTotpSecret()), createdAt: new Date().toISOString() } }, admin.id);
  }
  await setPre(admin.id, "enrol");
  redirect("/admin/login?step=enrol");
}

/**
 * Step 2: authenticator code or a recovery code. The code is checked and consumed in one locked
 * update against the current record, so the same code can't succeed twice, even concurrently.
 */
export async function verifyCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const pre = await readPre();
  if (!pre || pre.stage !== "totp") redirect("/admin/login");
  const addr = await ip();
  const admin = await findAdminById(pre.a);
  if (!admin || admin.status !== "active" || !admin.totp) return { error: GENERIC };
  if (signInAttempt(admin.email, addr) === "locked") {
    await audit({ adminId: admin.id, action: "auth.code", outcome: "denied", ip: addr, detail: "rate_limited", preAuth: true });
    return { error: LOCKED };
  }
  const code = String(formData.get("code") ?? "").trim().replace(/\s+/g, "").slice(0, 20);
  let method: "totp" | "recovery_code" = "totp";
  const updated = await updateAdmin(
    admin.id,
    (a) => {
      if (a.status !== "active" || !a.totp) return null;
      const now = new Date().toISOString();
      const secret = unseal(a.totp.sealed);
      const step = secret && /^\d{6}$/.test(code) ? verifyTotp(secret, code, a.totp.lastStep) : null;
      if (step !== null) return { totp: { ...a.totp, lastStep: step }, lastLoginAt: now };
      const index = code.length > 6 ? a.recoveryCodes.indexOf(hashRecoveryCode(code)) : -1;
      if (index === -1) return null;
      method = "recovery_code";
      return { recoveryCodes: a.recoveryCodes.filter((_, i) => i !== index), lastLoginAt: now };
    },
    admin.id,
  );
  if (!updated.ok) {
    if (updated.reason !== "unchanged") return { error: "Could not complete sign-in. Try again." };
    recordSignInFailure(admin.email, addr);
    await audit({ adminId: admin.id, action: "auth.code", outcome: "denied", ip: addr, preAuth: true });
    return { error: GENERIC };
  }
  clearSignInFailures(admin.email, addr);
  await startSession(updated.admin);
  await audit({ adminId: admin.id, action: "auth.signin", outcome: "success", ip: addr, detail: method });
  redirect("/admin");
}

/** Step 2 on first sign-in: confirm the authenticator app, then show recovery codes once. */
export async function completeEnrolment(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const pre = await readPre();
  if (!pre || pre.stage !== "enrol") redirect("/admin/login");
  const addr = await ip();
  const admin = await findAdminById(pre.a);
  if (!admin || admin.status !== "active" || !admin.pendingTotp) return { error: GENERIC };
  if (signInAttempt(admin.email, addr) === "locked") {
    await audit({ adminId: admin.id, action: "auth.enrol", outcome: "denied", ip: addr, detail: "rate_limited", preAuth: true });
    return { error: LOCKED };
  }
  const code = String(formData.get("code") ?? "").trim();
  const { codes, hashes } = generateRecoveryCodes();
  // Checked against the pending secret inside the locked update, so enrolment completes once.
  const updated = await updateAdmin(
    admin.id,
    (a) => {
      if (a.status !== "active" || !a.pendingTotp || a.totp) return null;
      const secret = unseal(a.pendingTotp.sealed);
      const step = secret ? verifyTotp(secret, code, -1) : null;
      if (step === null) return null;
      return { totp: { sealed: a.pendingTotp.sealed, lastStep: step }, pendingTotp: undefined, recoveryCodes: hashes, lastLoginAt: new Date().toISOString() };
    },
    admin.id,
  );
  if (!updated.ok) {
    if (updated.reason !== "unchanged") return { error: "Could not save. Try again." };
    recordSignInFailure(admin.email, addr);
    await audit({ adminId: admin.id, action: "auth.enrol", outcome: "denied", ip: addr, preAuth: true });
    return { error: "That code didn't match. Check the time on your phone and try the current code." };
  }
  clearSignInFailures(admin.email, addr);
  await startSession(updated.admin);
  await audit({ adminId: admin.id, action: "auth.enrol", outcome: "success", ip: addr });
  return { recoveryCodes: codes };
}

/**
 * Ends this session on the server (a copied cookie stops working) and removes the cookies. A
 * Server Action, so Next.js refuses cross-site posts (Origin check), and the session cookie is
 * SameSite=Strict: another site can't sign an administrator out.
 */
export async function signOut(): Promise<void> {
  const s = await currentAdmin();
  let complete = true;
  if (s) {
    const revoked = await revokeSession(s);
    complete = revoked.ok;
    await audit({ adminId: s.admin.id, action: "auth.signout", outcome: revoked.ok ? "success" : "error", ip: s.ip, ...(revoked.ok ? {} : { detail: `revocation_${revoked.reason}` }) });
  }
  await endSession();
  // If the server couldn't record the revocation, say so: the cookies are gone from this browser,
  // but a copy of the session cookie would still work until it expires.
  redirect(complete ? "/admin/login" : "/admin/login?signout=incomplete");
}
