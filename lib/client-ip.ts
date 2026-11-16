/**
 * The client's IP address, for rate limiting only (never stored or logged in clear).
 *
 * Behind Nginx, only a header that Nginx itself overwrites can be trusted, such as
 * `proxy_set_header X-Real-IP $remote_addr;`. Set TRUSTED_PROXY_HEADER to that header's name
 * (for example `x-real-ip`) once the proxy is confirmed to set it.
 *
 * Without TRUSTED_PROXY_HEADER this keeps the original behaviour (first X-Forwarded-For entry).
 * That value can be supplied by the client, so limits based on it can be bypassed: configure the
 * header in production (docs/admin-panel-runbook.md).
 */
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

export function trustedProxyHeader(): string | null {
  const name = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  return name && HEADER_NAME.test(name) ? name : null;
}

export function clientIp(headers: Headers): string {
  const trusted = trustedProxyHeader();
  const raw = trusted ? headers.get(trusted) : headers.get("x-forwarded-for");
  return (raw ?? "").split(",")[0].trim().slice(0, 64) || "unknown";
}
