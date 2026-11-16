/**
 * A stand-in for the Telegram Bot API (`POST /bot<token>/sendMessage`), for tests. Records what it
 * received; `mode` switches between accepting and the failures the client must map to codes.
 * The app reaches it through TELEGRAM_API_BASE, which the app accepts only for loopback addresses.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export type TelegramMessage = { token: string; chat_id: unknown; text: string; body: Record<string, unknown> };
export type TelegramMode = "accept" | "unauthorized" | "chat_not_found" | "forbidden" | "rate_limited" | "server_error" | "hang";

export class FakeTelegram {
  messages: TelegramMessage[] = [];
  requests = 0;
  mode: TelegramMode = "accept";
  port = 0;
  private server: Server;
  private sockets = new Set<Socket>();
  private nextId = 1;

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
  }

  get base() {
    return `http://127.0.0.1:${this.port}`;
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(this.port);
      });
    });
  }

  stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  reset(mode: TelegramMode = "accept") {
    this.messages = [];
    this.requests = 0;
    this.mode = mode;
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      this.requests++;
      const m = req.url?.match(/^\/bot([^/]+)\/sendMessage$/);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST" || !m) return json(404, { ok: false, error_code: 404, description: "Not Found" });
      if (this.mode === "hang") return; // never answers: the client must time out
      if (this.mode === "unauthorized") return json(401, { ok: false, error_code: 401, description: "Unauthorized" });
      if (this.mode === "chat_not_found") return json(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" });
      if (this.mode === "forbidden") return json(403, { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the group chat" });
      if (this.mode === "rate_limited")
        return json(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } });
      if (this.mode === "server_error") return json(502, { ok: false, error_code: 502, description: "Bad Gateway" });
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { ok: false, error_code: 400, description: "Bad Request: invalid JSON" });
      }
      this.messages.push({ token: decodeURIComponent(m[1]), chat_id: body.chat_id, text: String(body.text ?? ""), body });
      json(200, { ok: true, result: { message_id: this.nextId++, date: Math.floor(Date.now() / 1000), text: body.text } });
    });
  }
}
