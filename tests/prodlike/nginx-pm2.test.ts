/**
 * Production-like check: the built site run by PM2 (deploy/ecosystem.config.cjs, one fork-mode
 * process) behind Nginx (deploy/nginx/calix-proxy.conf), both used unchanged apart from the
 * ports. Needs `nginx` and `pm2` on the PATH and a prior `next build` (`npm run test:prodlike`).
 *
 * This shows the documented configuration behaves as the runbook says on this machine. It does
 * NOT show that the real server is configured this way: the runbook's server checks do that.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Client, textOf } from "../helpers/http";
import { FakeSmtp } from "../helpers/fake-smtp";
import { freePort, sleep, validEnquiry } from "../helpers/app";
import { PASSWORD, cli, enrolAndSignIn } from "../helpers/admin";
import { requiredOrSkip } from "../helpers/browser";
import { saveDiagnostic } from "../helpers/diagnostics";

const root = resolve(import.meta.dirname, "../..");
const has = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const available = has("nginx") && has("pm2") && existsSync(join(root, ".next/BUILD_ID"));

const work = mkdtempSync(join(tmpdir(), "calix-prodlike-"));
const settingsDir = join(work, "settings");
const pm2Home = join(work, "pm2");
const ngx = join(work, "nginx");
const backups = join(work, "backups");
const APP = `calix-test-${process.pid}`;
const secrets = {
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  FORM_SECRET: randomBytes(32).toString("hex"),
};
/** Every secret value used in this run, including ones rotated away (kept out of diagnostics). */
const usedSecrets = new Set(Object.values(secrets));
const smtp = new FakeSmtp();
let appPort = 0;
let webPort = 0;
let base = "";
let env: Record<string, string> = {};

const pm2 = (...args: string[]) => pm2With({}, ...args);
const pm2With = (extra: Record<string, string>, ...args: string[]) =>
  execFileSync("pm2", args, {
    env: { ...process.env, PM2_HOME: pm2Home, CALIX_ENV_FILE: join(work, "calix.env"), CALIX_PORT: String(appPort), CALIX_APP_NAME: APP, ...extra },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
type Pm2Proc = { name: string; pid: number; pm2_env: { status: string; restart_time: number; exec_mode: string; instances: number } };
const proc = (): Pm2Proc => (JSON.parse(pm2("jlist")) as Pm2Proc[]).find((p) => p.name === APP)!;

async function waitUp(ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${base}/robots.txt`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error("site did not come up through Nginx");
}

/** A visitor whose request carries forged address headers; Nginx must overwrite them. */
const spoofing = (ip: string) => new Client(base, { "x-real-ip": ip, "x-forwarded-for": ip });

function startNginx() {
  mkdirSync(ngx, { recursive: true });
  const snippet = readFileSync(join(root, "deploy/nginx/calix-proxy.conf"), "utf8").replace("http://127.0.0.1:3000", `http://127.0.0.1:${appPort}`);
  writeFileSync(join(ngx, "calix-proxy.conf"), snippet);
  const user = process.getuid?.() === 0 ? "user root;\n" : "";
  writeFileSync(
    join(ngx, "nginx.conf"),
    `${user}worker_processes 1;
pid ${ngx}/nginx.pid;
error_log ${ngx}/error.log;
events {}
http {
  access_log ${ngx}/access.log;
  client_body_temp_path ${ngx}/body; proxy_temp_path ${ngx}/proxy;
  fastcgi_temp_path ${ngx}/fcgi; uwsgi_temp_path ${ngx}/uwsgi; scgi_temp_path ${ngx}/scgi;
  server {
    listen 127.0.0.1:${webPort};
    server_name localhost;
    include ${ngx}/calix-proxy.conf;
  }
}
`,
  );
  execFileSync("nginx", ["-t", "-p", ngx, "-c", join(ngx, "nginx.conf")], { stdio: "pipe" });
  execFileSync("nginx", ["-p", ngx, "-c", join(ngx, "nginx.conf")], { stdio: "pipe" });
}

let admin: Client;
let nextCode: () => Promise<string>;

const mode = requiredOrSkip(available, "CALIX_REQUIRE_PRODLIKE", "nginx, pm2 or a production build is missing");

describe("PM2 + Nginx production-like run", { skip: mode.skip }, () => {
  if ("missing" in mode) {
    test("required production-like tests can run", () => assert.fail(`CALIX_REQUIRE_PRODLIKE=1 but ${mode.missing}`));
    return;
  }
  before(async () => {
    appPort = await freePort();
    webPort = await freePort();
    base = `http://127.0.0.1:${webPort}`;
    mkdirSync(settingsDir, { mode: 0o700 });
    chmodSync(settingsDir, 0o700);
    const smtpPort = await smtp.start();
    env = {
      SETTINGS_DIR: settingsDir,
      ...secrets,
      TRUSTED_PROXY_HEADER: "x-real-ip",
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_USER: "user",
      SMTP_PASS: "smtp-pass-not-real",
      ENQUIRY_TO: "enquiries@example.com",
    };
    writeFileSync(join(work, "calix.env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
    cli(env, "add", "owner@example.com");
    rmSync(join(root, ".next/server/route-cache"), { recursive: true, force: true });
    pm2("start", join(root, "deploy/ecosystem.config.cjs"));
    startNginx();
    await waitUp();
    const signedIn = await enrolAndSignIn(base);
    admin = signedIn.client;
    nextCode = signedIn.nextCode;
  });

  after(async () => {
    try {
      pm2("kill");
    } catch {
      // already stopped
    }
    try {
      execFileSync("nginx", ["-p", ngx, "-c", join(ngx, "nginx.conf"), "-s", "stop"], { stdio: "pipe" });
    } catch {
      // not running
    }
    await smtp.stop();
    // Logs only (never the settings folder or the environment file), secrets replaced.
    const hidden = [...usedSecrets, env.SMTP_PASS ?? ""];
    for (const f of ["error.log", "access.log"]) if (existsSync(join(ngx, f))) saveDiagnostic(`nginx-${f}`, readFileSync(join(ngx, f), "utf8"), hidden);
    const logs = join(pm2Home, "logs");
    if (existsSync(logs)) for (const f of readdirSync(logs)) saveDiagnostic(`pm2-${f}`, readFileSync(join(logs, f), "utf8"), hidden);
    rmSync(work, { recursive: true, force: true });
  });

  test("PM2 runs exactly one fork-mode process, listening on 127.0.0.1 only", () => {
    const p = proc();
    assert.equal(p.pm2_env.status, "online");
    assert.equal(p.pm2_env.exec_mode, "fork_mode");
    assert.equal(p.pm2_env.instances, 1);
    const listening = execFileSync("ss", ["-ltnH"], { encoding: "utf8" });
    assert.match(listening, new RegExp(`127\\.0\\.0\\.1:${appPort}\\b`));
    assert.doesNotMatch(listening, new RegExp(`(0\\.0\\.0\\.0|\\*|\\[::\\]):${appPort}\\b`));
  });

  test("the status page sees PM2 fork mode and the address Nginx reports, not a forged one", async () => {
    const c = spoofing("6.6.6.6");
    c.cookies = new Map(admin.cookies);
    const { res, html } = await c.get("/admin/status");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, "admin pages are not cacheable");
    const text = textOf(html);
    assert.match(text, /Process manager OK PM2, one process in fork mode, as required\./);
    assert.match(text, /Read from x-real-ip\. Your address as seen now: 127\.0\.0\.1\./);
    assert.doesNotMatch(text, /6\.6\.6\.6/);
    for (const v of Object.values(secrets)) assert.ok(!html.includes(v), "a secret appears on the status page");
    assert.ok(!html.includes(settingsDir), "the settings path appears on the status page");
  });

  test("a second process using the same settings is reported on the status page", async () => {
    const second = `${APP}-second`;
    const port = await freePort();
    pm2With({ CALIX_APP_NAME: second, CALIX_PORT: String(port) }, "start", join(root, "deploy/ecosystem.config.cjs"));
    try {
      const end = Date.now() + 30_000;
      let text = "";
      while (Date.now() < end) {
        text = textOf((await admin.get("/admin/status")).html);
        if (/2 running processes use this settings folder/.test(text)) break;
        await sleep(500);
      }
      assert.match(text, /Processes using these settings Problem 2 running processes use this settings folder\./);
    } finally {
      pm2("delete", second);
    }
    // Its heartbeat goes once it has stopped.
    assert.match(textOf((await admin.get("/admin/status")).html), /Processes using these settings OK One\./);
  });

  test("forged address headers can't get round the enquiry rate limit", async () => {
    const forms = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const c = spoofing(`198.18.0.${i + 1}`);
        return { c, html: (await c.get("/contact")).html };
      }),
    );
    await sleep(3_100);
    const outcomes: string[] = [];
    for (const [i, f] of forms.entries()) {
      const r = await f.c.submit("/contact", validEnquiry(`Spoof ${i} Ltd`), { html: f.html });
      outcomes.push(r.res.status === 303 ? "sent" : /Too many enquiries/.test(textOf(r.html)) ? "limited" : `other ${r.res.status}`);
    }
    assert.deepEqual(outcomes, ["sent", "sent", "sent", "sent", "sent", "limited"]);
  });

  async function saveReplyTime(value: string) {
    const page = await admin.get("/admin");
    const fields = Object.fromEntries(
      [...page.html.matchAll(/<input[^>]*\bname="([^"$]+)"[^>]*>/g)]
        .filter((m) => !/type="hidden"/.test(m[0]))
        .map((m) => [m[1], (m[0].match(/\bvalue="([^"]*)"/) ?? [])[1] ?? ""]),
    );
    for (const m of page.html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) {
      fields[m[1]] = (m[0].match(/<option value="([^"]*)" selected=""/) ?? [])[1] ?? "";
    }
    const r = await admin.submit("/admin", { ...fields, replyTime: value }, { index: 1, html: page.html });
    assert.match(textOf(r.html), /Saved\./);
  }
  const shows = async (path: string) => textOf((await new Client(base).get(path)).html);

  test("a saved setting appears through Nginx at once, on every page, with no rebuild", async () => {
    await saveReplyTime("one working day");
    assert.match(await shows("/"), /We reply within one working day\./);
    assert.match(await shows("/services"), /We reply within one working day with next steps\./);
    assert.match(await shows("/contact/thank-you"), /We will reply within one working day/);
    const res = await fetch(`${base}/`);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=300/, "pages refresh themselves at most 5 minutes later");
  });

  test("a PM2 restart keeps settings and the admin session", async () => {
    const before = proc().pid;
    pm2("restart", APP);
    await waitUp();
    assert.notEqual(proc().pid, before);
    assert.match(await shows("/"), /We reply within one working day\./);
    assert.equal((await admin.get("/admin")).res.status, 200, "still signed in");
  });

  test("a crashed process is restarted by PM2 and serves the saved settings", async () => {
    const p = proc();
    process.kill(p.pid, "SIGKILL");
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
      const now = proc();
      if (now.pm2_env.status === "online" && now.pid !== p.pid) break;
      await sleep(250);
    }
    await waitUp();
    assert.ok(proc().pm2_env.restart_time > p.pm2_env.restart_time);
    assert.match(await shows("/services"), /one working day/);
  });

  test("backup and restore follow the runbook; Refresh public pages shows the restored values", async () => {
    const archive = execFileSync(join(root, "deploy/backup-settings.sh"), [settingsDir, backups], { encoding: "utf8" }).trim();
    assert.equal((readFileSync(archive).length > 0), true);
    assert.equal(execFileSync("stat", ["-c", "%a", archive], { encoding: "utf8" }).trim(), "600");

    await saveReplyTime("two weeks");
    assert.match(await shows("/"), /We reply within two weeks\./);

    // Runbook §5: stop, `admin-user restore`, change SESSION_SECRET in the environment file, start.
    pm2("stop", APP);
    const restored = execFileSync(
      process.execPath,
      ["--env-file", join(work, "calix.env"), "--import", "./scripts/register-ts.mjs", "scripts/admin-user.mts", "restore", archive],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" } },
    );
    assert.match(restored, /Next: change SESSION_SECRET/);
    const oldSecret = secrets.SESSION_SECRET;
    secrets.SESSION_SECRET = randomBytes(32).toString("base64url");
    env.SESSION_SECRET = secrets.SESSION_SECRET;
    usedSecrets.add(secrets.SESSION_SECRET);
    writeFileSync(join(work, "calix.env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
    pm2("start", APP);
    await waitUp();

    // The session from before the restore no longer works; sign in again.
    assert.equal((await admin.get("/admin")).res.status === 200, false, "old session refused after the restore");
    assert.ok(!pm2("jlist").includes(secrets.SESSION_SECRET) && !pm2("jlist").includes(oldSecret), "secrets stay out of PM2");
    const c = new Client(base);
    await c.submit("/admin/login", { email: "owner@example.com", password: PASSWORD });
    const codePage = await c.get("/admin/login?step=code");
    const signedIn = await c.submit("/admin/login?step=code", { code: await nextCode() }, { html: codePage.html });
    assert.equal(signedIn.location, "/admin");
    admin = c;
    assert.match(textOf((await admin.get("/admin/status")).html), /Last restore from a backup Info .* SESSION_SECRET has been changed since\./);

    // Pages regenerated before the restore are still on disk (.next/server/route-cache).
    assert.match(await shows("/"), /two weeks/, "stale until refreshed (runbook §5)");
    const page = await admin.get("/admin/status");
    const r = await admin.submit("/admin/status", {}, { index: 1, html: page.html });
    assert.match(textOf(r.html), /Every public page shows the current settings on its next visit\./);
    assert.match(await shows("/"), /We reply within one working day\./);
    assert.match(await shows("/services"), /We reply within one working day with next steps\./);
    assert.match(await shows("/contact/thank-you"), /We will reply within one working day/);
    const res = await fetch(`${base}/`);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage=300/, "pages refresh themselves at most 5 minutes later");
  });

  test("a PM2 restart keeps settings and the admin session", async () => {
    const before = proc().pid;
    pm2("restart", APP);
    await waitUp();
    assert.notEqual(proc().pid, before);
    assert.match(await shows("/"), /We reply within one working day\./);
    assert.equal((await admin.get("/admin")).res.status, 200, "still signed in");
  });

  test("a crashed process is restarted by PM2 and serves the saved settings", async () => {
    const p = proc();
    process.kill(p.pid, "SIGKILL");
    const end = Date.now() + 30_000;
    while (Date.now() < end) {
      const now = proc();
      if (now.pm2_env.status === "online" && now.pid !== p.pid) break;
      await sleep(250);
    }
    await waitUp();
    assert.ok(proc().pm2_env.restart_time > p.pm2_env.restart_time);
    assert.match(await shows("/services"), /one working day/);
  });

  test("backup and restore follow the runbook; Refresh public pages shows the restored values", async () => {
    const archive = execFileSync(join(root, "deploy/backup-settings.sh"), [settingsDir, backups], { encoding: "utf8" }).trim();
    assert.equal((readFileSync(archive).length > 0), true);
    assert.equal(execFileSync("stat", ["-c", "%a", archive], { encoding: "utf8" }).trim(), "600");

    await saveReplyTime("two weeks");
    assert.match(await shows("/"), /We reply within two weeks\./);

    // Runbook §5: stop, move the current files aside, unpack, fix ownership and modes, start.
    pm2("stop", APP);
    renameSync(settingsDir, `${settingsDir}.before-restore`);
    mkdirSync(settingsDir, { mode: 0o700 });
    execFileSync("tar", ["-C", settingsDir, "-xzf", archive]);
    for (const f of readdirSync(settingsDir)) chmodSync(join(settingsDir, f), 0o600);
    chmodSync(settingsDir, 0o700);
    pm2("start", APP);
    await waitUp();

    // Pages regenerated before the restore are still on disk (.next/server/route-cache).
    assert.match(await shows("/"), /two weeks/, "stale until refreshed (runbook §5)");
    const page = await admin.get("/admin/status");
    const r = await admin.submit("/admin/status", {}, { index: 1, html: page.html });
    assert.match(textOf(r.html), /Every public page shows the current settings on its next visit\./);
    assert.match(await shows("/"), /We reply within one working day\./);
    assert.match(await shows("/services"), /one working day/);
  });

  test("logs hold no secrets or enquiry contents; the activity log is intact", async () => {
    const logs = [
      ...readdirSync(join(pm2Home, "logs")).map((f) => join(pm2Home, "logs", f)),
      join(ngx, "access.log"),
      join(ngx, "error.log"),
    ].map((f) => readFileSync(f, "utf8"));
    const all = logs.join("\n");
    assert.ok(all.length > 0);
    for (const v of [...Object.values(secrets), PASSWORD, "smtp-pass-not-real", "person@example.com", "Spoof 0 Ltd", "We need a faster website"]) {
      assert.ok(!all.includes(v), `found a secret or enquiry content in the logs: ${v.slice(0, 3)}…`);
    }
    process.env.SETTINGS_DIR = settingsDir;
    const { verifyAuditChain } = await import("@/lib/admin/audit");
    const chain = await verifyAuditChain();
    assert.equal(chain.ok, true);
    // Secrets are read by Node from the env file, so PM2's view of the process never holds them.
    const jlist = pm2("jlist");
    for (const v of [...Object.values(secrets), "smtp-pass-not-real"]) assert.ok(!jlist.includes(v), "a secret is in PM2's process list");
  });
});
