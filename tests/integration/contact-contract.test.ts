/**
 * Contract tests for the public enquiry form, run against the production build (`next start`),
 * submitting the form the way a browser without JavaScript does. Written before the delivery flow
 * was changed; they must keep passing afterwards.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client, textOf } from "../helpers/http";
import { FakeSmtp, body, header } from "../helpers/fake-smtp";
import { sleep, startApp, validEnquiry, type RunningApp } from "../helpers/app";

const UNAVAILABLE = "We could not send your enquiry just now. Please try again in a few minutes. Your details are still in the form.";
const RESEND = "Please check your details and press Send again. Nothing has been sent yet.";
const RATE = "Too many enquiries were sent from this connection. Please wait ten minutes and try again.";

let ipCounter = 0;
const visitor = (base: string) => {
  const ip = `203.0.113.${++ipCounter}`;
  return new Client(base, { "x-real-ip": ip, "x-forwarded-for": ip });
};

/** Loads the form, waits past the 3-second minimum, and returns the rendered HTML. */
async function readyForm(c: Client) {
  const { html } = await c.get("/contact");
  await sleep(3_100);
  return html;
}

describe("enquiry form contract (production build)", () => {
  const smtp = new FakeSmtp();
  let app: RunningApp;

  before(async () => {
    const port = await smtp.start();
    app = await startApp({
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(port),
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      ENQUIRY_TO: "enquiries@example.com",
      FORM_SECRET: "test-form-secret",
      TRUSTED_PROXY_HEADER: "x-real-ip",
    });
  });
  after(async () => {
    await app?.stop();
    await smtp.stop();
  });

  test("invalid fields re-render with the error summary and keep values", async () => {
    const c = visitor(app.base);
    const html = await readyForm(c);
    const r = await c.submit("/contact", { ...validEnquiry(), name: "", goals: "short" }, { html });
    assert.equal(r.res.status, 200);
    const text = textOf(r.html);
    assert.match(text, /Please check the highlighted fields\./);
    assert.match(text, /Enter your name\./);
    assert.match(r.html, /value="person@example.com"/);
  });

  test("submitting faster than 3 seconds asks to resend; nothing is sent", async () => {
    const c = visitor(app.base);
    const before = smtp.messages.length;
    const r = await c.submit("/contact", validEnquiry());
    assert.equal(r.res.status, 200);
    assert.ok(textOf(r.html).includes(RESEND));
    assert.equal(smtp.messages.length, before);
  });

  test("honeypot: silent redirect without the conversion query; nothing is sent", async () => {
    const c = visitor(app.base);
    const before = smtp.messages.length;
    const r = await c.submit("/contact", { ...validEnquiry(), company_fax: "bot" });
    assert.equal(r.res.status, 303);
    assert.equal(r.location, "/contact/thank-you");
    assert.equal(smtp.messages.length, before);
  });

  test("forged token: silent redirect; nothing is sent", async () => {
    const c = visitor(app.base);
    const before = smtp.messages.length;
    const r = await c.submit("/contact", { ...validEnquiry(), form_token: "123.abc" });
    assert.equal(r.res.status, 303);
    assert.equal(r.location, "/contact/thank-you");
    assert.equal(smtp.messages.length, before);
  });

  test("valid enquiry: emailed to CALIX, then redirected with the conversion query", async () => {
    smtp.mode = "accept";
    const c = visitor(app.base);
    const html = await readyForm(c);
    const before = smtp.messages.length;
    const r = await c.submit("/contact", validEnquiry("Contract Co"), { html });
    assert.equal(r.res.status, 303);
    assert.equal(r.location, "/contact/thank-you?submitted=1&services=web%2Cseo&timeline=1-3-months");
    assert.equal(smtp.messages.length, before + 1);
    const m = smtp.messages.at(-1)!;
    assert.deepEqual(m.to, ["<enquiries@example.com>"]);
    assert.equal(header(m.data, "Subject"), "Project enquiry: Contract Co");
    assert.equal(header(m.data, "Reply-To"), "person@example.com");
    assert.match(body(m.data), /Needs: Web Design & Development, SEO & GEO/);
  });

  test("delivery failure: honest error, values kept, no redirect", async () => {
    smtp.mode = "reject";
    try {
      const c = visitor(app.base);
      const html = await readyForm(c);
      const r = await c.submit("/contact", validEnquiry(), { html });
      assert.equal(r.res.status, 200);
      assert.ok(textOf(r.html).includes(UNAVAILABLE));
      assert.match(r.html, /value="Acme Ltd"/);
    } finally {
      smtp.mode = "accept";
    }
  });

  test("rate limit: the sixth enquiry from one connection in ten minutes is refused", async () => {
    const c = visitor(app.base);
    const html = await readyForm(c);
    for (let i = 0; i < 5; i++) {
      const r = await c.submit("/contact", validEnquiry(`Rate ${i}`), { html });
      assert.equal(r.res.status, 303, `submission ${i + 1}`);
    }
    const r = await c.submit("/contact", validEnquiry("Rate 6"), { html });
    assert.equal(r.res.status, 200);
    assert.ok(textOf(r.html).includes(RATE));
  });
});

describe("enquiry form when delivery is not configured", () => {
  let app: RunningApp;
  before(async () => {
    app = await startApp({ FORM_SECRET: "test-form-secret" });
  });
  after(async () => app?.stop());

  test("tells the visitor it could not be sent (never a false success)", async () => {
    const c = visitor(app.base);
    const html = await readyForm(c);
    const r = await c.submit("/contact", validEnquiry(), { html });
    assert.equal(r.res.status, 200);
    assert.ok(textOf(r.html).includes(UNAVAILABLE));
  });
});
