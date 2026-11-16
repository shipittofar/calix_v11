/**
 * Runs once when a Next.js server starts (not during `next build`): registers this process's
 * heartbeat in SETTINGS_DIR, so the admin status page can tell when more than one process uses
 * the same settings (lib/admin/instances.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { registerInstance } = await import("./lib/admin/instances");
  await registerInstance();
}
