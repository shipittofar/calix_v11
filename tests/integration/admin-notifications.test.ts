/**
 * The "Contact form and notifications" admin on the production build: the pause switch, channel
 * settings with re-authentication, the Telegram test-before-enable rule, the operator gate, and
 * that the bot token never leaves the server.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client, textOf } from "../helpers/http";
import { FakeSmtp, header } from "../helpers/fake-smtp";
import { FakeTelegram } from "../helpers/fake-telegram";
import { sleep, startApp, validEnquiry, type RunningApp } from "../helpers/app";
import { PASSWORD, adminEnv, cli, enrolAndSignIn, readJson } from "../helpers/admin";

const { dir, env } = adminEnv();
const TOKEN = `555666777:${randomBytes(27).toString("base64url")}`;
const SECRET_PART = TOKEN.split(":")[1];
const CHAT = "-1005550001111";

// Form order on /admin/notifications: 0 sign out, 1 contact form, 2 test email, 3 test Telegram, 4 channels.
const FORM = { pause: 1, testEmail: 2, testTelegram: 3, channels: 4 } as const;

const seen: string[] = [];
const smtp = new FakeSmtp();
const tg = new FakeTelegram();
let app: RunningApp;
let admin: Client;
let nextCode: () => Promise<string>;

async function page() {
  const r = await admin.get("/admin/notifications");
  assert.equal(r.res.status, 200);
  seen.push(r.html);
  return r.html;
}
async function post(form: number, fields: Record<string, string>) {
  const html = await page();
  const r = await admin.submit("/admin/notifications", fields, { index: form, html });
  seen.push(r.html);
  return { ...r, text: textOf(r.html) };
}
async function channels(fields: Record<string, string>, code?: string) {
  return post(FORM.channels, { currentPassword: PASSWORD, confirmCode: code ?? (await nextCode()), ...fields });
}
const delivery = () => (existsSync(join(dir, "delivery.json")) ? readJson(dir, "delivery.json") : null);

before(async () => {
  await smtp.start();
  await tg.start();
  cli(env, "add", "owner@example.com");
  app = await startApp({
    ...env,
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    ENQUIRY_TO: "enquiries@example.com",
    TELEGRAM_API_BASE: tg.base,
    TELEGRAM_DELIVERY_ALLOWED: "true",
  });
  const s = await enrolAndSignIn(app.base);
  admin = s.client;
  nextCode = s.nextCode;
});
after(async () => {
  await app?.stop();
  await smtp.stop();
  await tg.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("contact form and notifications admin (production build)", () => {
  test("pausing needs a message, replaces the form for visitors, and changes nothing else", async () => {
    const missing = await post(FORM.pause, { accepting: "no", pausedMessage: "" });
    assert.match(missing.text, /Write the message visitors see while enquiries are paused\./);

    const paused = await post(FORM.pause, { accepting: "no", pausedMessage: "Back in January. Email hello@calix.example." });
    assert.match(paused.text, /Enquiries are paused\./);
    const contact = textOf((await new Client(app.base).get("/contact")).html);
    assert.match(contact, /New enquiries are paused Back in January\. Email hello@calix\.example\./);
    assert.match(contact, /Instagram \(CALIX profile, external site\)/, "the footer keeps its default profile");
    assert.deepEqual(readJson(dir, "settings.json").social.profiles, [{ platform: "instagram", url: "https://www.instagram.com/its.calixeden/" }]);

    const open = await post(FORM.pause, { accepting: "yes", pausedMessage: "" });
    assert.match(open.text, /Enquiries are open\./);
    assert.match((await new Client(app.base).get("/contact")).html, /name="goals"/);
  });

  test("channel changes need the password and a fresh code; a wrong code changes nothing", async () => {
    const r = await channels({ emailEnabled: "on", recipient: "studio@calix.example", chatId: CHAT, botToken: TOKEN }, "000000");
    assert.match(r.text, /Nothing was saved\. Your password or authenticator code is incorrect\./);
    assert.equal(delivery(), null);
  });

  test("a token is saved encrypted and never sent back; Telegram can't be switched on untested", async () => {
    const saved = await channels({ emailEnabled: "on", recipient: "studio@calix.example", chatId: CHAT, botToken: TOKEN });
    assert.match(saved.text, /Saved\. New enquiries use these channels from now on\./);
    const file = delivery();
    assert.equal(file.telegram.enabled, false);
    assert.equal(file.telegram.chatId, CHAT);
    assert.ok(file.telegram.botToken.sealed && !JSON.stringify(file).includes(SECRET_PART));
    assert.match(textOf(await page()), /A token is saved/);

    const untested = await channels({ emailEnabled: "on", recipient: "studio@calix.example", chatId: CHAT, telegramEnabled: "on" });
    assert.match(untested.text, /Send a successful test message with this token and chat ID first/);
    assert.equal(delivery().telegram.enabled, false);
  });

  test("every action on this page is refused without a session, with no side effects", async () => {
    const html = await page();
    const files = ["settings.json", "delivery.json", "status.json"].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : ""));
    tg.reset();
    smtp.messages = [];
    const anon = new Client(app.base);
    const attempts: Array<[number, Record<string, string>]> = [
      [FORM.pause, { accepting: "no", pausedMessage: "Hijacked" }],
      [FORM.testEmail, {}],
      [FORM.testTelegram, {}],
      [FORM.channels, { emailEnabled: "on", recipient: "attacker@evil.example", chatId: "-1001", botToken: `999999999:${"x".repeat(35)}`, currentPassword: PASSWORD, confirmCode: "000000" }],
    ];
    for (const [form, fields] of attempts) {
      const r = await anon.submit("/admin/notifications", fields, { index: form, html });
      seen.push(r.html);
      assert.doesNotMatch(textOf(r.html), /Saved\.|Enquiries are paused\.|Test message sent/, `form ${form}`);
    }
    const after = ["settings.json", "delivery.json", "status.json"].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : ""));
    assert.deepEqual(after, files, "no settings, delivery or status change");
    assert.equal(tg.requests, 0, "no Telegram message");
    assert.equal(smtp.messages.length, 0, "no email");
    const access = readFileSync(join(dir, "audit-access.log"), "utf8");
    assert.match(access, /"action":"admin\.access","outcome":"denied"/);
  });

  test("test messages go to the saved configuration and carry no visitor data", async () => {
    tg.reset();
    const r = await post(FORM.testTelegram, {});
    assert.match(r.text, /Test message sent\./);
    assert.equal(tg.messages.length, 1);
    assert.equal(tg.messages[0].chat_id, CHAT);
    assert.match(tg.messages[0].text, /^\[Test\] CALIX enquiry delivery/);

    smtp.messages = [];
    const e = await post(FORM.testEmail, {});
    assert.match(e.text, /Test message sent\./);
    assert.equal(header(smtp.messages[0].data, "To"), "studio@calix.example");
    assert.equal(header(smtp.messages[0].data, "Subject"), "[Test] CALIX enquiry delivery");

    tg.reset("unauthorized");
    const bad = await post(FORM.testTelegram, {});
    assert.match(bad.text, /The test failed: Telegram rejected the bot token/);
    tg.reset();
  });

  test("after a matching successful test, Telegram can be switched on and receives enquiries", async () => {
    // The failed test above replaced the last result, so test again first.
    await post(FORM.testTelegram, {});
    const on = await channels({ emailEnabled: "on", recipient: "studio@calix.example", chatId: CHAT, telegramEnabled: "on" });
    assert.match(on.text, /Saved\./);
    assert.equal(delivery().telegram.enabled, true);

    tg.reset();
    smtp.messages = [];
    const v = new Client(app.base, { "x-real-ip": "192.0.2.10" });
    const { html } = await v.get("/contact");
    await sleep(3_100);
    const r = await v.submit("/contact", validEnquiry("Admin Flow Ltd"), { html });
    assert.equal(r.res.status, 303);
    assert.equal(tg.messages.length, 1);
    assert.match(tg.messages[0].text, /^New enquiry: Admin Flow Ltd/);
    assert.equal(smtp.messages.length, 1);
    assert.match(textOf(await page()), /On and ready/);
  });

  test("changing the chat ID requires a new test; both channels off is refused", async () => {
    const moved = await channels({ emailEnabled: "on", chatId: "-1009999999999", telegramEnabled: "on" });
    assert.match(moved.text, /Send a successful test message with this token and chat ID first/);
    const none = await channels({ chatId: CHAT });
    assert.match(none.text, /At least one channel must be on/);
    assert.equal(delivery().telegram.enabled, true, "unchanged");
  });

  test("removing the token switches Telegram off and deletes it", async () => {
    const r = await channels({ emailEnabled: "on", chatId: CHAT, removeToken: "on" });
    assert.match(r.text, /Saved\./);
    const file = delivery();
    assert.equal(file.telegram.enabled, false);
    assert.equal(file.telegram.botToken, undefined);
  });

  test("the bot token never appears in any admin response, store file, audit entry or server log", () => {
    assert.ok(seen.length > 10);
    for (const html of seen) assert.ok(!html.includes(SECRET_PART), "token in a response");
    for (const f of ["delivery.json", "delivery.json.bak", "status.json", "audit.log", "audit-access.log", "settings.json"]) {
      if (existsSync(join(dir, f))) assert.ok(!readFileSync(join(dir, f), "utf8").includes(SECRET_PART), `token in ${f}`);
    }
    assert.ok(!app.output().includes(SECRET_PART), "token in the server log");
    const audit = readFileSync(join(dir, "audit.log"), "utf8");
    assert.match(audit, /"action":"delivery\.save","outcome":"success"/);
    assert.match(audit, /"tokenReplaced":true/);
  });
});

describe("without TELEGRAM_DELIVERY_ALLOWED (production build)", () => {
  test("Telegram can be saved and tested but not switched on", async () => {
    await app.stop();
    app = await startApp({ ...env, MAIL_TRANSPORT: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.port), SMTP_USER: "user", SMTP_PASS: "pass", ENQUIRY_TO: "enquiries@example.com", TELEGRAM_API_BASE: tg.base }, Number(new URL(app.base).port));
    const html = textOf(await page());
    assert.match(html, /Telegram can['’]t be switched on yet/);
    const saved = await channels({ emailEnabled: "on", chatId: CHAT, botToken: TOKEN });
    assert.match(saved.text, /Saved\./);
    tg.reset();
    assert.match((await post(FORM.testTelegram, {})).text, /Test message sent\./);
    const on = await channels({ emailEnabled: "on", chatId: CHAT, telegramEnabled: "on" });
    assert.match(on.text, /Telegram can['’]t be switched on yet\. The server operator must first confirm the privacy notice/);
    assert.equal(delivery().telegram.enabled, false);
    for (const h of seen) assert.ok(!h.includes(SECRET_PART));
    assert.ok(!app.output().includes(SECRET_PART));
  });
});
