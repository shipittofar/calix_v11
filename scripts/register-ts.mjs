// Lets Node (tests and the admin CLI) import the app's TypeScript modules directly (Node's built-in type stripping):
// resolves the "@/…" path alias, extensionless relative imports, and stubs "server-only".
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
