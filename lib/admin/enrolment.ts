import "server-only";
import { readPre } from "./session";
import { findAdminById } from "./users";
import { unseal } from "@/lib/settings/crypto";

/**
 * For the enrolment screen only (a Server Component, never a Server Action): the secret to add to
 * the authenticator app, available only between the password step and the first code.
 */
export async function pendingEnrolment(): Promise<{ email: string; secret: string } | null> {
  const pre = await readPre();
  if (!pre || pre.stage !== "enrol") return null;
  const admin = await findAdminById(pre.a);
  const secret = admin?.pendingTotp ? unseal(admin.pendingTotp.sealed) : null;
  return admin && secret ? { email: admin.email, secret } : null;
}
