/**
 * Which channels can receive enquiries right now, from delivery.json and the environment.
 * Pure (no I/O), so every combination is unit-tested; lib/delivery/enquiry.ts supplies the inputs.
 *
 * - No delivery.json: email to ENQUIRY_TO exactly as before the admin existed; Telegram off.
 * - Telegram is used only when enabled, configured, its token decrypts, and the server sets
 *   TELEGRAM_DELIVERY_ALLOWED=true. That variable is the operator's sign-off that the privacy
 *   notice, secrets, network access and delivery have been checked (docs/admin-panel-runbook.md).
 * - Log mode (development and NOINDEX builds) replaces every channel with a log line, as before.
 */
import type { DeliveryFile } from "@/lib/settings/schema";
import { smtpFromEnv, type Smtp } from "./email";

type Env = Record<string, string | undefined>;

export type EmailPlan = { enabled: boolean; ready: true; smtp: Smtp; to: string } | { enabled: boolean; ready: false; problem: string };
export type TelegramPlan =
  | { enabled: boolean; ready: true; token: string; chatId: string }
  | { enabled: boolean; ready: false; problem: string };
export type WhatsappPlan =
  | { enabled: boolean; ready: true; token: string; phoneNumberId: string; to: string; template?: string; language?: string }
  | { enabled: boolean; ready: false; problem: string };
export type Plan =
  | { mode: "log" }
  | { mode: "refused"; problem: string }
  | { mode: "live"; email: EmailPlan; telegram: TelegramPlan; whatsapp: WhatsappPlan };

export const telegramAllowed = (env: Env = process.env) => env.TELEGRAM_DELIVERY_ALLOWED === "true";

export function resolvePlan(file: DeliveryFile | null, env: Env, unseal: (sealed: string) => string | null): Plan {
  const transport = env.MAIL_TRANSPORT ?? (env.NODE_ENV === "production" ? "smtp" : "log");
  if (transport === "log") {
    // A public production site must never accept enquiries it does not deliver.
    if (env.NODE_ENV === "production" && env.NOINDEX !== "true") return { mode: "refused", problem: "log_transport_in_production" };
    return { mode: "log" };
  }
  // FORM_SECRET keeps spam tokens valid across restarts; required for live delivery (as before).
  if (!env.FORM_SECRET) return { mode: "refused", problem: "form_secret_missing" };

  const emailEnabled = file ? file.email.enabled : true;
  let email: EmailPlan;
  if (!emailEnabled) email = { enabled: false, ready: false, problem: "disabled" };
  else {
    const smtp = smtpFromEnv(env);
    const to = file?.email.recipient || env.ENQUIRY_TO;
    if (!smtp.ok) email = { enabled: true, ready: false, problem: `smtp_missing:${smtp.missing.join(",")}` };
    else if (!to) email = { enabled: true, ready: false, problem: "email_no_recipient" };
    else email = { enabled: true, ready: true, smtp: smtp.smtp, to };
  }

  const tg = file?.telegram;
  let telegram: TelegramPlan;
  if (!tg?.enabled) telegram = { enabled: false, ready: false, problem: "disabled" };
  else if (!telegramAllowed(env)) telegram = { enabled: true, ready: false, problem: "telegram_not_allowed" };
  else if (!tg.botToken) telegram = { enabled: true, ready: false, problem: "telegram_no_token" };
  else if (!tg.chatId) telegram = { enabled: true, ready: false, problem: "telegram_no_chat" };
  else {
    const token = unseal(tg.botToken.sealed);
    telegram = token ? { enabled: true, ready: true, token, chatId: tg.chatId } : { enabled: true, ready: false, problem: "telegram_token_unreadable" };
  }
  const wa = file?.whatsapp;
  let whatsapp: WhatsappPlan;
  if (!wa?.enabled) whatsapp = { enabled: false, ready: false, problem: "disabled" };
  else if (!wa.accessToken) whatsapp = { enabled: true, ready: false, problem: "whatsapp_no_token" };
  else if (!wa.phoneNumberId) whatsapp = { enabled: true, ready: false, problem: "whatsapp_no_sender" };
  else if (!wa.to) whatsapp = { enabled: true, ready: false, problem: "whatsapp_no_recipient" };
  else {
    const token = unseal(wa.accessToken.sealed);
    whatsapp = token
      ? { enabled: true, ready: true, token, phoneNumberId: wa.phoneNumberId, to: wa.to, template: wa.template, language: wa.language }
      : { enabled: true, ready: false, problem: "whatsapp_token_unreadable" };
  }
  return { mode: "live", email, telegram, whatsapp };
}
