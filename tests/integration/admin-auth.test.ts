/**
 * Admin sign-in, session and refusal behaviour against the production build (`next start`),
 * submitting forms the way a browser without JavaScript does. The account is created with the
 * operator CLI, exactly as on the server.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { textOf, type Client } from "../helpers/http";
import { startApp, type RunningApp } from "../helpers/app";
import { EMAIL, PASSWORD, adminEnv, browser, cli as runCli, codeSource } from "../helpers/admin";
import { currentStep, totpAt } from "@/lib/admin/totp";
import { verifyAuditChain } from "@/lib/admin/audit";

const { dir, env } = adminEnv();
const cli = (...args: string[]) => runCli(env, ...args);

const admins = () => JSON.parse(readFileSync(join(dir, "admins.json"), "utf8")).admins as Array<Record<string, unknown>>;
const logLines = (file: string) =>
  existsSync(join(dir, file))
    ? readFileSync(join(dir, file), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { action: string; outcome: string; detail?: string; adminId: string })
    : [];
/** Security history: signed-in actions, sign-ins, sign-outs, CLI. */
const auditLines = () => logLines("audit.log");
/** Unauthenticated events (failed sign-in steps, refused anonymous requests). */
const accessLines = () => logLines("audit-access.log");

describe("admin authentication (production build)", () => {
  let app: RunningApp;
  let secret = "";
  let recoveryCodes: string[] = [];
  let securityHtml = "";
  let signedIn: Client;
  let nextCode: () => Promise<string>;
  let password = PASSWORD;

  before(async () => {
    cli("add", EMAIL);
    app = await startApp(env);
  });
  after(async () => {
    await app?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  test("anonymous visitors are sent to sign-in; admin responses are private and uncached", async () => {
    const c = browser(app.base);
    for (const path of ["/admin", "/admin/security", "/admin/notifications", "/admin/status"]) {
      const { res } = await c.get(path);
      assert.ok([303, 307].includes(res.status), `${path}: ${res.status}`);
      assert.match(res.headers.get("location") ?? "", /\/admin\/login$/);
    }
    const { res, html } = await c.get("/admin/login");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    assert.match(csp, /frame-ancestors 'none'/);
    // The public header and footer are not part of the admin.
    assert.match(html, /data-admin-shell/);
  });

  test("a wrong password gets the generic error and no cookie", async () => {
    const c = browser(app.base);
    const r = await c.submit("/admin/login", { email: EMAIL, password: "wrong password here" });
    assert.equal(r.res.status, 200);
    assert.match(textOf(r.html), /Email, password or code is incorrect\./);
    assert.equal(c.cookies.size, 0);
    const unknown = await c.submit("/admin/login", { email: "nobody@example.com", password: PASSWORD });
    assert.match(textOf(unknown.html), /Email, password or code is incorrect\./);
  });

  test("a cross-site form post is refused before the action runs", async () => {
    const c = browser(app.base);
    const before = { admins: JSON.stringify(admins()), main: auditLines().length, access: accessLines().length };
    const r = await c.submit("/admin/login", { email: EMAIL, password: PASSWORD }, { extraHeaders: { origin: "https://evil.example" } });
    assert.notEqual(r.res.status, 303);
    assert.equal(c.cookies.size, 0, "no sign-in cookie");
    // The action never ran: it would have created a pending authenticator secret and audit lines.
    assert.equal(JSON.stringify(admins()), before.admins);
    assert.equal(auditLines().length, before.main);
    assert.equal(accessLines().length, before.access);
  });

  test("first sign-in enrols the authenticator and shows recovery codes once", async () => {
    const c = browser(app.base);
    const r = await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    assert.equal(r.res.status, 303);
    assert.equal(r.location, "/admin/login?step=enrol");
    assert.ok(c.cookies.has("__Host-calix_admin_pre"));

    const page = await c.get("/admin/login?step=enrol");
    const m = page.html.match(/<code class="admin-secret">([A-Z2-7 ]+)<\/code>/);
    assert.ok(m, "setup key shown");
    secret = m[1].replace(/ /g, "");

    const bad = await c.submit("/admin/login?step=enrol", { code: "000000" }, { html: page.html });
    assert.match(textOf(bad.html), /That code didn't match/);

    const enrolStep = currentStep();
    nextCode = codeSource(secret, enrolStep);
    const ok = await c.submit("/admin/login?step=enrol", { code: totpAt(secret, enrolStep) }, { html: page.html });
    assert.equal(ok.res.status, 200);
    recoveryCodes = [...ok.html.matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((x) => x[1]);
    assert.equal(recoveryCodes.length, 8);
    assert.ok(c.cookies.has("__Host-calix_admin"));

    const home = await c.get("/admin");
    assert.equal(home.res.status, 200);
    assert.match(textOf(home.html), /General settings/);

    const security = await c.get("/admin/security");
    assert.equal(security.res.status, 200);
    securityHtml = security.html;
    signedIn = c;
    assert.match(textOf(securityHtml), new RegExp(`Signed in as ${EMAIL}`));

    // The secret is stored sealed, and never in plain text.
    const stored = JSON.stringify(admins());
    assert.ok(!stored.includes(secret));
    assert.ok(!stored.includes(recoveryCodes[0]));
    assert.equal(statSync(join(dir, "admins.json")).mode & 0o777, 0o600);
  });

  test("the status page reports server settings as set or not set, never their values", async () => {
    const c = browser(app.base);
    c.cookies = new Map(signedIn.cookies);
    const { res, html } = await c.get("/admin/status");
    assert.equal(res.status, 200);
    const text = textOf(html);
    assert.match(text, /Settings storage \(SETTINGS_DIR\) OK/);
    assert.match(text, /SESSION_SECRET OK Set\./);
    assert.match(text, /Visitor address \(TRUSTED_PROXY_HEADER\) OK Read from x-real-ip\. Your address as seen now: 198\.51\.100\.\d+\./);
    assert.match(text, /Process manager Info Not running under PM2/);
    for (const v of [env.SESSION_SECRET, env.SETTINGS_ENCRYPTION_KEY, env.FORM_SECRET, dir]) assert.ok(!html.includes(v), "a secret or path on the status page");

    // Refresh public pages: audited, and refused without a session.
    const r = await c.submit("/admin/status", {}, { index: 1, html });
    assert.match(textOf(r.html), /Every public page shows the current settings on its next visit\./);
    assert.ok(auditLines().some((l) => l.action === "pages.refresh" && l.outcome === "success"));
    const anon = await browser(app.base).submit("/admin/status", {}, { index: 1, html });
    assert.doesNotMatch(textOf(anon.html), /Every public page shows/);
  });

  test("a stolen form replayed without a session changes nothing", async () => {
    const before = JSON.stringify(admins());
    const anon = browser(app.base);
    // Form 2 on the security page is "Create new recovery codes" (form 0 is sign-out, 1 change password).
    const r = await anon.submit(
      "/admin/security",
      { currentPassword: PASSWORD, confirmCode: totpAt(secret, currentStep()) },
      { index: 2, html: securityHtml },
    );
    assert.ok(!/<code>[a-z0-9]{5}-[a-z0-9]{5}<\/code>/.test(r.html), "no recovery codes issued");
    assert.equal(JSON.stringify(admins()), before);
    assert.ok(accessLines().some((l) => l.action === "admin.access" && l.outcome === "denied"));
    assert.ok(!auditLines().some((l) => l.action === "admin.access"), "anonymous refusals stay out of the security log");
  });

  test("a recovery code signs in once; the same code is refused afterwards", async () => {
    const c = browser(app.base);
    const r = await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    assert.equal(r.location, "/admin/login?step=code");
    const page = await c.get("/admin/login?step=code");
    const ok = await c.submit("/admin/login?step=code", { code: recoveryCodes[0] }, { html: page.html });
    assert.equal(ok.res.status, 303);
    assert.equal(ok.location, "/admin");
    assert.equal((await c.get("/admin")).res.status, 200);

    const again = browser(app.base);
    await again.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    const page2 = await again.get("/admin/login?step=code");
    const refused = await again.submit("/admin/login?step=code", { code: recoveryCodes[0] }, { html: page2.html });
    assert.match(textOf(refused.html), /Email, password or code is incorrect\./);
    assert.ok(!again.cookies.has("__Host-calix_admin"));
  });

  test("signing out ends the session, and disabling the account on the server ends every session", async () => {
    const c = browser(app.base);
    await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    const page = await c.get("/admin/login?step=code");
    await c.submit("/admin/login?step=code", { code: recoveryCodes[1] }, { html: page.html });
    const signedIn = await c.get("/admin/security");
    assert.equal(signedIn.res.status, 200);

    // A copied session cookie stops working once the account is disabled with the CLI.
    const copy = browser(app.base);
    copy.cookies = new Map(c.cookies);
    cli("disable", EMAIL);
    assert.notEqual((await copy.get("/admin/security")).res.status, 200);
    const login = await copy.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    assert.match(textOf(login.html), /Email, password or code is incorrect\./);
    cli("enable", EMAIL);
    assert.notEqual((await c.get("/admin")).res.status, 200, "enabling again does not revive old sessions");

    // Explicit sign-out.
    const d = browser(app.base);
    await d.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    const p = await d.get("/admin/login?step=code");
    await d.submit("/admin/login?step=code", { code: recoveryCodes[2] }, { html: p.html });
    const home = await d.get("/admin");
    assert.equal(home.res.status, 200);
    const out = await d.submit("/admin", {}, { index: 0, html: home.html });
    assert.equal(out.location, "/admin/login");
    assert.ok(!d.cookies.has("__Host-calix_admin"));
  });

  async function signInWithRecovery(code: string) {
    const c = browser(app.base);
    const r = await c.submit("/admin/login", { email: EMAIL, password });
    assert.equal(r.location, "/admin/login?step=code");
    const page = await c.get("/admin/login?step=code");
    const ok = await c.submit("/admin/login?step=code", { code }, { html: page.html });
    assert.equal(ok.location, "/admin", "signed in");
    return c;
  }
  const signedInAs = async (c: Client) => (await c.get("/admin")).res.status === 200;
  const copyOf = (c: Client) => {
    const k = browser(app.base);
    k.cookies = new Map(c.cookies);
    return k;
  };

  test("sign-out ends the session on the server: a copied cookie is refused afterwards", async () => {
    const c = await signInWithRecovery(recoveryCodes[3]);
    const other = await signInWithRecovery(recoveryCodes[4]);
    const copy = copyOf(c);
    const home = await c.get("/admin");
    const out = await c.submit("/admin", {}, { index: 0, html: home.html });
    assert.equal(out.location, "/admin/login");
    assert.equal(await signedInAs(copy), false, "the copied cookie no longer works");
    assert.equal(await signedInAs(other), true, "another session is unaffected");
    assert.ok(auditLines().some((l) => l.action === "auth.signout" && l.outcome === "success"));
    signedIn = other;
  });

  test("a cross-site post can't sign an administrator out", async () => {
    const home = await signedIn.get("/admin");
    const r = await signedIn.submit("/admin", {}, { index: 0, html: home.html, extraHeaders: { origin: "https://evil.example" } });
    assert.notEqual(r.location, "/admin/login");
    assert.equal(await signedInAs(copyOf(signedIn)), true, "still signed in");
  });

  test("one authenticator code used by two requests at once signs in only once", async () => {
    const c = browser(app.base);
    await c.submit("/admin/login", { email: EMAIL, password });
    const page = await c.get("/admin/login?step=code");
    const code = await nextCode();
    assert.ok(c.cookies.has("__Host-calix_admin_pre"));
    // Two requests carrying the same pre-sign-in cookie and the same code, at the same time.
    const [a, b] = await Promise.all([copyOf(c), copyOf(c)].map((k) => k.submit("/admin/login?step=code", { code }, { html: page.html })));
    const wins = [a, b].filter((r) => r.location === "/admin").length;
    assert.equal(wins, 1, `statuses ${a.res.status}/${b.res.status}`);
    const loser = [a, b].find((r) => r.location !== "/admin")!;
    assert.match(textOf(loser.html), /Email, password or code is incorrect\./);
  });

  test("one recovery code used by two requests at once signs in only once", async () => {
    const before = admins()[0].recoveryCodes as string[];
    const clients = [browser(app.base), browser(app.base)];
    const pages: string[] = [];
    for (const c of clients) {
      await c.submit("/admin/login", { email: EMAIL, password });
      pages.push((await c.get("/admin/login?step=code")).html);
    }
    const results = await Promise.all(clients.map((c, i) => c.submit("/admin/login?step=code", { code: recoveryCodes[5] }, { html: pages[i] })));
    assert.equal(results.filter((r) => r.location === "/admin").length, 1);
    assert.equal((admins()[0].recoveryCodes as string[]).length, before.length - 1, "consumed exactly once");
  });

  test("changing the password needs the current password and a fresh code, and ends other sessions", async () => {
    const a = await signInWithRecovery(recoveryCodes[6]);
    const b = signedIn;
    const security = await a.get("/admin/security");
    // Anonymous replay of the form changes nothing.
    const stored = JSON.stringify(admins());
    await browser(app.base).submit(
      "/admin/security",
      { newPassword: "a brand new passphrase 1", confirmPassword: "a brand new passphrase 1", currentPassword: password, confirmCode: "000000" },
      { index: 1, html: security.html },
    );
    assert.equal(JSON.stringify(admins()), stored);
    // A wrong code is refused.
    const wrong = await a.submit(
      "/admin/security",
      { newPassword: "a brand new passphrase 1", confirmPassword: "a brand new passphrase 1", currentPassword: password, confirmCode: "000000" },
      { index: 1, html: security.html },
    );
    assert.match(textOf(wrong.html), /Your password or authenticator code is incorrect\./);
    assert.equal(JSON.stringify(admins()), stored);

    const copyA = copyOf(a);
    const next = "a brand new passphrase 1";
    const ok = await a.submit(
      "/admin/security",
      { newPassword: next, confirmPassword: next, currentPassword: password, confirmCode: await nextCode() },
      { index: 1, html: (await a.get("/admin/security")).html },
    );
    assert.match(textOf(ok.html), /Password changed\. Other devices have been signed out\./);
    assert.equal(await signedInAs(a), true, "this browser has a new session");
    assert.equal(await signedInAs(copyA), false, "its old cookie is refused");
    assert.equal(await signedInAs(b), false, "other sessions are ended");
    const old = await browser(app.base).submit("/admin/login", { email: EMAIL, password });
    assert.match(textOf(old.html), /Email, password or code is incorrect\./, "the old password no longer works");
    password = next;
    signedIn = a;
  });

  test("sign out everywhere ends every session, copies included; refused without a session", async () => {
    const a = signedIn;
    const b = await signInWithRecovery(recoveryCodes[7]);
    const security = await a.get("/admin/security");
    const version = admins()[0].sessionVersion as number;
    await browser(app.base).submit("/admin/security", {}, { index: 3, html: security.html });
    assert.equal(admins()[0].sessionVersion, version, "anonymous: nothing changed");
    assert.equal(await signedInAs(a), true);

    const copyA = copyOf(a);
    const out = await a.submit("/admin/security", {}, { index: 3, html: security.html });
    assert.equal(out.location, "/admin/login");
    assert.equal(admins()[0].sessionVersion, version + 1);
    for (const c of [a, copyA, b]) assert.equal(await signedInAs(c), false);
  });

  test("the audit log records each step and its hash chain is intact", async () => {
    const lines = auditLines();
    for (const action of ["admin.user.add", "auth.enrol", "auth.signin", "admin.user.disable", "auth.signout", "auth.password.change", "auth.signout.everywhere"]) {
      assert.ok(
        lines.some((l) => l.action === action),
        `audit has ${action}`,
      );
    }
    assert.ok(lines.every((l) => l.outcome === "success" || l.adminId !== "anonymous"), "nothing anonymous in the security log");
    const access = accessLines();
    for (const action of ["auth.signin", "auth.code", "admin.access"]) {
      assert.ok(access.some((l) => l.action === action && l.outcome === "denied"), `access log has ${action}`);
    }
    // The CLI appended entries while the server was running: the chain must still be unbroken.
    process.env.SETTINGS_DIR = dir;
    assert.deepEqual(await verifyAuditChain(), { ok: true, lines: lines.length });
    assert.deepEqual(await verifyAuditChain("access"), { ok: true, lines: access.length });
    const raw = readFileSync(join(dir, "audit.log"), "utf8") + readFileSync(join(dir, "audit-access.log"), "utf8");
    for (const v of [PASSWORD, password, secret, "198.51.100."]) assert.ok(!raw.includes(v), "no secrets or raw IPs in the audit logs");
  });
});

describe("admin unavailable (production build)", () => {
  test("anonymous visitors aren't told which server settings are missing; the server log names them", async () => {
    const quiet = adminEnv();
    const app = await startApp({ ...quiet.env, SESSION_SECRET: "" });
    try {
      const { res, html } = await browser(app.base).get("/admin/login");
      assert.equal(res.status, 200);
      const text = textOf(html);
      assert.match(text, /Admin unavailable/);
      assert.doesNotMatch(text, /SESSION_SECRET|SETTINGS_ENCRYPTION_KEY|SETTINGS_DIR|writable/);
      assert.match(app.output(), /\[admin\] unavailable until the server sets: SESSION_SECRET/);
    } finally {
      await app.stop();
      rmSync(quiet.dir, { recursive: true, force: true });
    }
  });

  test("visiting the sign-in page writes nothing to the settings folder", async () => {
    const q = adminEnv();
    const app = await startApp(q.env);
    try {
      await browser(app.base).get("/admin/login");
      const before = statSync(q.dir).mtimeMs;
      for (let i = 0; i < 5; i++) await browser(app.base).get("/admin/login");
      assert.equal(statSync(q.dir).mtimeMs, before, "no probe files created or removed");
    } finally {
      await app.stop();
      rmSync(q.dir, { recursive: true, force: true });
    }
  });
});
