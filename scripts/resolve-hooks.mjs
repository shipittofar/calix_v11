import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = (base) => [base, `${base}.ts`, `${base}/index.ts`];

function findFile(base) {
  return candidates(base).find((p) => existsSync(p) && !p.endsWith("/"));
}

// The app's .ts files are ES modules; saying so avoids Node's "reparsing as ES module" warning.
const formatOf = (file) => (file.endsWith(".ts") || file.endsWith(".mts") ? "module-typescript" : undefined);

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = findFile(resolvePath(root, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, format: formatOf(file), shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    if (!existsSync(base) || base.endsWith(".ts")) {
      const file = findFile(base);
      if (file) return { url: pathToFileURL(file).href, format: formatOf(file), shortCircuit: true };
    }
  }
  return next(specifier, context);
}
