import "server-only";
import { site, type Pending } from "@/content/site";
import { readStore } from "./store";
import { SOCIAL_PLATFORMS, type SettingsFile, type SocialPlatform } from "./schema";

/**
 * The editable public facts (docs/admin-panel-audit/ADMIN_PANEL_API_GAPS.md §5.1), read at render
 * by Server Components. Anything not saved in the admin falls back to content/site.ts, so with no
 * settings file the site renders exactly as it did before the admin existed, Pending markers
 * included. Never invent a value here: a missing fact stays Pending (docs/content-gaps.md).
 */
export type PublicPhone = { e164: string; display: string; label?: string };
export type PublicProfile = { platform: SocialPlatform; label: string; url: string };

export type PublicSettings = {
  legalName: string | Pending;
  email: string | Pending;
  replyTime: string | Pending;
  phones: PublicPhone[];
  address: NonNullable<SettingsFile["business"]["address"]> | null;
  profiles: PublicProfile[];
  /** The footer line before the email, e.g. "© 2026 CALIX." */
  copyright: { custom: string } | { year: number; owner: string | Pending };
  enquiries: { accepting: true } | { accepting: false; message: string };
};

/** The single profile in content/site.ts, as a typed default. */
const defaultProfiles: PublicProfile[] = site.profiles.map((url) => ({ platform: "instagram", label: "Instagram", url }));

export function toPublicSettings(file: SettingsFile | null, now = new Date()): PublicSettings {
  const legalName = file?.business.legalName ?? site.legalName;
  const phones: PublicPhone[] = file
    ? [...(file.contact.phonePrimary ? [file.contact.phonePrimary] : []), ...file.contact.phonesAdditional]
    : [];
  const custom = file?.footer.copyrightText;
  return {
    legalName,
    email: file?.contact.email ?? site.email,
    replyTime: file?.contact.replyTime ?? site.replyTime,
    phones,
    address: file?.business.address ?? null,
    profiles: file
      ? file.social.profiles.map((p) => ({ platform: p.platform, label: SOCIAL_PLATFORMS[p.platform].label, url: p.url }))
      : defaultProfiles,
    copyright: custom
      ? { custom: custom.replaceAll("{year}", String(now.getUTCFullYear())) }
      : { year: site.copyrightYear, owner: legalName },
    enquiries:
      !file || file.form.acceptingEnquiries
        ? { accepting: true }
        : { accepting: false, message: file.form.pausedMessage ?? "" },
  };
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return toPublicSettings(await readStore("settings"));
}
