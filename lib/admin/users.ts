import "server-only";
import { randomBytes } from "node:crypto";
import { readStore, updateStore } from "@/lib/settings/store";
import type { AdminRecord, AdminsFile } from "@/lib/settings/schema";

/** Administrator records (admins.json). Accounts are created only with scripts/admin-user.mts. */

export async function listAdmins(): Promise<AdminRecord[]> {
  return (await readStore("admins"))?.admins ?? [];
}

export async function findAdminByEmail(email: string): Promise<AdminRecord | undefined> {
  const e = email.trim().toLowerCase();
  return (await listAdmins()).find((a) => a.email.toLowerCase() === e);
}

export async function findAdminById(id: string): Promise<AdminRecord | undefined> {
  return (await listAdmins()).find((a) => a.id === id);
}

const newId = () => `adm_${randomBytes(8).toString("hex")}`;

type Changes = Partial<Omit<AdminRecord, "id" | "email" | "createdAt">>;

/**
 * Applies changes to one administrator, under the store lock, against the current record. A
 * function `changes` may return null to decline (nothing is written, reason "unchanged"): checks
 * that must not race, such as consuming a one-time code, are made inside it.
 */
export async function updateAdmin(id: string, changes: Changes | ((a: AdminRecord) => Changes | null), by: string) {
  let updated: AdminRecord | undefined;
  let declined = false;
  const result = await updateStore(
    "admins",
    (current) => {
      const admins = (current?.admins ?? []).map((a) => {
        if (a.id !== id) return a;
        const patch = typeof changes === "function" ? changes(a) : changes;
        if (patch === null) {
          declined = true;
          return a;
        }
        updated = { ...a, ...patch };
        // `undefined` in a patch removes the field.
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (updated as Record<string, unknown>)[k];
        return updated;
      });
      if (declined) return null;
      return { admins } as Omit<AdminsFile, "version" | "revision" | "updatedAt" | "updatedBy">;
    },
    { by },
  );
  if (result.ok && updated) return { ok: true as const, admin: updated };
  return { ok: false as const, reason: result.ok ? "not_found" : result.reason };
}

export async function addAdmin(email: string, passwordHash: string, by: string) {
  const record: AdminRecord = {
    id: newId(),
    email: email.trim(),
    status: "active",
    passwordHash,
    recoveryCodes: [],
    sessionVersion: 0,
    createdAt: new Date().toISOString(),
  };
  const result = await updateStore(
    "admins",
    (current) => ({ admins: [...(current?.admins ?? []), record] }),
    { by },
  );
  return result.ok ? { ok: true as const, admin: record } : { ok: false as const, reason: result.reason, issues: "issues" in result ? result.issues : undefined };
}
