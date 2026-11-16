/**
 * Channel-failure alerts. When a channel fails for an enquiry, the administrator is told through a
 * channel that has just worked ("Telegram delivery failed … the enquiry was delivered by email").
 *
 * Loop prevention is structural:
 * - this is called only for enquiry deliveries, never for alerts or test messages;
 * - an alert is a single direct send (`deps.send`), never a dispatch, and its outcome is only
 *   recorded: a failed alert is never alerted about;
 * - at most one alert per failing channel per ALERT_WINDOW_MS, claimed atomically before sending,
 *   so concurrent enquiries can't both alert;
 * - when no channel worked there is nothing to alert through: the failure is recorded instead.
 * Alerts carry no enquiry content: no name, email, company or message.
 */
import type { ChannelName, DeliveryRecord } from "@/lib/settings/schema";
import type { ChannelResult } from "./dispatch";

export const ALERT_WINDOW_MS = 30 * 60 * 1000;

export type AlertDeps = {
  now: () => Date;
  requestId: () => string;
  /** Atomically claims the alert slot for `about`; false if one was used within the window. */
  claim: (about: ChannelName, now: Date) => Promise<boolean>;
  record: (record: DeliveryRecord) => Promise<void>;
  send: (channel: ChannelName, subject: string, text: string) => Promise<{ result: string; ms: number }>;
};

const NAMES: Record<ChannelName, string> = { email: "Email", telegram: "Telegram", whatsapp: "WhatsApp" };

export function alertMessage(failed: ChannelName, code: string, via: ChannelName, at: Date) {
  const time = at.toISOString().slice(0, 16).replace("T", " ");
  return {
    subject: `[CALIX website] ${NAMES[failed]} delivery failed`,
    text: [
      `${NAMES[failed]} delivery failed for an enquiry received at ${time} UTC (${code}).`,
      `The enquiry was delivered by ${via === "email" ? "email" : NAMES[via]}, so nothing was lost.`,
      "Check Contact form and notifications in the website admin.",
      `Further alerts about ${NAMES[failed]} are paused for 30 minutes.`,
    ].join("\n"),
  };
}

export async function alertOnFailures(results: ChannelResult[], deps: AlertDeps): Promise<void> {
  const working = results.find((r) => r.result === "confirmed")?.channel;
  for (const failed of results.filter((r) => r.result !== "confirmed")) {
    const now = deps.now();
    if (!(await deps.claim(failed.channel, now))) continue;
    if (!working) {
      await deps.record({ at: now.toISOString(), requestId: deps.requestId(), kind: "alert", about: failed.channel, skipped: "no_working_channel", results: [] });
      continue;
    }
    const message = alertMessage(failed.channel, failed.result, working, now);
    const sent = await deps.send(working, message.subject, message.text);
    await deps.record({
      at: now.toISOString(),
      requestId: deps.requestId(),
      kind: "alert",
      about: failed.channel,
      results: [{ channel: working, result: sent.result, ms: sent.ms }],
    });
  }
}
