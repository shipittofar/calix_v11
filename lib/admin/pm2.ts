/** PM2 passes its process settings to the app as environment variables (pm_id, exec_mode, instances). */
export function pm2Info(env: Record<string, string | undefined> = process.env) {
  if (env.pm_id === undefined) return null;
  return { mode: env.exec_mode ?? "unknown", instances: env.instances ?? "1", id: env.pm_id };
}
