# CALIX — Admin Panel Audit (revision 3: post-implementation audit)

**Status:** Audit and plan only. This revision changes no application code, dependency, schema, environment or deployment configuration.
**Revision:** 3 (2026-10-24). It supersedes revision 2 (commit `b49f001`), which planned the admin before any of it existed.
**Repository state audited:** branch `claude/quirky-cannon-o525ld`, commit `5bcd584` (working tree clean apart from these four documents).

**Companion documents (same folder):**
- `ADMIN_PANEL_FEATURE_MATRIX.md`: one row per capability, with status, evidence and acceptance criteria.
- `ADMIN_PANEL_API_GAPS.md`: the backend surface as built, file formats, contracts and the remaining proposals.
- `ADMIN_PANEL_IMPLEMENTATION_PLAN.md`: what was delivered per phase, and the remaining backlog.

**Related operational documents (not changed by this audit):**
- `docs/admin-panel-runbook.md`: operator procedures.
- `docs/content-gaps.md`: facts still missing.

**Labels used throughout:**
- **Verified:** read in the repository at `5bcd584`, or in the Next.js 16.4 docs bundled at `node_modules/next/dist/docs/`.
- **Tested:** covered by an automated test in `tests/`. The last local run of the full suite passed: 126 unit, 65 integration with Chromium required, 12 production-like with Nginx and PM2 (session record, 2026-10-24).
- **Not observed:** depends on something outside this repository and session, such as the live server or a GitHub Actions run.
- **Recommended:** a proposal from this audit.

---

## 0. What changed from revision 2

| Revision 2 | Revision 3 |
|---|---|
| A plan: 40 capabilities, almost all **Missing** | **33 of 45 capabilities are Implemented and tested.** Revision 3 adds 5 rows that revision 2 didn't have (§12) |
| Scope: runtime business details plus email and Telegram delivery; no CMS (decision recorded in revision 2 §0) | **Scope kept.** This audit re-evaluated every category in the audit brief (content, users, media, analytics, localisation and so on) against the code; §5 records the result and when to revisit |
| Proposed files under `app/(admin)/…` and `scripts/admin-user.mjs` | Built as `app/admin/…` and `scripts/admin-user.mts` (§4.2) |
| Telegram token shown masked with its last 4 characters | Built stricter: no part of the token is kept in clear or shown (`lib/settings/schema.ts`, `deliveryFile.telegram.botToken`) |
| Cross-channel alert at most once an hour | Built as at most once every 30 minutes per channel (`lib/delivery/alerts.ts`, `ALERT_WINDOW_MS`) |
| Restore was "copy the files back" | Built as a journalled `admin-user restore` with `--rollback`, plus mandatory SESSION_SECRET rotation (§8) |
| Public CSP `script-src` judged a small task (a hash of one inline script) | **Corrected:** static pages also carry framework inline scripts, so the realistic options are nonces (which make pages dynamic) or Next.js's *experimental* SRI. This needs an investigation (§8, F2) |

---

## 1. Executive summary

**What CALIX needs from an admin** (unchanged from revision 2):
- change the public business details at runtime;
- control where contact-form enquiries are delivered (email and Telegram, each on its own), and pause the form;
- see whether delivery and the server are healthy;
- do all of this without a rebuild, without a database, and without turning the site into a CMS.

**What exists now (verified and tested):**
- A dynamically rendered admin at `/admin` with four screens: General settings, Contact form and notifications, System status, and Account and security. Sign-in is at `/admin/login`.
- **Sign-in:** password (scrypt) plus TOTP, with recovery codes.
- **Sessions:**
  - signed `__Host-` cookies;
  - 30 min idle and 8 h absolute expiry;
  - revocation per session and per account;
  - re-authentication for sensitive actions.
- **Every admin page and Server Action checks the session on the server**, and a unit test enforces it (`tests/unit/server-actions.test.ts`).
- **Settings store:** private JSON files in `SETTINGS_DIR`, written atomically and validated with Zod on every read and write. Secrets are encrypted with AES-256-GCM. A cross-process lock is PID-reuse safe.
- **Hash-chained audit logs:** `audit.log`, plus a throttled `audit-access.log` for anonymous traffic.
- **Delivery:** email and Telegram run concurrently and independently. The visitor is told "success" only when a channel confirmed. A failed channel triggers an alert through the other one. Delivery outcomes are recorded **without enquiry content**.
- **Backups:** a backup script, and a crash-safe restore with rollback.
- **Operations:** PM2 and Nginx configuration in `deploy/`, and an operator runbook.

**What remains:**

| # | Item | Kind | Severity / priority |
|---|---|---|---|
| 1 | The legal privacy notice is still a placeholder. It doesn't name Telegram, and doesn't describe delivery-outcome or admin-access records. The code already keeps Telegram off unless the operator sets `TELEGRAM_DELIVERY_ALLOWED=true` | Owner and legal adviser (not code) | P0 before Telegram is enabled in production |
| 2 | The CI workflow has never been observed passing on GitHub. The live server's single-process setup, disk, Nginx, outbound access to Telegram and SMTP are unverified | Verification | P0 before production |
| 3 | No Nginx `limit_req` on `/admin/login`. The application's own limits work (tested) | Defence in depth | P2 |
| 4 | The CLI's account commands (`add`, `reset`, `enable`, `disable`, `rekey`) still run while a restore is unfinished, and a rollback can then undo them | Operational safety | P2 |
| 5 | Public pages have no `script-src` CSP (the admin has a strict nonce CSP) | Hardening; needs investigation | P3 |
| 6 | No unsaved-changes warning on admin forms. The audit view shows only the last 50 entries, without filters, export or the access log | Usability | P3 |

**No critical vulnerability was found.** §8 lists every finding with evidence.

**Capability counts** (from `ADMIN_PANEL_FEATURE_MATRIX.md`, 45 rows):

| Status | Count |
|---|---|
| Implemented | 33 |
| Partially implemented | 4 |
| Missing | 4 (1 deliberately deferred, 1 owner/legal) |
| Needs verification | 4 |

**15 further content and data areas** were reviewed and are intentionally kept in code, so they are not counted as gaps (§5, §11).

---

## 2. Scope and method

**Inspected (source read, not only file names):**

| Area | Files |
|---|---|
| Admin routes and actions | `app/admin/**` (pages, `actions.ts` files, forms), `proxy.ts`, `instrumentation.ts` |
| Admin libraries | `lib/admin/*` (session, session-token, password, totp, reauth, rate-limit, users, audit, config, status, instances, restore, enrolment, pm2) |
| Settings | `lib/settings/*` (schema, store, crypto, public, general-form) |
| Delivery | `lib/delivery/*` (plan, dispatch, email, telegram, alerts, log, codes, admin, enquiry) |
| Public site | `app/**` (all routes), `components/**`, `content/*.ts`, `lib/{seo,schema,analytics,site-url,client-ip}.ts`, `lib/enquiry/*` |
| Config and operations | `next.config.ts`, `package.json`, `.env.example`, `README.md` environment table, `deploy/*`, `.github/workflows/validate.yml`, `docs/admin-panel-runbook.md`, `docs/content-gaps.md` |
| Tests | `tests/unit/*`, `tests/integration/*`, `tests/prodlike/*`, `tests/helpers/*` (test names and the assertions relevant to each capability) |
| Framework docs | Bundled Next.js 16.4 Content-Security-Policy guide (nonces, the no-nonce option, experimental SRI) |

**Not inspected** (outside the repository):
- the live server (PM2 mode, disk, Nginx, firewall, environment values);
- GitHub Actions runs (this session has no API access to the repository);
- the CALIX mailbox;
- any Telegram bot or chat.

There is **no database, no ORM, no migrations and no `app/api/*` route handlers**, so the "database models" and "API endpoints" in the audit brief are covered as **store file schemas** and **Server Actions** (§4, `ADMIN_PANEL_API_GAPS.md`).

---

## 3. Architecture overview (verified)

### 3.1 Stack

| Layer | What the repository uses |
|---|---|
| Framework | Next.js 16.4.1 App Router (Turbopack), React 19 |
| Language | TypeScript; `zod` 4 |
| Mail | `nodemailer` 10 |
| Images | `sharp` |
| Runtime | Node `>=22.18` (CI pins 22.22.0) |
| Mutations | Server Actions only (`"use server"` files). No REST or GraphQL API |
| Persistence | JSON files in `SETTINGS_DIR` (`lib/settings/store.ts`); optional at build time |
| Tests | Node test runner with type stripping (`scripts/register-ts.mjs`); Playwright 1.56.1 Chromium for browser-only rules; a production-like Nginx + PM2 suite |
| Hosting (reported) | One server, Nginx in front of one PM2 fork-mode `next start` process (`deploy/ecosystem.config.cjs`, `deploy/nginx/*`) |

### 3.2 Rendering and refresh

- Public pages are **static** with `export const revalidate = 300` on the root layout (`app/layout.tsx:63`).
- Saving settings calls `revalidatePath('/', 'layout')` (`app/admin/actions.ts:56`). The **Refresh public pages** button on the status page does the same (`app/admin/status/actions.ts:16`).
- `/contact` renders per request (`connection()`, `app/contact/page.tsx:26`).
- The tested consequence (`tests/integration/admin-settings.test.ts`, "saving publishes to every page on its next visit, with no rebuild or restart"): a saved public setting appears on every page's next visit.
- Prerequisites: one process, and no HTML caching in Nginx (`deploy/nginx/calix-proxy.conf` sets `proxy_cache off`).

### 3.3 Data the admin manages

These are store files in `SETTINGS_DIR`, all validated by `lib/settings/schema.ts`.

| File | Holds |
|---|---|
| `settings.json` | Public facts: legal name, address, email, phones, reply time, social profiles, footer copyright, and the form's pause switch with its message |
| `delivery.json` | Email on/off and recipient; Telegram on/off, chat ID and **encrypted** token. Refinement: at least one channel on |
| `status.json` | The last 200 delivery outcomes (codes only, no enquiry content), the last test per channel, and alert throttling |
| `admins.json` | Up to 10 administrators: scrypt hash, sealed TOTP, hashed recovery codes, `sessionVersion`, revoked session IDs |
| `audit.log`, `audit-access.log` | JSON Lines, hash-chained, rotated |
| `restore.json` | Restore journal: in-progress, complete or rolled-back. Never contains the secret, only a one-way check value |
| `instances/` | Per-process heartbeats, used to detect a second process |

---

## 4. Existing feature inventory

### 4.1 Public routes

Every route below is **verified**. "Content source" is where its text lives; "Admin" says what the admin controls on it today.

| Route | Purpose | Content source | Rendering | Admin today | Change needs a deploy? |
|---|---|---|---|---|---|
| `/` | Home: hero, services sequence, selected work, credibility, process, final CTA | `components/home/*`, `content/services.ts`, `content/work.ts`, `content/process.ts` | Static + revalidate | **Reply time** (hero, final CTA); footer facts | Copy, layout, sections: yes |
| `/services`, `/services/[service]` (5 pages, `dynamicParams = false`) | Service overview and detail | `content/services.ts`, `content/service-pages.ts` | Static | Reply time in the CTA band (`components/ui/PageParts.tsx`); footer | Yes |
| `/studio` | Studio, team, process | `app/studio/page.tsx`, `content/process.ts`, `content/site.ts` (gates) | Static | Footer and CTA band only | Yes |
| `/work`, `/work/[slug]` | Portfolio. Gate G1 (≥ 2 publishable projects); noindex until met | `content/work.ts` (empty; evidence rules checked at build) | Static | — | Yes, by design (evidence and approval rules) |
| `/insights`, `/insights/[slug]` | Articles. Gate G3 (≥ 3 approved articles); noindex until met | `content/insights.ts` (empty) | Static | — | Yes |
| `/contact` | Enquiry form, contact details | `app/contact/page.tsx`, `content/services.ts` (form options), settings | **Dynamic** | Email, phones, address, reply time, **pause switch and message** | Form fields: yes (a contract) |
| `/contact/thank-you` | Confirmation; noindex | settings | Static | Reply time | — |
| `/privacy` | Privacy facts; **legal notice is a placeholder** | `app/privacy/page.tsx` | Static | — | Yes; legal text needs an adviser |
| `/robots.txt`, `/sitemap.xml` | Crawling | `app/robots.ts`, `app/sitemap.ts` | Build | — | Infrastructure |
| Footer on every page | Positioning line, social links, copyright, email | `components/layout/SiteFooter.tsx` + settings | With the page | Legal name, email, phone, social profiles, copyright text | Link lists: yes |
| JSON-LD `Organization` (every page) | Structured data | `app/layout.tsx` + settings | With the page | `legalName`, `email`, `telephone`, `address` (only when set), `sameAs` | — |

**Behaviour that is not a page:**
- **Analytics** (`lib/analytics.ts`): events are dispatched as DOM events only. `sendToProvider` is intentionally empty. **No provider, no data, no cookies.**
- **Enquiry submission** (`app/contact/actions.ts` `submitEnquiry`). Its contract is protected by `tests/integration/contact-contract.test.ts`. The checks run in this order:
  1. honeypot;
  2. pause switch;
  3. validation;
  4. form token;
  5. rate limit by the trusted IP;
  6. delivery to every usable channel.

### 4.2 Admin surface (verified)

| Route / command | Purpose | Server Actions or functions | Auth |
|---|---|---|---|
| `/admin/login` | Password → TOTP (or enrolment on first sign-in) → recovery codes shown once | `signIn`, `verifyCode`, `completeEnrolment` (`app/admin/login/actions.ts`) | Public; throttled per account and per IP (`lib/admin/rate-limit.ts`) |
| `/admin` | **General settings**: company, address, email, phones (primary + 3), reply time, social profiles (≤ 6), footer copyright | `saveGeneralSettings` (`app/admin/actions.ts`) | `requireAdmin` |
| `/admin/notifications` | **Contact form and notifications**: pause switch; email/Telegram toggles, recipient, chat ID, write-only token; tests; channel status table (24 h / 7 day failures, last alert); recent deliveries | `saveFormStatus`, `saveDelivery` (re-authentication), `testEmail`, `testTelegram` (5 per 10 min) | `sessionForAction` |
| `/admin/status` | **System status**: store, permissions, disk, restore, locks, audit chain, form, delivery, Telegram gate, proxy header, instances, process manager, environment (set / not set), versions, uptime, pages; **Refresh public pages** | `refreshPublicPages` | `sessionForAction` |
| `/admin/security` | **Account and security**: change password, regenerate recovery codes (both need re-authentication), sign out everywhere, administrators list (read-only), recent activity (last 50 audit entries) | `changePassword`, `regenerateRecoveryCodes`, `signOutEverywhere` | `requireAdmin` |
| Header (every admin page) | Sign out; it reports when the server could not record it (`?signout=incomplete`) | `signOut` | Session |
| CLI `scripts/admin-user.mts` (operator, over SSH) | `list`, `add`, `reset`, `disable`, `enable`, `rekey`, `restore <archive> [--restore-admins]`, `restore --rollback` | — | Server shell access |

---

## 5. Category review: what should be editable

This covers every category in the audit brief (A–G). It distinguishes **website content management** (deliberately not in the admin) from **operational administration** (in the admin).

### A. Website content

| Content | Current source | Decision | Reason | Revisit when |
|---|---|---|---|---|
| Contact facts, legal name, address, social links, footer copyright, reply time | `settings.json` (defaults in `content/site.ts`) | **Fully editable (done)** | Change without a deploy, owned by the business | — |
| Page copy and layout, home sections, service pages, studio, process | `content/*.ts`, `components/**` | **Code-controlled** | Designed narrative and brand rules (`docs/calix-master-brief.md`, `docs/scroll-narrative.md`); changes need design review, not form edits | Copy changes become frequent and owned by non-developers |
| Case studies and portfolio | `content/work.ts` | **Code-controlled, specialised workflow** | Each project carries publication level, client approval reference and evidence grades, checked at build (`assertProjectValid`); a form would bypass that review | Several projects a month |
| Articles (Insights) | `content/insights.ts` | **Code-controlled** | Gate G3, named authors, editorial review | Regular publishing starts |
| Testimonials and verified outcomes | Placeholders (`docs/content-gaps.md` #2–3) | **Code-controlled** | Need written client permission and an approval reference | As above |
| Team | Placeholders (`/studio`) | **Code-controlled** | Gate G0 | — |
| SEO titles and descriptions, canonical URLs | `lib/seo.ts` (`pageMetadata` per page), `lib/site-url.ts` | **Code-controlled** | Coupled to routes, sitemap and gates (`docs/seo-audit.md`) | — |
| Navigation and footer link lists | `content/site.ts` (`primaryNav`), `SiteFooter.tsx` | **Code-controlled** | Coupled to routes and launch gates | — |
| Legal pages (privacy) | `app/privacy/page.tsx` | **Code-controlled; legal text required** | Needs qualified review. This audit doesn't write it | — |
| FAQs (service pages) | `content/service-pages.ts` | **Code-controlled** | Draft copy awaiting confirmation (`content-gaps` #17) | — |
| Banners and announcements | None exist | **Not needed.** The pause message covers the one operational notice the site has | — | A real need for site-wide notices appears |
| Localisation | None (English only) | **Not applicable** | — | — |

### B. Users and access

| Need | Decision | Evidence |
|---|---|---|
| Public user accounts | **None exist. No user management needed** | No sign-up, no visitor accounts anywhere in `app/` |
| Administrator accounts (1–3, at most 10) | **Done.** Created, reset, disabled and enabled by the operator CLI; read-only list in the admin | `scripts/admin-user.mts`; `app/admin/security/page.tsx` |
| Invitations or self-service onboarding | **Not recommended.** An invitation link is a new attack surface for 1–3 accounts | — |
| Password reset | **Done:** CLI `reset` (operator); change password in the admin (re-authentication) | `app/admin/security/actions.ts` |
| Roles | **One role** (§7) | `lib/settings/schema.ts` `adminRecord` has no role field |
| Session controls | **Done:** sign out, sign out everywhere, idle and absolute expiry, per-session revocation | `lib/admin/session.ts` |
| Data export and deletion | Not applicable for visitors: enquiries are **not stored**. Delivery records hold no personal data | `lib/delivery/log.ts`; `tests/integration/contact-delivery.test.ts` |

### C. Business operations

- **Enquiries are the only operational entity.** They are delivered, not stored (revision 2 §8.6), so there is **no inbox, CRUD, status workflow, bulk operation or export to build**.
- What the admin manages is delivery: channels, tests, outcomes and alerts. That is done (§4.2).
- A stored inbox would bring personal-data retention duties, and **is not recommended without an owner decision** (Q4).

### D. Configuration and settings

| Setting | Where | Decision |
|---|---|---|
| Public facts, form pause, delivery channels, recipient, Telegram chat and token | Admin | **Runtime-editable (done)** |
| SMTP host, port, user and password; `ENQUIRY_FROM`; `FORM_SECRET`; `SESSION_SECRET`; `SETTINGS_ENCRYPTION_KEY(_PREVIOUS)`; `SETTINGS_DIR`; `TRUSTED_PROXY_HEADER`; `TELEGRAM_DELIVERY_ALLOWED`; `SITE_URL`; `NOINDEX`; build flags | Environment (`README.md` table) | **Never editable in the UI.** The status page shows "set" or "not set" only (tested: `admin-auth.test.ts`, "the status page reports server settings as set or not set, never their values") |
| Branding, colours, logo | `lib/palette.ts`, `public/brand/` | **Code-controlled** (brand rules) |
| Feature flags, launch gates | `content/site.ts` `gates`, environment | **Code-controlled** (coupled to content) |
| Upload limits, media policies | None: no uploads | **Not applicable** |

### E. Notifications

**Done:**
- channel toggles;
- test sends;
- per-channel status and failure counts;
- recent outcomes (the last 200 kept, with no content);
- cross-channel failure alerts, throttled.

**Not needed:**
- **template editing:** the email format is a contract that mailbox rules may depend on (`ADMIN_PANEL_API_GAPS.md` §3);
- **in-app notifications;**
- **notification preferences:** there is one audience, the studio.

### F. Analytics and monitoring

| Kind | Decision |
|---|---|
| Business KPIs (traffic, conversion) | **No data exists.** No analytics provider is configured (`lib/analytics.ts`). Building a KPI dashboard needs a provider and a consent decision first (Q3). Not recommended now |
| Enquiry volume | Derivable from `status.json` records of kind `enquiry`. **Bounded to the last 200 records**, so it is a short-window indicator, not a report (§10) |
| System health | **Done:** `/admin/status` (16 checks, `lib/admin/status.ts`) |
| Audit events | **Done:** recent 50 on `/admin/security`, chain verification on `/admin/status`. Filtering, paging and the access log are **partial** (AUD-02) |

### G. Media

- **No uploads, no media library, by design.**
- The only media are brand files in `public/brand/` and future case-study visuals referenced by path in `content/work.ts`, with alt text and captions reviewed in code.
- An upload feature would add the unsafe-upload, orphaned-file and broken-reference risks listed in the brief, with no current need.

---

## 6. Recommended admin structure

The current navigation (`app/admin/layout.tsx`) fits the scope, so **no new sections are recommended**.

| Section | Purpose | Key actions | Data | Permission | Phase |
|---|---|---|---|---|---|
| General settings `/admin` | Public facts | Save (conflict-checked) | `settings.json` | Administrator | Done |
| Contact form and notifications `/admin/notifications` | Pause; channels; tests; outcomes | Save form status; save delivery (re-authentication); test email/Telegram | `settings.json` (form), `delivery.json`, `status.json` | Administrator; re-authentication for delivery changes | Done |
| System status `/admin/status` | Health and operations | Refresh public pages | Read-only checks | Administrator | Done |
| Account and security `/admin/security` | Own account; administrators; activity | Change password, recovery codes (re-authentication); sign out everywhere | `admins.json`, `audit.log` | Administrator | Done; activity view partial (AUD-02) |

**Recommended small additions** (backlog in the plan):
- An **overview strip** at the top of `/admin`: open problems from the status checks, failed deliveries in the last 24 h, and the last change (§10).
- **Activity filters and paging**, and a read-only access-log view (AUD-02).
- An **unsaved-changes warning** on the three editable forms (UI-01).

**UI pattern** (already established; keep it for any addition):
- Forms are server-rendered, validated on the server (Zod), with inline field errors and a summary (`error-summary`, `role="alert"`).
- Input is kept on error, and every outcome message is honest ("Nothing was saved…").
- Tables use `admin-table` inside a focusable scroll region (`admin-scroll`, `role="region"`).
- Sensitive actions **re-authenticate in the form** (password plus a fresh code) instead of using a confirmation dialog.
- Empty states say what the site shows instead ("Never", "No enquiries yet").

---

## 7. Authorization model

**Current (verified):**
- One role, Administrator, for 1–3 people.
- `requireAdmin()` / `sessionForAction()` is the first call in every admin page and action (`lib/admin/session.ts`). `tests/unit/server-actions.test.ts` checks every exported action of every `"use server"` file.
- `proxy.ts` sets headers and refreshes the idle timer; it is **not** an authorisation boundary, and its comment says so.
- Account administration (create, reset, disable, enable) is **operator-only through the CLI**, which is a separation of duties: a stolen admin session can't create accounts.

**Recommendation:** keep one role. A Content Manager / Operations / Read-only split is unjustified for 1–3 people sharing all duties. The schema allows at most 10 administrators.

**Revisit if:** a non-owner needs access to delivery settings or the token. In that case, add a read-only role that can see status and outcomes, with `delivery.save` limited to the existing Administrator.

| Sensitive action | Control today |
|---|---|
| Change recipient, chat ID, token; enable Telegram | Re-authentication (password + fresh TOTP, `lib/admin/reauth.ts`); Telegram requires a successful test bound to the token and chat; the token is write-only |
| Change password; regenerate recovery codes | Re-authentication |
| Sign out everywhere | Session; bumps `sessionVersion` |
| Create, reset, disable or enable an account; rekey; restore | Server shell only (CLI) |
| Enable Telegram delivery at all | Environment `TELEGRAM_DELIVERY_ALLOWED=true` (operator sign-off after the privacy notice; `lib/delivery/plan.ts`) |

Tenant isolation is **not applicable**: there is one organisation and no multi-tenant data.

---

## 8. Security and auditability assessment

### 8.1 Controls verified against the brief

| Risk | Status | Evidence |
|---|---|---|
| Broken access control / missing backend checks | Controlled | `requireAdmin` everywhere; `tests/unit/server-actions.test.ts`; `admin-auth.test.ts` ("a stolen form replayed without a session changes nothing") |
| CSRF | Controlled | Server Actions only, with Next.js Origin/Host check; `SameSite` cookies; Nginx passes `Host $http_host` (`deploy/nginx/calix-proxy.conf`); tested ("a cross-site form post is refused before the action runs") |
| Session security | Controlled | `__Host-` cookies; HMAC; idle and absolute expiry; server-side revocation (copied cookie refused, tested); failed revocation reported as incomplete (`admin-session-edges.test.ts`); restore requires secret rotation |
| Brute force | Controlled in the app; **Nginx layer missing** (F3) | `lib/admin/rate-limit.ts`; `tests/unit/rate-limit.test.ts` |
| Trusted client IP | Controlled | `lib/client-ip.ts` reads only `TRUSTED_PROXY_HEADER`; Nginx overwrites `X-Real-IP` and `X-Forwarded-For`; status check "proxy-header" |
| Mass assignment | Controlled | Strict Zod objects; fields read explicitly (`lib/settings/general-form.ts` `readValues`); `tests/unit/input-hardening.test.ts` |
| Stored XSS / unsafe HTML | Controlled | Plain text only (single line, no control characters); React escaping; JSON-LD through the escaping `JsonLd` component; URLs `https:` with a host allow-list per platform; `tel:` from E.164 |
| Secret exposure | Controlled | Token sealed and write-only; status shows set/not set; seeded-secret tests ("the bot token never appears in pages, responses or server logs"); CI diagnostics redacted (`tests/helpers/diagnostics.ts`) |
| Unsafe uploads | Not applicable | No upload anywhere |
| Insecure destructive operations | Controlled | No delete in the UI. Restore and rollback are CLI-only, refuse while the site runs, and are journalled |
| Audit trail | Done | Two hash-chained streams; actor, action, outcome, IP hash (HMAC), redacted changes; chain verified on the status page; never passwords, codes, tokens or full secrets |
| Admin headers | Done | Nonce CSP, `no-store`, `X-Robots-Tag`, COOP, `Referrer-Policy: no-referrer` (`proxy.ts`) |

### 8.2 Findings

| ID | Severity | Finding | Evidence | Recommended remediation |
|---|---|---|---|---|
| F1 | **Medium (legal); release-blocking for Telegram only** | The legal privacy notice is a placeholder. The facts list says enquiries are "sent to CALIX by email" and doesn't mention Telegram, delivery-outcome records (no content), or the hashed addresses in the admin access log | `app/privacy/page.tsx`; `docs/content-gaps.md` #7, #21 | Owner and legal adviser supply the text (this audit doesn't write it). Telegram already stays off without `TELEGRAM_DELIVERY_ALLOWED=true` (`lib/delivery/plan.ts`, tested) |
| F2 | Low | Public pages send no `script-src`/`default-src` (CSP is `frame-ancestors`, `base-uri`, `form-action`, `object-src` only). Revision 2's "hash the motion script" plan is insufficient, because the bundled Next.js guide says nonces need dynamic rendering, and the hash option is **experimental SRI** | `next.config.ts` `securityHeaders`; `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` ("Static vs Dynamic Rendering with CSP", "Subresource Integrity (Experimental)") | Investigation task (plan R-05): try `experimental.sri` with `script-src 'self'` plus the motion-script hash on a production build; accept only if no violations on every route. Not a blocker: public pages render no stored HTML |
| F3 | Low | No Nginx `limit_req` on `/admin/login`, nor the optional allow-list. Only comments point to the runbook | `deploy/nginx/calix-proxy.conf`, `deploy/nginx/calix.conf.example` (no `limit_req`) | Add a `limit_req_zone` + `location = /admin/login` snippet (plan R-03) |
| F4 | Low | During an unfinished restore, the CLI account commands still run. `performRollback` puts back `admins.json` if the restore replaced it, undoing those changes (for example re-enabling an account the operator just disabled) | `scripts/admin-user.mts` (`add`, `reset`, `enable`, `disable`, `rekey` don't check `restoreState`); `lib/admin/restore.ts` `performRollback` | Refuse those commands while `restoreState().state` is `in-progress` or `unreadable`, pointing to `restore --rollback` (plan R-04) |
| F5 | Info | Locks and heartbeats assume one machine (PIDs). A settings folder shared between hosts isn't supported | `lib/settings/store.ts` (`holderAlive`); `lib/admin/instances.ts` | Documented constraint; keep single-host (runbook §2) |
| F6 | Info | The audit view shows the last 50 main-stream entries only; the access log isn't viewable in the UI; there's no export | `app/admin/security/page.tsx` (`recentAudit(50)`) | Plan R-07 (filters, paging, access log, read-only) |
| F7 | Info | Enrolment shows the TOTP secret as text and an `otpauth:` link; there's no QR image | `app/admin/login/LoginForms.tsx` `EnrolForm` | Acceptable (no dependency). Optional QR later (P3) |

**Not a finding, confirmed safe:** `TELEGRAM_API_BASE` exists for tests but is honoured only for `127.0.0.1`/`localhost` (README environment table).

---

## 9. API and data-model gaps (summary)

`ADMIN_PANEL_API_GAPS.md` has the details. In short:
- **No new endpoints or store files are needed** for the current scope.
- **Gaps are local extensions:**
  - a `restoreState` check in the CLI (F4);
  - `recentAudit` options for filtering and the access stream (F6);
  - an overview data function reusing `systemStatus(headers)` and `status.json` (§10);
  - Nginx config (F3);
  - a CSP investigation (F2).
- **Nothing proposed changes a public contract:** form fields, redirect query, email format, store schemas.

---

## 10. Admin dashboard recommendation

There is **no landing dashboard today**: `/admin` opens on General settings. The recommendation is a compact **overview strip at the top of `/admin`** rather than a new page, because the data is small.

| Widget | Measures | Why | Data source (exists?) | Calculation | Roles |
|---|---|---|---|---|---|
| Open problems | Status checks at level `problem` / `warn` | One glance at "is anything broken" | `systemStatus(headers)` in `lib/admin/status.ts` (exists) | Count by level; link to `/admin/status` | Administrator |
| Delivery failures (24 h) | Enquiry records with a failed channel | An unseen failing channel loses response time | `status.json` records (exists; already computed on `/admin/notifications`) | Same as `failures()` in `app/admin/notifications/page.tsx` | Administrator |
| Enquiries received (last 7 days) | Count of `kind: "enquiry"` records with ≥ 1 confirmed | A rough activity signal | `status.json` (exists) | **Bounded by the 200-record cap**; label it "of the last 200 recorded" | Administrator |
| Last change | The most recent `audit.log` entry | Notice unexpected changes | `recentAudit(1)` (exists) | — | Administrator |
| Restore state | Pending, unfinished or last restore | Operator safety | `restoreState()` (exists) | — | Administrator |

**Not recommended:**
- **traffic and conversion charts:** there is no analytics data (§5F);
- **any widget needing enquiry content:** enquiries aren't stored.

---

## 11. Website-to-admin editability matrix

| Website page or feature | Current content source | Editable in admin? | Admin module | Required actions | Backend/API gap | Priority | Evidence |
|---|---|---|---|---|---|---|---|
| Footer: legal name, email, phone, copyright | `settings.json` → `SiteFooter.tsx` | **Fully (done)** | General settings | Save | None | — | `components/layout/SiteFooter.tsx`; `admin-settings.test.ts` |
| Footer: social links | `settings.json` | **Fully (done)** | General settings | Save (≤ 6, host-checked) | None | — | `lib/settings/schema.ts` `socialProfile` |
| Footer: positioning line, link lists | `content/site.ts`, `SiteFooter.tsx` | Intentionally hardcoded | — | — | — | — | Brand decision (§5A) |
| JSON-LD Organization facts | `settings.json` → `app/layout.tsx` | **Fully (done)**, emitted only when set | General settings | Save | None | — | `app/layout.tsx:66–80` |
| Reply time (hero, final CTA, CTA band, contact, thank-you) | `settings.json` | **Fully (done)** | General settings | Save | None | — | `Hero.tsx`, `HomeSections.tsx`, `PageParts.tsx`, contact pages |
| Contact page: email, phones, address | `settings.json` | **Fully (done)** | General settings | Save | None | — | `app/contact/page.tsx` |
| Contact form open/paused + message | `settings.json` `form` | **Fully (done)**, enforced on the server | Contact form and notifications | Save form status | None | — | `app/contact/actions.ts:41`; "paused…" integration test |
| Enquiry delivery (channels, recipient, Telegram) | `delivery.json` + environment | **Specialised workflow (done)**: test-before-enable, re-authentication | Contact form and notifications | Save, test | None | — | `app/admin/notifications/actions.ts` |
| Contact form fields and options | `lib/enquiry/schema.ts`, `content/services.ts` | Intentionally hardcoded | — | — | — | — | A contract (`contact-contract.test.ts`) |
| Home sections, service pages, studio, process copy | `content/*.ts`, components | Intentionally hardcoded | — | — | — | — | §5A |
| Work / case studies | `content/work.ts` | Specialised workflow **in code** (evidence rules) | — | — | — | — | `assertProjectValid` |
| Insights / articles | `content/insights.ts` | Intentionally hardcoded (gate G3) | — | — | — | — | — |
| SEO metadata, canonical, sitemap, robots | `lib/seo.ts`, `app/sitemap.ts`, `app/robots.ts` | Intentionally hardcoded | — | — | — | — | — |
| Privacy page | `app/privacy/page.tsx` | Intentionally hardcoded; **legal text missing** | — | — | Owner/legal (F1) | P0 for Telegram | `docs/content-gaps.md` #7, #21 |
| Brand assets, palette | `public/brand/`, `lib/palette.ts` | Intentionally hardcoded | — | — | — | — | Brand rules |
| Launch gates, build flags | `content/site.ts` `gates`, environment | Deployment-controlled | — | — | — | — | — |
| Public page cache refresh | `revalidatePath` | **Operational action (done)** | System status | Refresh public pages | None | — | `app/admin/status/actions.ts` |

---

## 12. Roadmap summary

Most of revision 2's phases are delivered (`ADMIN_PANEL_IMPLEMENTATION_PLAN.md` §1). Remaining backlog, in order:

| ID | Task | Priority | Effort |
|---|---|---|---|
| R-01 | Privacy notice: Telegram, delivery records, admin access log (**owner and adviser**; then the operator may set `TELEGRAM_DELIVERY_ALLOWED`) | P0 (Telegram) | S (non-code) |
| R-02 | Verification: observe the GitHub Actions workflow passing; run the runbook §11 server checks (single PM2 fork process, persistent `SETTINGS_DIR`, Nginx snippet, egress to `api.telegram.org`, a real SMTP delivery) | P0 | S |
| R-03 | Nginx `limit_req` for `/admin/login` (+ documented optional allow-list) | P2 | XS |
| R-04 | CLI: refuse account and rekey commands during an unfinished or unreadable restore | P2 | S |
| R-05 | Public CSP investigation (experimental SRI vs. the status quo) | P3 | M |
| R-06 | Overview strip on `/admin` | P3 | S |
| R-07 | Activity view: filters, paging, access log (read-only) | P3 | S |
| R-08 | Unsaved-changes warning on admin forms | P3 | XS |
| R-09 | Accessibility audit of the admin screens (WCAG 2.2 AA), with screenshots at 1440/768/390 | P2 | S |
| R-10 | Optional QR image for authenticator enrolment (F7) | P3 | S |

---

## 13. Testing and acceptance

**Existing coverage (Tested)**, file by file:

| File | Covers |
|---|---|
| `tests/unit/server-actions.test.ts` | Every action checks the session |
| `tests/integration/admin-auth.test.ts` | Sign-in, enrolment, recovery codes, concurrency, CSRF, audit chain, status secrecy |
| `tests/integration/admin-session-edges.test.ts` | Failed revocation, copied cookies |
| `tests/integration/admin-browser.test.ts` | Real Chromium: `__Host-` cookies, idle refresh |
| `tests/integration/admin-settings.test.ts` | Runtime refresh, conflicts, defaults |
| `tests/integration/admin-notifications.test.ts` | Delivery settings and tests |
| `tests/integration/contact-delivery.test.ts` | Every channel configuration, timeouts, token secrecy |
| `tests/integration/contact-contract.test.ts` | The public form contract |
| `tests/unit/restore.test.ts`, `tests/integration/admin-restore.test.ts` | Restore, rollback, crash safety |
| `tests/unit/locks.test.ts` | The cross-process lock |
| `tests/prodlike/nginx-pm2.test.ts` | Nginx + PM2: forged headers, single process, restore procedure |

**Acceptance criteria for the remaining work:**

1. **R-03:** more than the configured rate of POSTs to `/admin/login` from one address gets HTTP 429 from Nginx. The rest of the site is unaffected. A production-like test checks this.
2. **R-04:** with `restore.json` in progress or unreadable:
   - `admin-user add|reset|enable|disable|rekey` exit non-zero with guidance and change nothing (file hashes unchanged);
   - `list` still works.
3. **R-05:** with the chosen CSP:
   - zero violations on every public route at 1440 and 390 (production build, motion on and off);
   - static rendering preserved (`next build` output unchanged in kind).

   If not achievable, document the decision and keep the current headers.
4. **R-06 / R-07:**
   - no secret, token, password hash or full IP in any new view (seeded-secret scan);
   - the access log is shown read-only;
   - pages call `requireAdmin("page")`.
5. **R-08:** leaving a form with unsaved edits asks for confirmation; saving or resetting clears the warning; keyboard- and screen-reader-operable.
6. **Every change:** `npm run typecheck`, `npm run lint`, `npm test`, `CALIX_REQUIRE_BROWSER=1 npm run test:integration`, `npm run verify:builds`, `CALIX_REQUIRE_PRODLIKE=1 npm run test:prodlike`, `npm audit --audit-level=high`, plus the `CLAUDE.md` screenshot and palette checks for any visible change.

---

## 14. Assumptions, limitations and open questions

**Assumptions:**
- One server, one PM2 fork process, and a persistent `SETTINGS_DIR` (reported; enforced by status checks; not observed).
- The scope decision of revision 2 (no CMS, no enquiry storage) stands unless the owner says otherwise.

**Limitations:**
- No access to the live server or to GitHub Actions results.
- Test results quoted are from the latest local run recorded in this session, not from CI.

**Questions for the product owner:**

| # | Question | Recommended answer |
|---|---|---|
| Q1 | Who drafts and approves the privacy notice text (F1), and should Telegram be used at all at launch? | Launch with email only; enable Telegram after the notice is published |
| Q2 | Should page copy, case studies or articles ever be edited outside the code? | Not now; revisit when content changes more than monthly (§5A) |
| Q3 | Will an analytics provider be chosen (needs a consent decision)? | Only then consider KPI widgets |
| Q4 | Is an enquiry inbox (stored enquiries) wanted? | No: it adds personal-data storage and retention duties for no current need |
| Q5 | Should `/admin` be limited to known IP addresses in Nginx (optional allow-list)? | Yes if the team works from stable addresses |
