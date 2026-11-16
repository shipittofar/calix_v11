/**
 * Restoring settings from a backup, on the production build. First shows the hazard (a plain file
 * restore revives a signed-out cookie and an account disabled since the backup), then that the
 * supported workflow (`admin-user restore`, then a new SESSION_SECRET) revives neither.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Client, textOf } from "../helpers/http";
import { startApp, type RunningApp } from "../helpers/app";
import { EMAIL, PASSWORD, adminEnv, browser, cli, enrolAndSignIn, readJson } from "../helpers/admin";

const root = resolve(import.meta.dirname, "../..");
const EDITOR = "editor@example.com";
const { dir, env } = adminEnv();
const work = mkdtempSync(join(tmpdir(), "calix-restore-it-"));

/** Signed in = the server renders this administrator's account page (not just any 200 page). */
const signedIn = async (base: string, cookie: string) => {
  const c = new Client(base);
  c.cookies.set("__Host-calix_admin", cookie);
  const r = await c.get("/admin/security");
  return r.res.status === 200 && textOf(r.html).includes(`Signed in as ${EMAIL}`);
};
/** Saves the footer line through the General settings action, as the holder of `cookie`. */
const trySave = async (base: string, cookie: string, html: string, text: string) => {
  const c = new Client(base);
  c.cookies.set("__Host-calix_admin", cookie);
  const fields = Object.fromEntries(
    [...html.matchAll(/<input[^>]*\bname="([^"$]+)"[^>]*>/g)].filter((m) => !/type="hidden"/.test(m[0])).map((m) => [m[1], (m[0].match(/\bvalue="([^"]*)"/) ?? [])[1] ?? ""]),
  );
  for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) fields[m[1]] = (m[0].match(/<option value="([^"]*)" selected=""/) ?? [])[1] ?? "";
  await c.submit("/admin", { ...fields, copyrightText: text }, { index: 1, html });
};
/** The live settings file, or null while none has been saved (the backup holds none either). */
const savedSettings = () => (existsSync(join(dir, "settings.json")) ? readJson(dir, "settings.json") : null);
const passwordStep = async (base: string, email: string) => {
  const r = await browser(base).submit("/admin/login", { email, password: PASSWORD });
  return r.location ?? textOf(r.html).match(/Email, password or code is incorrect\.|The admin is not available on this server\./)?.[0] ?? `status ${r.res.status}`;
};

describe("restoring settings from a backup (production build)", () => {
  let app: RunningApp | null = null;
  let port = 0;
  let oldCookie = "";
  let archive = "";
  let formHtml = "";
  let nextCode: () => Promise<string>;
  const start = async (e: Record<string, string>) => {
    app = await startApp(e, port || undefined);
    port = Number(new URL(app.base).port);
    return app;
  };
  const stop = async () => {
    await app?.stop();
    app = null;
  };

  before(async () => {
    cli(env, "add", EMAIL);
    cli(env, "add", EDITOR);
    const a = await start(env);
    const s = await enrolAndSignIn(a.base);
    nextCode = s.nextCode;
    oldCookie = s.client.cookies.get("__Host-calix_admin")!;
    // Back up while that session is valid and the editor is active.
    const b = spawnSync("bash", [join(root, "deploy/backup-settings.sh"), dir, join(work, "backups")], { encoding: "utf8" });
    assert.equal(b.status, 0, b.stderr);
    archive = b.stdout.trim();
    // After the backup: the owner signs out, the editor is disabled.
    const home = await s.client.get("/admin");
    await s.client.submit("/admin", {}, { index: 0, html: home.html });
    cli(env, "disable", EDITOR);
    assert.equal(await signedIn(a.base, oldCookie), false, "signed out");
    assert.equal(await passwordStep(a.base, EDITOR), "Email, password or code is incorrect.", "editor disabled");
    await stop();
  });
  after(async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  test("the hazard: a plain file restore revives the signed-out cookie and the disabled account", async () => {
    const plain = join(work, "plain");
    mkdirSync(plain, { mode: 0o700 });
    spawnSync("tar", ["-C", plain, "-xzf", archive]);
    const a = await start({ ...env, SETTINGS_DIR: plain });
    try {
      assert.equal(await signedIn(a.base, oldCookie), true, "revived session");
      const k = new Client(a.base);
      k.cookies.set("__Host-calix_admin", oldCookie);
      formHtml = (await k.get("/admin")).html;
      await trySave(a.base, oldCookie, formHtml, "Saved with a revived session");
      assert.equal(readJson(plain, "settings.json").footer.copyrightText, "Saved with a revived session", "the revived session can change settings");
      assert.equal(await passwordStep(a.base, EDITOR), "/admin/login?step=enrol", "revived account");
    } finally {
      await stop();
    }
  });

  test("supported restore: until SESSION_SECRET changes the admin is closed and the old cookie refused", async () => {
    const r = cli(env, "restore", archive);
    assert.match(r, /Administrators: kept from the live server/);
    const a = await start(env);
    try {
      assert.equal(await signedIn(a.base, oldCookie), false);
      const before = savedSettings();
      await trySave(a.base, oldCookie, formHtml, "Saved with the old cookie");
      assert.deepEqual(savedSettings(), before, "the old cookie can't change anything");
      const login = (await browser(a.base).get("/admin/login")).html;
      assert.match(textOf(login), /Admin unavailable/);
      assert.doesNotMatch(login, /<form\b/, "no sign-in form is offered");
      assert.match(a.output(), /\[admin\] unavailable until the server sets: .*a new SESSION_SECRET/);
    } finally {
      await stop();
    }
  });

  test("after the secret is changed: the old cookie stays refused, the editor stays disabled, the owner signs in", async () => {
    const rotated = { ...env, SESSION_SECRET: randomBytes(32).toString("base64url") };
    const a = await start(rotated);
    try {
      assert.equal(await signedIn(a.base, oldCookie), false, "old cookie refused under the new secret");
      const before = savedSettings();
      await trySave(a.base, oldCookie, formHtml, "Saved with the old cookie");
      assert.deepEqual(savedSettings(), before);
      assert.equal(await passwordStep(a.base, EDITOR), "Email, password or code is incorrect.", "still disabled");
      const c = browser(a.base);
      const p = await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
      assert.equal(p.location, "/admin/login?step=code");
      const page = await c.get("/admin/login?step=code");
      const ok = await c.submit("/admin/login?step=code", { code: await nextCode() }, { html: page.html });
      assert.equal(ok.location, "/admin");
      assert.equal((await c.get("/admin")).res.status, 200);
      Object.assign(env, rotated);
    } finally {
      await stop();
    }
  });

  test("--restore-admins: every account from the backup comes back disabled until re-enabled", async () => {
    cli(env, "restore", archive, "--restore-admins");
    const rotated = { ...env, SESSION_SECRET: randomBytes(32).toString("base64url") };
    const admins = readJson(dir, "admins.json").admins as Array<{ email: string; status: string }>;
    assert.deepEqual(admins.map((a) => a.status), ["disabled", "disabled"]);
    const a = await start(rotated);
    try {
      assert.equal(await passwordStep(a.base, EMAIL), "Email, password or code is incorrect.");
      assert.equal(await passwordStep(a.base, EDITOR), "Email, password or code is incorrect.");
      cli(rotated, "enable", EMAIL);
      assert.equal(await passwordStep(a.base, EMAIL), "/admin/login?step=code", "re-enabled on purpose");
      assert.equal(await passwordStep(a.base, EDITOR), "Email, password or code is incorrect.");
    } finally {
      await stop();
    }
  });

  test("a restore killed midway keeps the admin closed even after the secret changes, until it is rolled back", async () => {
    const killed = spawnSync(
      process.execPath,
      [
        "--import",
        "./scripts/register-ts.mjs",
        "--input-type=module",
        "-e",
        `const { performRestore, restoreTestHooks } = await import("@/lib/admin/restore");
         restoreTestHooks.afterReplace = () => process.kill(process.pid, "SIGKILL");
         await performRestore({ archive: ${JSON.stringify(archive)}, restoreAdmins: true });`,
      ],
      { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" },
    );
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    let a = await start({ ...env, SESSION_SECRET: randomBytes(32).toString("base64url") });
    try {
      const login = (await browser(a.base).get("/admin/login")).html;
      assert.match(textOf(login), /Admin unavailable/);
      assert.doesNotMatch(login, /<form\b/);
      assert.match(a.output(), /\[admin\] unavailable until the server sets: .*the unfinished restore to be rolled back/);
    } finally {
      await stop();
    }
    assert.match(cli(env, "restore", "--rollback"), /Rolled back: put back/);
    const rotated = { ...env, SESSION_SECRET: randomBytes(32).toString("base64url") };
    a = await start(rotated);
    try {
      assert.equal(await passwordStep(a.base, EMAIL), "/admin/login?step=code", "open again, with the accounts as before the restore");
      assert.equal(await passwordStep(a.base, EDITOR), "Email, password or code is incorrect.");
    } finally {
      await stop();
    }
  });
});
