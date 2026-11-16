/**
 * PM2 process file for the CALIX website (docs/admin-panel-runbook.md §2).
 *
 *   CALIX_ENV_FILE=/etc/calix/calix.env pm2 start deploy/ecosystem.config.cjs
 *
 * - Exactly one process in fork mode. Saved settings refresh pages only in the process that saved
 *   them, and rate limits and alert throttling are kept in memory: never use cluster mode or
 *   more than one instance.
 * - Next.js listens on 127.0.0.1 only, so every request comes through Nginx. That is what makes
 *   TRUSTED_PROXY_HEADER (set by Nginx) safe to trust.
 * - Secrets are read by Node from CALIX_ENV_FILE (`--env-file`), a file outside the repository
 *   readable only by the service user. Nothing secret is written in this file or in PM2's dump.
 * - kill_timeout leaves time for an enquiry being delivered (up to about 16 s) to finish.
 */
// The repository root (this file lives in deploy/).
const root = `${__dirname}/..`;
const envFile = process.env.CALIX_ENV_FILE || "/etc/calix/calix.env";
const port = process.env.CALIX_PORT || "3000";

module.exports = {
  apps: [
    {
      name: process.env.CALIX_APP_NAME || "calix",
      cwd: root,
      script: `${root}/node_modules/next/dist/bin/next`,
      args: ["start", "--hostname", "127.0.0.1", "--port", port],
      interpreter: "node",
      node_args: [`--env-file=${envFile}`],
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      kill_timeout: 20000,
      max_memory_restart: "768M",
      merge_logs: true,
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
