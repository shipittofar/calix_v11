"use server";

import { redirect } from "next/navigation";
import { AdminAuthError, endSession, requireAdmin, startSession, type AdminSession } from "@/lib/admin/session";
import { audit } from "@/lib/admin/audit";
import { confirmIdentity } from "@/lib/admin/reauth";
import { generateRecoveryCodes, hashPassword, passwordProblem } from "@/lib/admin/password";
import { updateAdmin } from "@/lib/admin/users";

export type AccountState = { ok?: string; error?: string; recoveryCodes?: string[] };

const SIGNED_OUT: AccountState = { error: "Your session has ended. Sign in again." };

export async function changePassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  let s: AdminSession;
  try {
    s = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) return SIGNED_OUT;
    throw e;
  }
  const problem = await confirmIdentity(s, formData);
  if (problem) return { error: problem };
  const next = String(formData.get("newPassword") ?? "");
  if (next !== String(formData.get("confirmPassword") ?? "")) return { error: "The new passwords do not match." };
  const policy = passwordProblem(next, s.admin.email);
  if (policy) return { error: policy };
  const passwordHash = await hashPassword(next);
  const updated = await updateAdmin(s.admin.id, (a) => ({ passwordHash, sessionVersion: a.sessionVersion + 1 }), s.admin.id);
  if (!updated.ok) return { error: "Could not save. Try again." };
  await startSession(updated.admin);
  await audit({ adminId: s.admin.id, action: "auth.password.change", outcome: "success", ip: s.ip });
  return { ok: "Password changed. Other devices have been signed out." };
}

export async function regenerateRecoveryCodes(_prev: AccountState, formData: FormData): Promise<AccountState> {
  let s: AdminSession;
  try {
    s = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) return SIGNED_OUT;
    throw e;
  }
  const problem = await confirmIdentity(s, formData);
  if (problem) return { error: problem };
  const { codes, hashes } = generateRecoveryCodes();
  const updated = await updateAdmin(s.admin.id, { recoveryCodes: hashes }, s.admin.id);
  if (!updated.ok) return { error: "Could not save. Try again." };
  await audit({ adminId: s.admin.id, action: "auth.recovery.regenerate", outcome: "success", ip: s.ip });
  return { ok: "New recovery codes created. The old ones no longer work.", recoveryCodes: codes };
}

export async function signOutEverywhere(): Promise<void> {
  let s: AdminSession;
  try {
    s = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) redirect("/admin/login");
    throw e;
  }
  await updateAdmin(s.admin.id, (a) => ({ sessionVersion: a.sessionVersion + 1 }), s.admin.id);
  await endSession();
  await audit({ adminId: s.admin.id, action: "auth.signout.everywhere", outcome: "success", ip: s.ip });
  redirect("/admin/login");
}
