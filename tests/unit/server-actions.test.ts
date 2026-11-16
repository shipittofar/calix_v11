// Every export of a "use server" file is a publicly callable endpoint. These checks keep the
// list of endpoints explicit and make sure every admin action checks the session first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const serverFiles = ["app", "lib", "components"]
  .flatMap((d) => walk(join(root, d)))
  .filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")))
  .map((f) => relative(root, f));

/** Exported runtime values (types are erased and are not endpoints). */
function exportedFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^export\s+(async\s+function|function|const|let|var|class|default)\s*([A-Za-z0-9_$]*)/gm;
  const starts = [...source.matchAll(re)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    out.set(m[2] || "default", m[1] + "|" + source.slice(m.index, end));
  });
  return out;
}

// Endpoints reachable without an admin session, each deliberately public.
const PUBLIC: Record<string, string[]> = {
  "app/contact/actions.ts": ["submitEnquiry"],
  "app/admin/login/actions.ts": ["signIn", "verifyCode", "completeEnrolment", "signOut"],
};

test("the set of server-action files is known", () => {
  assert.deepEqual(serverFiles.sort(), ["app/admin/actions.ts", "app/admin/login/actions.ts", "app/admin/notifications/actions.ts", "app/admin/security/actions.ts", "app/admin/status/actions.ts", "app/contact/actions.ts"].sort());
});

test("server-action files export only async functions", () => {
  for (const f of serverFiles) {
    for (const [name, entry] of exportedFunctions(readFileSync(f, "utf8"))) {
      assert.ok(entry.startsWith("async function|"), `${f}: export "${name}" is not an async function`);
    }
  }
});

test("public server actions are exactly the allow-list", () => {
  for (const [f, names] of Object.entries(PUBLIC)) {
    assert.deepEqual([...exportedFunctions(readFileSync(f, "utf8")).keys()].sort(), [...names].sort(), f);
  }
});

test("every other admin action checks the session before anything else", () => {
  const admin = serverFiles.filter((f) => f.startsWith("app/admin/") && !(f in PUBLIC));
  assert.ok(admin.length > 0);
  for (const f of admin) {
    for (const [name, entry] of exportedFunctions(readFileSync(f, "utf8"))) {
      const body = entry.slice(entry.indexOf("{") + 1);
      const first = body.search(/\bawait\b/);
      assert.ok(first >= 0, `${f}: ${name} never awaits`);
      // requireAdmin(), or sessionForAction() which wraps it (lib/admin/session.ts).
      assert.match(body.slice(first, first + 40), /^await (requireAdmin|sessionForAction)\(/, `${f}: ${name} must start with requireAdmin()`);
    }
  }
});
