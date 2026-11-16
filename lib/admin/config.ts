import "server-only";
import { encryptionKey } from "@/lib/settings/crypto";
import { storeStatus } from "@/lib/settings/store";
import { restoreState } from "./restore";

let logged = "";

/**
 * The admin works only when its server configuration is complete. Missing items are named (never
 * their values) in the server log, once per process per change; visitors only see that the admin
 * is unavailable (app/admin/layout.tsx).
 */
export async function adminProblems(): Promise<string[]> {
  const problems: string[] = [];
  if ((process.env.SESSION_SECRET ?? "").length < 32) problems.push("SESSION_SECRET (at least 32 random characters)");
  if (!encryptionKey()) problems.push("SETTINGS_ENCRYPTION_KEY (32 random bytes, base64)");
  const store = await storeStatus();
  if (!store.ok) problems.push(store.problem ?? "SETTINGS_DIR");
  const restore = await restoreState();
  if (restore.state === "in-progress") problems.push("the unfinished restore to be rolled back (admin-user restore --rollback; runbook §5)");
  else if (restore.state === "unreadable") problems.push("a readable restore.json (the restore record can't be read; runbook §5)");
  else if (restore.pending) problems.push("a new SESSION_SECRET (settings were restored from a backup; runbook §5)");
  const summary = problems.join("; ");
  if (summary && summary !== logged) console.error(`[admin] unavailable until the server sets: ${summary}`);
  logged = summary;
  return problems;
}
