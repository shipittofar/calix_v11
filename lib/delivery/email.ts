/**
 * Email channel: SMTP through nodemailer (already a dependency). "confirmed" means the SMTP server
 * accepted the message (it then delivers it to the mailbox), not that it reached an inbox.
 * Never throws; failures are short codes, never server responses or credentials.
 */
import nodemailer from "nodemailer";

export const EMAIL_TIMEOUT_MS = 15_000;

export type Smtp = { host: string; port: number; user: string; pass: string; from: string };
export type EmailMessage = { to: string; subject: string; text: string; replyTo?: string };

/** SMTP settings from the environment. Lists missing variable names, never values. */
export function smtpFromEnv(env: Record<string, string | undefined> = process.env): { ok: true; smtp: Smtp } | { ok: false; missing: string[] } {
  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !env[k]);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    smtp: {
      host: env.SMTP_HOST!,
      port: Number(env.SMTP_PORT ?? 587),
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!,
      from: env.ENQUIRY_FROM || env.SMTP_USER!,
    },
  };
}

function codeFor(error: unknown): string {
  const e = error as { code?: string; responseCode?: number };
  if (e?.code === "EAUTH") return "email_auth_failed";
  if (e?.code === "EENVELOPE" || (typeof e?.responseCode === "number" && e.responseCode >= 500)) return "email_rejected";
  if (typeof e?.responseCode === "number" && e.responseCode >= 400) return "email_deferred";
  if (["ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED", "ENOTFOUND"].includes(e?.code ?? "")) return "email_unreachable";
  if (e?.code === "ETIMEDOUT") return "email_timeout";
  return "email_error";
}

export async function sendEmail(smtp: Smtp, message: EmailMessage, timeoutMs = EMAIL_TIMEOUT_MS): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: Math.min(10_000, timeoutMs),
    greetingTimeout: Math.min(10_000, timeoutMs),
    socketTimeout: timeoutMs,
  });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("email_timeout"), timeoutMs);
  });
  const send = transporter
    .sendMail({ from: smtp.from, to: message.to, replyTo: message.replyTo, subject: message.subject, text: message.text })
    .then(
      (info) => (info.accepted?.length ? "confirmed" : "email_rejected"),
      (error: unknown) => codeFor(error),
    );
  try {
    return await Promise.race([send, deadline]);
  } finally {
    clearTimeout(timer);
    transporter.close();
  }
}
