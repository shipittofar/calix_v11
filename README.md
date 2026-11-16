# CALIX website

The CALIX studio website: Next.js (App Router), TypeScript and Tailwind CSS v4.

Planning and decisions live in `docs/` (start with `docs/calix-master-brief.md` and `docs/implementation-plan.md`). Missing content is tracked in `docs/content-gaps.md`.

## Commands

```bash
npm install
npm run dev         # development server on http://localhost:3000
npm run typecheck   # generate route types, then tsc
npm run lint        # ESLint, including the palette hex-literal rule
npm run build       # production build
npm start           # serve the production build
npm test            # unit tests (Node's test runner, no extra dependencies)
npm run test:integration  # production build, then end-to-end tests against `next start`
npm run test:prodlike     # needs nginx and pm2: the build under PM2 behind Nginx (docs/admin-panel-runbook.md §10)
npm run admin:user -- list   # administrator accounts (add | reset | disable | enable <email>)
```

## Admin panel

`/admin` lets CALIX change the public business details, the footer and social links, where enquiries are delivered (email, Telegram, WhatsApp via the Meta Cloud API) and pause the contact form, without a rebuild. Settings are JSON files in `SETTINGS_DIR`; there is no database or CMS. Accounts are created on the server with `npm run admin:user`, and sign-in needs a password and an authenticator app. Operating it (Nginx, PM2, storage, backups, restore, rollback, Telegram go-live) is described in `docs/admin-panel-runbook.md`. The admin is switched off until `SETTINGS_DIR`, `SESSION_SECRET` and `SETTINGS_ENCRYPTION_KEY` are set; the public site works without them, using the details in `content/site.ts`.

## Environment

Copy `.env.example` to `.env.local` for development. On the host, set these as environment variables (never commit real values).

| Variable | Required | Purpose |
|---|---|---|
| `SITE_URL` | No | Canonical origin. Defaults to `https://www.calixeden.com` |
| `NOINDEX` | Previews | `true` on preview and staging deployments: noindex metadata, a blocking robots.txt, and permission to use the log mail transport |
| `MAIL_TRANSPORT` | No | `smtp` (production default) or `log` (development default: nothing is delivered). In production, `log` is refused unless `NOINDEX=true`, so a live site never shows success for an enquiry it did not deliver |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Production | CALIX mailbox used to deliver enquiries. Port defaults to 587; 465 uses implicit TLS |
| `ENQUIRY_TO`, `ENQUIRY_FROM` | Production (`ENQUIRY_TO`) | Recipient and sender of enquiry emails. The sender defaults to `SMTP_USER`. A recipient saved in the admin takes precedence over `ENQUIRY_TO` |
| `FORM_SECRET` | Production | Long random string that signs form tokens (`openssl rand -hex 32`). The same value on every server instance |
| `SETTINGS_DIR` | Admin | Absolute path of the settings directory: persistent, outside the release, mode 700, owned by the service user. Without it the admin is off and the site uses its code defaults |
| `SESSION_SECRET` | Admin | At least 32 random characters (`openssl rand -hex 32`). Signs admin sessions; changing it signs everyone out |
| `SETTINGS_ENCRYPTION_KEY` | Admin | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts authenticator secrets and the Telegram token. Back it up separately: settings backups are useless without it |
| `SETTINGS_ENCRYPTION_KEY_PREVIOUS` | Key rotation only | The old key while rotating: read-only fallback until `npm run admin:user -- rekey` has re-encrypted everything (runbook §4). Remove it afterwards |
| `TRUSTED_PROXY_HEADER` | Production | `x-real-ip` behind the Nginx snippet in `deploy/nginx/`. Without it, rate limits read `X-Forwarded-For`, which only Nginx's overwrite makes safe |
| `TELEGRAM_DELIVERY_ALLOWED` | Off by default | `true` only after the privacy notice names Telegram and the server checks are done (runbook §8). Without it, Telegram never receives enquiries, whatever the admin settings say |
| `TELEGRAM_API_BASE` | Tests only | Points the Telegram client at a local test server. Honoured only for `127.0.0.1`/`localhost` |
| `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` | No | Search Console and Bing Webmaster verification codes |
| `SHOW_CONTENT_PLACEHOLDERS` | No | `true` on review previews to show the internal content-gap markers. Leave unset on the public site |
| `CALIX_FIXTURES` | Never in production | `1` compiles in test fixtures. Never deploy a fixture build |
| `STORY_PREVIEW` | No | The olive story is on the home page in every build. `false` leaves the section and its drawing code out of the build (the off switch). `true` makes a separate noindex review build in `.next-preview` and requires `NOINDEX=true`. See `docs/olive-story.md` |

`NOINDEX`, `SHOW_CONTENT_PLACEHOLDERS`, `CALIX_FIXTURES` and `STORY_PREVIEW` are read when pages are generated, so set them for the **build**, not only at runtime.

Enquiries go to every enabled channel at once (email, and Telegram when allowed). The visitor is thanked when at least one channel accepted the enquiry. If none did, or nothing is configured (for example the SMTP variables or `FORM_SECRET` are missing in production), the form says it could not be sent and keeps what the visitor wrote. It never shows a false success.

## Rules

- Use only the five palette colours (see `app/globals.css`). The Tailwind theme is reset, so other colours don't exist as utilities.
- Don't invent clients, results, testimonials or metrics. Use `pending()` in `content/site.ts` or `ContentPlaceholder`.
- Production deployment requires explicit authorisation.
