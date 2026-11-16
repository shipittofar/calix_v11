import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "@/lib/client-ip";

const env = process.env as Record<string, string | undefined>;
afterEach(() => delete env.TRUSTED_PROXY_HEADER);

test("with TRUSTED_PROXY_HEADER, a forged X-Forwarded-For is ignored", () => {
  env.TRUSTED_PROXY_HEADER = "x-real-ip";
  const a = new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" });
  const b = new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "2.2.2.2, 198.51.100.7" });
  assert.equal(clientIp(a), "198.51.100.7");
  assert.equal(clientIp(b), "198.51.100.7");
});

test("with TRUSTED_PROXY_HEADER but the header missing, all such requests share one bucket", () => {
  env.TRUSTED_PROXY_HEADER = "x-real-ip";
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9" })), "unknown");
});

test("without TRUSTED_PROXY_HEADER, the original behaviour is kept (first X-Forwarded-For entry)", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "5.5.5.5, 6.6.6.6" })), "5.5.5.5");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("an invalid header name is ignored", () => {
  env.TRUSTED_PROXY_HEADER = "x-real-ip\r\nx";
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "5.5.5.5" })), "5.5.5.5");
});
