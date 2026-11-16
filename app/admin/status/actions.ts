"use server";

import { revalidatePath } from "next/cache";
import { sessionForAction } from "@/lib/admin/session";
import { audit } from "@/lib/admin/audit";

export type RefreshState = { ok?: string; error?: string };

/**
 * Re-renders every public page on its next visit. Needed after settings files were restored or
 * changed outside the admin (runbook §5); saving in the admin already does this.
 */
export async function refreshPublicPages(): Promise<RefreshState> {
  const s = await sessionForAction();
  if (!s) return { error: "Your session has ended. Sign in again." };
  revalidatePath("/", "layout");
  await audit({ adminId: s.admin.id, action: "pages.refresh", outcome: "success", ip: s.ip });
  return { ok: "Done. Every public page shows the current settings on its next visit." };
}
