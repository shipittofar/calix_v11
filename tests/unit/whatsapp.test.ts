import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { flatten, sendWhatsapp, whatsappApiBase } from "@/lib/delivery/whatsapp";
import { resolvePlan } from "@/lib/delivery/plan";
import { deliveryFile } from "@/lib/settings/schema";

async function fake(status: number, body: unknown) {
  const seen: { url?: string; auth?: string; body?: unknown }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, seen, close: () => server.close() };
}

test("WhatsApp: a template message carries the flattened text and the token only in a header", async () => {
  const f = await fake(200, { messages: [{ id: "wamid.1" }] });
  const result = await sendWhatsapp({ token: "T".repeat(40), phoneNumberId: "123456", to: "+491701234567", text: "New enquiry\n\nA  B", template: "new_enquiry", language: "en", base: f.base });
  f.close();
  assert.equal(result, "confirmed");
  assert.equal(f.seen[0].url, "/123456/messages");
  assert.equal(f.seen[0].auth, `Bearer ${"T".repeat(40)}`);
  const body = f.seen[0].body as { to: string; type: string; template: { components: { parameters: { text: string }[] }[] } };
  assert.equal(body.to, "491701234567");
  assert.equal(body.type, "template");
  assert.equal(body.template.components[0].parameters[0].text, "New enquiry | A B");
});

test("WhatsApp: without a template, plain text is sent", async () => {
  const f = await fake(200, { messages: [{ id: "x" }] });
  await sendWhatsapp({ token: "T".repeat(40), phoneNumberId: "1", to: "+491701234567", text: "hello", base: f.base });
  f.close();
  assert.equal((f.seen[0].body as { type: string }).type, "text");
});

test("WhatsApp: provider errors become short codes, never provider text", async () => {
  for (const [status, code, expected] of [
    [401, 190, "whatsapp_unauthorized"],
    [400, 132001, "whatsapp_template_not_found"],
    [400, 131047, "whatsapp_window_closed"],
    [500, 1, "whatsapp_error_500"],
  ] as const) {
    const f = await fake(status, { error: { code, message: "secret detail" } });
    const result = await sendWhatsapp({ token: "T".repeat(40), phoneNumberId: "1", to: "+491701234567", text: "x", base: f.base });
    f.close();
    assert.equal(result, expected);
  }
});

test("WhatsApp: an unreachable server is a code, and the API base is only overridable on loopback", async () => {
  assert.equal(await sendWhatsapp({ token: "T".repeat(40), phoneNumberId: "1", to: "+491701234567", text: "x", base: "http://127.0.0.1:1" }), "whatsapp_unreachable");
  assert.equal(whatsappApiBase({ WHATSAPP_API_BASE: "http://evil.example" }), "https://graph.facebook.com/v21.0");
  assert.equal(flatten("a".repeat(2000)).length, 1000);
});

test("WhatsApp: plan readiness depends on token, sender and recipient", () => {
  const base = { version: 1 as const, revision: 1, updatedAt: "", updatedBy: "", email: { enabled: true }, telegram: { enabled: false } };
  const env = { MAIL_TRANSPORT: "smtp", FORM_SECRET: "x", NODE_ENV: "production" };
  const plan = (whatsapp: unknown) => {
    const file = deliveryFile.parse({ ...base, whatsapp });
    const p = resolvePlan(file, env, () => "tok");
    assert.equal(p.mode, "live");
    return p.mode === "live" ? p.whatsapp : null;
  };
  assert.equal(plan({ enabled: true })?.ready, false);
  assert.equal(plan({ enabled: true, accessToken: { sealed: "s", savedAt: "" }, phoneNumberId: "12345", to: "+491701234567" })?.ready, true);
  assert.equal(plan({ enabled: false, accessToken: { sealed: "s", savedAt: "" }, phoneNumberId: "12345", to: "+491701234567" })?.ready, false);
});
