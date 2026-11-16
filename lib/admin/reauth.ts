import "server-only";
import { audit } from "./audit";
import { verifyPassword } from "./password";
import { reauthFailures } from "./rate-limit";
import type { AdminSession } from "./session";
import { verifyTotp } from "./totp";
import { updateAdmin } from "./users";
import { unseal } from "@/lib/settings/crypto";

/**
 * Re-authentication inside the form: the current password and a fresh authenticator code.
 * Has its own per-administrator limit (lib/admin/rate-limit.ts), separate from sign-in.
 */
export async function confirmIdentity(s: AdminSession, formData: FormData): Promise<string | null> {
  if (reauthFailures.blocked(s.admin.id)) return "Too many attempts. Try again in 15 minutes.";
  const password = String(formData.get("currentPassword") ?? "");
  const code = String(formData.get("confirmCode") ?? "").trim();
  const passwordOk = await verifyPassword(password, s.admin.passwordHash);
  // The code is checked and consumed in one locked update, so it can't be used twice.
  const consumed = passwordOk
    ? await updateAdmin(
        s.admin.id,
        (a) => {
          const secret = a.totp ? unseal(a.totp.sealed) : null;
          const step = secret && a.totp ? verifyTotp(secret, code, a.totp.lastStep) : null;
          return step !== null && a.totp ? { totp: { ...a.totp, lastStep: step } } : null;
        },
        s.admin.id,
      )
    : null;
  if (!consumed?.ok) {
    reauthFailures.record(s.admin.id);
    await audit({ adminId: s.admin.id, action: "auth.reconfirm", outcome: "denied", ip: s.ip });
    return "Your password or authenticator code is incorrect.";
  }
  return null;
}
