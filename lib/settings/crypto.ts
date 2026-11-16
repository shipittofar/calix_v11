import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Encryption at rest for secrets in the settings files (the Telegram bot token, TOTP secrets).
 * AES-256-GCM, format `v1:<iv>:<tag>:<ciphertext>` (base64): a random 12-byte IV and a full
 * 16-byte authentication tag; anything else is refused. The key is SETTINGS_ENCRYPTION_KEY
 * (32 bytes, base64), held in the environment, never in the files. Decryption fails closed
 * (returns null) and never changes stored data.
 *
 * Key rotation (docs/admin-panel-runbook.md §4): set the new key, keep the old one in
 * SETTINGS_ENCRYPTION_KEY_PREVIOUS (read only), run `admin-user rekey`, then remove the old key.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

function parseKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function encryptionKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

function previousKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY_PREVIOUS);
}

export function seal(plaintext: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is missing or invalid");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function open(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Which key opened a sealed value, for `rekey`; null when none can. */
export function unsealWith(sealed: string): { plaintext: string; key: "current" | "previous" } | null {
  const fields = sealed.split(":");
  if (fields.length !== 4) return null;
  const [v, ivText, tagText, ctText] = fields;
  if (v !== "v1" || ![ivText, tagText, ctText].every((f) => BASE64.test(f))) return null;
  const iv = Buffer.from(ivText, "base64");
  const tag = Buffer.from(tagText, "base64");
  const ct = Buffer.from(ctText, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  const current = encryptionKey();
  const fromCurrent = current ? open(current, iv, tag, ct) : null;
  if (fromCurrent !== null) return { plaintext: fromCurrent, key: "current" };
  const previous = previousKey();
  const fromPrevious = previous ? open(previous, iv, tag, ct) : null;
  return fromPrevious !== null ? { plaintext: fromPrevious, key: "previous" } : null;
}

export function unseal(sealed: string): string | null {
  return unsealWith(sealed)?.plaintext ?? null;
}

/**
 * A keyed fingerprint (never reversible), e.g. to bind a test result to a token and chat.
 * Unchanged from the first version so stored test results stay valid. It changes when the key is
 * rotated, so a Telegram test must be repeated after a rotation.
 */
export function fingerprint(...parts: string[]): string {
  const key = encryptionKey();
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is missing or invalid");
  return createHmac("sha256", key).update(parts.join("\u0000")).digest("base64url").slice(0, 32);
}
