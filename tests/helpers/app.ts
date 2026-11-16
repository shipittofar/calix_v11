/**
 * Starts the production build (`next start`) with a chosen environment, for integration tests.
 * Requires a prior `next build` (`npm run test:integration` does both).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { saveDiagnostic, secretValues } from "./diagnostics";

const root = resolve(import.meta.dirname, "../..");

export function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolvePort(port));
    });
  });
}

export type RunningApp = { base: string; pid: number; stop: () => Promise<void>; output: () => string };

/** Environment variables that tests control explicitly, so the caller's shell can't leak in. */
const CONTROLLED = [
  "MAIL_TRANSPORT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "ENQUIRY_TO",
  "ENQUIRY_FROM",
  "FORM_SECRET",
  "NOINDEX",
  "SITE_URL",
  "SETTINGS_DIR",
  "SESSION_SECRET",
  "SETTINGS_ENCRYPTION_KEY",
  "TRUSTED_PROXY_HEADER",
  "TELEGRAM_API_BASE",
  "TELEGRAM_DELIVERY_ALLOWED",
  "STORY_PREVIEW",
  "SHOW_CONTENT_PLACEHOLDERS",
  "CALIX_FIXTURES",
];

/**
 * Starts the build. By default the on-disk ISR cache (.next/server/route-cache, where Next.js keeps
 * pages it regenerated) is cleared first, as on a fresh deploy; `keepRouteCache` models a restart
 * of the same deployment.
 */
export async function startApp(env: Record<string, string>, port?: number, opts: { keepRouteCache?: boolean } = {}): Promise<RunningApp> {
  if (!opts.keepRouteCache) rmSync(resolve(root, ".next/server/route-cache"), { recursive: true, force: true });
  const p = port ?? (await freePort());
  const base = { ...process.env };
  for (const key of CONTROLLED) delete base[key];
  let out = "";
  const child: ChildProcess = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-p", String(p)], {
    cwd: root,
    env: { ...base, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const url = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url + "/robots.txt");
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`next start exited: ${out}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    base: url,
    pid: child.pid ?? 0,
    output: () => out,
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done();
        child.once("exit", () => done());
        child.kill("SIGTERM");
      }).then(() => saveDiagnostic(`app-${p}.log`, out, secretValues(env))),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A complete, valid enquiry (field names as rendered by the form). */
export const validEnquiry = (company = "Acme Ltd") => ({
  name: "Test Person",
  email: "person@example.com",
  company,
  website: "example.com",
  services: ["web", "seo"],
  goals: "We need a faster website that brings in qualified enquiries.",
  budget: "",
  start: "1-3-months",
  context: "",
});
