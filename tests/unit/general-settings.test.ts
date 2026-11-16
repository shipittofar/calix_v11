import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFields, parseGeneral, valuesFrom } from "@/lib/settings/general-form";
import { toPublicSettings } from "@/lib/settings/public";
import { settingsFile } from "@/lib/settings/schema";
import { site } from "@/content/site";

const blank = () => valuesFrom(null);

test("defaults: an empty store gives the content/site.ts facts, Pending included", () => {
  const p = toPublicSettings(null);
  assert.deepEqual(p.legalName, site.legalName);
  assert.deepEqual(p.email, site.email);
  assert.deepEqual(p.replyTime, site.replyTime);
  assert.deepEqual(p.phones, []);
  assert.equal(p.address, null);
  assert.deepEqual(p.profiles, [{ platform: "instagram", label: "Instagram", url: site.profiles[0] }]);
  assert.deepEqual(p.copyright, { year: site.copyrightYear, owner: site.legalName });
  assert.deepEqual(p.enquiries, { accepting: true });
  // The form starts from the same profile, so a first save keeps it.
  assert.equal(blank()["profile1.url"], site.profiles[0]);
});

test("an untouched form saves nothing but the existing profile", () => {
  const r = parseGeneral(blank());
  assert.ok(r.ok);
  assert.deepEqual(r.sections, {
    business: {},
    contact: { phonesAdditional: [] },
    social: { profiles: [{ platform: "instagram", url: site.profiles[0] }] },
    footer: {},
  });
});

test("a full, valid submission round-trips through the file schema and public view", () => {
  const v = {
    ...blank(),
    legalName: "  CALIX Studio Ltd ",
    email: "Hello@Calix.example",
    replyTime: "one working day",
    copyrightText: "© {year} CALIX Studio Ltd. All rights reserved.",
    "address.street": "1 Olive Row",
    "address.locality": "London",
    "address.postcode": "EC1A 1AA",
    "address.country": "gb",
    "phone.e164": "+44 (20) 7946-0000",
    "phone.display": "020 7946 0000",
    "phone1.label": "Sales",
    "phone1.e164": "+442079460001",
    "profile2.platform": "linkedin",
    "profile2.url": "https://www.linkedin.com/company/calix",
  };
  const r = parseGeneral(v);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  const file = settingsFile.parse({ ...r.sections, form: { acceptingEnquiries: true }, version: 1, revision: 1, updatedAt: "x", updatedBy: "t" });
  assert.equal(file.business.address?.country, "GB");
  assert.deepEqual(file.contact.phonePrimary, { e164: "+442079460000", display: "020 7946 0000" });
  assert.deepEqual(file.contact.phonesAdditional, [{ e164: "+442079460001", display: "+442079460001", label: "Sales" }]);
  const pub = toPublicSettings(file, new Date("2031-05-01T00:00:00Z"));
  assert.equal(pub.legalName, "CALIX Studio Ltd");
  assert.deepEqual(pub.copyright, { custom: "© 2031 CALIX Studio Ltd. All rights reserved." });
  assert.deepEqual(
    pub.profiles.map((p) => p.label),
    ["Instagram", "LinkedIn"],
  );
  assert.deepEqual(valuesFrom(file)["phone1.label"], "Sales");
  assert.deepEqual(changedFields(null, r.sections).sort(), ["address", "copyrightText", "email", "legalName", "phonePrimary", "phonesAdditional", "replyTime", "socialProfiles"].sort());
});

test("invalid input is refused field by field, with nothing saved", () => {
  const r = parseGeneral({
    ...blank(),
    email: "not-an-email",
    legalName: "Line one\nline two",
    copyrightText: "© {company}",
    "address.street": "1 Olive Row",
    "phone.e164": "07946 000000",
    "phone2.e164": "+442079460002",
    "profile1.platform": "linkedin",
    "profile1.url": "https://www.instagram.com/its.calixeden/",
    "profile3.platform": "x",
    "profile3.url": "javascript:alert(1)",
    "profile4.platform": "",
    "profile4.url": "https://evil.example/",
  });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), [
    "address.country",
    "copyrightText",
    "email",
    "legalName",
    "phone.e164",
    "phone2.label",
    "profile1.url",
    "profile3.url",
    "profile4.platform",
  ].sort());
  assert.match(r.errors["profile1.url"], /LinkedIn address/);
  assert.match(r.errors["copyrightText"], /\{year\}/);
});

test("a cleared field returns to 'not supplied'", () => {
  const filled = parseGeneral({ ...blank(), replyTime: "two days" });
  const cleared = parseGeneral({ ...blank(), replyTime: "   " });
  assert.ok(filled.ok && cleared.ok);
  assert.equal(cleared.sections.contact.replyTime, undefined);
  assert.deepEqual(changedFields(filled.sections, cleared.sections), ["replyTime"]);
});
