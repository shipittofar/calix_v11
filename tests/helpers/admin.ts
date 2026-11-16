/**
 * Admin test fixtures: a private settings store, the operator CLI, and a signed-in browser.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "./http";
import { currentStep, totpAt } from "@/lib/admin/totp";

const root = resolve(import.meta.dirname, "../..");
export const EMAIL = "owner@example.com";
export const PASSWORD = "correct horse battery staple";

export function adminEnv() {
  const dir = mkdtempSync(join(tmpdir(), "calix-admin-"));
  return {
    dir,
    env: {
      SETTINGS_DIR: dir,
      SESSION_SECRET: randomBytes(32).toString("base64url"),
      SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      TRUSTED_PROXY_HEADER: "x-real-ip",
      FORM_SECRET: "test-form-secret",
    },
  };
}

export function cli(env: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "./scripts/register-ts.mjs", "scripts/admin-user.mts", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    input: `${PASSWORD}\n${PASSWORD}\n`,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

export const readJson = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

let n = 0;
export const browser = (base: string) => new Client(base, { "x-real-ip": `198.51.100.${++n}` });

/** First sign-in for a CLI-created account: password, then authenticator enrolment. */
export async function enrolAndSignIn(base: string) {
  const c = browser(base);
  const r = await c.submit("/admin/login", { email: EMAIL, password: PASSWORD });
  assert.equal(r.location, "/admin/login?step=enrol");
  const page = await c.get("/admin/login?step=enrol");
  const m = page.html.match(/<code class="admin-secret">([A-Z2-7 ]+)<\/code>/);
  assert.ok(m, "setup key shown");
  const secret = m[1].replace(/ /g, "");
  const ok = await c.submit("/admin/login?step=enrol", { code: totpAt(secret, currentStep()) }, { html: page.html });
  assert.equal(ok.res.status, 200);
  const recoveryCodes = [...ok.html.matchAll(/<code>([a-z0-9]{5}-[a-z0-9]{5})<\/code>/g)].map((x) => x[1]);
  assert.ok(c.cookies.has("__Host-calix_admin"));
  return { client: c, secret, recoveryCodes, nextCode: codeSource(secret, currentStep()) };
}

/**
 * Fresh authenticator codes for re-authentication. Each code can be used once and the server
 * accepts at most one step ahead, so this waits for the next 30-second step when needed.
 */
export function codeSource(secret: string, lastUsed: number) {
  let last = lastUsed;
  return async () => {
    const step = Math.max(last + 1, currentStep());
    while (step > currentStep() + 1) await new Promise((r) => setTimeout(r, 500));
    last = step;
    return totpAt(secret, step);
  };
}
