/**
 * A tiny SMTP server for tests: accepts AUTH PLAIN/LOGIN and records messages. `mode` switches
 * between accepting, rejecting the message (554 after DATA) and hanging (no reply, for timeouts).
 */
import { createServer, type Server, type Socket } from "node:net";

export type SmtpMessage = { from: string; to: string[]; data: string };
export type SmtpMode = "accept" | "reject" | "hang";

export class FakeSmtp {
  messages: SmtpMessage[] = [];
  mode: SmtpMode = "accept";
  port = 0;
  private server: Server;
  private sockets = new Set<Socket>();

  constructor() {
    this.server = createServer((socket) => this.session(socket));
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

  private session(socket: Socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
    const send = (line: string) => socket.write(`${line}\r\n`);
    let buffer = "";
    let inData = false;
    let authStep: "none" | "login-user" | "login-pass" = "none";
    let current: SmtpMessage = { from: "", to: [], data: "" };
    send("220 fake-smtp ready");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          if (this.mode === "hang") return;
          if (this.mode === "reject") {
            send("554 5.7.1 Message rejected");
          } else {
            this.messages.push(current);
            send("250 2.0.0 OK queued");
          }
          current = { from: "", to: [], data: "" };
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const cmd = line.toUpperCase();
        if (authStep === "login-user") {
          authStep = "login-pass";
          send("334 UGFzc3dvcmQ6");
        } else if (authStep === "login-pass") {
          authStep = "none";
          send("235 2.7.0 Authentication successful");
        } else if (cmd.startsWith("EHLO")) {
          socket.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        } else if (cmd.startsWith("HELO")) {
          send("250 fake-smtp");
        } else if (cmd.startsWith("AUTH PLAIN")) {
          send("235 2.7.0 Authentication successful");
        } else if (cmd.startsWith("AUTH LOGIN")) {
          authStep = "login-user";
          send("334 VXNlcm5hbWU6");
        } else if (cmd.startsWith("MAIL FROM")) {
          current.from = line.slice(10).trim();
          send("250 OK");
        } else if (cmd.startsWith("RCPT TO")) {
          current.to.push(line.slice(8).trim());
          send("250 OK");
        } else if (cmd === "DATA") {
          inData = true;
          send("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "QUIT") {
          send("221 Bye");
          socket.end();
        } else if (cmd === "RSET" || cmd === "NOOP") {
          send("250 OK");
        } else {
          send("502 Command not implemented");
        }
      }
    });
  }
}

/** Header value from a raw message. */
export function header(data: string, name: string) {
  const m = data.match(new RegExp(`^${name}:\\s*(.*)$`, "mi"));
  return m?.[1].trim();
}

/** Decoded plain-text body (nodemailer may use quoted-printable). */
export function body(data: string) {
  const split = data.indexOf("\r\n\r\n");
  const raw = data.slice(split + 4);
  if (/content-transfer-encoding:\s*quoted-printable/i.test(data)) {
    return raw
      .replace(/=\r\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
  return raw;
}
