import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Password hashing with scrypt (N=2^15, r=8, p=1), and the password policy. */

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const key = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  const expected = Buffer.from(hash, "base64");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

/** A hash used to keep timing similar when the account doesn't exist. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

const COMMON = new Set([
  "password1234",
  "passwordpassword",
  "123456789012",
  "qwertyuiopas",
  "calixcalix12",
  "letmeinletmein",
  "administrator",
  "changemechangeme",
]);

/** Returns a problem, or null when acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common.";
  if (lower.includes(email.split("@")[0].toLowerCase())) return "Don't include your email name in the password.";
  if (new Set(password).size < 5) return "Use a less repetitive password.";
  return null;
}

/** Recovery codes: 10 random characters each, shown once, stored as SHA-256 hashes. */
export function generateRecoveryCodes(count = 8): { codes: string[]; hashes: string[] } {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(code.trim().toLowerCase().replace(/\s+/g, "")).digest("base64url");
