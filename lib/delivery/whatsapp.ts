/**
 * WhatsApp Cloud API client (Meta Graph API `messages`), using fetch: no dependency.
 *
 * The access token travels in a header, and nothing here logs, returns or throws a URL, a response
 * body or an error object: callers get "confirmed" or a short code.
 *
 * With a template name, a template message is sent: the only kind WhatsApp delivers to a number
 * that has not written to the business in the last 24 hours. The enquiry text is the template's one
 * body variable (WhatsApp forbids newlines and long space runs there, so it is flattened, and
 * limited to 1,024 characters). Without a template name, plain text is sent, which works only
 * inside that 24-hour window.
 */

export const WHATSAPP_TIMEOUT_MS = 10_000;
const API = "https://graph.facebook.com/v21.0";
const MAX_PARAM = 1_000;
const MAX_TEXT = 4_000;

/** The API origin. WHATSAPP_API_BASE is honoured only for a loopback address (tests). */
export function whatsappApiBase(env: Record<string, string | undefined> = process.env): string {
  const raw = env.WHATSAPP_API_BASE?.trim();
  if (!raw) return API;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return url.origin;
  } catch {
    // ignored: fall back to the real API
  }
  return API;
}

/** One line, no tabs, no runs of spaces: what a template variable accepts. */
export function flatten(text: string, max = MAX_PARAM): string {
  const one = text.replace(/\s*[\r\n]+\s*/g, " | ").replace(/[\t ]{2,}/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function codeFor(status: number, errorCode: unknown): string {
  if (status === 401 || errorCode === 190) return "whatsapp_unauthorized";
  if (errorCode === 132001) return "whatsapp_template_not_found";
  if (errorCode === 131030) return "whatsapp_recipient_not_allowed";
  if (errorCode === 131047) return "whatsapp_window_closed";
  if (status === 429 || errorCode === 130429 || errorCode === 80007) return "whatsapp_rate_limited";
  if (status === 400 && errorCode === 100) return "whatsapp_bad_request";
  return `whatsapp_error_${status}`;
}

export async function sendWhatsapp(opts: {
  token: string;
  phoneNumberId: string;
  /** Recipient in international format, e.g. +491701234567. */
  to: string;
  text: string;
  template?: string;
  language?: string;
  timeoutMs?: number;
  base?: string;
}): Promise<string> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? WHATSAPP_TIMEOUT_MS);
  const base = opts.base ?? whatsappApiBase();
  const to = opts.to.replace(/^\+/, "");
  const body = opts.template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: opts.template,
          language: { code: opts.language || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: flatten(opts.text) }] }],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: opts.text.slice(0, MAX_TEXT) } };

  let res: Response;
  try {
    res = await fetch(`${base}/${opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  } catch {
    return signal.aborted ? "whatsapp_timeout" : "whatsapp_unreachable";
  }
  let data: { messages?: { id?: unknown }[]; error?: { code?: unknown } } = {};
  try {
    data = await res.json();
  } catch {
    if (signal.aborted) return "whatsapp_timeout";
  }
  if (res.ok && typeof data.messages?.[0]?.id === "string") return "confirmed";
  return codeFor(res.status, data.error?.code);
}
