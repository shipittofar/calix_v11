# CALIX — Admin Panel Feature Matrix (revision 3: post-implementation)

**Companion to:** `ADMIN_PANEL_AUDIT.md` (§ numbers below refer to it).
**Date:** 2026-10-24. **Audited commit:** `5bcd584`.

Revision 2 rows keep their IDs. Revision 3 changes their status from the code, and adds:
- **STO-04**, **STO-05**, **AUD-02**, **OPS-01**, **LEG-01** (new capabilities or gaps found by this audit);
- **CAT-01 to CAT-15**: content areas reviewed and intentionally kept in code. They are not counted as gaps.

**Status values:**

| Status | Meaning |
|---|---|
| Implemented | The full workflow works and is authorised on the server, with evidence in code and tests |
| Partially implemented | Some of the required behaviour exists |
| Missing | Doesn't exist |
| Needs verification | The evidence lies outside the repository |
| Hardcoded (intentional) | Kept in code by decision (`ADMIN_PANEL_AUDIT.md` §5) |

**Other conventions:**
- **Priority:** P0 before production · P1 first release · P2 next · P3 optional.
- **Effort:** relative only (XS < S < M < L).
- **Role:** "Admin" = the single Administrator role. "Operator" = server shell access.
- **Abbreviations:** "it" = `tests/integration`, "ut" = `tests/unit`, "pl" = `tests/prodlike`.

---

## Existing capabilities reused

| ID | Capability | Status | Evidence | Required behaviour | Priority | Notes |
|---|---|---|---|---|---|---|
| EXI-01 | Enquiry validation and spam defence | Implemented | `app/contact/actions.ts`; `lib/enquiry/{schema,spam}.ts`; it `contact-contract.test.ts` | Unchanged contract | — | Field names and the redirect query are contracts |
| EXI-02 | Email over SMTP | Implemented | `lib/delivery/email.ts`; it `contact-delivery.test.ts` ("email format unchanged") | The email channel; subject and body unchanged | — | — |
| EXI-03 | `Pending` fallback for missing facts | Implemented | `content/site.ts`; `components/ui/Pending.tsx`; `lib/settings/public.ts` | Unset settings stay `Pending` | — | — |
| EXI-04 | CI validation and build-output checks | Implemented in the repository | `.github/workflows/validate.yml`; `scripts/check-story.mjs` | Required browser and prodlike modes; audit; pinned Node and actions | — | GitHub run not observed: OPS-01 |
| EXI-05 | Security headers baseline | Partially implemented | `next.config.ts` (HSTS, nosniff, Referrer-Policy, Permissions-Policy, CSP without `script-src`); admin: `proxy.ts` | Public `script-src`: SEC-03 | P3 | — |

## Environment and operations

| ID | Capability | Status | Evidence | Required behaviour | Role | Priority | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|
| ENV-01 | One `next start` process, persistent `SETTINGS_DIR` | Needs verification (live server) | Repository side done: `deploy/ecosystem.config.cjs` (fork, `instances: 1`); status checks `process`, `instances`, `store`; pl `nginx-pm2.test.ts` | Live PM2 shows one fork process; folder survives deploy and reboot | Operator | P0 | XS | Runbook §11 checks recorded |
| ENV-02 | Production SMTP delivers | Needs verification | `README.md` environment table; status check `delivery` | A real enquiry arrives with Reply-To | Operator | P0 | XS | Test enquiry received; `/admin/notifications` shows "confirmed" |
| ENV-03 | Egress to `api.telegram.org` | Needs verification | Runbook §8 | Only if Telegram is used | Operator | P0 (Telegram) | XS | Test Telegram message confirmed |
| OPS-01 | CI workflow passes on GitHub | Needs verification | `.github/workflows/validate.yml` (never observed on GitHub; local equivalents passed) | Both jobs green on GitHub | Operator / developer | P0 | XS | A green run linked in the release notes |
| LEG-01 | Privacy notice covers Telegram, delivery records, admin access log | Missing (owner/legal; this audit writes no legal text) | `app/privacy/page.tsx` (placeholder); `docs/content-gaps.md` #7, #21; code gate in `lib/delivery/plan.ts` (`TELEGRAM_DELIVERY_ALLOWED`) | Published, approved notice before Telegram is enabled | Owner + adviser | P0 (Telegram) | S | Notice live; then the operator sets `TELEGRAM_DELIVERY_ALLOWED=true` |

## Security foundation

| ID | Capability | Status | Evidence | Required behaviour | Role | Priority | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Trustworthy client IP | Implemented | `lib/client-ip.ts`; ut `client-ip.test.ts`; `deploy/nginx/calix-proxy.conf` (`X-Real-IP`, `X-Forwarded-For` overwritten); pl test with forged headers | — | System | — | — | Done |
| SEC-02 | Admin CSP and headers | Implemented | `proxy.ts` (nonce CSP, `no-store`, `X-Robots-Tag`, COOP, `no-referrer`); it `admin-auth.test.ts` ("responses are private and uncached") | — | System | — | — | Done |
| SEC-03 | Public `script-src` | Missing | `next.config.ts` CSP; bundled CSP guide: nonces need dynamic rendering; hash approach = **experimental SRI** | Investigate `experimental.sri` + motion-script hash; adopt only if violation-free on static pages (`ADMIN_PANEL_AUDIT.md` F2) | System | P3 | M | Zero CSP violations on every public route at 1440/390; pages still static |
| AUTH-01 | Administrator accounts via the operator CLI | Implemented | `scripts/admin-user.mts` (`list`, `add`, `reset`, `disable`, `enable`); `lib/admin/users.ts`; it `admin-auth.test.ts` ("disabling the account on the server ends every session") | — | Operator | — | — | Done |
| AUTH-02 | Password (scrypt) + TOTP; enrolment; recovery codes | Implemented | `lib/admin/{password,totp,enrolment}.ts`; `app/admin/login/*`; it `admin-auth.test.ts` (enrolment, recovery once, concurrent code use) | Optional QR image (F7, P3) | Admin | — | — | Done |
| AUTH-03 | Sessions: signed cookie, idle 30 min, absolute 8 h, revocation, re-auth | Implemented | `lib/admin/session-token.ts` (`IDLE_MS`, `ABSOLUTE_MS`, `RECENT_AUTH_MS`); `lib/admin/session.ts` (`revokeSession`); `lib/admin/reauth.ts`; it `admin-session-edges.test.ts`, `admin-browser.test.ts` | — | Admin | — | — | Done |
| AUTH-04 | Sign-in rate limiting | Partially implemented | Application: `lib/admin/rate-limit.ts` (per account and IP; re-auth 5 per 15 min; tests 5 per 10 min), ut `rate-limit.test.ts`. **Nginx `limit_req` missing:** `deploy/nginx/*` | Add `limit_req` for `/admin/login` (F3) | System / Operator | P2 | XS | Excess POSTs from one address → HTTP 429 from Nginx; other routes unaffected |
| AUTH-05 | Session check on every admin page and action | Implemented | `requireAdmin`/`sessionForAction` in every `app/admin/**/actions.ts` and page; ut `server-actions.test.ts` | — | System | — | — | Done |
| AUD-01 | Audit log | Implemented | `lib/admin/audit.ts` (two streams, hash chain, rotation, throttling, `verifyAuditChain`); ut `audit.test.ts`; it "the audit log records each step and its hash chain is intact" | — | Admin (read) | — | — | Done |
| AUD-02 | Browse activity: filters, paging, access log, read-only | Partially implemented | `app/admin/security/page.tsx` shows `recentAudit(50)` of the main stream only | Filter by action/outcome/date, page beyond 50, a read-only access-log tab; never full IPs or secrets | Admin | P3 | S | Seeded-secret scan passes; `requireAdmin("page")`; filters work without JavaScript |
| UI-01 | Admin shell and forms | Partially implemented | Four screens (`app/admin/layout.tsx`); server-validated forms with inline errors and a summary. **No unsaved-changes warning** (no `beforeunload` in `app/admin`) | Add the warning on the three editable forms | Admin | P3 | XS | Leaving with edits asks for confirmation; save/reset clears it; keyboard-operable |

## Settings store and recovery

| ID | Capability | Status | Evidence | Required behaviour | Priority | Effort | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| STO-01 | File store: atomic write, revision check, lock, validation, defaults | Implemented | `lib/settings/store.ts` (`updateStore`, `withLock`, `atomicWrite`, `.bak` fallback); ut `locks.test.ts`, `crypto-and-locks.test.ts`; it "a save based on an old revision is refused as a conflict" | — | — | — | Done |
| STO-02 | Encryption at rest; key rotation | Implemented | `lib/settings/crypto.ts` (AES-256-GCM); `SETTINGS_ENCRYPTION_KEY_PREVIOUS` + CLI `rekey` | — | — | — | Done |
| STO-03 | Backup | Implemented | `deploy/backup-settings.sh`; ut `backup-script.test.ts`; runbook §5 | — | — | — | Done |
| STO-04 | Crash-safe restore with rollback; SESSION_SECRET rotation enforced | Implemented | `lib/admin/restore.ts` (journal `restore.json`, `performRestore`, `performRollback`); ut `restore.test.ts`; it `admin-restore.test.ts`; pl restore procedure | — | — | — | Done |
| STO-05 | CLI account and rekey commands refused during an unfinished or unreadable restore | Missing | `scripts/admin-user.mts`: `add`, `reset`, `enable`, `disable`, `rekey` don't consult `restoreState()` (F4) | Refuse with guidance to run `restore --rollback`; `list` still allowed | P2 | S | With an in-progress or corrupt marker, each command exits non-zero and every file hash is unchanged |

## General settings (public)

All of these are on the General settings screen (`app/admin/page.tsx`, `GeneralForm.tsx`, `saveGeneralSettings`). They are rendered through `getPublicSettings()` (`lib/settings/public.ts`), and each save triggers `revalidatePath('/', 'layout')`.

| ID | Capability | Status | Evidence | Acceptance (tested) |
|---|---|---|---|---|
| SET-01 | Legal name | Implemented | Schema `business.legalName`; footer and JSON-LD | it `admin-settings.test.ts` |
| SET-02 | Address | Implemented | `postalAddress`; contact page and JSON-LD only when set | it `admin-settings.test.ts` |
| SET-03 | Public email | Implemented | `contact.email` | it `admin-settings.test.ts` |
| SET-04 | Phones (primary + 3) | Implemented | `phoneNumber` (E.164) | ut `general-settings.test.ts` |
| SET-05 | Reply time (six render sites) | Implemented | `Hero.tsx`, `HomeSections.tsx`, `PageParts.tsx` ×2, contact, thank-you | it "saving publishes to every page on its next visit" |
| SET-06 | Social links, labelled per platform | Implemented | `SOCIAL_PLATFORMS` host allow-list | ut `general-settings.test.ts` |
| SET-07 | Footer copyright with `{year}` | Implemented | `footer.copyrightText` | it `admin-settings.test.ts` |
| SET-08 | Runtime refresh, no rebuild | Implemented | `app/admin/actions.ts:56`; `app/layout.tsx:63` (`revalidate = 300` safety net); Refresh button | it "…with no rebuild or restart"; "survive a restart" |
| SET-09 | Pause enquiries, enforced on the server | Implemented | `app/admin/notifications/actions.ts` `saveFormStatus`; `app/contact/actions.ts:41` | it "paused: … direct posts are refused without sending" |

## Contact-form delivery

| ID | Capability | Status | Evidence | Notes |
|---|---|---|---|---|
| DEL-01 | Email toggle and recipient at runtime (`ENQUIRY_TO` fallback) | Implemented | `lib/delivery/plan.ts` `resolvePlan`; `saveDelivery` (re-auth) | No `delivery.json` → behaviour identical to before the admin |
| DEL-02 | Independent concurrent dispatcher | Implemented | `lib/delivery/dispatch.ts`; it `contact-delivery.test.ts` (all configurations, hanging channels) | Success only when ≥ 1 confirmed |
| DEL-03 | Telegram channel | Implemented, **gated off** by default | `lib/delivery/telegram.ts` (plain text, chunking, `telegram_partial`); `TELEGRAM_DELIVERY_ALLOWED` | Needs LEG-01 before production use |
| DEL-04 | Telegram settings: write-only token, chat ID, test-before-enable | Implemented | `app/admin/notifications/actions.ts` (`testMatches`, `removeToken`); schema keeps no clear part of the token | Stricter than revision 2 (no last-4 shown) |
| DEL-05 | Test email | Implemented | `testEmail`, `testSends` limiter (5 per 10 min) | — |
| DEL-06 | Test Telegram (fingerprint-bound) | Implemented | `testTelegram` | — |
| DEL-07 | Outcome records and status display | Implemented | `lib/delivery/log.ts`; `status.json` (≤ 200, no content); `/admin/notifications` tables | — |
| DEL-08 | Cross-channel failure alert | Implemented | `lib/delivery/alerts.ts` (`ALERT_WINDOW_MS` 30 min) | it "email fails, Telegram confirms … carries one alert"; "no alert can loop" |
| DEL-09 | Durable retry outbox | Missing (**deliberately deferred**) | Revision 2 §8.6 rationale unchanged | Only if all-channel failures occur in practice or the owner requires it |

## Status

| ID | Capability | Status | Evidence | Notes |
|---|---|---|---|---|
| SYS-01 | System status screen | Implemented | `lib/admin/status.ts` (16 checks); `app/admin/status/page.tsx`; it "reports server settings as set or not set, never their values" | Overview strip on `/admin` is a P3 addition (plan R-06), not a gap in SYS-01 |

---

## Content areas intentionally kept in code (not counted as gaps)

Rationale and revisit triggers: `ADMIN_PANEL_AUDIT.md` §5.

| ID | Area | Source | Status |
|---|---|---|---|
| CAT-01 | Page copy and layout (home, services, studio) | `content/*.ts`, `components/**` | Hardcoded (intentional) |
| CAT-02 | Case studies / portfolio | `content/work.ts` (`assertProjectValid`) | Hardcoded (intentional, evidence workflow) |
| CAT-03 | Articles | `content/insights.ts` | Hardcoded (intentional) |
| CAT-04 | Team | `/studio` placeholders | Hardcoded (intentional) |
| CAT-05 | Testimonials and outcomes | Placeholders | Hardcoded (intentional, approval needed) |
| CAT-06 | SEO metadata, canonical URLs | `lib/seo.ts`, `lib/site-url.ts` | Hardcoded (intentional) |
| CAT-07 | Navigation and footer link lists | `content/site.ts`, `SiteFooter.tsx` | Hardcoded (intentional) |
| CAT-08 | Media and brand assets | `public/brand/`, `lib/palette.ts` | Hardcoded (intentional, no uploads) |
| CAT-09 | Legal pages | `app/privacy/page.tsx` | Hardcoded (intentional; text is LEG-01) |
| CAT-10 | Public user accounts | None exist | Not applicable |
| CAT-11 | Multiple roles | One role | Not justified (`ADMIN_PANEL_AUDIT.md` §7) |
| CAT-12 | Business analytics / KPIs | No provider (`lib/analytics.ts`) | Not applicable until Q3 |
| CAT-13 | Localisation | English only | Not applicable |
| CAT-14 | Enquiry inbox / storage | Not stored by design | Not recommended (Q4) |
| CAT-15 | Launch gates and build flags | `content/site.ts` `gates`, environment | Deployment-controlled |

---

## Status counts (capability rows above, excluding CAT rows)

45 capabilities.

| Status | Count | IDs |
|---|---|---|
| Implemented | 33 | EXI-01, EXI-02, EXI-03, EXI-04, SEC-01, SEC-02, AUTH-01, AUTH-02, AUTH-03, AUTH-05, AUD-01, STO-01, STO-02, STO-03, STO-04, SET-01 … SET-09 (9), DEL-01 … DEL-08 (8), SYS-01 |
| Partially implemented | 4 | EXI-05, AUTH-04, AUD-02, UI-01 |
| Missing | 4 | SEC-03, STO-05, LEG-01 (owner/legal), DEL-09 (deferred by design) |
| Needs verification | 4 | ENV-01, ENV-02, ENV-03, OPS-01 |

The 15 CAT rows are intentionally code-controlled or not applicable.
