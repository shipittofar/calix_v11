/**
 * Runtime settings on the production build: saving in the admin changes the public pages with no
 * rebuild, redeploy or restart. The build under test was made without a settings store, as a CI
 * build would be, so the pages start with the content/site.ts defaults.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { textOf, type Client } from "../helpers/http";
import { startApp, type RunningApp } from "../helpers/app";
import { adminEnv, browser, cli, enrolAndSignIn, readJson } from "../helpers/admin";

const root = resolve(import.meta.dirname, "../..");
const { dir, env } = adminEnv();
const buildId = () => readFileSync(join(root, ".next/BUILD_ID"), "utf8");

const PAGES = ["/", "/services", "/contact/thank-you", "/contact"];
const SAVED = {
  legalName: "CALIX Test Studio Ltd",
  replyTime: "one working day",
  email: "studio@calix.example",
  "phone.e164": "+442079460000",
  "phone.display": "020 7946 0000",
  "address.locality": "London",
  "address.country": "GB",
  "profile2.platform": "linkedin",
  "profile2.url": "https://www.linkedin.com/company/calix-test",
};

/** What a visitor sees: the page text and the Organization JSON-LD. */
async function visit(path: string) {
  const { res, html } = await browser(app.base).get(path);
  assert.equal(res.status, 200, path);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const data = JSON.parse(m[1]);
    return Array.isArray(data) ? data : [data];
  });
  return { text: textOf(html), html, org: ld.find((d) => d["@type"] === "Organization"), res };
}

let app: RunningApp;

describe("runtime settings (production build)", () => {
  let admin: Client;
  let pid = 0;
  let build = "";

  before(async () => {
    cli(env, "add", "owner@example.com");
    app = await startApp(env);
    pid = app.pid;
    build = buildId();
    admin = (await enrolAndSignIn(app.base)).client;
  });
  after(async () => {
    await app?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  async function save(fields: Record<string, string>, revision?: string) {
    const page = await admin.get("/admin");
    assert.equal(page.res.status, 200);
    // Form 0 is "Sign out" in the admin header; form 1 is General settings.
    const current = Object.fromEntries(
      [...page.html.matchAll(/<input[^>]*\bname="([^"$]+)"[^>]*>/g)]
        .filter((m) => !/type="hidden"/.test(m[0]))
        .map((m) => [m[1], (m[0].match(/\bvalue="([^"]*)"/) ?? [])[1] ?? ""]),
    );
    for (const m of page.html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) {
      current[m[1]] = (m[0].match(/<option value="([^"]*)" selected=""/) ?? [])[1] ?? "";
    }
    const body = { ...current, ...fields, ...(revision === undefined ? {} : { revision }) };
    return admin.submit("/admin", body, { index: 1, html: page.html });
  }

  test("before saving, every page shows the defaults", async () => {
    for (const path of PAGES) {
      const { text, org } = await visit(path);
      assert.doesNotMatch(text, /one working day|CALIX Test Studio|020 7946 0000|LinkedIn/, path);
      assert.deepEqual(org?.sameAs, ["https://www.instagram.com/its.calixeden/"], path);
      assert.match(text, /© 2026 CALIX\./, path);
    }
  });

  test("an invalid save is refused field by field and changes nothing", async () => {
    const r = await save({ email: "not-an-email", "profile3.platform": "x", "profile3.url": "http://x.com/calix" });
    assert.equal(r.res.status, 200);
    const text = textOf(r.html);
    assert.match(text, /Nothing was saved\. Check the highlighted fields\./);
    assert.match(text, /Enter a valid email address/);
    assert.match(text, /Use an https:\/\/ address\./);
    assert.match(r.html, /value="not-an-email"/, "typed values are kept");
    assert.throws(() => statSync(join(dir, "settings.json")), "no file written");
  });

  test("saving publishes to every page on its next visit, with no rebuild or restart", async () => {
    const r = await save(SAVED);
    assert.equal(r.res.status, 200);
    assert.match(textOf(r.html), /Saved\. The website now shows these details\./);

    for (const path of PAGES) {
      const { text, org } = await visit(path);
      assert.match(text, /© 2026 CALIX Test Studio Ltd\./, `${path}: footer copyright`);
      assert.match(text, /Email: studio@calix\.example/, `${path}: footer email`);
      assert.match(text, /Phone: 020 7946 0000/, `${path}: footer phone`);
      assert.match(text, /London United Kingdom/, `${path}: footer address`);
      assert.match(text, /LinkedIn \(CALIX profile, external site\)/, `${path}: footer profiles`);
      assert.deepEqual(org?.sameAs, ["https://www.instagram.com/its.calixeden/", "https://www.linkedin.com/company/calix-test"]);
      assert.equal(org?.legalName, "CALIX Test Studio Ltd");
      assert.equal(org?.telephone, "+442079460000");
      assert.deepEqual(org?.address, { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" });
    }
    assert.match((await visit("/")).text, /We reply within one working day\./);
    assert.match((await visit("/services")).text, /We reply within one working day with next steps\./);
    assert.match((await visit("/contact/thank-you")).text, /We will reply within one working day with next steps\./);
    const contact = (await visit("/contact")).text;
    assert.match(contact, /And reply within one working day\./);
    assert.match(contact, /Prefer email\? Write to studio@calix\.example ?\./);

    assert.equal(app.pid, pid, "same server process");
    assert.equal(buildId(), build, "same build");

    const file = readJson(dir, "settings.json");
    assert.equal(file.revision, 1);
    assert.equal(statSync(join(dir, "settings.json")).mode & 0o777, 0o600);
    const audit = readFileSync(join(dir, "audit.log"), "utf8");
    assert.match(audit, /"action":"settings\.general\.save","outcome":"success"/);
    assert.ok(!audit.includes("studio@calix.example"), "the audit log names fields, not values");
  });

  test("a save based on an old revision is refused as a conflict", async () => {
    const r = await save({ replyTime: "two weeks" }, "0");
    assert.match(textOf(r.html), /Someone else saved these settings while you were editing\. Nothing was saved/);
    assert.equal(readJson(dir, "settings.json").contact.replyTime, "one working day");
    assert.match((await visit("/")).text, /We reply within one working day\./);
  });

  test("anonymous saves are refused", async () => {
    const page = await admin.get("/admin");
    const r = await browser(app.base).submit("/admin", { ...SAVED, replyTime: "a minute" }, { index: 1, html: page.html });
    assert.notEqual(r.res.status, 500);
    assert.equal(readJson(dir, "settings.json").contact.replyTime, "one working day");
  });

  test("the saved settings survive a restart of the same build", async () => {
    const port = Number(new URL(app.base).port);
    await app.stop();
    app = await startApp(env, port, { keepRouteCache: true });
    for (const path of PAGES) {
      assert.match((await visit(path)).text, /© 2026 CALIX Test Studio Ltd\./, path);
    }
  });

  test("clearing the fields returns the site to the defaults", async () => {
    // The session cookie is still valid after the restart: sessions live in the store, not the process.
    const cleared = Object.fromEntries(Object.keys(SAVED).map((k) => [k, ""]));
    const r = await save(cleared);
    assert.match(textOf(r.html), /Saved\./);
    for (const path of PAGES) {
      const { text, org } = await visit(path);
      assert.match(text, /© 2026 CALIX\./, path);
      assert.doesNotMatch(text, /one working day|CALIX Test Studio|020 7946 0000|LinkedIn/, path);
      assert.deepEqual(org?.sameAs, ["https://www.instagram.com/its.calixeden/"], path);
    }
  });
});
