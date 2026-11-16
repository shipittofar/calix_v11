/**
 * The General settings form: field names, the values it starts from, and parsing of a submission
 * into the `settings.json` sections it owns (business, contact, social, footer). The `form`
 * section belongs to the Contact form page and is never changed here.
 *
 * Every field is optional: an empty field means "not supplied", and the site falls back to
 * content/site.ts (a Pending marker or no output at all). Rows of phones and profiles left
 * completely empty are ignored, so the form works without JavaScript.
 */
import type { z } from "zod";
import { site } from "@/content/site";
import {
  SOCIAL_PLATFORMS,
  emailAddress,
  phoneNumber,
  plainText,
  postalAddress,
  settingsFile,
  socialProfile,
  type SettingsFile,
  type SocialPlatform,
} from "./schema";

export const EXTRA_PHONES = 3;
export const PROFILE_ROWS = 6;

export type GeneralValues = Record<string, string>;
export type GeneralSections = Pick<SettingsFile, "business" | "contact" | "social" | "footer">;
export type ParseResult = { ok: true; sections: GeneralSections } | { ok: false; errors: Record<string, string> };

const copyrightText = settingsFile.shape.footer.shape.copyrightText.unwrap();
const ADDRESS_FIELDS = ["street", "locality", "region", "postcode", "country"] as const;

/** Form values for the current settings (or the content/site.ts defaults when nothing is saved). */
export function valuesFrom(file: SettingsFile | null): GeneralValues {
  const v: GeneralValues = {
    legalName: file?.business.legalName ?? "",
    email: file?.contact.email ?? "",
    replyTime: file?.contact.replyTime ?? "",
    copyrightText: file?.footer.copyrightText ?? "",
    "phone.e164": file?.contact.phonePrimary?.e164 ?? "",
    "phone.display": file?.contact.phonePrimary?.display ?? "",
  };
  for (const f of ADDRESS_FIELDS) v[`address.${f}`] = file?.business.address?.[f] ?? "";
  const extra = file?.contact.phonesAdditional ?? [];
  for (let i = 0; i < EXTRA_PHONES; i++) {
    v[`phone${i + 1}.label`] = extra[i]?.label ?? "";
    v[`phone${i + 1}.e164`] = extra[i]?.e164 ?? "";
    v[`phone${i + 1}.display`] = extra[i]?.display ?? "";
  }
  const profiles = file ? file.social.profiles : site.profiles.map((url) => ({ platform: "instagram" as SocialPlatform, url }));
  for (let i = 0; i < PROFILE_ROWS; i++) {
    v[`profile${i + 1}.platform`] = profiles[i]?.platform ?? "";
    v[`profile${i + 1}.url`] = profiles[i]?.url ?? "";
  }
  return v;
}

/** The submitted values for every known field (unknown fields are dropped). */
export function readValues(formData: FormData): GeneralValues {
  const keys = Object.keys(valuesFrom(null));
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "").slice(0, 400)]));
}

export function parseGeneral(values: GeneralValues): ParseResult {
  const errors: Record<string, string> = {};
  const val = (k: string) => (values[k] ?? "").trim();

  function field<T>(schema: z.ZodType<T>, key: string): T | undefined {
    if (!val(key)) return undefined;
    const r = schema.safeParse(val(key));
    if (!r.success) errors[key] = r.error.issues[0]?.message ?? "Check this field.";
    return r.success ? r.data : undefined;
  }

  /** Validates an object built from several inputs; issues map back to `${prefix}.${field}`. */
  function group<T>(schema: z.ZodType<T>, prefix: string, input: Record<string, unknown>): T | undefined {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      const key = `${prefix}.${String(issue.path[0] ?? "")}`;
      errors[key in values ? key : `${prefix}.${Object.keys(input)[0]}`] ??= issue.message;
    }
    return undefined;
  }

  const legalName = field(plainText(160), "legalName");
  const email = field(emailAddress, "email");
  const replyTime = field(plainText(40), "replyTime");
  const footerText = field(copyrightText, "copyrightText");

  const addressInput = Object.fromEntries(ADDRESS_FIELDS.filter((f) => val(`address.${f}`)).map((f) => [f, val(`address.${f}`)]));
  let address: SettingsFile["business"]["address"];
  if (Object.keys(addressInput).length) {
    if (!addressInput.country) errors["address.country"] = "Add the two-letter country code, for example GB.";
    else address = group(postalAddress, "address", { ...addressInput, country: String(addressInput.country).toUpperCase() });
  }

  const phone = (prefix: string, withLabel: boolean) => {
    const e164 = val(`${prefix}.e164`).replace(/[\s()-]/g, "");
    const display = val(`${prefix}.display`);
    const label = withLabel ? val(`${prefix}.label`) : "";
    if (!e164 && !display && !label) return undefined;
    if (!e164) {
      errors[`${prefix}.e164`] = "Add the number in international format, for example +441234567890.";
      return undefined;
    }
    if (withLabel && !label) {
      errors[`${prefix}.label`] = "Add a label, for example Studio or Sales.";
      return undefined;
    }
    const schema = withLabel ? phoneNumber.extend({ label: plainText(40) }).strict() : phoneNumber;
    return group(schema, prefix, { e164, display: display || e164, ...(withLabel ? { label } : {}) });
  };
  const phonePrimary = phone("phone", false);
  const phonesAdditional = Array.from({ length: EXTRA_PHONES }, (_, i) => phone(`phone${i + 1}`, true)).filter(
    (p): p is NonNullable<typeof p> & { label: string } => Boolean(p),
  );
  if (phonesAdditional.length && !phonePrimary && !errors["phone.e164"]) {
    errors["phone.e164"] = "Add the main number first.";
  }

  const profiles: SettingsFile["social"]["profiles"] = [];
  const seen = new Set<string>();
  for (let i = 1; i <= PROFILE_ROWS; i++) {
    const platform = val(`profile${i}.platform`);
    const url = val(`profile${i}.url`);
    if (!platform && !url) continue;
    if (!url) {
      errors[`profile${i}.url`] = "Add the profile address, or clear the platform.";
      continue;
    }
    const p = group(socialProfile, `profile${i}`, { platform: platform || undefined, url });
    if (!p) continue;
    if (seen.has(p.url)) {
      errors[`profile${i}.url`] = "This profile is already listed.";
      continue;
    }
    seen.add(p.url);
    profiles.push(p);
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    sections: {
      business: { ...(legalName ? { legalName } : {}), ...(address ? { address } : {}) },
      contact: {
        ...(email ? { email } : {}),
        ...(phonePrimary ? { phonePrimary } : {}),
        phonesAdditional,
        ...(replyTime ? { replyTime } : {}),
      },
      social: { profiles },
      footer: footerText ? { copyrightText: footerText } : {},
    },
  };
}

/** Which top-level fields differ, for the audit log (names only, never values). */
export function changedFields(before: GeneralSections | null, after: GeneralSections): string[] {
  const flat = (s: GeneralSections | null): Record<string, string> => ({
    legalName: JSON.stringify(s?.business.legalName),
    address: JSON.stringify(s?.business.address),
    email: JSON.stringify(s?.contact.email),
    phonePrimary: JSON.stringify(s?.contact.phonePrimary),
    phonesAdditional: JSON.stringify(s?.contact.phonesAdditional ?? []),
    replyTime: JSON.stringify(s?.contact.replyTime),
    socialProfiles: JSON.stringify(s?.social.profiles.map((p) => [p.platform, p.url]) ?? null),
    copyrightText: JSON.stringify(s?.footer.copyrightText),
  });
  const a = flat(before);
  const b = flat(after);
  return Object.keys(b).filter((k) => a[k] !== b[k]);
}

export const platformOptions = (Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[]).map((key) => ({
  value: key,
  label: SOCIAL_PLATFORMS[key].label,
}));
