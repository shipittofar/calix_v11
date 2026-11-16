"use server";

import { sessionForAction } from "@/lib/admin/session";
import { audit } from "@/lib/admin/audit";
import { confirmIdentity } from "@/lib/admin/reauth";
import { testSends } from "@/lib/admin/rate-limit";
import { readStore, updateStore } from "@/lib/settings/store";
import { seal, unseal } from "@/lib/settings/crypto";
import {
  emailAddress,
  settingsFile,
  telegramBotToken,
  telegramChatId,
  whatsappAccessToken,
  whatsappLanguage,
  whatsappNumber,
  whatsappPhoneNumberId,
  whatsappTemplate,
  type DeliveryFile,
} from "@/lib/settings/schema";
import { resolvePlan, telegramAllowed } from "@/lib/delivery/plan";
import { runTest, testMatches } from "@/lib/delivery/admin";
import { explain } from "@/lib/delivery/codes";
import { parseGeneral, valuesFrom } from "@/lib/settings/general-form";

function defaultSections() {
  const parsed = parseGeneral(valuesFrom(null));
  if (!parsed.ok) throw new Error("default settings are invalid");
  return parsed.sections;
}

const SIGNED_OUT = "Your session has ended. Sign in again; nothing was saved.";
const CONFLICT = "Someone else saved these settings while you were editing. Nothing was saved: reload the page and try again.";

/* ---------- Pause switch ---------- */

export type FormStatusState = { ok?: string; error?: string; errors?: Record<string, string>; values?: { accepting: boolean; pausedMessage: string } };

export async function saveFormStatus(_prev: FormStatusState, formData: FormData): Promise<FormStatusState> {
  const s = await sessionForAction();
  if (!s) return { error: SIGNED_OUT };
  const values = {
    accepting: formData.get("accepting") === "yes",
    pausedMessage: String(formData.get("pausedMessage") ?? "").slice(0, 400),
  };
  const form = settingsFile.shape.form.safeParse({
    acceptingEnquiries: values.accepting,
    ...(values.pausedMessage.trim() ? { pausedMessage: values.pausedMessage } : {}),
  });
  if (!form.success) {
    return { error: "Nothing was saved.", errors: { pausedMessage: form.error.issues[0]?.message ?? "Check the message." }, values };
  }
  const result = await updateStore(
    "settings",
    // Before the first General settings save, start from the defaults the site shows today
    // (including the content/site.ts profile), so pausing never changes anything else.
    (cur) => ({ ...(cur ?? defaultSections()), form: form.data }),
    { by: s.admin.id, baseRevision: Number(formData.get("revision")) },
  );
  if (!result.ok) {
    await audit({ adminId: s.admin.id, action: "settings.form.save", outcome: "error", ip: s.ip, detail: result.reason });
    return { error: result.reason === "conflict" ? CONFLICT : "Nothing was saved: the settings store is unavailable.", values };
  }
  await audit({ adminId: s.admin.id, action: "settings.form.save", outcome: "success", ip: s.ip, changes: { acceptingEnquiries: values.accepting } });
  return { ok: values.accepting ? "Enquiries are open. The contact form is back on the website." : "Enquiries are paused. Visitors now see your message instead of the form." };
}

/* ---------- Delivery channels ---------- */

export type DeliveryState = {
  ok?: string;
  error?: string;
  errors?: Record<string, string>;
  /** Echoed on error so the form keeps its input. Never contains the token. */
  values?: {
    emailEnabled: boolean;
    recipient: string;
    telegramEnabled: boolean;
    chatId: string;
    whatsappEnabled: boolean;
    waTo: string;
    waPhoneNumberId: string;
    waTemplate: string;
    waLanguage: string;
  };
};

export async function saveDelivery(_prev: DeliveryState, formData: FormData): Promise<DeliveryState> {
  const s = await sessionForAction();
  if (!s) return { error: SIGNED_OUT };
  const values = {
    emailEnabled: formData.get("emailEnabled") === "on",
    recipient: String(formData.get("recipient") ?? "").trim().slice(0, 200),
    telegramEnabled: formData.get("telegramEnabled") === "on",
    chatId: String(formData.get("chatId") ?? "").trim().slice(0, 40),
    whatsappEnabled: formData.get("whatsappEnabled") === "on",
    waTo: String(formData.get("waTo") ?? "").trim().replace(/[\s()-]/g, "").slice(0, 20),
    waPhoneNumberId: String(formData.get("waPhoneNumberId") ?? "").trim().slice(0, 30),
    waTemplate: String(formData.get("waTemplate") ?? "").trim().slice(0, 100),
    waLanguage: String(formData.get("waLanguage") ?? "").trim().slice(0, 10),
  };
  const newToken = String(formData.get("botToken") ?? "").trim().slice(0, 200);
  const removeToken = formData.get("removeToken") === "on";
  const newWaToken = String(formData.get("waAccessToken") ?? "").trim().slice(0, 700);
  const removeWaToken = formData.get("removeWaToken") === "on";

  const problem = await confirmIdentity(s, formData);
  if (problem) return { error: `Nothing was saved. ${problem}`, values };

  const errors: Record<string, string> = {};
  if (values.recipient && !emailAddress.safeParse(values.recipient).success) errors.recipient = "Enter a valid email address.";
  if (values.chatId && !telegramChatId.safeParse(values.chatId).success) errors.chatId = "Use the numeric chat ID (for example -1001234567890) or @channelname.";
  if (newToken && !telegramBotToken.safeParse(newToken).success) errors.botToken = "This does not look like a bot token from @BotFather.";
  if (newToken && removeToken) errors.botToken = "Either enter a new token or remove the saved one, not both.";
  if (values.waTo && !whatsappNumber.safeParse(values.waTo).success) errors.waTo = "Use the international format, for example +491701234567.";
  if (values.waPhoneNumberId && !whatsappPhoneNumberId.safeParse(values.waPhoneNumberId).success) errors.waPhoneNumberId = "Use the numeric Phone number ID from Meta (WhatsApp > API setup).";
  if (values.waTemplate && !whatsappTemplate.safeParse(values.waTemplate).success) errors.waTemplate = "Use the template name exactly as in Meta: lowercase letters, digits and underscores.";
  if (values.waLanguage && !whatsappLanguage.safeParse(values.waLanguage).success) errors.waLanguage = "Use a language code such as en or en_US.";
  if (newWaToken && !whatsappAccessToken.safeParse(newWaToken).success) errors.waAccessToken = "This does not look like a Meta access token.";
  if (newWaToken && removeWaToken) errors.waAccessToken = "Either enter a new token or remove the saved one, not both.";
  if (Object.keys(errors).length) return { error: "Nothing was saved. Check the highlighted fields.", errors, values };

  const [current, status] = await Promise.all([readStore("delivery"), readStore("status")]);
  const botToken = removeToken
    ? undefined
    : newToken
      ? { sealed: seal(newToken), savedAt: new Date().toISOString() }
      : current?.telegram.botToken;
  const waToken = removeWaToken
    ? undefined
    : newWaToken
      ? { sealed: seal(newWaToken), savedAt: new Date().toISOString() }
      : current?.whatsapp?.accessToken;
  const whatsapp = {
    enabled: values.whatsappEnabled,
    ...(values.waTo ? { to: values.waTo } : {}),
    ...(values.waPhoneNumberId ? { phoneNumberId: values.waPhoneNumberId } : {}),
    ...(values.waTemplate ? { template: values.waTemplate } : {}),
    ...(values.waLanguage ? { language: values.waLanguage } : {}),
    ...(waToken ? { accessToken: waToken } : {}),
  };
  const whatsappTouched = current?.whatsapp !== undefined || Object.keys(whatsapp).length > 1 || whatsapp.enabled;
  const next: Omit<DeliveryFile, "version" | "revision" | "updatedAt" | "updatedBy"> = {
    email: { enabled: values.emailEnabled, ...(values.recipient ? { recipient: values.recipient } : {}) },
    telegram: { enabled: values.telegramEnabled, ...(values.chatId ? { chatId: values.chatId } : {}), ...(botToken ? { botToken } : {}) },
    ...(whatsappTouched ? { whatsapp } : {}),
  };

  if (values.whatsappEnabled) {
    if (!waToken) errors.whatsappEnabled = "Save a WhatsApp access token first.";
    else if (!values.waPhoneNumberId) errors.whatsappEnabled = "Enter the Phone number ID first.";
    else if (!values.waTo) errors.whatsappEnabled = "Enter the number that should receive enquiries first.";
  }

  if (values.telegramEnabled) {
    const token = newToken || (botToken ? unseal(botToken.sealed) : null);
    if (!telegramAllowed()) {
      errors.telegramEnabled =
        "Telegram can't be switched on yet. The server operator must first confirm the privacy notice, the server's access to Telegram and the configuration, then set TELEGRAM_DELIVERY_ALLOWED=true.";
    } else if (!values.chatId || !botToken) {
      errors.telegramEnabled = "Save a bot token and chat ID first.";
    } else if (newToken || !testMatches(status, token, values.chatId)) {
      errors.telegramEnabled = "Send a successful test message with this token and chat ID first: save them with Telegram off, press Send test message, then switch Telegram on.";
    }
  }
  if (!values.emailEnabled && !values.telegramEnabled && !values.whatsappEnabled) {
    errors.emailEnabled = "At least one channel must be on, or enquiries could not be delivered.";
  }
  if (!Object.keys(errors).length) {
    // Refuse a configuration that can't deliver, e.g. email as the only channel without SMTP on the server.
    const plan = resolvePlan({ ...next, version: 1, revision: 0, updatedAt: "", updatedBy: "" }, process.env, unseal);
    if (plan.mode === "live" && !plan.email.ready && !plan.telegram.ready && !plan.whatsapp.ready) {
      const reasons = [plan.email, plan.telegram, plan.whatsapp].filter((c) => c.enabled && !c.ready).map((c) => (c.ready ? "" : explain(c.problem)));
      errors.emailEnabled = `With these settings no channel could deliver enquiries. ${reasons.join(" ")}`;
    }
  }
  if (Object.keys(errors).length) return { error: "Nothing was saved. Check the highlighted fields.", errors, values };

  const result = await updateStore("delivery", () => next, { by: s.admin.id, baseRevision: Number(formData.get("revision")) });
  if (!result.ok) {
    await audit({ adminId: s.admin.id, action: "delivery.save", outcome: "error", ip: s.ip, detail: result.reason });
    return { error: result.reason === "conflict" ? CONFLICT : "Nothing was saved: the settings store is unavailable.", values };
  }
  await audit({
    adminId: s.admin.id,
    action: "delivery.save",
    outcome: "success",
    ip: s.ip,
    // Which settings changed, never values (and never the token).
    changes: {
      emailEnabled: values.emailEnabled,
      recipientChanged: (current?.email.recipient ?? "") !== values.recipient,
      telegramEnabled: values.telegramEnabled,
      chatIdChanged: (current?.telegram.chatId ?? "") !== values.chatId,
      tokenReplaced: Boolean(newToken),
      tokenRemoved: removeToken && Boolean(current?.telegram.botToken),
      whatsappEnabled: values.whatsappEnabled,
      whatsappNumberChanged: (current?.whatsapp?.to ?? "") !== values.waTo,
      whatsappTokenReplaced: Boolean(newWaToken),
      whatsappTokenRemoved: removeWaToken && Boolean(current?.whatsapp?.accessToken),
    },
  });
  return { ok: "Saved. New enquiries use these channels from now on." };
}

/* ---------- Test messages ---------- */

export type TestState = { result?: string; message?: string; error?: string };

async function test(channel: "email" | "telegram" | "whatsapp", s: Awaited<ReturnType<typeof sessionForAction>>): Promise<TestState> {
  if (!s) return { error: "Your session has ended. Sign in again." };
  const key = `${s.admin.id}:${channel}`;
  if (testSends.blocked(key)) return { error: "Too many test messages. Wait ten minutes and try again." };
  testSends.record(key);
  const result = await runTest(channel, s.admin.id);
  await audit({ adminId: s.admin.id, action: `delivery.test.${channel}`, outcome: result === "confirmed" ? "success" : "error", ip: s.ip, detail: result });
  return { result, message: result === "confirmed" ? "Test message sent. Check that it arrived." : `The test failed: ${explain(result)}` };
}

export async function testEmail(): Promise<TestState> {
  return test("email", await sessionForAction());
}

export async function testTelegram(): Promise<TestState> {
  return test("telegram", await sessionForAction());
}

export async function testWhatsapp(): Promise<TestState> {
  return test("whatsapp", await sessionForAction());
}
