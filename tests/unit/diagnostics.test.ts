// CI failure diagnostics never contain secret values, and are written only when asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, saveDiagnostic, secretValues } from "../helpers/diagnostics";

test("secret values are replaced, and only secret-like variables are treated as secrets", () => {
  const env = { SESSION_SECRET: "s".repeat(40), SETTINGS_ENCRYPTION_KEY: "k".repeat(44), SMTP_PASS: "smtp-password", SETTINGS_DIR: "/srv/calix/settings", PORT: "3000" };
  const values = secretValues(env);
  assert.deepEqual(values.sort(), [env.SESSION_SECRET, env.SETTINGS_ENCRYPTION_KEY, env.SMTP_PASS].sort());
  const text = `start ${env.SESSION_SECRET} key=${env.SETTINGS_ENCRYPTION_KEY} pass=${env.SMTP_PASS} dir=${env.SETTINGS_DIR}`;
  assert.equal(redact(text, values), "start [redacted] key=[redacted] pass=[redacted] dir=/srv/calix/settings");
});

test("nothing is written unless CALIX_DIAGNOSTICS_DIR is set; files are private", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "calix-diag-")), "out");
  delete process.env.CALIX_DIAGNOSTICS_DIR;
  saveDiagnostic("app.log", "hello", []);
  process.env.CALIX_DIAGNOSTICS_DIR = dir;
  saveDiagnostic("app 1/../x.log", "token=abcdefghij", ["abcdefghij"]);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{3}-app_1_.._x\.log$/, "no path separators in the name");
  assert.equal(readFileSync(join(dir, files[0]), "utf8"), "token=[redacted]");
  assert.equal(statSync(join(dir, files[0])).mode & 0o777, 0o600);
  delete process.env.CALIX_DIAGNOSTICS_DIR;
});
