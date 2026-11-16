/**
 * Sign-out in a real browser (Chromium), which enforces the `__Host-` cookie prefix rules: a
 * Set-Cookie for a `__Host-` cookie without `Secure` and `Path=/` is ignored. An HTTP client's
 * cookie jar does not apply those rules, so it can't prove sign-out works.
 *
 * Runs against the production build on http://localhost (a secure context for Chromium).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Client } from "../helpers/http";
import { startApp, type RunningApp } from "../helpers/app";
import { EMAIL, PASSWORD, adminEnv, cli } from "../helpers/admin";
import { loadChromium, requiredOrSkip } from "../helpers/browser";
import type { Browser, Context, Page } from "../helpers/browser-types";
import { currentStep, totpAt } from "@/lib/admin/totp";

const chromium = await loadChromium();
const { dir, env } = adminEnv();
const SESSION = "__Host-calix_admin";
const PRE = "__Host-calix_admin_pre";

const mode = requiredOrSkip(Boolean(chromium), "CALIX_REQUIRE_BROWSER", "Playwright Chromium is not installed");

describe("admin sign-out in a real browser (production build)", { skip: mode.skip }, () => {
  if ("missing" in mode) {
    test("required browser tests can run", () => assert.fail(`CALIX_REQUIRE_BROWSER=1 but ${mode.missing}`));
    return;
  }
  let app: RunningApp;
  let browser: Browser;
  let base = "";
  let secret = "";
  let step = 0;

  before(async () => {
    cli(env, "add", EMAIL);
    app = await startApp(env);
    base = app.base.replace("127.0.0.1", "localhost");
    browser = await chromium!.launch();
  });
  after(async () => {
    await browser?.close();
    await app?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const names = async (ctx: Context) => (await ctx.cookies()).map((c) => c.name).sort();

  async function signIn(ctx: Context): Promise<Page> {
    const page = await ctx.newPage();
    await page.goto(`${base}/admin/login`);
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    if (!secret) {
      await page.waitForURL(/step=enrol/);
      secret = ((await page.textContent(".admin-secret")) ?? "").replace(/ /g, "");
      step = currentStep();
      await page.fill("#code", totpAt(secret, step));
      await page.click("button[type=submit]");
      await page.waitForSelector(".admin-codes");
    } else {
      await page.waitForURL(/step=code/);
      step = Math.max(step + 1, currentStep());
      while (step > currentStep() + 1) await new Promise((r) => setTimeout(r, 500));
      await page.fill("#code", totpAt(secret, step));
      await page.click("button[type=submit]");
      await page.waitForURL(/\/admin$/);
    }
    return page;
  }

  test("the session cookie carries the attributes the __Host- prefix requires", async () => {
    const ctx = await browser.newContext();
    await signIn(ctx);
    const cookie = (await ctx.cookies()).find((c) => c.name === SESSION);
    assert.ok(cookie, "signed in");
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Strict");
    assert.equal(cookie.path, "/");
    assert.ok(!(await names(ctx)).includes(PRE), "the pre-sign-in cookie is gone once signed in");
    await ctx.close();
  });

  test("after Sign out the browser holds no session, /admin asks to sign in, and a copied cookie is refused", async () => {
    const ctx = await browser.newContext();
    const page = await signIn(ctx);
    const copied = (await ctx.cookies()).find((c) => c.name === SESSION)!.value;

    await page.goto(`${base}/admin`);
    await page.click("text=Sign out");
    await page.waitForURL(/\/admin\/login$/);

    assert.deepEqual(await names(ctx), [], "no admin cookies left in the browser");
    await page.goto(`${base}/admin`);
    assert.match(page.url(), /\/admin\/login$/, "direct navigation needs sign-in again");

    // Server-side revocation: the old cookie value, replayed by another client, no longer works.
    const replay = new Client(base);
    replay.cookies.set(SESSION, copied);
    const r = await replay.get("/admin");
    assert.ok([303, 307].includes(r.res.status), `copied cookie: ${r.res.status}`);

    // And in another browser.
    const other = await browser.newContext();
    // Chromium's DevTools API takes a Secure cookie for http://localhost only as domain + path.
    await other.addCookies([{ name: SESSION, value: copied, domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Strict" }]);
    const p2 = await other.newPage();
    await p2.goto(`${base}/admin`);
    assert.match(p2.url(), /\/admin\/login$/);
    await other.close();
    await ctx.close();
  });

  test("signing out one browser leaves another signed-in browser alone", async () => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    await signIn(a);
    const pb = await signIn(b);
    await pb.goto(`${base}/admin`);
    await pb.click("text=Sign out");
    await pb.waitForURL(/\/admin\/login$/);
    const pa = await a.newPage();
    await pa.goto(`${base}/admin`);
    assert.match(pa.url(), /\/admin$/, "the other browser is still signed in");
    await a.close();
    await b.close();
  });

  test("sign-out after more than 60 s idle: the expiry comes after the idle refresh, and the copy is refused", async () => {
    const ctx = await browser.newContext();
    const page = await signIn(ctx);
    await page.goto(`${base}/admin`);
    const copied = (await ctx.cookies()).find((c) => c.name === SESSION)!.value;
    // Idle for longer than the 60 s after which the proxy refreshes the session cookie.
    await new Promise((r) => setTimeout(r, 61_000));
    const response = page.waitForResponse((r) => r.request().method() === "POST");
    await page.click("text=Sign out");
    const headers = await (await response).headersArray();
    const sessionCookies = headers.filter((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${SESSION}=`)).map((h) => h.value);
    assert.ok(sessionCookies.length >= 1);
    assert.match(sessionCookies[0], /^__Host-calix_admin=[^;]+;/, "the idle refresh is sent first");
    assert.match(sessionCookies.at(-1)!, /^__Host-calix_admin=;.*Max-Age=0/, "the expiry comes last, so it wins");
    await page.waitForURL(/\/admin\/login$/);
    assert.deepEqual(await names(ctx), [], "no admin cookies left");
    const replay = new Client(base);
    replay.cookies.set(SESSION, copied);
    assert.ok([303, 307].includes((await replay.get("/admin")).res.status), "the copy is refused by the server");
    await ctx.close();
  });
});
