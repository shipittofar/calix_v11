// Untrusted input hardening tied to dependency advisories. Visitor email addresses become the Reply-To header, and saved recipients the To header, of
// messages sent with nodemailer. Address shapes that have tricked mail address parsers (quoted
// local parts with ">" or ";", comments, groups, display names, lists) must never pass validation,
// whatever the nodemailer version (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h).
import { test } from "node:test";
import assert from "node:assert/strict";
import { enquirySchema } from "@/lib/enquiry/schema";
import { emailAddress } from "@/lib/settings/schema";

const crafted = [
  '"a>b"@example.com',
  '"x;y"@example.com',
  '"a@evil.example>"@example.com',
  "a@example.com;b@evil.example",
  "a@example.com, b@evil.example",
  "a(c(d)e)@example.com",
  "(x)a@example.com",
  "a@example.com (comment) , b@evil.example",
  "Name <a@example.com>",
  "grp: a@example.com;",
  "a@example.com\r\nBcc: b@evil.example",
];

test("crafted addresses are rejected for the visitor's email and for saved recipients", () => {
  for (const value of crafted) {
    assert.equal(enquirySchema.shape.email.safeParse(value).success, false, `enquiry email: ${JSON.stringify(value)}`);
    assert.equal(emailAddress.safeParse(value).success, false, `recipient: ${JSON.stringify(value)}`);
  }
  assert.equal(enquirySchema.shape.email.safeParse("person@example.com").success, true);
});

test("an oversized services array is refused quickly with a single error", async () => {
  const { validateEnquiry } = await import("@/lib/enquiry/schema");
  const values = {
    name: "A",
    email: "a@example.com",
    company: "C",
    goals: "x".repeat(30),
    start: "1-3-months",
    services: Array.from({ length: 200_000 }, () => "not-a-service"),
  };
  const t0 = performance.now();
  const r = validateEnquiry(values);
  const ms = performance.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.errors.services, "Choose fewer options.");
  assert.ok(ms < 500, `took ${Math.round(ms)} ms`);
});

test("single-line contact fields refuse CR, LF and other control characters; tabs become spaces", async () => {
  const { validateEnquiry } = await import("@/lib/enquiry/schema");
  const base = { name: "Test Person", email: "person@example.com", company: "Acme Ltd", website: "example.com", services: ["web"], goals: "We need a faster website that brings in qualified enquiries.", start: "1-3-months", budget: "", context: "" };
  for (const field of ["name", "company", "website", "budget"] as const) {
    for (const bad of ["Acme\r\nBcc: x@evil.example", "Acme\nLtd", "Acme\u0000Ltd", "Acme\u001bLtd", "Acme\u007fLtd"]) {
      const r = validateEnquiry({ ...base, [field]: bad });
      assert.equal(r.ok, false, `${field}: ${JSON.stringify(bad)}`);
      assert.equal(!r.ok && r.errors[field], field === "website" ? "Enter a web address, for example yourcompany.com." : "Use a single line of plain text.", field);
    }
  }
  const tabbed = validateEnquiry({ ...base, name: "Test\tPerson", company: "Acme\tLtd" });
  assert.ok(tabbed.ok);
  assert.equal(tabbed.ok && tabbed.data.name, "Test Person");
  // Multi-line fields keep their line breaks.
  const multi = validateEnquiry({ ...base, goals: "Line one is long enough\nLine two", context: "a\nb" });
  assert.ok(multi.ok);
  assert.equal(multi.ok && multi.data.goals, "Line one is long enough\nLine two");
});
