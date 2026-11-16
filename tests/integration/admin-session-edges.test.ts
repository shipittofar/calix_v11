/**
 * Session edge cases on the production build: a sign-out whose server-side revocation fails must
 * not look complete, and the copy of the cookie is checked on the server, not in the browser.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { textOf, type Client } from "../helpers/http";
import { startApp, type RunningApp } from "../helpers/app";
import { EMAIL, PASSWORD, adminEnv, browser, cli, codeSource } from "../helpers/admin";
import { currentStep, totpAt } from "@/lib/admin/totp";

const { dir, env } = adminEnv();
process.env.SETTINGS_DIR = dir;
const { processIdentity } = await import("@/lib/settings/store");

describe("sign-out edge cases (production build)", () => {
  let app: RunningApp;
  let nextCode: () => Promise<string>;
  let first: Client;

  before(async () => {
    cli(env, "add", EMAIL);
    app = await startApp(env);
    first = browser(app.base);
    await first.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    const page = await first.get("/admin/login?step=enrol");
    const secret = page.html.match(/<code class="admin-secret">([A-Z2-7 ]+)<\/code>/)![1].replace(/ /g, "");
    const step = currentStep();
    nextCode = codeSource(secret, step);
    await first.submit("/admin/login?step=enrol", { code: totpAt(secret, step) }, { html: page.html });
  });
  after(async () => {
    await app?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  async function signIn() {
    const c = browser(app.base);
    await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
    const page = await c.get("/admin/login?step=code");
    const r = await c.submit("/admin/login?step=code", { code: await nextCode() }, { html: page.html });
    assert.equal(r.location, "/admin");
    return c;
  }
  const validOnServer = async (cookie: string) => {
    const k = browser(app.base);
    k.cookies.set("__Host-calix_admin", cookie);
    return (await k.get("/admin")).res.status === 200;
  };

  test("if the server can't record the revocation, sign-out says so and is audited as an error", async () => {
    const c = await signIn();
    const copy = c.cookies.get("__Host-calix_admin")!;
    const home = await c.get("/admin");
    // Another (live) process holds the administrators file's lock, so the revocation can't be written.
    const lock = join(dir, "admins.json.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "test-holder", start: processIdentity() }));
    let out;
    try {
      out = await c.submit("/admin", {}, { index: 0, html: home.html });
    } finally {
      rmSync(lock, { force: true });
    }
    assert.equal(out.location, "/admin/login?signout=incomplete", "not reported as a complete sign-out");
    assert.ok(!c.cookies.has("__Host-calix_admin"), "this browser's cookie is removed");
    const page = textOf((await c.get("/admin/login?signout=incomplete")).html);
    assert.match(page, /Sign-out was not completed on the server\./);
    // Honest about the server side: the copy still works until revoked another way.
    assert.equal(await validOnServer(copy), true);
    const audit = readFileSync(join(dir, "audit.log"), "utf8");
    assert.match(audit, /"action":"auth\.signout","outcome":"error"[^\n]*"detail":"revocation_busy"/);

    // Sign out on every device ends it.
    const d = await signIn();
    const security = await d.get("/admin/security");
    await d.submit("/admin/security", {}, { index: 3, html: security.html });
    assert.equal(await validOnServer(copy), false);
  });

  test("a normal sign-out reports success and refuses the copied cookie on the server", async () => {
    const c = await signIn();
    const copy = c.cookies.get("__Host-calix_admin")!;
    const home = await c.get("/admin");
    const out = await c.submit("/admin", {}, { index: 0, html: home.html });
    assert.equal(out.location, "/admin/login");
    assert.equal(await validOnServer(copy), false);
    assert.doesNotMatch(textOf((await c.get("/admin/login")).html), /not completed/);
  });
});
