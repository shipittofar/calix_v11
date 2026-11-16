# CALIX website — operations runbook (admin panel)

**For:** whoever runs the server. **Applies to:** the website with the admin panel (runtime settings, email and Telegram delivery).
**Last updated:** 2026-10-24.

Production deployment and changes to production configuration need explicit authorisation (`docs/calix-master-brief.md`). Nothing in this runbook has been applied to the real server. §11 lists what must be checked there.

## 1. How it fits together

```
visitor ──HTTPS──▶ Nginx (TLS, sets X-Real-IP) ──HTTP──▶ Next.js on 127.0.0.1:3000 (one PM2 process)
                                                           │
                                                           ├── reads/writes SETTINGS_DIR (JSON files)
                                                           ├── SMTP ──▶ CALIX mailbox
                                                           └── HTTPS ──▶ api.telegram.org (only if allowed)
```

- **Public pages are prebuilt.** Saving settings in the admin re-renders every page on its next visit, with no rebuild. Pages also refresh themselves at most every 5 minutes. Next.js keeps re-rendered pages on disk in `.next/server/route-cache`, so they survive restarts of the same build.
- **`/contact` and `/admin` render per request.**
- **Settings live in `SETTINGS_DIR`.** These are JSON files, written atomically with a `.bak` of the previous version. There is no database.
- **Exactly one Next.js process.** A save refreshes pages only in the process that made it, and rate limits and alert throttling are held in memory. Two processes would serve stale pages and halve the limits.

| File in `SETTINGS_DIR` | Contains | Sensitivity |
|---|---|---|
| `settings.json` | Public business details, footer, social links, pause switch | Public |
| `delivery.json` | Email recipient, Telegram chat ID, the **encrypted** bot token | Confidential |
| `status.json` | Delivery outcomes (time, request ID, result codes), test results, alert times. No enquiry content | Internal |
| `admins.json` | Administrator emails, password hashes, **encrypted** authenticator secrets, recovery-code hashes | Secret |
| `audit.log` (+ `.1`–`.5`) | Security history: what signed-in administrators and the CLI changed, sign-ins and sign-outs. IP addresses are keyed hashes; no values or secrets. Anonymous requests never write here | Internal |
| `audit-access.log` (+ `.1`–`.3`) | Unauthenticated events (failed sign-in steps, refused anonymous requests), throttled (§7) | Internal |
| `instances/` | One heartbeat file per running process (§2). Not backed up | Internal |
| `*.bak` | The previous version of each file | As above |

## 2. PM2

Use `deploy/ecosystem.config.cjs` unchanged. It runs `next start --hostname 127.0.0.1` as **one process in fork mode** and loads secrets with Node's `--env-file`, so they never appear in the PM2 config, `pm2 jlist` or `pm2 save` dumps.

```bash
# as the service user (e.g. calix), from the release directory
CALIX_ENV_FILE=/etc/calix/calix.env pm2 start deploy/ecosystem.config.cjs
pm2 save                       # remember it across reboots
pm2 startup                    # once, prints the command that installs the boot service
pm2 logs calix --lines 100     # logs (never contain secrets or enquiry contents)
pm2 restart calix              # after changing /etc/calix/calix.env
```

Optional variables when starting: `CALIX_PORT` (default 3000; change the Nginx snippet to match) and `CALIX_APP_NAME` (default `calix`).

**Never** use `-i`, `instances > 1`, `exec_mode: cluster` or `pm2 scale`. The admin status page reports a problem:
- if PM2 runs the site in cluster mode or with more than one instance;
- if more than one running process writes a heartbeat to the same `SETTINGS_DIR`, for example a second PM2 app or a stray `npm start`. Each process records a heartbeat in `SETTINGS_DIR/instances` every 30 s.

It **can't** see a process started with a different `SETTINGS_DIR`, or on a machine that doesn't share the folder. `pm2 jlist` and `ss -ltnp` (§11) remain the authority.

**The release directory must be writable by the service user**, in particular `.next/`. Next.js writes re-rendered pages to `.next/server/route-cache` at runtime. Build as the service user (or `chown -R calix .next` after building).

`kill_timeout` is 20 s, so a restart lets an enquiry being delivered (up to about 16 s) finish.

## 3. Nginx

1. Copy `deploy/nginx/calix-proxy.conf` to `/etc/nginx/snippets/calix-proxy.conf`.
2. Adapt `deploy/nginx/calix.conf.example` as the site file (names, certificate paths).
3. `nginx -t`, then `systemctl reload nginx`.

What the snippet guarantees, and why:

| Setting | Why |
|---|---|
| `proxy_set_header X-Real-IP $remote_addr` and `X-Forwarded-For $remote_addr` | Nginx **overwrites** both, so a visitor can't forge their address. The app reads `X-Real-IP` when `TRUSTED_PROXY_HEADER=x-real-ip`. Without that variable it falls back to the first `X-Forwarded-For` entry, which is only safe behind this snippet |
| `Host $http_host` and `X-Forwarded-Host $http_host` | Server Actions (the contact form, every admin form) refuse requests whose Origin doesn't match the host |
| `proxy_cache off` | Saved settings must show at once, and admin pages are private. Don't add caching for HTML here or in a CDN |
| `proxy_read_timeout 60s` | An enquiry answers within about 16 s, even when a channel times out |
| `client_max_body_size 1m` | Matches the Server Action body limit |

**If a CDN or another proxy sits in front of Nginx,** `$remote_addr` is the CDN's address, and every visitor would share one rate limit. Configure Nginx's `real_ip` module for that provider's published address ranges (`set_real_ip_from …; real_ip_header …;`) before relying on `X-Real-IP`, and make sure the CDN doesn't cache HTML.

**Optional: restrict the admin.** Add a `location /admin { allow <office IP>; deny all; … }` block containing the same `proxy_*` lines as the snippet. The admin already requires a password and an authenticator code.

**Check:** sign in, open **System status**, then "Visitor address". It must show your real public address and say it was read from `x-real-ip`. A request without that header reports a problem.

## 4. Settings storage, secrets and permissions

**Storage directory.** Use a persistent location outside the release directory, so deploys never touch it, and not on tmpfs:

```bash
sudo install -d -o calix -g calix -m 700 /var/lib/calix/settings
```

Writes are atomic: a temporary file is renamed over the old one, and the previous version is kept as `.bak`. They are serialised by a lock file next to each file, recording the holder's PID, a random token and the holder's **start identity** (the machine's boot ID plus the kernel's start time for that PID).
- A lock is taken over only when it is more than 30 s old **and** its holder is gone. A PID that now belongs to a different process, as after a crash and restart, counts as gone.
- A live holder's lock is never broken; other writers wait up to 5 s, then report "busy". Only the holder removes its own lock.
- Takeovers go through a guard file named after the exact stale lock (`<file>.lock.reclaim-<hash>`), so two processes can't both act on the same stale lock. A guard left by a crashed process is cleared the same way once it is over 10 s old and its holder is gone; leftovers are swept on the next save. Waiting behind another takeover also backs off and ends with "busy" after 5 s.
- System status warns about any lock held for over a minute.
- Residual: without `/proc` (not Linux) only the PID is checked.

The site refuses to use a directory that is not absolute or is world-writable. The status page warns if the directory isn't `700`, if files aren't `600`, or if the directory belongs to another user. Files are created `600` by the site and the CLI. Run the CLI as the service user (`sudo -u calix …`), never as root, so ownership stays correct.

**Environment file** `/etc/calix/calix.env` (owner `root`, group `calix`, mode `640`). One `KEY=value` per line, no quotes. See `.env.example` for every variable. Generate secrets with:

```bash
openssl rand -base64 32   # SETTINGS_ENCRYPTION_KEY (exactly 32 bytes, base64)
openssl rand -hex 32      # SESSION_SECRET (at least 32 characters), FORM_SECRET
```

| Secret | If it is lost or changed |
|---|---|
| `SETTINGS_ENCRYPTION_KEY` | Lost: authenticator secrets and the Telegram token can't be decrypted. Every administrator must be reset with the CLI (§9) and the token entered again. Decryption fails closed and never changes stored data. **Back it up separately from the settings backups.** To change it on purpose, rotate it (below) |
| `SESSION_SECRET` | Everyone is signed out. Changing it is the way to end all sessions at once |
| `FORM_SECRET` | Forms opened before the change ask the visitor to press Send again |

**Rotating `SETTINGS_ENCRYPTION_KEY`** (no data loss):
1. Generate a new key.
2. In `/etc/calix/calix.env`, move the current value to `SETTINGS_ENCRYPTION_KEY_PREVIOUS` and put the new one in `SETTINGS_ENCRYPTION_KEY`, then `pm2 restart calix`. Both keys can now read; new values use the new key.
3. Back up the settings (§5), then run `admin-user rekey`.
   - It re-encrypts every stored secret with the new key and prints how many it re-encrypted.
   - If any value can't be read with either key, the file it's in is left exactly as it was, and the command fails.
4. Remove `SETTINGS_ENCRYPTION_KEY_PREVIOUS` and restart.
5. Send a Telegram test message again: the test binding uses the key.

A restore (§5) needs the key that was current when the backup was taken. Keep old keys with the backups that need them.

**Administrator accounts** are managed only on the server; there is no sign-up page. Run the CLI from the release directory as the service user, with the same environment file. `--env-file` keeps secrets off the command line, where `ps` would show them:

```bash
cd /srv/calix/current
sudo -u calix node --env-file=/etc/calix/calix.env --import ./scripts/register-ts.mjs scripts/admin-user.mts add owner@calixeden.com
# other commands: list | reset <email> | disable <email> | enable <email>
```

The command prompts for the password twice. The authenticator app is set up at the first sign-in, at `/admin/login`. The CLI runs TypeScript directly, which needs Node.js 22.18 or later. Below, `admin-user` means this command.

## 5. Backups and restore

**Back up** with `deploy/backup-settings.sh <SETTINGS_DIR> <backup dir> [keep]`. It:
- is safe while the site runs;
- writes mode-600 archives and keeps the newest 30;
- checks each archive can be read before keeping it.

If anything fails, it removes the incomplete file and exits non-zero, so cron reports the failure. Heartbeats (`instances/`) are not included. For example, cron for the service user:

```
17 3 * * * /srv/calix/current/deploy/backup-settings.sh /var/lib/calix/settings /var/backups/calix 30
```

Copy the archives off the server. They contain password hashes and the encrypted token: protect them like the server. Keep `/etc/calix/calix.env` (in particular `SETTINGS_ENCRYPTION_KEY`) in a separate secure place: a restore needs the same key.

**Back up the secrets separately.** The archives deliberately don't contain `/etc/calix/calix.env`.
- Keep a copy of `SESSION_SECRET`, `SETTINGS_ENCRYPTION_KEY` and the SMTP settings in a password manager or vault, separately from the archives.
- **Every time `SETTINGS_ENCRYPTION_KEY` changes**, record the date and keep the old key, until no archive made before that date is needed. A backup can only be restored with the key that was current when it was made.

**Restore.** Restoring an older `admins.json` would bring back older session versions, an older list of signed-out sessions and older account states. A plain file copy can therefore make signed-out cookies valid again and re-enable accounts disabled since the backup (the restore integration test demonstrates this). Always use the restore command, in this order:

```bash
# 1. Stop the site. The command refuses to run while the site is running.
pm2 stop calix
# 2. Restore, as the service user, with the site's environment file.
cd /srv/calix/current
sudo -u calix node --env-file=/etc/calix/calix.env --import ./scripts/register-ts.mjs scripts/admin-user.mts restore /var/backups/calix/settings-<stamp>.tar.gz
# 3. Change SESSION_SECRET (mandatory), keeping the old value until you're done.
sudo cp /etc/calix/calix.env /etc/calix/calix.env.before-restore
#    edit /etc/calix/calix.env: SESSION_SECRET=<output of: openssl rand -hex 32>
# 4. Start the site.
pm2 start calix   # Node reads the environment file at start, so the new secret takes effect
```

What the command does:
- **Before changing anything**, it checks the archive:
  - only the expected file names are used, and they must be regular files (no links, no paths outside the folder);
  - each settings file must be valid;
  - every encrypted value (authenticator secrets, the Telegram token) must be readable with the current or previous key.

  If any check fails, nothing is changed and the archive is never modified.
- It **copies the current files** to a new `pre-restore-<time>/` folder inside `SETTINGS_DIR` and flushes them to disk before changing anything. These copies are never deleted and not included in later backups.
- It **never overwrites the activity logs**. The archive's logs are kept in `pre-restore-<time>/archive-audit/` for reference.
- **Administrators are kept from the live server** by default. If the live `admins.json` is missing or unreadable, or you pass `--restore-admins`, the accounts come from the backup and **every one is disabled**. Re-enable each account you trust with `admin-user enable <email>`, after checking it should still have access. An account disabled after the backup stays disabled.
- It **records the restore in `restore.json` before changing any live file**, as "in progress", and as "complete" only after every file is replaced (each record written atomically and flushed to disk). From the first record on, the admin is unavailable, refusing every session and sign-in. An unfinished restore keeps it unavailable whatever `SESSION_SECRET` is; a complete one until `SESSION_SECRET` has been changed. Every admin cookie is signed with `SESSION_SECRET`, so the new value makes all cookies issued before the restore invalid (verified by the integration test). The new secret also changes how IP addresses are hashed in the activity logs: entries before and after can't be compared by address.

Then, in the admin:
1. **System status** should show "Last restore from a backup … SESSION_SECRET has been changed since", and every file **OK**.
2. Press **Refresh public pages**: pages re-rendered before the restore are kept on disk and would otherwise show the old values for up to 5 minutes.
3. Send a Telegram test message if Telegram is used: the test binding depends on the encryption key.

When everything works, delete `/etc/calix/calix.env.before-restore`.

**Restoring a backup made before an encryption-key change:**
1. Stop the site.
2. In `/etc/calix/calix.env`, set `SETTINGS_ENCRYPTION_KEY_PREVIOUS` to the key in use when the backup was made, keeping the current key in `SETTINGS_ENCRYPTION_KEY`.
3. Run the restore command above. If it still reports values it can't read, nothing was changed: check that you have the right old key. The backup is never modified, so you can try again.
4. Run `admin-user rekey`. It re-encrypts everything with the current key and must report `0 could not be read`.
5. Change `SESSION_SECRET` as in step 3 above, then remove `SETTINGS_ENCRYPTION_KEY_PREVIOUS` and start the site.
6. Check: System status shows every file OK; sign in (this proves the authenticator secret is readable); send a Telegram test message if used.

The restore unit tests run this sequence: a backup made with key A, restored on a server using key B. It is refused without A, restored with A as the previous key, rekeyed, and then readable with B alone.

**If a restore goes wrong** (an error after it began changing files, a crash, a killed process, a power cut): the command says so, and the admin stays unavailable ("the unfinished restore to be rolled back" in the site log). A new restore is refused until this is resolved. With the site stopped:

```bash
sudo -u calix node --env-file=/etc/calix/calix.env --import ./scripts/register-ts.mjs scripts/admin-user.mts restore --rollback
```

- It puts back, byte for byte, the files the restore replaced (and their `.bak`), from the `pre-restore-<time>/` folder recorded in `restore.json`. Administrators the restore kept are not touched.
- If it is interrupted too, run it again: it is safe to repeat.
- Then fix the cause (for example free disk space) and either run the restore again, or change `SESSION_SECRET` and start the site. After a rollback the admin stays unavailable until `SESSION_SECRET` changes, as after a restore.
- A rollback is also possible after a restore that finished, until `SESSION_SECRET` is changed. After that the admin may have been used, so it is refused: restore a backup instead.

**If `restore.json` can't be read** (the site log says "a readable restore.json"), the admin stays unavailable and the restore command refuses to run. Check that the file belongs to `calix` and is readable. If it is damaged, the state of the last restore is unknown: with the site stopped, compare the settings files with the newest `pre-restore-<time>/` folder and copy its files back if in doubt, then move `restore.json` out of `SETTINGS_DIR`, change `SESSION_SECRET` and start the site.

Never delete the only copy of a backup while recovering; work from copies.

**One corrupt file.** The site keeps working from the last good copy in memory, then `<file>.bak`, then the code defaults, and the status page reports the file as a problem. Restore it as above, or copy `<file>.bak` over it, then press **Refresh public pages**.

## 6. Deploying and rolling back

1. Build on the server, or anywhere, with the release's dependencies: `npm ci && npm run build`.
   - Building **with `SETTINGS_DIR` set** bakes the saved settings into the prebuilt pages.
   - Built elsewhere (for example in CI), the first visitor to each page may see the default details once, and pages pick up the saved settings within 5 minutes. Pressing **Refresh public pages** after the deploy makes this immediate.
2. Switch the release and run `pm2 restart calix`.
3. Open **System status**: no problems, expected Next.js version and build ID.

**Rollback** means switching back to the previous release directory, then `pm2 restart calix` and **Refresh public pages**.
- Settings files are format version 1 and stay where they are.
- Rolling back to a release from before the admin panel ignores `SETTINGS_DIR`: the site then shows the details from `content/site.ts`, and email goes to `ENQUIRY_TO` only.
- Don't roll back below `next` 16.4.1, `zod` 4.6.6 or `nodemailer` 10.1.4. Older versions have published security advisories.

**After a failed deploy** the old release still runs: PM2 only switches on restart. If the new process won't start, `pm2 logs calix` shows why. Switch back and restart.

**Forms open during a deploy.** Pages carry an ID for the Server Action they post to.
- **Verified:** after rebuilding unchanged code, a contact form loaded before the deploy still submits (same ID, normal thank-you).
- **Not verified:** a deploy that changes the contact form's action code may change that ID. A visitor who loaded the form before the deploy could then get an error instead of the thank-you page. Deploy such changes at a quiet time.
- **Admin forms:** the same applies; reload the admin page after a deploy.

## 7. The admin status page

**Admin → System status** (signed-in administrators only) checks:
- storage and permissions, each settings file and its backup, and the activity log;
- whether the secrets are set (values never shown);
- the contact form, each delivery channel and the Telegram gate;
- the visitor address header;
- PM2 mode and instance count;
- versions, build ID and uptime.

Each check reads **OK**, **Check**, **Problem** or **Info**, with a plain explanation. The page has the **Refresh public pages** button.

**Activity logs.** Each line holds the hash of the previous line, so an edited or removed line in the *middle* of a file shows as "Broken". Limits:
- Changing or cutting the *end* of a file, deleting a whole file, or rotation dropping the oldest file can't be detected from the files alone. Copy the logs off the server, for example with the backups, to keep a record nobody on the server can rewrite.
- Unauthenticated events go to `audit-access.log`, never to `audit.log`. That file is throttled to one line per action and address per minute, with repeats counted into the next line, and to 120 lines a minute in total; the rest are counted into one `access.suppressed` line the next minute. A flood of anonymous requests can therefore only cycle `audit-access.log`. It can't push security history out of `audit.log`.

For outside monitoring, check that `https://www.calixeden.com/robots.txt` answers `200`, and alert on PM2 restarts. **Admin → Contact form and notifications** shows delivery failures over the last 24 hours and 7 days.

## 8. Telegram: switching it on

Telegram becomes a recipient of visitors' personal data, so it is off until **all** of these are done:

1. **Privacy notice.** CALIX approves and publishes wording that names Telegram as a recipient of enquiry details: what is sent, where Telegram processes it, and how long messages are kept in the chat. This is content gap #21 in `docs/content-gaps.md`. Nobody may invent this wording.
2. **A private destination.** Use a private group, or a direct chat with the bot, whose members are CALIX staff only. Create the bot with @BotFather; keep the token secret.
3. **Network.** From the server, as the service user, `curl -sS -o /dev/null -w '%{http_code}\n' https://api.telegram.org/` must print a status code, not a connection error or timeout. Open outgoing HTTPS to `api.telegram.org` if a firewall blocks it.
4. **Operator sign-off.** Add `TELEGRAM_DELIVERY_ALLOWED=true` to `/etc/calix/calix.env` and run `pm2 restart calix`.
5. **In the admin** (Contact form and notifications):
   1. Save the chat ID and token with Telegram **off**. The password and a fresh authenticator code are required.
   2. Press **Send test message** and check that it arrives.
   3. Switch Telegram on and save. This is refused unless the last test succeeded with exactly this token and chat.
6. Send a real test enquiry from the public form. It must arrive in both email and Telegram, and the delivery table must show both as delivered.

Before step 4, the admin can save and test Telegram but can't switch it on. Even if `delivery.json` were edited by hand, the site doesn't send enquiries to Telegram.

**Switch it off quickly** by unticking it in the admin, or by removing the variable and restarting. Enquiries keep going by email.

**Failure alerts.** If one channel fails for an enquiry, the other sends one short alert, at most once per channel every 30 minutes. The alert has no visitor details. An alert is never sent about an alert. If every channel fails, the visitor is told to try again, with their text kept, and the failure is recorded.

## 9. Recovery

| Situation | Do this |
|---|---|
| Forgot password or lost phone | Sign in with a recovery code, or `admin-user reset <email>` (new password; the authenticator is set up again; that account is signed out everywhere) |
| Signed out on a shared computer | **Sign out** ends that session on the server (its ID is recorded until it would have expired), so a copied cookie stops working too; other devices stay signed in. **Sign out on every device** ends them all |
| An administrator leaves | `admin-user disable <email>`. Their sessions end at once |
| Locked out of sign-in | Limits: 5 failures per account from one address, 20 from one address overall, and 25 per account from all addresses, each over 15 minutes. Someone guessing from one address doesn't lock you out elsewhere. **Residual risk:** about two addresses' worth of wrong passwords (25) locks an account for 15 minutes for everyone. Wait, or `pm2 restart calix` (limits are kept in memory). The password-and-code check inside admin forms has its own limit per administrator, so anonymous failures can't block it. Memory stays bounded without resetting accounts that are locked |
| Admin says "unavailable" after a restore | Expected: change `SESSION_SECRET` and restart (§5). If the log says "the unfinished restore to be rolled back" or "a readable restore.json", see "If a restore goes wrong" (§5) |
| `SETTINGS_ENCRYPTION_KEY` lost | Set a new key, `reset` every administrator, enter the Telegram token again |
| Status page: activity log "Broken" | Someone edited `audit.log`. Keep a copy, investigate who had server access; the site keeps working |
| Status page: storage problem | Check the disk (`df -h`), ownership and modes (§4). Saves are refused rather than half-written |
| Enquiries failing | Check the delivery table on Contact form and notifications. Then use the test buttons, the explanation next to each code, and `pm2 logs calix`, which logs codes such as `all_channels_failed codes=email_auth_failed` |
| Need to stop enquiries | Admin → Contact form and notifications → Paused, with a message. Submissions are refused by the server too |

## 10. Local production-like test

`npm run build && npm run test:prodlike` runs the built site under PM2, using `deploy/ecosystem.config.cjs` with temporary settings, logs and PM2 home. It sits behind Nginx with `deploy/nginx/calix-proxy.conf` on local ports. It checks:
- one fork-mode process, listening on 127.0.0.1 only;
- the status page;
- that forged `X-Real-IP`/`X-Forwarded-For` headers neither show up nor get round the rate limit;
- that saved settings show through Nginx without a rebuild;
- PM2 restart and crash recovery;
- backup and restore with Refresh public pages;
- that no secrets or enquiry contents appear in PM2 and Nginx logs or in `pm2 jlist`.

The test needs `nginx` and `pm2` installed. It is skipped otherwise, and it does not run in CI. It shows that **these files** behave as described. It does not show that the real server uses them.

## 11. Checks only the real server can answer

Not verified yet. Each needs access to the production server:

- [ ] PM2 runs exactly one `calix` process in fork mode (`pm2 jlist`; System status: Process manager **OK**).
- [ ] Next.js listens on 127.0.0.1 only (`ss -ltnp | grep 3000`).
- [ ] Nginx uses the snippet (`nginx -T | grep -n 'X-Real-IP'`), `TRUSTED_PROXY_HEADER=x-real-ip` is set, and System status shows your real address. With a CDN in front: `real_ip` configured (§3).
- [ ] No HTML caching in Nginx or a CDN: save a setting and see it on the next page load.
- [ ] `SETTINGS_DIR` is on persistent disk (`df -h /var/lib/calix/settings`), mode 700, files 600, owned by the service user.
- [ ] Backups run, are copied off the server, and a restore has been rehearsed with `admin-user restore`, including the `SESSION_SECRET` change. `SETTINGS_ENCRYPTION_KEY` (and every earlier key still needed) and `SESSION_SECRET` are backed up separately from the archives.
- [ ] SMTP: **Send test email** arrives; a real enquiry arrives with the visitor as Reply-To.
- [ ] Where builds happen, and whether the build sees `SETTINGS_DIR` (§6).
- [ ] Telegram, only when wanted: every step of §8, the privacy notice first.
- [ ] Node.js is 22.18 or later (`node -v`); the admin CLI needs it.
- [ ] The release's `.next/` is writable by the service user (§2).
- [ ] System status: Processes using these settings **OK One.**
- [ ] The installed dependency versions on the server match `package-lock.json` (`npm ci`), in particular `next` 16.4.1 and `sharp` 0.35.5.
