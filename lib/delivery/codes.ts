/** Plain-language explanations of delivery result codes, for the admin. No provider messages. */
const TEXT: Record<string, string> = {
  confirmed: "Accepted by the provider.",
  disabled: "Switched off.",
  email_rejected: "The mail server refused the message. Check the recipient address and the SMTP account.",
  email_auth_failed: "The mail server rejected the SMTP username or password set on the server.",
  email_deferred: "The mail server asked to try again later.",
  email_unreachable: "The mail server could not be reached.",
  email_timeout: "The mail server did not answer in time.",
  email_error: "Sending failed for an unexpected reason.",
  email_no_recipient: "No recipient address is saved and ENQUIRY_TO is not set on the server.",
  telegram_unauthorized: "Telegram rejected the bot token. Replace the token, then send a test message.",
  telegram_chat_not_found: "Telegram can't find the chat. Check the chat ID and that the bot was added to the chat.",
  telegram_forbidden: "The bot can't post in the chat (it was removed or blocked). Add it back, then send a test message.",
  telegram_rate_limited: "Telegram asked the bot to slow down. Messages will work again shortly.",
  telegram_unreachable: "Telegram could not be reached from the server. The server may block outgoing connections to api.telegram.org.",
  telegram_timeout: "Telegram did not answer in time.",
  telegram_partial: "Only part of a long message reached Telegram.",
  telegram_not_allowed: "Telegram is not allowed on this server yet (TELEGRAM_DELIVERY_ALLOWED is not set).",
  telegram_no_token: "No bot token is saved.",
  telegram_no_chat: "No chat ID is saved.",
  telegram_token_unreadable: "The saved bot token can't be decrypted (the server's encryption key changed). Enter the token again.",
  whatsapp_unauthorized: "WhatsApp rejected the access token (invalid or expired). Replace the token, then send a test message.",
  whatsapp_template_not_found: "WhatsApp can't find the message template. Check its name and language in Meta, and that it is approved.",
  whatsapp_recipient_not_allowed: "The recipient number isn't allowed yet. With a test number, add it to the allowed recipients in Meta first.",
  whatsapp_window_closed: "WhatsApp only accepts plain text within 24 hours of the recipient's last message. Set an approved template name.",
  whatsapp_rate_limited: "WhatsApp asked the server to slow down. Messages will work again shortly.",
  whatsapp_bad_request: "WhatsApp refused the request. Check the Phone number ID, the recipient number and the template settings.",
  whatsapp_unreachable: "WhatsApp could not be reached from the server (graph.facebook.com).",
  whatsapp_timeout: "WhatsApp did not answer in time.",
  whatsapp_no_token: "No WhatsApp access token is saved.",
  whatsapp_no_sender: "No WhatsApp Phone number ID is saved.",
  whatsapp_no_recipient: "No WhatsApp recipient number is saved.",
  whatsapp_token_unreadable: "The saved WhatsApp token can't be decrypted (the server's encryption key changed). Enter the token again.",
  log_transport_in_production: "The server is set to log enquiries instead of sending them (MAIL_TRANSPORT=log). Enquiries are refused.",
  smtp_missing: "The server is missing its SMTP settings (SMTP_HOST, SMTP_USER, SMTP_PASS).",
  log_mode: "This server logs enquiries instead of sending them (development or preview). Nothing was sent.",
  form_secret_missing: "FORM_SECRET is not set on the server. Enquiries are refused.",
};

export function explain(code: string): string {
  if (TEXT[code]) return TEXT[code];
  if (code.startsWith("smtp_missing:")) return `Email is switched on but the server is missing ${code.slice(13).split(",").join(", ")}.`;
  if (code.startsWith("telegram_error_")) return `Telegram answered with an error (HTTP ${code.slice(15)}).`;
  if (code.startsWith("whatsapp_error_")) return `WhatsApp answered with an error (HTTP ${code.slice(15)}).`;
  if (code.endsWith("_timeout")) return "No answer in time.";
  if (code.endsWith("_error")) return "Sending failed for an unexpected reason.";
  return code;
}
