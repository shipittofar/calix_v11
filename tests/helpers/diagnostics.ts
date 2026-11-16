/**
 * Failure diagnostics for CI. When CALIX_DIAGNOSTICS_DIR is set, test helpers save logs there
 * (app output, Nginx and PM2 logs); the workflow uploads the folder only when a job fails.
 * Every value of a secret-like variable is replaced before writing. Settings files are never saved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let n = 0;

/** Values of variables whose names look secret (SESSION_SECRET, *_KEY, *_PASS, *_TOKEN…). */
export const secretValues = (env: Record<string, string | undefined>) =>
  Object.entries(env)
    .filter(([k, v]) => /SECRET|KEY|PASS|TOKEN/i.test(k) && typeof v === "string" && v.length >= 8)
    .map(([, v]) => v as string);

export function redact(text: string, secrets: string[]) {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) if (s.length >= 8) out = out.split(s).join("[redacted]");
  return out;
}

export function saveDiagnostic(name: string, text: string, secrets: string[]) {
  const dir = process.env.CALIX_DIAGNOSTICS_DIR;
  if (!dir || !text) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${String(++n).padStart(3, "0")}-${name.replace(/[^\w.-]/g, "_")}`), redact(text, secrets), { mode: 0o600 });
}
