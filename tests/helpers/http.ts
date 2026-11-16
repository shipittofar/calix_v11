/**
 * Minimal HTTP client for integration tests: submits forms the way a browser without JavaScript
 * does (React's progressive-enhancement hidden fields included), and keeps cookies.
 */

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export class Client {
  cookies = new Map<string, string>();
  base: string;
  headers: Record<string, string>;
  constructor(base: string, headers: Record<string, string> = {}) {
    this.base = base;
    this.headers = headers;
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private keepCookies(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string, extra: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      redirect: "manual",
      headers: { ...this.headers, ...extra, cookie: this.cookieHeader() },
    });
    this.keepCookies(res);
    return { res, html: await res.text() };
  }

  /**
   * Submits the form at `index` on `path` with `fields` (strings, or arrays for repeated names).
   * Hidden inputs rendered in that form are included first, like a browser.
   */
  async submit(
    path: string,
    fields: Record<string, string | string[]>,
    opts: { index?: number; html?: string; extraHeaders?: Record<string, string> } = {},
  ) {
    const html = opts.html ?? (await this.get(path)).html;
    const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
    const form = forms[opts.index ?? 0];
    if (!form) throw new Error(`No form #${opts.index ?? 0} on ${path}`);
    const body = new FormData();
    for (const m of form[1].matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) {
      if (!(m[1] in fields)) body.append(decode(m[1]), decode(m[2] ?? ""));
    }
    for (const [k, v] of Object.entries(fields)) {
      for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
    }
    const res = await fetch(this.base + path, {
      method: "POST",
      redirect: "manual",
      body,
      headers: { ...this.headers, origin: this.base, ...opts.extraHeaders, cookie: this.cookieHeader() },
    });
    this.keepCookies(res);
    return { res, html: await res.text(), location: res.headers.get("location") };
  }
}

/** The value of a hidden input in rendered HTML. */
export function hiddenValue(html: string, name: string) {
  const m = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
}

/** Page text as a reader sees it: React's <!-- --> separators between text nodes add no space. */
export const textOf = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
