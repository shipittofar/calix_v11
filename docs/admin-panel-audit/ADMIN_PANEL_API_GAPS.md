# CALIX — Admin Panel API and Backend Gaps (revision 3: post-implementation)

**Companion to:** `ADMIN_PANEL_AUDIT.md`, `ADMIN_PANEL_FEATURE_MATRIX.md`, `ADMIN_PANEL_IMPLEMENTATION_PLAN.md`.
**Date:** 2026-10-24. **Audited commit:** `5bcd584`.

**Labels:**
- **Existing:** verified in the repository at that commit.
- **NEW (proposed):** a recommendation from this audit. It does not exist yet.
- **External:** a third-party API.

**Architecture note:** there is no REST or GraphQL API, no `app/api/*` route handler, and no database. Every mutation is a **Server Action** (`POST`-only, with Next.js's Origin/Host check), and persistence is a set of validated JSON files. The "endpoints" below are therefore Server Actions and server-only functions, and "database changes" are store-schema changes.

---

## 1. Existing backend surface (verified)

### 1.1 Server Actions

These are all the exports of `"use server"` files. `tests/unit/server-actions.test.ts` keeps this list explicit and checks that each admin action verifies the session first.

| Action | File | Auth | Input → effect | Audit action |
|---|---|---|---|---|
| `submitEnquiry` | `app/contact/actions.ts` | Public; honeypot, form token, rate limit (trusted IP), pause switch | Form → dispatch to usable channels → thank-you redirect only if ≥ 1 confirmed | — (delivery outcome to `status.json`) |
| `signIn` | `app/admin/login/actions.ts` | Public; per-account and per-IP limits | Email + password → pre-auth cookie (stage `code` or `enrol`) | `auth.signin` |
| `verifyCode` | same | Pre-auth cookie; limits | TOTP or recovery code → session cookie | `auth.code`, `auth.signin` |
| `completeEnrolment` | same | Pre-auth cookie (stage `enrol`); limits | Code → stores the TOTP secret; recovery codes shown once | `auth.enrol` |
| `signOut` | same | Session | Revokes this session on the server; reports `?signout=incomplete` if that fails | `auth.signout` |
| `saveGeneralSettings` | `app/admin/actions.ts` | `requireAdmin` | Form + `revision` → `settings.json` (keeps `form`), `revalidatePath('/', 'layout')` | `settings.general.save` (changed field names) |
| `saveFormStatus` | `app/admin/notifications/actions.ts` | `sessionForAction` | Accepting + message + `revision` → `settings.json.form` | `settings.form.save` |
| `saveDelivery` | same | Session + **re-auth** (`confirmIdentity`) | Email on/recipient, Telegram on/chat, new token or remove → `delivery.json`; Telegram needs a matching successful test | `delivery.save` (recipient masked; token "replaced"/"removed") |
| `testEmail`, `testTelegram` | same | Session; 5 per 10 min | Fixed test message → `status.json.lastTest` | `delivery.test.email`, `delivery.test.telegram` |
| `refreshPublicPages` | `app/admin/status/actions.ts` | `sessionForAction` | `revalidatePath('/', 'layout')` | `pages.refresh` |
| `changePassword` | `app/admin/security/actions.ts` | `requireAdmin` + re-auth | New password → hash; other sessions end | `auth.password.change` |
| `regenerateRecoveryCodes` | same | `requireAdmin` + re-auth | New codes shown once | `auth.recovery.regenerate` |
| `signOutEverywhere` | same | `requireAdmin` | Bumps `sessionVersion` | `auth.signout.everywhere` |

### 1.2 Server-only read functions used by pages

| Function | File | Returns (never secrets) |
|---|---|---|
| `getPublicSettings()` / `toPublicSettings()` | `lib/settings/public.ts` | Public facts with `Pending` fallbacks. **The only settings read that public components use** |
| `readStore(name)` | `lib/settings/store.ts` | A validated store value, or `null`. Missing or invalid falls back to the last good value, then `.bak`, then `null` |
| `deliveryView()` | `lib/delivery/admin.ts` | Channel states (enabled, ready, problem code), last tests, records, alert times. The token appears only as "set" or "not set" |
| `systemStatus(headers)` | `lib/admin/status.ts` | 16 checks with level and detail. Environment values are shown as set or not set |
| `recentAudit(n)`, `verifyAuditChain(stream)` | `lib/admin/audit.ts` | The last *n* main-stream lines; chain integrity |
| `listAdmins()` | `lib/admin/users.ts` | Admin records. Pages render email, status and last sign-in only |
| `restoreState()` | `lib/admin/restore.ts` | `{ pending, state, at, archive, aside }`. Never the secret |
| `longHeldLocks()` | `lib/settings/store.ts` | Lock file names and ages (no paths) |

### 1.3 Operator CLI (`scripts/admin-user.mts`, existing)

| Command | Effect |
|---|---|
| `list` | Show administrators |
| `add <email>` | Create an account (password from a prompt or stdin) |
| `reset <email>` | Set a new password and clear the authenticator and recovery codes; signs the account out |
| `disable <email>`, `enable <email>` | Change status and bump `sessionVersion` |
| `rekey` | Re-encrypt sealed values with the current key |
| `restore <archive> [--restore-admins]` | Journalled restore (`lib/admin/restore.ts`) |
| `restore --rollback` | Undo an unfinished restore, or a finished one still waiting for the secret change |

---

## 2. Store files (existing schemas, `lib/settings/schema.ts`)

All objects are `.strict()`, so unknown fields are rejected. Every file has `version`, `revision`, `updatedAt` and `updatedBy`.

| File | Key fields | Invariants |
|---|---|---|
| `settings.json` | `business.{legalName, address}`, `contact.{email, phonePrimary, phonesAdditional[≤3], replyTime}`, `social.profiles[≤6]`, `footer.copyrightText`, `form.{acceptingEnquiries, pausedMessage}` | Plain single-line text with no control characters; E.164 phones; `https:` profile URLs with a host allow-list per platform; only `{year}` as a placeholder; a paused form needs a message |
| `delivery.json` | `email.{enabled, recipient}`, `telegram.{enabled, chatId, botToken.{sealed, savedAt}}` | At least one channel enabled |
| `status.json` | `records[≤200]` (at, requestId, kind, per-channel `confirmed` or a code, ms), `lastTest`, `lastAlertAt` | No enquiry content: result codes match `^[a-z_0-9]{1,40}$` |
| `admins.json` | `admins[≤10]`: id, email, status, `passwordHash`, `totp`/`pendingTotp` (sealed), `recoveryCodes` (hashed), `sessionVersion`, `revokedSessions[≤50]` | Unique emails |
| `restore.json` | `v: 2`, `state` (`in-progress` \| `complete` \| `rolled-back`), `at`, `archive`, `aside`, `check`, `existed[]`, `replaces[]` | An unreadable or invalid marker counts as an unfinished restore |
| `audit.log`, `audit-access.log` | `at`, `adminId`, `action`, `outcome`, `ipHash`, `changes`/`detail`, `prevHash` | Append-only, hash-chained, rotated |

---

## 3. Contracts that must not break

| Contract | Consumers | Protected by |
|---|---|---|
| Form field names, `ref`, honeypot and token fields | `EnquiryForm.tsx`; no-JavaScript posts | it `contact-contract.test.ts` |
| Redirect `/contact/thank-you?submitted=1&services=…&timeline=…`, issued only on confirmed delivery | `TrackSubmission.tsx` | it `contact-contract.test.ts`, `contact-delivery.test.ts` |
| Error states with values kept (`UNAVAILABLE`, `RESEND`, rate limit, pause message) | Visitors | Same |
| Email subject and body format | The CALIX mailbox and possible rules | it "email format unchanged" |
| No `delivery.json` → email to `ENQUIRY_TO` exactly as before | Existing deployments | ut `delivery.test.ts` (`resolvePlan`) |
| No `settings.json` → the site renders the `content/site.ts` defaults | Every page | it "before saving, every page shows the defaults"; "clearing the fields returns the site to the defaults" |
| Builds never need the store | CI | `verify:builds` |
| Store schemas (`STORE_VERSION = 1`) | Existing files on the server; backups | Any schema change needs a migration path (see §5) |

---

## 4. Gaps and proposals

All of these are **NEW (proposed)**. None needs a new store file, a new Server Action that writes data, or a change to a public contract.

### 4.1 R-04: CLI guard during an unfinished restore (STO-05, finding F4)

- **Where:** `scripts/admin-user.mts`, before the `add`, `reset`, `enable`, `disable` and `rekey` branches.
- **Behaviour:** `const s = await restoreState(); if (s.state === "in-progress" || s.state === "unreadable") fail(…)`.
  - The message names `admin-user restore --rollback` (or runbook §5 for an unreadable marker).
  - `list` and `restore` are unaffected.
- **Reuse:** `restoreState()` (existing).
- **Data changes:** none.
- **Tests:** in `tests/unit/restore.test.ts`, with an in-progress marker, a garbage marker and a directory in its place:
  - each guarded command exits non-zero;
  - every data-file hash is unchanged;
  - `list` works.

### 4.2 R-03: Nginx sign-in rate limit (AUTH-04, finding F3)

This is configuration, not an API.
- **Where:** `deploy/nginx/calix.conf.example`, or a new snippet:
  - a `limit_req_zone $binary_remote_addr zone=calix_login:1m rate=10r/m;` in the `http` context;
  - a `location = /admin/login { limit_req zone=calix_login burst=5 nodelay; include …calix-proxy.conf; }`.
- **Check:** Server Actions post to the page URL (`/admin/login`), so the location matches sign-in posts. Verify that with the production-like test.
- **Tests:** in `tests/prodlike/nginx-pm2.test.ts`, a burst of posts gets HTTP 429 from Nginx, and `/` is unaffected.

### 4.3 R-07: activity view (AUD-02, finding F6)

- **Function:** extend the existing `recentAudit(n)` to `recentAudit({ stream?: "main" | "access", limit?: number, before?: string, action?: string, outcome?: AuditEvent["outcome"] })`.
  - Read-only, and it reads rotated files only as needed.
  - **Backward-compatible:** keep the `recentAudit(50)` call shape via an overload.
- **Page:** `/admin/security` with GET query filters, or a new `/admin/activity`, behind `requireAdmin("page")`.
  - No new Server Action, because filters are GET parameters.
  - Parameters are validated with Zod and limits clamped.
- **Never render:** full IPs (only `ipHash` prefixes, if anything), changes beyond the already-redacted `changes`, or secrets.
- **Tests:**
  - filter and paging unit tests;
  - an integration test that the access log is visible only when signed in;
  - a seeded-secret scan.

### 4.4 R-06: overview strip (`ADMIN_PANEL_AUDIT.md` §10)

- **Function:** a server-only `adminOverview(headers)` in `lib/admin/status.ts` that composes existing data:
  - status-check counts by level (from `systemStatus(headers)`);
  - 24 h delivery failures (the same logic as `failures()` in `app/admin/notifications/page.tsx`; move it to `lib/delivery/admin.ts` so it isn't duplicated);
  - enquiry count in the last 7 days, labelled as bounded by the 200-record buffer;
  - the last audit entry;
  - the restore state.
- **Page:** the top of `app/admin/page.tsx`.
- **Data changes:** none.
- **Tests:**
  - unit tests for the composition;
  - an integration test that the strip renders and links to `/admin/status`.

### 4.5 R-05: public CSP (SEC-03, finding F2)

- **Investigation, not an API.** In `next.config.ts`:
  - `experimental: { sri: { algorithm: "sha256" } }`;
  - a public CSP with `script-src 'self' <motion-script hash>` (reuse `MOTION_BOOT_SCRIPT` from `lib/motion.ts`, as `proxy.ts` does).
- **Keep the admin's own nonce CSP.** Today the `next.config.ts` headers use `source: "/:path*"`, so `/admin` responses already carry both the public CSP and the admin CSP from `proxy.ts`.
  - Browsers enforce both. That is harmless now, because the public CSP has no script or style rules.
  - A strict public `script-src` would block the admin's nonce scripts. Exclude `/admin` from the public header's `source` in the same change.
- **Accept only with:** zero violations on all routes (Playwright console check), and static output preserved.
- **Fallback:** record the decision and keep today's headers. Because SRI is experimental, pin the Next.js version while relying on it.

### 4.6 R-08: unsaved-changes warning (UI-01)

- **Client-only:** a small hook in the three client form components (`GeneralForm.tsx`, `NotificationForms.tsx`) sets `beforeunload` while the form is dirty.
- **No server change.**

---

## 5. Backward-compatibility and deployment risks

| Change | Risk | Mitigation |
|---|---|---|
| R-04 CLI guard | An operator blocked mid-incident | The message gives the next command; `list` still works; the runbook already describes rollback |
| R-03 Nginx `limit_req` | Legitimate admins rate-limited while typing codes | `burst` and a generous rate; the application's limits stay authoritative; test first in the production-like suite |
| R-05 CSP | A strict `script-src` breaks hydration on some route | Investigation gate with a violation scan on every route; scope the header away from `/admin` |
| R-07 audit options | Reading large rotated logs on a request | Clamp limits; read newest first; stop at the limit |
| Any future store-schema change | Old files fail validation and the site falls back to defaults | Bump `STORE_VERSION` only with a migration in `readStore`'s parse path; cover with a unit test reading a file from the previous version |
| Telegram enablement | Personal data sent to Telegram before the notice exists | Code gate `TELEGRAM_DELIVERY_ALLOWED`; LEG-01 first |
