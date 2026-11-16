/**
 * Telegram Bot API client (`sendMessage`), using fetch: no dependency.
 *
 * The bot token is part of the request URL, so nothing here ever logs, returns or throws the URL,
 * a response body or an error object: callers get "confirmed" or a short code. Messages are plain
 * text (no `parse_mode`), so visitor input cannot add formatting or links, and link previews are off.
 */

export const TELEGRAM_TIMEOUT_MS = 10_000;
const API = "https://api.telegram.org";
const MAX_CHARS = 4_000; // Telegram's limit is 4096
const MAX_PARTS = 3;
const SHORTENED = "\n[message shortened]";

/** The API origin. TELEGRAM_API_BASE is honoured only for a loopback address (tests). */
export function telegramApiBase(env: Record<string, string | undefined> = process.env): string {
  const raw = env.TELEGRAM_API_BASE?.trim();
  if (!raw) return API;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/") {
      return url.origin;
    }
  } catch {
    // ignored: fall back to the real API
  }
  return API;
}

/** Splits text into at most three parts of at most 4,000 characters, labelled "(1/3) ". */
export function chunkMessage(text: string): string[] {
  const label = 6; // "(1/3) "
  if (text.length <= MAX_CHARS) return [text];
  const size = MAX_CHARS - label;
  let body = text;
  if (body.length > size * MAX_PARTS) body = body.slice(0, size * MAX_PARTS - SHORTENED.length) + SHORTENED;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += size) parts.push(body.slice(i, i + size));
  return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}

function codeFor(status: number, description: string): string {
  if (status === 401) return "telegram_unauthorized";
  if (status === 403) return "telegram_forbidden";
  if (status === 429) return "telegram_rate_limited";
  if (status === 400 && /chat not found/i.test(description)) return "telegram_chat_not_found";
  return `telegram_error_${status}`;
}

async function sendOne(base: string, token: string, chatId: string, text: string, signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal,
      redirect: "error",
    });
  } catch {
    return signal.aborted ? "telegram_timeout" : "telegram_unreachable";
  }
  let data: { ok?: boolean; result?: { message_id?: unknown }; description?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    if (signal.aborted) return "telegram_timeout";
  }
  if (res.ok && data.ok === true && data.result?.message_id !== undefined) return "confirmed";
  return codeFor(res.status, typeof data.description === "string" ? data.description : "");
}

/**
 * Sends `text` (split if long). Confirmed only when every part is confirmed; one deadline covers
 * all parts. Never throws.
 */
export async function sendTelegram(opts: {
  token: string;
  chatId: string;
  text: string;
  timeoutMs?: number;
  base?: string;
}): Promise<string> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
  const base = opts.base ?? telegramApiBase();
  const parts = chunkMessage(opts.text);
  for (let i = 0; i < parts.length; i++) {
    const result = await sendOne(base, opts.token, opts.chatId, parts[i], signal);
    if (result !== "confirmed") return i > 0 && result !== "telegram_timeout" ? "telegram_partial" : result;
  }
  return "confirmed";
}
