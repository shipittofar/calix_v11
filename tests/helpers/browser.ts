/**
 * A real browser for tests that depend on browser rules an HTTP client doesn't apply (for example
 * the `__Host-` cookie prefix). Uses Playwright if it is installed for the project, else a global
 * install. Returns null when none is available: callers skip and say so, never pass silently.
 */
import { existsSync } from "node:fs";

type Chromium = { launch: () => Promise<import("./browser-types").Browser>; executablePath: () => string };

/**
 * Playwright is a pinned dev dependency (package.json); its Chromium build is installed with
 * `npx playwright install chromium` (CI) or comes preinstalled (PLAYWRIGHT_BROWSERS_PATH).
 * Available only if the browser binary is actually there.
 */
export async function loadChromium(): Promise<Chromium | null> {
  try {
    const { chromium } = (await import("playwright")) as unknown as { chromium: Chromium };
    return existsSync(chromium.executablePath()) ? chromium : null;
  } catch {
    return null;
  }
}

/**
 * When a test suite is required (CI sets the variable), a missing tool is a failure, not a skip.
 * Returns the `describe` options: skip with a reason, or run.
 */
export function requiredOrSkip(available: boolean, variable: string, reason: string) {
  if (available) return { skip: false as const };
  if (process.env[variable] === "1") return { skip: false as const, missing: reason };
  return { skip: `${reason} (set ${variable}=1 to make this a failure)` };
}
