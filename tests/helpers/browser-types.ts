/** The small part of Playwright's API the browser tests use (Playwright is not a dependency). */
export type Cookie = { name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite: string };
export type Response = {
  request: () => { method: () => string };
  allHeaders: () => Promise<Record<string, string>>;
  headersArray: () => Promise<Array<{ name: string; value: string }>>;
};
export type Page = {
  goto: (url: string) => Promise<unknown>;
  fill: (selector: string, value: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  textContent: (selector: string) => Promise<string | null>;
  waitForURL: (url: RegExp) => Promise<void>;
  waitForSelector: (selector: string) => Promise<unknown>;
  waitForResponse: (fn: (r: Response) => boolean) => Promise<Response>;
  url: () => string;
};
export type Context = {
  newPage: () => Promise<Page>;
  cookies: () => Promise<Cookie[]>;
  addCookies: (cookies: Array<Partial<Cookie> & { name: string; value: string; url?: string }>) => Promise<void>;
  close: () => Promise<void>;
};
export type Browser = { newContext: () => Promise<Context>; close: () => Promise<void> };
