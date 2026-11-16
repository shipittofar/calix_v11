/**
 * Delivery contract for the enquiry form on the production build: independent email and Telegram
 * channels, partial and total failure, timeouts, malformed configuration, the pause switch and
 * failure alerts. Written before submitEnquiry was changed. The existing single-channel contract
 * (contact-contract.test.ts) must keep passing unchanged.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client, textOf } from "../helpers/http";
import { FakeSmtp, body, header } from "../helpers/fake-smtp";
import { FakeTelegram } from "../helpers/fake-telegram";
import { sleep, startApp, validEnquiry, type RunningApp } from "../helpers/app";

const UNAVAILABLE = "We could not send your enquiry just now. Please try again in a few minutes. Your details are still in the form.";
const PAUSED = "We are not taking new projects until 1 December. Email hello@calix.example in the meantime.";
const TOKEN = `987654321:${randomBytes(27).toString("base64url")}`;
const TOKEN_SECRET_PART = TOKEN.split(":")[1];

const dir = mkdtempSync(join(tmpdir(), "calix-delivery-"));
const keys = {
  SETTINGS_DIR: dir,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
// The test process writes the store with the same key as the server.
Object.assign(process.env, keys);
const { updateStore } = await import("@/lib/settings/store");
const { seal } = await import("@/lib/settings/crypto");

type Channels = { email?: boolean; recipient?: string; telegram?: boolean; chatId?: string; sealed?: string };
async function setDelivery(c: Channels) {
  const r = await updateStore(
    "delivery",
    () => ({
      email: { enabled: c.email ?? false, ...(c.recipient ? { recipient: c.recipient } : {}) },
      telegram: {
        enabled: c.telegram ?? false,
        chatId: c.chatId ?? "-1009876543210",
        botToken: { sealed: c.sealed ?? seal(TOKEN), savedAt: new Date().toISOString() },
      },
    }),
    { by: "test" },
  );
  assert.ok(r.ok, JSON.stringify(r));
}
async function setAccepting(accepting: boolean) {
  const r = await updateStore("settings", (cur) => ({
    business: cur?.business ?? {},
    contact: cur?.contact ?? { phonesAdditional: [] },
    social: cur?.social ?? { profiles: [] },
    footer: cur?.footer ?? {},
    form: accepting ? { acceptingEnquiries: true } : { acceptingEnquiries: false, pausedMessage: PAUSED },
  }), { by: "test" });
  assert.ok(r.ok);
}
const status = () => JSON.parse(readFileSync(join(dir, "status.json"), "utf8")) as { records: Array<{ kind: string; about?: string; skipped?: string; results: Array<{ channel: string; result: string }> }> };

/** Every response body the suite saw, checked for the token at the end. */
const seen: string[] = [];
let ipCounter = 0;
const visitor = (base: string) => {
  const ip = `203.0.113.${++ipCounter}`;
  return new Client(base, { "x-real-ip": ip, "x-forwarded-for": ip });
};
async function submit(app: RunningApp, company: string) {
  const c = visitor(app.base);
  const { html } = await c.get("/contact");
  seen.push(html);
  await sleep(3_100);
  const r = await c.submit("/contact", validEnquiry(company), { html });
  seen.push(r.html, r.location ?? "");
  return r;
}
const thanked = (r: { res: Response; location: string | null }) => r.res.status === 303 && (r.location ?? "").startsWith("/contact/thank-you?submitted=1");
async function waitFor(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}

const smtp = new FakeSmtp();
const tg = new FakeTelegram();
let smtpPort = 0;
const baseEnv = () => ({
  ...keys,
  MAIL_TRANSPORT: "smtp",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(smtpPort),
  SMTP_USER: "user",
  SMTP_PASS: "pass",
  ENQUIRY_TO: "enquiries@example.com",
  FORM_SECRET: "test-form-secret",
  TRUSTED_PROXY_HEADER: "x-real-ip",
  TELEGRAM_API_BASE: tg.base,
});

before(async () => {
  smtpPort = await smtp.start();
  await tg.start();
});
after(async () => {
  await smtp.stop();
  await tg.stop();
  rmSync(dir, { recursive: true, force: true });
});

function reset() {
  smtp.messages = [];
  smtp.mode = "accept";
  tg.reset();
}

describe("enquiry delivery with Telegram allowed (production build)", () => {
  let app: RunningApp;
  before(async () => {
    app = await startApp({ ...baseEnv(), TELEGRAM_DELIVERY_ALLOWED: "true" });
  });
  after(() => app?.stop());

  test("Telegram only: delivered to the chat as plain text, nothing emailed", async () => {
    reset();
    await setDelivery({ email: false, telegram: true });
    const r = await submit(app, "Telegram Only Ltd");
    assert.ok(thanked(r), `${r.res.status} ${r.location}`);
    assert.equal(smtp.messages.length, 0);
    assert.equal(tg.messages.length, 1);
    const m = tg.messages[0];
    assert.equal(m.chat_id, "-1009876543210");
    assert.ok(m.token === TOKEN);
    assert.match(m.text, /^New enquiry: Telegram Only Ltd\n/);
    assert.match(m.text, /Email: person@example\.com/);
    assert.equal("parse_mode" in m.body, false);
  });

  test("both channels: each receives the enquiry independently; email format unchanged", async () => {
    reset();
    await setDelivery({ email: true, telegram: true, recipient: "studio@calix.example" });
    const r = await submit(app, "Both Ltd");
    assert.ok(thanked(r));
    assert.equal(tg.messages.length, 1);
    assert.equal(smtp.messages.length, 1);
    const data = smtp.messages[0].data;
    assert.equal(header(data, "To"), "studio@calix.example");
    assert.equal(header(data, "Subject"), "Project enquiry: Both Ltd");
    assert.equal(header(data, "Reply-To"), "person@example.com");
    assert.match(body(data), /Company: Both Ltd/);
  });

  test("email fails, Telegram confirms: the visitor is thanked and Telegram carries one alert", async () => {
    reset();
    smtp.mode = "reject";
    const r = await submit(app, "Email Down Ltd");
    assert.ok(thanked(r));
    assert.ok(await waitFor(() => tg.messages.length === 2), "alert sent");
    const alert = tg.messages[1].text;
    assert.match(alert, /Email delivery failed/);
    assert.match(alert, /email_rejected/);
    assert.doesNotMatch(alert, /Email Down Ltd|person@example\.com/, "no enquiry content in alerts");
    const rec = status().records.filter((x) => x.kind === "enquiry").at(-1);
    assert.deepEqual(rec?.results.map((x) => [x.channel, x.result]), [
      ["email", "email_rejected"],
      ["telegram", "confirmed"],
    ]);

    // A second failure inside the window is not alerted again.
    tg.reset();
    const again = await submit(app, "Email Still Down Ltd");
    assert.ok(thanked(again));
    await sleep(1_500);
    assert.equal(tg.messages.length, 1, "only the enquiry, no second alert");
  });

  test("Telegram fails, email confirms: the visitor is thanked and email carries the alert", async () => {
    reset();
    tg.mode = "unauthorized";
    const r = await submit(app, "Telegram Down Ltd");
    assert.ok(thanked(r));
    assert.ok(await waitFor(() => smtp.messages.length === 2), "alert emailed");
    const alert = smtp.messages.find((m) => /Telegram delivery failed/.test(header(m.data, "Subject") ?? ""));
    assert.ok(alert);
    assert.match(body(alert.data), /telegram_unauthorized/);
    assert.doesNotMatch(body(alert.data), /Telegram Down Ltd|person@example\.com/);
  });

  test("every channel fails: honest error with values kept, and no alert can loop", async () => {
    reset();
    smtp.mode = "reject";
    tg.mode = "forbidden";
    // Earlier tests used both alert slots; clear them so this test must record what it couldn't send.
    const cleared = await updateStore("status", (cur) => ({ records: cur?.records ?? [], lastTest: cur?.lastTest ?? {}, lastAlertAt: {} }), { by: "test" });
    assert.ok(cleared.ok);
    const before = status().records.length;
    const r = await submit(app, "Nothing Works Ltd");
    assert.equal(r.res.status, 200);
    assert.match(textOf(r.html), new RegExp(UNAVAILABLE.replace(/[.?]/g, "\\$&")));
    assert.match(r.html, /value="Nothing Works Ltd"/);
    await sleep(1_500);
    assert.equal(tg.requests, 1, "one Telegram attempt, no alert attempts");
    assert.equal(smtp.messages.length, 0);
    const added = status().records.slice(before);
    const enquiries = added.filter((x) => x.kind === "enquiry");
    assert.deepEqual(enquiries.map((x) => x.results.map((y) => y.result)), [["email_rejected", "telegram_forbidden"]]);
    // With nothing working there is nothing to alert through: one record per failed channel, no attempt.
    await sleep(500);
    const alerts = status().records.slice(before).filter((x) => x.kind === "alert");
    assert.deepEqual(
      alerts.map((a) => [a.about, a.skipped, a.results.length]).sort(),
      [
        ["email", "no_working_channel", 0],
        ["telegram", "no_working_channel", 0],
      ],
    );
  });

  test("a hanging Telegram API times out without holding back email", async () => {
    reset();
    tg.mode = "hang";
    const t0 = Date.now();
    const r = await submit(app, "Slow Telegram Ltd");
    const ms = Date.now() - t0 - 3_100;
    assert.ok(thanked(r));
    assert.ok(ms < 14_000, `answered in ${ms} ms`);
    const rec = status().records.filter((x) => x.kind === "enquiry").at(-1);
    assert.deepEqual(rec?.results.map((x) => x.result), ["confirmed", "telegram_timeout"]);
  });

  test("both channels hanging: the visitor gets the honest error after the timeout", async () => {
    reset();
    smtp.mode = "hang";
    tg.mode = "hang";
    const r = await submit(app, "All Slow Ltd");
    assert.equal(r.res.status, 200);
    assert.match(textOf(r.html), /We could not send your enquiry just now/);
    const rec = status().records.filter((x) => x.kind === "enquiry").at(-1);
    assert.deepEqual(rec?.results.map((x) => x.result), ["email_timeout", "telegram_timeout"]);
  });

  test("malformed configuration: an unreadable token disables Telegram only; a corrupt file falls back to email", async () => {
    reset();
    await setDelivery({ email: true, telegram: true, sealed: "v1.AAAA.BBBB.CCCC" });
    const r = await submit(app, "Bad Token Ltd");
    assert.ok(thanked(r));
    assert.equal(tg.requests, 0);
    assert.equal(smtp.messages.length, 1);

    reset();
    writeFileSync(join(dir, "delivery.json"), "{ not json");
    rmSync(join(dir, "delivery.json.bak"), { force: true });
    const r2 = await submit(app, "Corrupt File Ltd");
    assert.ok(thanked(r2));
    assert.equal(tg.requests, 0, "Telegram stays off when the configuration can't be read");
    assert.equal(header(smtp.messages[0].data, "To"), "enquiries@example.com");
  });

  test("paused: the form is replaced by the message, and direct posts are refused without sending", async () => {
    reset();
    await setDelivery({ email: true, telegram: true });
    const c = visitor(app.base);
    const open = await c.get("/contact");
    await setAccepting(false);
    try {
      const page = await visitor(app.base).get("/contact");
      seen.push(page.html);
      assert.match(textOf(page.html), new RegExp(PAUSED.replace(/[.]/g, "\\.")));
      assert.doesNotMatch(page.html, /name="goals"/, "no form while paused");

      // A form loaded before the pause, submitted after it.
      await sleep(3_100);
      const r = await c.submit("/contact", validEnquiry("Paused Ltd"), { html: open.html });
      seen.push(r.html);
      assert.equal(r.res.status, 200);
      assert.match(textOf(r.html), new RegExp(PAUSED.replace(/[.]/g, "\\.")));
      assert.match(r.html, /value="Paused Ltd"/, "values kept");

      // A crafted post without a valid token or a real form.
      const crafted = await visitor(app.base).submit("/contact", { ...validEnquiry("Crafted Ltd"), form_token: "x" }, { html: open.html });
      seen.push(crafted.html);
      assert.ok(!thanked(crafted));
      await sleep(500);
      assert.equal(smtp.messages.length, 0);
      assert.equal(tg.requests, 0);
    } finally {
      await setAccepting(true);
    }
    const back = await visitor(app.base).get("/contact");
    assert.match(back.html, /name="goals"/, "the form is back");
  });

  test("the bot token never appears in pages, responses or server logs", () => {
    for (const html of seen) assert.ok(!html.includes(TOKEN_SECRET_PART), "token in a response");
    assert.ok(!app.output().includes(TOKEN_SECRET_PART), "token in the server log");
    for (const f of ["delivery.json", "status.json"]) {
      assert.ok(!readFileSync(join(dir, f), "utf8").includes(TOKEN_SECRET_PART), `token in plain text in ${f}`);
    }
  });
});

describe("enquiry delivery without TELEGRAM_DELIVERY_ALLOWED (production build)", () => {
  let app: RunningApp;
  before(async () => {
    app = await startApp(baseEnv());
  });
  after(() => app?.stop());

  test("Telegram enabled in the file is not used; email still delivers", async () => {
    reset();
    await setDelivery({ email: true, telegram: true });
    const r = await submit(app, "Gate Closed Ltd");
    assert.ok(thanked(r));
    assert.equal(tg.requests, 0);
    assert.equal(smtp.messages.length, 1);
  });

  test("Telegram as the only channel: refused honestly, nothing sent", async () => {
    reset();
    await setDelivery({ email: false, telegram: true });
    const r = await submit(app, "Gate Closed Only Ltd");
    assert.equal(r.res.status, 200);
    assert.match(textOf(r.html), /We could not send your enquiry just now/);
    assert.equal(tg.requests, 0);
    assert.equal(smtp.messages.length, 0);
    assert.ok(!app.output().includes(TOKEN_SECRET_PART));
  });
});
