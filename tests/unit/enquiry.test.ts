/**
 * Contract tests for the existing enquiry modules (written before the delivery flow changes).
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { validateEnquiry, readEnquiry } from "@/lib/enquiry/schema";
import { checkFormToken, createFormToken, looksLikeLinkSpam, rateLimited } from "@/lib/enquiry/spam";
import { formatEnquiry, mailConfig } from "@/lib/enquiry/mail";

const valid = {
  name: "Test Person",
  email: "person@example.com",
  company: "Acme Ltd",
  website: "example.com",
  services: ["web", "seo"],
  goals: "We need a faster website that brings in qualified enquiries.",
  budget: "",
  start: "1-3-months",
  context: "",
};

describe("enquiry schema", () => {
  test("accepts a valid enquiry and normalises the website", () => {
    const r = validateEnquiry(valid);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.website, "https://example.com");
      assert.equal(r.data.budget, undefined);
      assert.deepEqual(r.data.services, ["web", "seo"]);
    }
  });

  test("returns one message per invalid field, with the interface wording", () => {
    const r = validateEnquiry({ ...valid, name: "", email: "nope", goals: "short", services: [], start: "" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errors.name, "Enter your name.");
      assert.equal(r.errors.email, "Enter a valid email address, for example name@company.com.");
      assert.equal(r.errors.goals, "Tell us a little more about your goals: at least 20 characters.");
      assert.equal(r.errors.services, "Choose at least one option, or “Not sure yet”.");
      assert.equal(r.errors.start, "Choose your desired timeline.");
    }
  });

  test("readEnquiry reads repeated service values", () => {
    const fd = new FormData();
    fd.append("name", "A");
    fd.append("services", "web");
    fd.append("services", "brand");
    assert.deepEqual(readEnquiry(fd).services, ["web", "brand"]);
  });
});

describe("spam checks", () => {
  test("form token: ok, too fast, expired, forged", () => {
    const now = 1_800_000_000_000;
    const token = createFormToken(now);
    assert.equal(checkFormToken(token, now + 1_000), "too-fast");
    assert.equal(checkFormToken(token, now + 5_000), "ok");
    assert.equal(checkFormToken(token, now + 25 * 60 * 60 * 1000), "expired");
    assert.equal(checkFormToken(`${now}.deadbeef`, now + 5_000), "invalid");
    assert.equal(checkFormToken("", now), "invalid");
  });

  test("rate limit: 5 per 10 minutes per key", () => {
    const now = 1_900_000_000_000;
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) assert.equal(rateLimited(key, now + i), false);
    assert.equal(rateLimited(key, now + 10), true);
    assert.equal(rateLimited(key, now + 11 * 60 * 1000), false);
  });

  test("link heuristic", () => {
    assert.equal(looksLikeLinkSpam("We need a new website for our studio."), false);
    assert.equal(looksLikeLinkSpam("https://a.com https://b.com https://c.com https://d.com"), true);
    assert.equal(looksLikeLinkSpam("www.spam.example"), true);
  });
});

describe("email format (mailbox contract)", () => {
  const enquiry = (() => {
    const r = validateEnquiry(valid);
    if (!r.ok) throw new Error("fixture invalid");
    return r.data;
  })();

  test("subject and body are unchanged", () => {
    const m = formatEnquiry(enquiry, { ref: "case-a" });
    assert.equal(m.subject, "Project enquiry: Acme Ltd");
    assert.equal(
      m.text,
      [
        "Name: Test Person",
        "Email: person@example.com",
        "Company: Acme Ltd",
        "Website: https://example.com",
        "Needs: Web Design & Development, SEO & GEO",
        "Budget range: Not given",
        "Desired timeline: In 1 to 3 months",
        "Referring page: case-a",
        "",
        "Project goals:",
        "We need a faster website that brings in qualified enquiries.",
        "",
        "Additional context:",
        "None",
      ].join("\n"),
    );
  });

  test("flagged subject prefix", () => {
    assert.equal(formatEnquiry(enquiry, { flagged: true }).subject, "[Check: many links] Project enquiry: Acme Ltd");
  });
});

describe("mailConfig (environment contract)", () => {
  const saved = { ...process.env };
  const env = process.env as Record<string, string | undefined>;
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete env[k];
    Object.assign(env, saved);
  });
  const clear = () => {
    for (const k of ["MAIL_TRANSPORT", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "ENQUIRY_TO", "ENQUIRY_FROM", "FORM_SECRET", "NOINDEX"]) {
      delete env[k];
    }
  };

  test("production without SMTP settings is not configured (no false success)", () => {
    clear();
    env.NODE_ENV = "production";
    assert.equal(mailConfig(), null);
  });

  test("production refuses the log transport unless NOINDEX=true", () => {
    clear();
    env.NODE_ENV = "production";
    env.MAIL_TRANSPORT = "log";
    assert.equal(mailConfig(), null);
    env.NOINDEX = "true";
    assert.deepEqual(mailConfig(), { transport: "log" });
  });

  test("complete SMTP settings", () => {
    clear();
    env.NODE_ENV = "production";
    Object.assign(env, { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", ENQUIRY_TO: "to@x.com", FORM_SECRET: "s" });
    assert.deepEqual(mailConfig(), { transport: "smtp", host: "h", port: 587, user: "u", pass: "p", to: "to@x.com", from: "u" });
  });
});
