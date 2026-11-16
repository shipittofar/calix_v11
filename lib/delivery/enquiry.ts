import "server-only";
import { after } from "next/server";
import { readStore } from "@/lib/settings/store";
import { unseal } from "@/lib/settings/crypto";
import type { ChannelName } from "@/lib/settings/schema";
import { formatEnquiry, type EnquiryContext } from "@/lib/enquiry/mail";
import type { Enquiry } from "@/lib/enquiry/schema";
import { resolvePlan, type Plan } from "./plan";
import { dispatch, type ChannelResult, type Job } from "./dispatch";
import { EMAIL_TIMEOUT_MS, sendEmail } from "./email";
import { TELEGRAM_TIMEOUT_MS, sendTelegram } from "./telegram";
import { WHATSAPP_TIMEOUT_MS, sendWhatsapp } from "./whatsapp";
import { alertOnFailures } from "./alerts";
import { claimAlert, newRequestId, recordDelivery } from "./log";

export async function currentPlan(): Promise<Plan> {
  return resolvePlan(await readStore("delivery"), process.env, unseal);
}

/** A sender for each ready channel, for messages to CALIX staff (enquiries, alerts, tests). */
export function senders(plan: Plan & { mode: "live" }) {
  const out: Partial<Record<ChannelName, (subject: string, text: string, replyTo?: string) => Promise<string>>> = {};
  const { email, telegram, whatsapp } = plan;
  if (email.ready) out.email = (subject, text, replyTo) => sendEmail(email.smtp, { to: email.to, subject, text, replyTo });
  if (telegram.ready) out.telegram = (_subject, text) => sendTelegram({ token: telegram.token, chatId: telegram.chatId, text });
  if (whatsapp.ready) {
    out.whatsapp = (_subject, text) =>
      sendWhatsapp({ token: whatsapp.token, phoneNumberId: whatsapp.phoneNumberId, to: whatsapp.to, template: whatsapp.template, language: whatsapp.language, text });
  }
  return out;
}

export type EnquiryOutcome = { delivered: boolean; results: ChannelResult[] };

/**
 * Sends an accepted enquiry to every ready channel at once (docs/admin-panel-audit/ADMIN_PANEL_AUDIT.md §8.2).
 * Delivered means at least one channel confirmed. Failures are recorded, and alerted through a
 * working channel after the response is sent.
 */
export async function deliverEnquiry(enquiry: Enquiry, context: EnquiryContext): Promise<EnquiryOutcome> {
  const message = formatEnquiry(enquiry, context);
  const plan = await currentPlan();

  if (plan.mode === "log") {
    // No personal data in logs: record that an enquiry arrived, not its content.
    console.info(`[enquiry] log transport: "${message.subject.replace(enquiry.company, "<company>")}" not delivered`);
    return { delivered: true, results: [] };
  }
  if (plan.mode === "refused") {
    console.error(`[enquiry] no_channel (${plan.problem})`);
    return { delivered: false, results: [] };
  }

  const send = senders(plan);
  const telegramText = [
    `New enquiry: ${enquiry.company}`,
    ...(context.flagged ? ["Check: the message contains many links."] : []),
    "",
    message.text,
  ].join("\n");
  const jobs: Job[] = [];
  if (send.email) jobs.push({ channel: "email", timeoutMs: EMAIL_TIMEOUT_MS + 1_000, send: () => send.email!(message.subject, message.text, enquiry.email) });
  if (send.telegram) jobs.push({ channel: "telegram", timeoutMs: TELEGRAM_TIMEOUT_MS + 1_000, send: () => send.telegram!(message.subject, telegramText) });
  if (send.whatsapp) jobs.push({ channel: "whatsapp", timeoutMs: WHATSAPP_TIMEOUT_MS + 1_000, send: () => send.whatsapp!(message.subject, telegramText) });
  if (!jobs.length) {
    console.error(
      `[enquiry] no_channel (email: ${plan.email.ready ? "ready" : plan.email.problem}; telegram: ${plan.telegram.ready ? "ready" : plan.telegram.problem}; whatsapp: ${plan.whatsapp.ready ? "ready" : plan.whatsapp.problem})`,
    );
    return { delivered: false, results: [] };
  }

  const results = await dispatch(jobs);
  const delivered = results.some((r) => r.result === "confirmed");
  const requestId = newRequestId();
  await recordDelivery({ at: new Date().toISOString(), requestId, kind: "enquiry", results });
  if (!delivered) console.error(`[enquiry] all_channels_failed codes=${results.map((r) => r.result).join(",")}`);
  else if (results.some((r) => r.result !== "confirmed")) console.warn(`[enquiry] partial_delivery codes=${results.map((r) => r.result).join(",")}`);

  if (results.some((r) => r.result !== "confirmed")) {
    after(() =>
      alertOnFailures(results, {
        now: () => new Date(),
        requestId: () => requestId,
        claim: claimAlert,
        record: recordDelivery,
        send: async (channel, subject, text) => {
          const started = Date.now();
          const fn = send[channel];
          return { result: fn ? await fn(subject, text) : `${channel}_not_ready`, ms: Date.now() - started };
        },
      }).catch(() => console.error("[delivery] alerting failed")),
    );
  }
  return { delivered, results };
}
