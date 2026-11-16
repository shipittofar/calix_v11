# CALIX — Admin Panel Implementation Plan (revision 3: delivered work and remaining backlog)

**Companion to:**
- `ADMIN_PANEL_AUDIT.md` (rationale, findings F1–F7);
- `ADMIN_PANEL_FEATURE_MATRIX.md` (IDs);
- `ADMIN_PANEL_API_GAPS.md` (interfaces for the remaining tasks).

**Date:** 2026-10-24. **Audited commit:** `5bcd584`.
**Status:** Revision 2's backlog is largely delivered (§1). The remaining tasks (§2) are proposals; **none has been started**, and implementation begins only on explicit instruction.

**Estimates:**
- **Priority:** P0 before production · P1 first release · P2 next · P3 optional.
- **Effort:** relative (XS < S < M < L), not time. There are no dates.

**Boundaries for every remaining task:**
- No new runtime dependency; no database.
- No change to public page content, layout or the enquiry form's contract.
- No change to store schemas, unless a migration is included (`ADMIN_PANEL_API_GAPS.md` §5).
- No environment, Nginx or PM2 change on a real server without operator authorisation.
- Don't enable Telegram before LEG-01.

---

## 1. Delivered: revision 2 phases mapped to the code

| Revision 2 phase | Tasks | Delivered as | Status |
|---|---|---|---|
| Phase 0: prerequisites | P0-01 owner decisions | Pause switch and cross-channel alerts built, as they were in the requested implementation scope; Telegram held behind `TELEGRAM_DELIVERY_ALLOWED` | Done, except the privacy text (LEG-01) |
| | P0-02 operator environment | Repository side: `deploy/ecosystem.config.cjs`, `deploy/nginx/*`, runbook, status checks | **Live server not verified** (ENV-01..03) |
| | P0-03 contract tests | Node test runner instead of Vitest (no new dependency); `tests/integration/contact-contract.test.ts` | Done |
| | P0-04 trusted IP | `lib/client-ip.ts` | Done |
| | P0-05 privacy notice | — | **Open** (LEG-01, owner/legal) |
| Phase 1: foundation | P1-01 … P1-08 | `lib/settings/{store,schema,crypto}.ts`; `scripts/admin-user.mts`; `lib/admin/*`; `proxy.ts`; `tests/unit/server-actions.test.ts`; admin integration suites | Done (Nginx `limit_req` part of P1-05 open: R-03) |
| Phase 2: general settings | P2-01 … P2-06 | `lib/settings/public.ts`, consumers rewired, `app/admin/page.tsx`, `revalidatePath`, backup script and runbook | Done |
| Phase 3: delivery | P3-01 … P3-06 | `lib/delivery/*`, `/admin/notifications`, tests | Done |
| Phase 4: status, options, hardening | P4-01 status screen; P4-03 alerts; P4-04 pause; P4-05 security reviews (several rounds, with fixes); P4-07 docs | `lib/admin/status.ts`, `lib/delivery/alerts.ts`; `README.md`, `.env.example`, runbook | Done |
| | P4-02 public CSP | — | **Open**, re-scoped as an investigation (R-05) |
| | P4-06 admin accessibility audit | Forms follow the accessible patterns (labels, `aria-invalid`, error summary, focusable scroll regions) | **No recorded audit report**: carried into R-09 |
| Added during implementation | Crash-safe restore and rollback; PID-reuse-safe locks; required CI test modes; redacted CI diagnostics | `lib/admin/restore.ts`; `lib/settings/store.ts`; `.github/workflows/validate.yml`; `tests/helpers/diagnostics.ts` | Done |

---

## 2. Remaining backlog (ordered)

### Phase 0: release prerequisites

| ID | Task | Matrix | Priority | Depends on | Reuse | Frontend | Backend | Data | Tests | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| R-01 | Privacy notice: Telegram as a recipient, delivery-outcome records, admin access log. **Owner and adviser write it; not code by this plan** | LEG-01 | P0 (before Telegram) | Owner decision Q1 | `app/privacy/page.tsx` placeholder | Page text only | — | — | Visual check; then the operator sets `TELEGRAM_DELIVERY_ALLOWED=true` | S |
| R-02 | Verification: a GitHub Actions run of both jobs, observed green. The runbook §11 server checks: one PM2 fork process; persistent `SETTINGS_DIR`; Nginx snippet in place; a real SMTP enquiry; Telegram egress if used | OPS-01, ENV-01..03 | P0 | Operator access | Runbook §11; status page | — | — | — | Recorded results (links or screenshots of the status page) | S |

### Phase 1: hardening

| ID | Task | Matrix | Priority | Depends on | Reuse | Frontend | Backend / config | Data | Tests | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| R-03 | Nginx `limit_req` on `/admin/login`; document the optional allow-list | AUTH-04 (F3) | P2 | — | `deploy/nginx/*` | — | Nginx config (`ADMIN_PANEL_API_GAPS.md` §4.2) | — | Production-like: a burst gets 429; `/` unaffected | XS |
| R-04 | CLI refuses `add`, `reset`, `enable`, `disable` and `rekey` during an unfinished or unreadable restore | STO-05 (F4) | P2 | — | `restoreState()` | — | `scripts/admin-user.mts` (§4.1) | — | Unit: three marker states × five commands → non-zero, hashes unchanged; `list` works | S |

### Phase 2: operations and usability

| ID | Task | Matrix | Priority | Depends on | Reuse | Frontend | Backend | Data | Tests | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| R-06 | Overview strip at the top of `/admin` | SYS-01 (addition) | P3 | — | `systemStatus(headers)`, `status.json`, `recentAudit`, `restoreState` | `app/admin/page.tsx` | `adminOverview(headers)`; move `failures()` into `lib/delivery/admin.ts` (§4.4) | — | Unit composition; integration render; seeded-secret scan | S |
| R-07 | Activity view: filters, paging, read-only access log | AUD-02 (F6) | P3 | — | `recentAudit` | `/admin/security` or `/admin/activity` (GET filters) | `recentAudit` options (§4.3) | — | Filters without JavaScript; auth required; no secrets or full IPs | S |
| R-08 | Unsaved-changes warning | UI-01 | P3 | — | Client forms | `GeneralForm.tsx`, `NotificationForms.tsx` | — | — | Browser test: dirty → prompt; save/reset → no prompt | XS |

### Phase 3: investigations

| ID | Task | Matrix | Priority | Depends on | Effort |
|---|---|---|---|---|---|
| R-05 | Public CSP with `experimental.sri` and the motion-script hash; scope it away from `/admin`; adopt only with a zero-violation scan on every route; otherwise record the decision | SEC-03 (F2) | P3 | — | M |
| R-09 | Accessibility audit of the five admin screens (WCAG 2.2 AA, `accessibility-audit` skill) at 1440/768/390, with screenshots | UI-01 | P2 | — | S |
| R-10 | Optional QR image for TOTP enrolment (only if users struggle with the text secret; needs a dependency decision or a small built-in encoder) | AUTH-02 (F7) | P3 | Dependency approval | S |

### Deferred (no task unless triggered)

| Item | Trigger |
|---|---|
| DEL-09 durable retry outbox | All-channel failures observed in `status.json`, or the owner requires "accept when every channel is down" |
| Content editing (CAT-01..09) | Owner decision Q2 |
| KPI widgets | An analytics provider and consent decision (Q3) |
| Enquiry inbox | Owner decision Q4 (not recommended) |

---

## 3. Definition of done

| Phase | Done when |
|---|---|
| 0 | Privacy notice published (or Telegram stays off); a green GitHub Actions run is linked; runbook §11 results recorded |
| 1 | R-03 and R-04 merged with their tests; full suite green (below) |
| 2 | R-06, R-07 and R-08 merged; no secret in any new view (seeded scan); `calix-visual-qa` screenshots at 1440/768/390; palette check on the built CSS |
| 3 | R-05 adopted with a zero-violation scan, or a documented decision to keep the current headers; R-09 report with fixes; R-10 only if needed |

**Every task runs:**
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm audit --audit-level=high`
- `CALIX_REQUIRE_BROWSER=1 npm run test:integration`
- `npm run verify:builds`
- `CALIX_REQUIRE_PRODLIKE=1 npm run test:prodlike` (when Nginx/PM2 behaviour is touched)

Skipped tests are reported explicitly. CI is claimed green only from an observed GitHub run.

---

## 4. Traceability

| Matrix ID | Task |
|---|---|
| LEG-01 | R-01 |
| OPS-01, ENV-01, ENV-02, ENV-03 | R-02 |
| AUTH-04 | R-03 |
| STO-05 | R-04 |
| SEC-03, EXI-05 | R-05 |
| SYS-01 (overview addition) | R-06 |
| AUD-02 | R-07 |
| UI-01 | R-08, R-09 |
| AUTH-02 (QR) | R-10 |
| DEL-09 | Deferred |
| All other rows | Delivered (§1) |
