/**
 * Delivery building blocks: the Telegram client, the email sender, the dispatcher (independent
 * channels with timeouts), configuration resolution and failure alerts. Written before the
 * enquiry handler was changed to use them.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeTelegram } from "../helpers/fake-telegram";
import { FakeSmtp } from "../helpers/fake-smtp";
import { chunkMessage, sendTelegram, telegramApiBase } from "@/lib/delivery/telegram";
import { sendEmail, smtpFromEnv } from "@/lib/delivery/email";
import { dispatch, type Job } from "@/lib/delivery/dispatch";
import { resolvePlan } from "@/lib/delivery/plan";
import { alertOnFailures, ALERT_WINDOW_MS, type AlertDeps } from "@/lib/delivery/alerts";
import type { DeliveryFile, DeliveryRecord } from "@/lib/settings/schema";

const TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop";
const never = () => new Promise<string>(() => {});

describe("Telegram client", () => {
  const tg = new FakeTelegram();
  before(() => tg.start());
  after(() => tg.stop());

  test("sends plain text: no parse_mode, link previews off, the chat and token as given", async () => {
    tg.reset();
    const r = await sendTelegram({ token: TOKEN, chatId: "-1001234567890", text: "Hello <b>*world*</b> https://x.example", base: tg.base });
    assert.equal(r, "confirmed");
    assert.equal(tg.messages.length, 1);
    const m = tg.messages[0];
    assert.ok(m.token === TOKEN);
    assert.equal(m.chat_id, "-1001234567890");
    assert.equal(m.text, "Hello <b>*world*</b> https://x.example");
    assert.equal("parse_mode" in m.body, false);
    assert.deepEqual(m.body.link_preview_options, { is_disabled: true });
  });

  test("maps failures to codes that never contain the token", async () => {
    const cases = [
      ["unauthorized", "telegram_unauthorized"],
      ["chat_not_found", "telegram_chat_not_found"],
      ["forbidden", "telegram_forbidden"],
      ["rate_limited", "telegram_rate_limited"],
      ["server_error", "telegram_error_502"],
    ] as const;
    for (const [mode, code] of cases) {
      tg.reset(mode);
      const r = await sendTelegram({ token: TOKEN, chatId: "42", text: "x", base: tg.base });
      assert.equal(r, code, mode);
      assert.ok(!r.includes(TOKEN.split(":")[1]));
    }
  });

  test("a hanging API times out; an unreachable one is reported as unreachable", async () => {
    tg.reset("hang");
    const t0 = Date.now();
    assert.equal(await sendTelegram({ token: TOKEN, chatId: "42", text: "x", base: tg.base, timeoutMs: 300 }), "telegram_timeout");
    assert.ok(Date.now() - t0 < 2_000);
    assert.equal(await sendTelegram({ token: TOKEN, chatId: "42", text: "x", base: "http://127.0.0.1:9", timeoutMs: 2_000 }), "telegram_unreachable");
  });

  test("long messages are split into at most three labelled parts; every part must be confirmed", async () => {
    const text = "a".repeat(9_500);
    const parts = chunkMessage(text);
    assert.equal(parts.length, 3);
    assert.ok(parts.every((p) => p.length <= 4_000));
    assert.match(parts[0], /^\(1\/3\) /);
    assert.equal(parts.map((p) => p.replace(/^\(\d\/3\) /, "")).join(""), text);
    const huge = chunkMessage("b".repeat(20_000));
    assert.equal(huge.length, 3);
    assert.match(huge[2], /\[message shortened\]$/);
    assert.deepEqual(chunkMessage("short"), ["short"]);

    tg.reset();
    assert.equal(await sendTelegram({ token: TOKEN, chatId: "42", text, base: tg.base }), "confirmed");
    assert.equal(tg.messages.length, 3);
  });

  test("the API address can be overridden for tests only with a loopback address", () => {
    assert.equal(telegramApiBase({}), "https://api.telegram.org");
    assert.equal(telegramApiBase({ TELEGRAM_API_BASE: "http://127.0.0.1:8081" }), "http://127.0.0.1:8081");
    assert.equal(telegramApiBase({ TELEGRAM_API_BASE: "http://localhost:8081/" }), "http://localhost:8081");
    assert.equal(telegramApiBase({ TELEGRAM_API_BASE: "https://evil.example" }), "https://api.telegram.org");
    assert.equal(telegramApiBase({ TELEGRAM_API_BASE: "http://127.0.0.1.evil.example" }), "https://api.telegram.org");
  });
});

describe("email sender", () => {
  const smtp = new FakeSmtp();
  let port = 0;
  before(async () => {
    port = await smtp.start();
  });
  after(() => smtp.stop());
  const cfg = () => ({ host: "127.0.0.1", port, user: "u", pass: "p", from: "site@calix.example" });
  const msg = { to: "studio@calix.example", subject: "S", text: "T" };

  test("confirmed when the server accepts; codes for rejection, hang and no server", async () => {
    smtp.mode = "accept";
    assert.equal(await sendEmail(cfg(), msg), "confirmed");
    smtp.mode = "reject";
    assert.equal(await sendEmail(cfg(), msg), "email_rejected");
    smtp.mode = "hang";
    const t0 = Date.now();
    assert.equal(await sendEmail(cfg(), msg, 500), "email_timeout");
    assert.ok(Date.now() - t0 < 3_000);
    smtp.mode = "accept";
    assert.equal(await sendEmail({ ...cfg(), port: 9 }, msg, 3_000), "email_unreachable");
  });

  test("SMTP settings come from the environment; missing names are listed, never values", () => {
    assert.deepEqual(smtpFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" }), {
      ok: true,
      smtp: { host: "h", port: 587, user: "u", pass: "p", from: "u" },
    });
    assert.deepEqual(smtpFromEnv({ SMTP_HOST: "h" }), { ok: false, missing: ["SMTP_USER", "SMTP_PASS"] });
  });
});

describe("dispatcher", () => {
  const job = (channel: "email" | "telegram", send: Job["send"], timeoutMs = 1_000): Job => ({ channel, send, timeoutMs });

  test("partial success: one channel failing does not stop the other", async () => {
    const r = await dispatch([job("email", async () => "email_rejected"), job("telegram", async () => "confirmed")]);
    assert.deepEqual(
      r.map((x) => [x.channel, x.result]),
      [
        ["email", "email_rejected"],
        ["telegram", "confirmed"],
      ],
    );
  });

  test("a throwing channel is reported as an error code and never throws out", async () => {
    const r = await dispatch([
      job("email", async () => {
        throw new Error(`secret ${TOKEN}`);
      }),
      job("telegram", async () => "confirmed"),
    ]);
    assert.deepEqual(r.map((x) => x.result), ["email_error", "confirmed"]);
  });

  test("channels run concurrently and each has its own timeout", async () => {
    const t0 = Date.now();
    let emailDoneAt = 0;
    const r = await dispatch([
      job(
        "email",
        async () => {
          emailDoneAt = Date.now();
          return "confirmed";
        },
        1_000,
      ),
      job("telegram", never, 300),
    ]);
    assert.ok(emailDoneAt - t0 < 100, "email did not wait for Telegram");
    assert.deepEqual(r.map((x) => x.result), ["confirmed", "telegram_timeout"]);
    assert.ok(Date.now() - t0 < 1_000);
  });

  test("total failure is visible to the caller; nothing dispatched means no results", async () => {
    const r = await dispatch([job("email", never, 200), job("telegram", async () => "telegram_unreachable")]);
    assert.ok(r.every((x) => x.result !== "confirmed"));
    assert.deepEqual(await dispatch([]), []);
  });
});

describe("delivery configuration", () => {
  const env = {
    NODE_ENV: "production",
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "h",
    SMTP_USER: "u",
    SMTP_PASS: "p",
    ENQUIRY_TO: "inbox@calix.example",
    FORM_SECRET: "s",
  };
  const file = (d: Partial<DeliveryFile> = {}): DeliveryFile => ({
    version: 1,
    revision: 1,
    updatedAt: "x",
    updatedBy: "t",
    email: { enabled: true },
    telegram: { enabled: false },
    ...d,
  });
  const unseal = (s: string) => (s === "sealed-ok" ? TOKEN : null);
  const tgOn = { enabled: true, chatId: "42", botToken: { sealed: "sealed-ok", savedAt: "x" } };

  test("no delivery file: email to ENQUIRY_TO as before; Telegram disabled by default", () => {
    const p = resolvePlan(null, env, unseal);
    assert.equal(p.mode, "live");
    if (p.mode !== "live") return;
    assert.equal(p.email.ready, true);
    assert.equal(p.email.ready && p.email.to, "inbox@calix.example");
    assert.deepEqual(p.telegram, { enabled: false, ready: false, problem: "disabled" });
  });

  test("Telegram needs TELEGRAM_DELIVERY_ALLOWED=true even when enabled and configured", () => {
    const off = resolvePlan(file({ telegram: tgOn }), env, unseal);
    assert.ok(off.mode === "live" && !off.telegram.ready && off.telegram.problem === "telegram_not_allowed");
    const on = resolvePlan(file({ telegram: tgOn }), { ...env, TELEGRAM_DELIVERY_ALLOWED: "true" }, unseal);
    assert.ok(on.mode === "live" && on.telegram.ready && on.telegram.token === TOKEN && on.telegram.chatId === "42");
  });

  test("malformed configuration makes a channel unusable without affecting the other", () => {
    const allowed = { ...env, TELEGRAM_DELIVERY_ALLOWED: "true" };
    const bad = resolvePlan(file({ telegram: { ...tgOn, botToken: { sealed: "garbage", savedAt: "x" } } }), allowed, unseal);
    assert.ok(bad.mode === "live" && !bad.telegram.ready && bad.telegram.problem === "telegram_token_unreadable");
    assert.ok(bad.mode === "live" && bad.email.ready);
    const noChat = resolvePlan(file({ telegram: { enabled: true, botToken: { sealed: "sealed-ok", savedAt: "x" } } }), allowed, unseal);
    assert.ok(noChat.mode === "live" && !noChat.telegram.ready && noChat.telegram.problem === "telegram_no_chat");
    const noSmtp = resolvePlan(file(), { ...env, SMTP_PASS: "" }, unseal);
    assert.ok(noSmtp.mode === "live" && !noSmtp.email.ready && noSmtp.email.problem === "smtp_missing:SMTP_PASS");
    const noTo = resolvePlan(file(), { ...env, ENQUIRY_TO: "" }, unseal);
    assert.ok(noTo.mode === "live" && !noTo.email.ready && noTo.email.problem === "email_no_recipient");
    const saved = resolvePlan(file({ email: { enabled: true, recipient: "saved@calix.example" } }), env, unseal);
    assert.ok(saved.mode === "live" && saved.email.ready && saved.email.to === "saved@calix.example");
    const disabled = resolvePlan(file({ email: { enabled: false }, telegram: tgOn }), allowed, unseal);
    assert.ok(disabled.mode === "live" && !disabled.email.ready && disabled.email.problem === "disabled");
  });

  test("log mode stays limited to development and non-indexed builds; live delivery needs FORM_SECRET", () => {
    assert.deepEqual(resolvePlan(null, { NODE_ENV: "development" }, unseal), { mode: "log" });
    assert.deepEqual(resolvePlan(null, { NODE_ENV: "production", MAIL_TRANSPORT: "log", NOINDEX: "true" }, unseal), { mode: "log" });
    assert.deepEqual(resolvePlan(null, { NODE_ENV: "production", MAIL_TRANSPORT: "log" }, unseal), { mode: "refused", problem: "log_transport_in_production" });
    assert.deepEqual(resolvePlan(null, { ...env, FORM_SECRET: "" }, unseal), { mode: "refused", problem: "form_secret_missing" });
  });
});

describe("failure alerts", () => {
  function deps(opts: { sendResult?: string; throttled?: boolean } = {}) {
    const sent: { channel: string; subject: string; text: string }[] = [];
    const records: DeliveryRecord[] = [];
    const claims: string[] = [];
    const d: AlertDeps = {
      now: () => new Date("2026-10-24T09:12:00Z"),
      requestId: () => "req_test",
      claim: async (about) => {
        claims.push(about);
        return !opts.throttled;
      },
      record: async (r) => {
        records.push(r);
      },
      send: async (channel, subject, text) => {
        sent.push({ channel, subject, text });
        return { result: opts.sendResult ?? "confirmed", ms: 5 };
      },
    };
    return { d, sent, records, claims };
  }
  const res = (email: string, telegram: string) => [
    { channel: "email" as const, result: email, ms: 10 },
    { channel: "telegram" as const, result: telegram, ms: 10 },
  ];

  test("one channel failed: the other channel carries one alert, with no enquiry content", async () => {
    const { d, sent, records } = deps();
    await alertOnFailures(res("confirmed", "telegram_forbidden"), d);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, "email");
    assert.match(sent[0].subject, /Telegram delivery failed/);
    assert.match(sent[0].text, /telegram_forbidden/);
    assert.match(sent[0].text, /delivered by email/);
    assert.deepEqual(records, [{ at: "2026-10-24T09:12:00.000Z", requestId: "req_test", kind: "alert", about: "telegram", results: [{ channel: "email", result: "confirmed", ms: 5 }] }]);
  });

  test("throttled: at most one alert per failing channel per window", async () => {
    const { d, sent, records, claims } = deps({ throttled: true });
    await alertOnFailures(res("email_rejected", "confirmed"), d);
    assert.deepEqual(claims, ["email"]);
    assert.equal(sent.length, 0);
    assert.equal(records.length, 0);
    assert.equal(ALERT_WINDOW_MS, 30 * 60 * 1000);
  });

  test("every channel failed: no alert can be sent, so the failure is recorded instead", async () => {
    const { d, sent, records } = deps();
    await alertOnFailures(res("email_timeout", "telegram_unreachable"), d);
    assert.equal(sent.length, 0);
    assert.deepEqual(
      records.map((r) => [r.kind, r.about, r.skipped, r.results.length]),
      [
        ["alert", "email", "no_working_channel", 0],
        ["alert", "telegram", "no_working_channel", 0],
      ],
    );
  });

  test("an alert that fails is recorded once and never triggers another alert", async () => {
    const { d, sent, records, claims } = deps({ sendResult: "email_unreachable" });
    await alertOnFailures(res("confirmed", "telegram_unauthorized"), d);
    assert.equal(sent.length, 1, "exactly one attempt");
    assert.deepEqual(claims, ["telegram"], "no claim about the alert's own channel");
    assert.deepEqual(records.map((r) => [r.kind, r.about, r.results[0]?.result]), [["alert", "telegram", "email_unreachable"]]);
  });

  test("nothing failed, or only one channel was in use: no alerts", async () => {
    const { d, sent, records, claims } = deps();
    await alertOnFailures(res("confirmed", "confirmed"), d);
    await alertOnFailures([{ channel: "email", result: "email_rejected", ms: 1 }], d);
    assert.equal(sent.length, 0);
    assert.deepEqual(claims, ["email"]);
    assert.deepEqual(records.map((r) => r.skipped), ["no_working_channel"]);
  });
});
