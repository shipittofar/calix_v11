import "server-only";
import { readStore } from "@/lib/settings/store";
import { fingerprint, unseal } from "@/lib/settings/crypto";
import type { ChannelName, DeliveryFile, StatusFile } from "@/lib/settings/schema";
import { resolvePlan, telegramAllowed } from "./plan";
import { sendEmail } from "./email";
import { sendTelegram } from "./telegram";
import { sendWhatsapp } from "./whatsapp";
import { recordTest } from "./log";

export const TEST_SUBJECT = "[Test] CALIX enquiry delivery";
const TEST_TEXT = "This is a test message from the CALIX website admin. It contains no visitor data.";

/** What the admin page may show about delivery. Never the token or any part of it. */
export type DeliveryView = {
  revision: number;
  email: { enabled: boolean; recipient: string; serverDefault: boolean; ready: boolean; problem?: string };
  telegram: { enabled: boolean; chatId: string; tokenSaved: boolean; tokenSavedAt?: string; allowed: boolean; ready: boolean; problem?: string; testMatches: boolean };
  whatsapp: {
    enabled: boolean;
    to: string;
    phoneNumberId: string;
    template: string;
    language: string;
    tokenSaved: boolean;
    tokenSavedAt?: string;
    ready: boolean;
    problem?: string;
  };
  lastTest: StatusFile["lastTest"];
  records: StatusFile["records"];
  lastAlertAt: StatusFile["lastAlertAt"];
  mode: "live" | "log" | "refused";
  refusedBecause?: string;
};

export const telegramFingerprint = (token: string, chatId: string) => fingerprint("telegram", token, chatId);

/** True when the last Telegram test succeeded for exactly this token and chat. */
export function testMatches(status: StatusFile | null, token: string | null, chatId: string | undefined) {
  const t = status?.lastTest.telegram;
  return Boolean(t && t.result === "confirmed" && token && chatId && t.fingerprint === telegramFingerprint(token, chatId));
}

export async function deliveryView(): Promise<DeliveryView> {
  const [file, status] = await Promise.all([readStore("delivery"), readStore("status")]);
  const plan = resolvePlan(file, process.env, unseal);
  const token = file?.telegram.botToken ? unseal(file.telegram.botToken.sealed) : null;
  const live = plan.mode === "live" ? plan : null;
  return {
    revision: file?.revision ?? 0,
    email: {
      enabled: file ? file.email.enabled : true,
      recipient: file?.email.recipient ?? "",
      serverDefault: !file?.email.recipient && Boolean(process.env.ENQUIRY_TO),
      ready: Boolean(live?.email.ready),
      problem: live && !live.email.ready ? live.email.problem : undefined,
    },
    telegram: {
      enabled: Boolean(file?.telegram.enabled),
      chatId: file?.telegram.chatId ?? "",
      tokenSaved: Boolean(file?.telegram.botToken),
      tokenSavedAt: file?.telegram.botToken?.savedAt,
      allowed: telegramAllowed(),
      ready: Boolean(live?.telegram.ready),
      problem: live && !live.telegram.ready ? live.telegram.problem : undefined,
      testMatches: testMatches(status, token, file?.telegram.chatId),
    },
    whatsapp: {
      enabled: Boolean(file?.whatsapp?.enabled),
      to: file?.whatsapp?.to ?? "",
      phoneNumberId: file?.whatsapp?.phoneNumberId ?? "",
      template: file?.whatsapp?.template ?? "",
      language: file?.whatsapp?.language ?? "",
      tokenSaved: Boolean(file?.whatsapp?.accessToken),
      tokenSavedAt: file?.whatsapp?.accessToken?.savedAt,
      ready: Boolean(live?.whatsapp.ready),
      problem: live && !live.whatsapp.ready ? live.whatsapp.problem : undefined,
    },
    lastTest: status?.lastTest ?? {},
    records: (status?.records ?? []).slice(-50).reverse(),
    lastAlertAt: status?.lastAlertAt ?? {},
    mode: plan.mode,
    refusedBecause: plan.mode === "refused" ? plan.problem : undefined,
  };
}

/**
 * Sends a fixed test message through a channel's saved configuration, whether or not the channel
 * is switched on (so it can be checked before enquiries go to it). Records the result.
 */
export async function runTest(channel: ChannelName, by: string): Promise<string> {
  const file = await readStore("delivery");
  let result: string;
  let fp: string | undefined;
  if (channel === "email") {
    const forced: DeliveryFile | null = file ? { ...file, email: { ...file.email, enabled: true } } : null;
    const plan = resolvePlan(forced, { ...process.env, TELEGRAM_DELIVERY_ALLOWED: "" }, unseal);
    if (plan.mode !== "live") result = plan.mode === "log" ? "log_mode" : plan.problem;
    else if (!plan.email.ready) result = plan.email.problem;
    else result = await sendEmail(plan.email.smtp, { to: plan.email.to, subject: TEST_SUBJECT, text: TEST_TEXT });
  } else if (channel === "whatsapp") {
    const wa = file?.whatsapp;
    const token = wa?.accessToken ? unseal(wa.accessToken.sealed) : null;
    if (!wa?.accessToken) result = "whatsapp_no_token";
    else if (!token) result = "whatsapp_token_unreadable";
    else if (!wa.phoneNumberId) result = "whatsapp_no_sender";
    else if (!wa.to) result = "whatsapp_no_recipient";
    else {
      result = await sendWhatsapp({
        token,
        phoneNumberId: wa.phoneNumberId,
        to: wa.to,
        template: wa.template,
        language: wa.language,
        text: `${TEST_SUBJECT} - ${TEST_TEXT}`,
      });
    }
  } else {
    const token = file?.telegram.botToken ? unseal(file.telegram.botToken.sealed) : null;
    const chatId = file?.telegram.chatId;
    if (!file?.telegram.botToken) result = "telegram_no_token";
    else if (!token) result = "telegram_token_unreadable";
    else if (!chatId) result = "telegram_no_chat";
    else {
      result = await sendTelegram({ token, chatId, text: `${TEST_SUBJECT}\n${TEST_TEXT}` });
      fp = telegramFingerprint(token, chatId);
    }
  }
  // Stored codes are short identifiers; variable names stay on the status display only.
  if (result.startsWith("smtp_missing:")) result = "smtp_missing";
  await recordTest(channel, { at: new Date().toISOString(), result, by, ...(fp ? { fingerprint: fp } : {}) });
  return result;
}
