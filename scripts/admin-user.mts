/**
 * Administrator accounts, managed on the server by the operator (there is no sign-up page).
 *
 *   npm run admin:user -- list
 *   npm run admin:user -- add <email>       prompts for a password; the authenticator is set up at first sign-in
 *   npm run admin:user -- reset <email>     new password, authenticator and recovery codes cleared, signed out
 *   npm run admin:user -- disable <email>   signs the account out and blocks sign-in
 *   npm run admin:user -- enable <email>
 *   npm run admin:user -- restore <archive> [--restore-admins]
 *                                           restore settings from a backup, with the site stopped
 *                                           (runbook §5); afterwards SESSION_SECRET must be changed
 *   npm run admin:user -- restore --rollback
 *                                           put back the files saved by an unfinished restore (or a
 *                                           finished one still waiting for the new SESSION_SECRET)
 *   npm run admin:user -- rekey             after rotating SETTINGS_ENCRYPTION_KEY (old key in
 *                                           SETTINGS_ENCRYPTION_KEY_PREVIOUS): re-encrypt stored secrets
 *
 * Run as the service user with the production environment (SETTINGS_DIR, SESSION_SECRET,
 * SETTINGS_ENCRYPTION_KEY). Passwords are read from a hidden prompt, or from standard input when
 * piped (two lines: password, confirmation), never from arguments.
 */
import { createInterface } from "node:readline";
import { addAdmin, findAdminByEmail, listAdmins, updateAdmin } from "@/lib/admin/users";
import { hashPassword, passwordProblem } from "@/lib/admin/password";
import { audit } from "@/lib/admin/audit";
import { storeStatus, updateStore } from "@/lib/settings/store";
import { seal, unsealWith } from "@/lib/settings/crypto";
import { performRestore, performRollback, RestoreError } from "@/lib/admin/restore";
import { emailAddress } from "@/lib/settings/schema";

const [command, emailArg] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readPasswordTwice(): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    const lines: string[] = [];
    for await (const line of rl) {
      lines.push(line);
      if (lines.length === 2) break;
    }
    rl.close();
    if (lines[0] !== lines[1]) fail("The passwords do not match.");
    return lines[0] ?? "";
  }
  const ask = (prompt: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      let value = "";
      const onData = (buf: Buffer) => {
        for (const ch of buf.toString("utf8")) {
          if (ch === "\r" || ch === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stdout.write("\n");
            resolve(value);
            return;
          }
          if (ch === "\u0003") process.exit(130);
          value = ch === "\u007f" ? value.slice(0, -1) : value + ch;
        }
      };
      stdin.on("data", onData);
    });
  const a = await ask("Password: ");
  const b = await ask("Confirm password: ");
  if (a !== b) fail("The passwords do not match.");
  return a;
}

async function main() {
  const store = await storeStatus();
  if (!store.ok) fail(`Settings store unavailable: ${store.problem}`);

  if (command === "list") {
    for (const a of await listAdmins()) {
      console.log(`${a.email}\t${a.status}\t${a.totp ? "authenticator set" : "authenticator not set"}\tlast sign-in ${a.lastLoginAt ?? "never"}`);
    }
    return;
  }

  if (command === "restore") {
    const args = process.argv.slice(3);
    const archive = args.find((a) => !a.startsWith("--"));
    if (args.includes("--rollback")) {
      if (archive) fail("Usage: admin-user restore --rollback (no archive)");
      try {
        const r = await performRollback();
        console.log(`Rolled back: put back ${r.putBack.join(", ") || "nothing"}${r.removed.length ? `; removed ${r.removed.join(", ")} (absent before the restore)` : ""}, from ${r.aside}/.`);
        console.log("Next: change SESSION_SECRET in the environment file, then start the site. Until then the admin stays unavailable (runbook §5).");
      } catch (error) {
        if (error instanceof RestoreError) fail(error.message);
        throw error;
      }
      return;
    }
    if (!archive) fail("Usage: admin-user restore <archive> [--restore-admins] | restore --rollback");
    try {
      const r = await performRestore({ archive: archive!, restoreAdmins: args.includes("--restore-admins") });
      console.log(`Restored ${r.restored.join(", ")}. The files that were there are kept in ${r.asideDir}/ inside SETTINGS_DIR.`);
      console.log(
        r.keptAdmins
          ? "Administrators: kept from the live server (pass --restore-admins to take them from the backup)."
          : `Administrators: taken from the backup and all DISABLED: ${r.disabledAccounts.join(", ")}. Re-enable each one you trust with \`admin-user enable <email>\`.`,
      );
      console.log("Next: change SESSION_SECRET in the environment file, then start the site. Until then the admin stays unavailable (runbook §5).");
    } catch (error) {
      if (error instanceof RestoreError) fail(error.message);
      throw error;
    }
    return;
  }

  if (command === "rekey") {
    // Re-encrypts every sealed value with the current key, inside one locked update per file. If
    // any value can't be read with either key, that file is left exactly as it was.
    let done = 0;
    let unreadable = 0;
    const reseal = (sealed: string) => {
      const opened = unsealWith(sealed);
      if (!opened) {
        unreadable++;
        return sealed;
      }
      done++;
      return seal(opened.plaintext);
    };
    const admins = await updateStore(
      "admins",
      (cur) => {
        if (!cur) return null;
        const before = unreadable;
        const next = cur.admins.map((a) => ({
          ...a,
          ...(a.totp ? { totp: { ...a.totp, sealed: reseal(a.totp.sealed) } } : {}),
          ...(a.pendingTotp ? { pendingTotp: { ...a.pendingTotp, sealed: reseal(a.pendingTotp.sealed) } } : {}),
        }));
        return unreadable > before ? null : { admins: next };
      },
      { by: "cli" },
    );
    const delivery = await updateStore(
      "delivery",
      (cur) => {
        if (!cur?.telegram.botToken && !cur?.whatsapp?.accessToken) return null;
        const before = unreadable;
        const telegram = cur.telegram.botToken
          ? { ...cur.telegram, botToken: { ...cur.telegram.botToken, sealed: reseal(cur.telegram.botToken.sealed) } }
          : cur.telegram;
        const whatsapp = cur.whatsapp?.accessToken
          ? { ...cur.whatsapp, accessToken: { ...cur.whatsapp.accessToken, sealed: reseal(cur.whatsapp.accessToken.sealed) } }
          : cur.whatsapp;
        return unreadable > before ? null : { email: cur.email, telegram, ...(whatsapp ? { whatsapp } : {}) };
      },
      { by: "cli" },
    );
    for (const [name, r] of [["admins", admins], ["delivery", delivery]] as const) {
      if (!r.ok && r.reason !== "unchanged") fail(`Could not update ${name}.json (${r.reason}); nothing in it was changed.`);
    }
    await audit({ adminId: "cli", action: "settings.rekey", outcome: unreadable ? "error" : "success", changes: { reencrypted: done, unreadable } });
    console.log(`Re-encrypted ${done} value(s); ${unreadable} could not be read.`);
    if (unreadable) fail("Some values could not be read with SETTINGS_ENCRYPTION_KEY or SETTINGS_ENCRYPTION_KEY_PREVIOUS; their files were left unchanged.");
    return;
  }

  const parsed = emailAddress.safeParse(emailArg ?? "");
  if (!parsed.success) fail("Usage: admin-user <add|reset|disable|enable> <email>");
  const email = parsed.data;
  const existing = await findAdminByEmail(email);

  if (command === "add") {
    if (existing) fail("An administrator with this email already exists.");
    const password = await readPasswordTwice();
    const problem = passwordProblem(password, email);
    if (problem) fail(problem);
    const result = await addAdmin(email, await hashPassword(password), "cli");
    if (!result.ok) fail(`Could not save the account (${result.reason}).`);
    await audit({ adminId: "cli", action: "admin.user.add", outcome: "success", changes: { admin: result.admin.id } });
    console.log(`Added ${email}. Sign in at /admin/login to set up the authenticator app.`);
    return;
  }

  if (!existing) fail("No administrator with this email.");

  if (command === "reset") {
    const password = await readPasswordTwice();
    const problem = passwordProblem(password, email);
    if (problem) fail(problem);
    const passwordHash = await hashPassword(password);
    const result = await updateAdmin(
      existing.id,
      (a) => ({ passwordHash, totp: undefined, pendingTotp: undefined, recoveryCodes: [], sessionVersion: a.sessionVersion + 1 }),
      "cli",
    );
    if (!result.ok) fail(`Could not save (${result.reason}).`);
    await audit({ adminId: "cli", action: "admin.user.reset", outcome: "success", changes: { admin: existing.id } });
    console.log(`Reset ${email}: signed out everywhere; the authenticator must be set up again at the next sign-in.`);
    return;
  }

  if (command === "disable" || command === "enable") {
    const result = await updateAdmin(
      existing.id,
      (a) => ({ status: command === "disable" ? "disabled" : "active", sessionVersion: a.sessionVersion + 1 }),
      "cli",
    );
    if (!result.ok) fail(`Could not save (${result.reason}).`);
    await audit({ adminId: "cli", action: `admin.user.${command}`, outcome: "success", changes: { admin: existing.id } });
    console.log(`${command === "disable" ? "Disabled" : "Enabled"} ${email}.`);
    return;
  }

  fail("Usage: admin-user <list|add|reset|disable|enable|rekey|restore> [email|archive]");
}

await main();
