/**
 * Schemas for the runtime settings files (docs/admin-panel-audit/ADMIN_PANEL_API_GAPS.md §5).
 * Every read and every write goes through these: an invalid file is never used, and admin input
 * that doesn't match is refused. Objects are strict, so unknown fields are rejected.
 */
import { z } from "zod";

export const STORE_VERSION = 1;

// Text shown on the site or sent to staff: trimmed, no control characters, bounded.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Enter a value or clear the field.")
    .max(max, `Keep this under ${max} characters.`)
    .refine((v) => !CONTROL.test(v) && !/[\r\n]/.test(v), "Use a single line of plain text.");

export const emailAddress = z
  .string()
  .trim()
  .max(200, "Keep this under 200 characters.")
  .pipe(z.email("Enter a valid email address, for example name@company.com."));

export const phoneNumber = z
  .object({
    e164: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Use the international format, for example +441234567890."),
    display: plainText(30),
  })
  .strict();

/** Social platforms and the hosts their profile URLs may use. */
export const SOCIAL_PLATFORMS = {
  instagram: { label: "Instagram", hosts: ["instagram.com"] },
  linkedin: { label: "LinkedIn", hosts: ["linkedin.com"] },
  behance: { label: "Behance", hosts: ["behance.net"] },
  dribbble: { label: "Dribbble", hosts: ["dribbble.com"] },
  x: { label: "X", hosts: ["x.com", "twitter.com"] },
  facebook: { label: "Facebook", hosts: ["facebook.com"] },
  youtube: { label: "YouTube", hosts: ["youtube.com"] },
} as const;
export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
const platformKeys = Object.keys(SOCIAL_PLATFORMS) as [SocialPlatform, ...SocialPlatform[]];

const hostMatches = (host: string, allowed: readonly string[]) =>
  allowed.some((h) => host === h || host === `www.${h}` || host.endsWith(`.${h}`));

export const socialProfile = z
  .object({
    platform: z.enum(platformKeys, { message: "Choose a platform." }),
    url: z.string().trim().max(200, "Keep this under 200 characters."),
  })
  .strict()
  .superRefine((p, ctx) => {
    let url: URL;
    try {
      url = new URL(p.url);
    } catch {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Enter a full address starting with https://." });
      return;
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Use an https:// address." });
    } else if (!hostMatches(url.hostname.toLowerCase(), SOCIAL_PLATFORMS[p.platform].hosts)) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: `Use a ${SOCIAL_PLATFORMS[p.platform].label} address (${SOCIAL_PLATFORMS[p.platform].hosts.join(" or ")}).`,
      });
    }
  });

export const postalAddress = z
  .object({
    street: plainText(120).optional(),
    locality: plainText(120).optional(),
    region: plainText(120).optional(),
    postcode: plainText(20).optional(),
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, "Use the two-letter country code, for example GB."),
  })
  .strict();

const meta = {
  version: z.literal(STORE_VERSION),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  updatedBy: z.string(),
};

/** settings.json: public business details and form behaviour. */
export const settingsFile = z
  .object({
    ...meta,
    business: z.object({ legalName: plainText(160).optional(), address: postalAddress.optional() }).strict(),
    contact: z
      .object({
        email: emailAddress.optional(),
        phonePrimary: phoneNumber.optional(),
        phonesAdditional: z.array(phoneNumber.extend({ label: plainText(40) }).strict()).max(3),
        replyTime: plainText(40).optional(),
      })
      .strict(),
    social: z.object({ profiles: z.array(socialProfile).max(6) }).strict(),
    footer: z
      .object({
        copyrightText: plainText(120)
          .refine((v) => !/\{(?!year\})[^}]*\}/.test(v), "Only the {year} placeholder is supported.")
          .optional(),
      })
      .strict(),
    form: z
      .object({
        acceptingEnquiries: z.boolean(),
        pausedMessage: z
          .string()
          .trim()
          .max(300, "Keep this under 300 characters.")
          .refine((v) => !CONTROL.test(v), "Use plain text.")
          .optional(),
      })
      .strict()
      .refine((f) => f.acceptingEnquiries || Boolean(f.pausedMessage), {
        path: ["pausedMessage"],
        message: "Write the message visitors see while enquiries are paused.",
      }),
  })
  .strict();
export type SettingsFile = z.infer<typeof settingsFile>;

/** Telegram chat: a numeric ID (groups are negative) or a public @channelname. */
export const telegramChatId = z
  .string()
  .trim()
  .regex(/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/, "Use the numeric chat ID (for example -1001234567890) or @channelname.");

export const telegramBotToken = z
  .string()
  .trim()
  .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,}$/, "This does not look like a bot token from @BotFather.");

/** WhatsApp Cloud API (Meta): numeric phone-number ID, template name and language code. */
export const whatsappNumber = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Use the international format, for example +491701234567.");
export const whatsappPhoneNumberId = z.string().trim().regex(/^\d{5,25}$/, "Use the numeric Phone number ID from Meta (WhatsApp > API setup).");
export const whatsappAccessToken = z.string().trim().regex(/^[A-Za-z0-9_-]{30,600}$/, "This does not look like a Meta access token.");
export const whatsappTemplate = z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Use the template name exactly as in Meta: lowercase letters, digits and underscores.");
export const whatsappLanguage = z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Use a language code such as en or en_US.");

/** delivery.json: which channels receive enquiries (private; the token is encrypted). */
export const deliveryFile = z
  .object({
    ...meta,
    email: z.object({ enabled: z.boolean(), recipient: emailAddress.optional() }).strict(),
    whatsapp: z
      .object({
        enabled: z.boolean(),
        /** The number that receives enquiries. */
        to: whatsappNumber.optional(),
        phoneNumberId: whatsappPhoneNumberId.optional(),
        /** Approved message template with one body variable. Empty: plain text (only works inside Meta's 24-hour window). */
        template: whatsappTemplate.optional(),
        language: whatsappLanguage.optional(),
        accessToken: z.object({ sealed: z.string().min(1), savedAt: z.string() }).strict().optional(),
      })
      .strict()
      .optional(),
    telegram: z
      .object({
        enabled: z.boolean(),
        chatId: telegramChatId.optional(),
        // Encrypted; no part of the token (not even its last characters) is kept in clear or shown.
        botToken: z.object({ sealed: z.string().min(1), savedAt: z.string() }).strict().optional(),
      })
      .strict(),
  })
  .strict()
  .refine((d) => d.email.enabled || d.telegram.enabled || Boolean(d.whatsapp?.enabled), {
    path: ["email", "enabled"],
    message: "At least one delivery channel must be enabled, or enquiries could not be delivered.",
  });
export type DeliveryFile = z.infer<typeof deliveryFile>;

export const channelName = z.enum(["email", "telegram", "whatsapp"]);
export type ChannelName = z.infer<typeof channelName>;

const outcome = z.union([z.literal("confirmed"), z.string().regex(/^[a-z_0-9]{1,40}$/)]);

export const deliveryRecord = z
  .object({
    at: z.string(),
    requestId: z.string().max(40),
    kind: z.enum(["enquiry", "test_email", "test_telegram", "test_whatsapp", "alert"]),
    results: z.array(z.object({ channel: channelName, result: outcome, ms: z.number().int().nonnegative() }).strict()),
    /** For alerts: which channel's failures the alert reported. */
    about: channelName.optional(),
    /** For alerts that could not be attempted: every channel had just failed. */
    skipped: z.literal("no_working_channel").optional(),
  })
  .strict();
export type DeliveryRecord = z.infer<typeof deliveryRecord>;

export const testResult = z
  .object({ at: z.string(), result: outcome, by: z.string(), fingerprint: z.string().optional() })
  .strict();

/** status.json: delivery outcomes (no enquiry content), test results and alert throttling. */
export const statusFile = z
  .object({
    ...meta,
    records: z.array(deliveryRecord).max(200),
    lastTest: z.object({ email: testResult.optional(), telegram: testResult.optional(), whatsapp: testResult.optional() }).strict(),
    /** When an alert about each channel was last sent (throttling). */
    lastAlertAt: z.object({ email: z.string().optional(), telegram: z.string().optional(), whatsapp: z.string().optional() }).strict(),
  })
  .strict();
export type StatusFile = z.infer<typeof statusFile>;

export const adminRecord = z
  .object({
    id: z.string().regex(/^adm_[a-z0-9]{8,32}$/),
    email: emailAddress,
    status: z.enum(["active", "disabled"]),
    passwordHash: z.string(),
    totp: z.object({ sealed: z.string(), lastStep: z.number().int() }).strict().optional(),
    pendingTotp: z.object({ sealed: z.string(), createdAt: z.string() }).strict().optional(),
    recoveryCodes: z.array(z.string()).max(10),
    sessionVersion: z.number().int().nonnegative(),
    /** Sessions ended with "Sign out", until they would have expired anyway (lib/admin/session.ts). */
    revokedSessions: z
      .array(z.object({ sid: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), until: z.number().int() }).strict())
      .max(50)
      .optional(),
    createdAt: z.string(),
    lastLoginAt: z.string().optional(),
  })
  .strict();
export type AdminRecord = z.infer<typeof adminRecord>;

export const adminsFile = z
  .object({ ...meta, admins: z.array(adminRecord).max(10) })
  .strict()
  .refine((f) => new Set(f.admins.map((a) => a.email.toLowerCase())).size === f.admins.length, "Duplicate administrator email.");
export type AdminsFile = z.infer<typeof adminsFile>;

/** The store's files and their schemas. Names are fixed: no path ever comes from input. */
export const STORE_FILES = {
  settings: settingsFile,
  delivery: deliveryFile,
  status: statusFile,
  admins: adminsFile,
} as const;
export type StoreName = keyof typeof STORE_FILES;
export type StoreValue<N extends StoreName> = z.infer<(typeof STORE_FILES)[N]>;
