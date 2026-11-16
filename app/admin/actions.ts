"use server";

import { revalidatePath } from "next/cache";
import { AdminAuthError, requireAdmin, type AdminSession } from "@/lib/admin/session";
import { audit } from "@/lib/admin/audit";
import { readStore, updateStore } from "@/lib/settings/store";
import { changedFields, parseGeneral, readValues, type GeneralValues } from "@/lib/settings/general-form";

export type GeneralState = {
  ok?: string;
  error?: string;
  errors?: Record<string, string>;
  values?: GeneralValues;
  revision?: number;
};

export async function saveGeneralSettings(_prev: GeneralState, formData: FormData): Promise<GeneralState> {
  let s: AdminSession;
  try {
    s = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) return { error: "Your session has ended. Sign in again; nothing was saved." };
    throw e;
  }
  const values = readValues(formData);
  const baseRevision = Number(formData.get("revision"));
  const parsed = parseGeneral(values);
  if (!parsed.ok) {
    return { error: "Nothing was saved. Check the highlighted fields.", errors: parsed.errors, values };
  }

  const before = await readStore("settings");
  const result = await updateStore(
    "settings",
    (current) => ({
      ...parsed.sections,
      // The contact-form switch is managed on its own page and is kept as it is.
      form: current?.form ?? { acceptingEnquiries: true },
    }),
    { by: s.admin.id, baseRevision: Number.isInteger(baseRevision) ? baseRevision : -1 },
  );

  if (!result.ok) {
    await audit({ adminId: s.admin.id, action: "settings.general.save", outcome: "error", ip: s.ip, detail: result.reason });
    const error =
      result.reason === "conflict"
        ? "Someone else saved these settings while you were editing. Nothing was saved: reload the page to see their changes, then make yours again."
        : result.reason === "invalid"
          ? "Nothing was saved: the settings did not pass validation."
          : "Nothing was saved: the settings store is unavailable. Try again, and tell the site operator if it continues.";
    return { error, values };
  }

  const changed = changedFields(before, result.value);
  // Every public page shows these facts (footer, structured data): re-render them all.
  revalidatePath("/", "layout");
  await audit({ adminId: s.admin.id, action: "settings.general.save", outcome: "success", ip: s.ip, changes: { fields: changed } });
  return {
    ok: changed.length ? "Saved. The website now shows these details." : "Saved. Nothing had changed.",
    revision: result.value.revision,
  };
}
