# Retention Matrix — Extract, Reconcile, Report

**Mode:** read-only audit. No code, migrations or schema changed. The only writes are the
`PROPOSED` SCL entries recorded in §5 and appended to `docs/SpecAudit/SPEC_CHANGES_LOG.md`.

**Purpose.** The amended COPPA Rule has required since 22 April 2026 that an operator maintain a
written retention policy naming each category of children's personal information, the purpose it
is kept for, and the timeframe for its deletion, and publish it in the online privacy notice.
Lyceon has no such policy. This report is the factual base counsel will draft it from, so it
records what the system **does**, not what the corpus says it should.

Wording here is jurisdiction-neutral and the report is not organised by regime, per the brief.

---

## Grounding

| | |
|---|---|
| Repo root | `/home/user/Lyceonai` |
| Branch | `cleanup` |
| HEAD | `c91544bf` — *Merge pull request #777 from Lyceon-Team/claude/legal-gate-base-ref-6d1e4f* |
| `git status --porcelain` | clean (0 modified files) at the moment of reading |
| Node | v22.22.2 |
| pnpm | 10.33.0 |
| Read at | 2026-09-17T10:17:58Z |
| Prod project | Supabase `hncolwkccbbjkfithhlo` (`MVP`), Postgres 17.6.1.008, 103 public tables |

`main` is red on CI run 2347 (the merge of #767, deleting the legacy study-calendar surface).
Not this branch's base and not this work — flagged so it is not rediscovered. *(The cause was
since found and fixed for `cleanup` and `main` alike: the workflow's push-event fallback named
the deleted `stripe` branch, so the legal-immutability gate had no comparison point and exited 2.
PR #777, merged.)*

---

## Part 1 — The specified matrix

Extracted from `docs/Spec` by section. Where two documents state different periods for the same
category, both are shown with their sections and **not reconciled here** — reconciliation is §4.

### 1.1 Doc 01 §5.1 — the master retention table

`docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md:210` (§5.1
"Audit log retention and PII boundaries"). The table at `:219-227`:

| # | Category | Retention | Identity stripped? | Stated basis |
|---|---|---|---|---|
| 1 | Authentication events (login, logout, MFA challenge) | 90 days | not stated | "Security forensics window" |
| 2 | Identity mutations (profile updates, role changes) | 365 days | not stated | "Regulatory and operational trail" |
| 3 | Entitlement/billing events | 7 years | not stated | "Financial records minimum" |
| 4 | Account deletion requests | 7 years | **anonymized after 1 year** | "Regulatory + evidence of compliance" |
| 5 | Guardian consent events | **Permanent** | **anonymized after 1 year** | "COPPA compliance evidence" |
| 6 | Support-mediated operations | 365 days | not stated | "Dispute resolution window" |

Adjacent rules in the same section:

- `:229` — "Retention values live in `observability_runtime_config` per Doc 01A §74."
- `:243` — email addresses inside `changes` JSONB: **domain-only retention after 90 days**.
- `:248-253` — on hard delete at T+7, `actor_profile_id` and `target_profile_id` become NULL,
  only anonymized metadata is retained, and "after
  `account_deletion_runtime_config.anonymization_retention_days` (default 365), audit logs are
  hard-deleted".
- `:255` — minors: for profiles under 13 at deletion, COPPA consent-event retention is
  **extended (permanent anonymized record)**, identifying links severed.
- `:265` — audit logs older than **90 days** transition to cold storage (`audit_logs_archive`).

### 1.2 Doc 03 §14.2 — the LISA data-retention matrix

`docs/Spec/Doc 03 — LISA (AI Tutor System).md:1243`. Ten rows, `:1249-1259`:

| Table | Retention period | Delete trigger | Recovery window |
|---|---|---|---|
| `tutor_conversations` | Active + 7 days post-entitlement-loss | Entitlement lapse OR account deletion | 7 days (soft delete) |
| `tutor_messages` | Active + 7 days post-entitlement-loss | Cascade from `tutor_conversations` | 7 days (soft delete) |
| `tutor_memory_summaries` | Active + 7 days post-entitlement-loss | Cascade from account / entitlement | 7 days |
| `tutor_instruction_assignments` | 90 days from creation, then aggregated | Automatic archival at 90 days; cascade from account | N/A (archival) |
| `tutor_question_links` | Active + 7 days post-entitlement-loss | Cascade from `tutor_conversations` | 7 days |
| `tutor_instruction_exposures` | 90 days from creation | Automatic archival at 90 days | N/A |
| Crisis-flagged conversations | 180 days (extended for safety review) | Manual purge after incident closure | 180 days |
| Injection-attempt logs | 180 days | Automatic archival at 180 days | N/A |
| LISA cost telemetry | 365 days | Automatic archival at 365 days | N/A |
| Quota appeal records | 365 days (audit trail) | Automatic archival at 365 days | N/A |

`:1264` defines "automatic archival" as: "Tables with time-based retention (90d, 180d, 365d)
auto-archive on **daily cron**. Archived data is moved to cold storage (aggregated form for
analytics); raw records deleted."

**The section closes `[BUSINESS TARGET — Pending Legal Implementation]` at `:1289`.** The
document calls it "the authoritative retention schedule" at `:1245` and simultaneously marks it
aspirational. That tension is material to what can be published and is carried into §4.

Doc 03A §17.3 (`docs/Spec/Doc 03A — LISA Context & Memory Runtime.md:1640-1650`) restates the
same periods and adds `tutor_injection_log` 180 days, and: "Hard delete via scheduled cron at
7-day window expiry."

### 1.3 Doc 07E — analytics retention

`docs/Spec/Lyceon — Document 07E_ Analytics Retention, Privacy & Cascade.md`. Two classes, §5:

| Class | Scope | Retention horizon | Trigger |
|---|---|---|---|
| Class 1 `personal_data_with_inactivity_expiry` (§5.1, `:201`) | User-identifying data + the bridges linking analytics events to a student | **12 months from last activity**, calendar-month semantics; config primitive `USER_INACTIVITY_RETENTION_MONTHS = 12` | **V1: user-initiated deletion only.** Inactivity trigger is **V1.1+** (§9) |
| Class 2 `pseudonymized_indefinite_retention_pending_anonymization_review` (§5.2, `:215`) | Post-cascade event stream + Lyceon-authored system-state archives | **Indefinite. No expiry.** | None — manual operator deletion only |

- §6 (`:263`) registers `RPOL-ANALYTICS-01` (12 months, `purge_substrate: doc05d_cascade`,
  `purge_lag_allowance_seconds: 604800`) and `RPOL-ANALYTICS-02` (indefinite,
  `purge_substrate: manual`) against **`infra/retention-policy-registry.yaml`**.
- §9.2 (`:538`) — 48-hour pre-deletion notification before inactivity expiry.
- §10 (`:596`) — under-13: **hard-delete-everywhere, immediate, no 7-day envelope** (`:614`),
  and no under-13 data used for AI training.
- §8.3 (`:467`) specifies the seven disclosure elements the privacy policy must carry and states
  "This is a V1 launch gate" (W7).

### 1.4 Everything else that states a retention period

Grepped across all 47 files of `docs/Spec` rather than assuming the three above are exhaustive.

| Source | Category | Period |
|---|---|---|
| Doc 01A `:542` | Production logs | 90 days hot, 1 year cold, then purged |
| Doc 01A `:542` | Staging logs | 30 days |
| Doc 01A `:544` | Emails in logs | domain-only after 90 days |
| Doc 01A `:795` (§29.1) | Idempotency records — Stripe webhook scope | 30 days |
| Doc 01A `:795` (§29.1) | Idempotency records — practice-session scope | 7 days |
| Doc 01A `:1725` (§65.1) | Revoked HMAC service-auth secrets | purge where `revoked_at < now − 7 days`; 180-day validity, 14-day rotation overlap |
| Doc 01A `:2486` (via 03A) | `tutor_turn` context scope TTL | 7 days |
| Doc 01 `:1786` | Guardian-initiated deletion `deletion_days` | default 30 days |
| Doc 01 `:1838`, `:1862` | Account deletion grace | 7 days |
| Doc 01 `:852` | Recovery/verification token expiry | 1 hour |
| Doc 03B `:4088` | Backups containing deleted accounts | purged per 30-day backup cycle |
| Doc 03C V3 `:3353`, `:4430` | Tutor job `expires_at` | ≤ 4 hours |
| Doc 03C Runbook `:2525` | Archive lifecycle | 7-year tier referenced |
| Doc 06B `:238`, `:854` | Privileged access grants `expires_at` | **MAX 90 days** |
| Doc 06B `:325` | Break-glass session | ≤ 1 hour |
| Doc 06D `:256` | `retention_window_seconds` V1 baseline | 604800s / 7 days |
| Doc 06D `:211` | Deletion-proof reconciliation lookback | 14 days |
| Doc 06D `:456` | Stuck-deletion alert threshold | `delete_at < now() − 24 hours` |
| Doc 07D `:525` | Experiment data | 12-month inactivity, inherits 07E |
| Doc 09 `:584` (§9) | Financial records | **7 years** ("Lyceon's conservative direction", not a legal minimum — `:143`) |
| Doc 10 `:497` | Marketing-facing retention claim | 12 months |
| `docs/Spec/Lyceon Privacy Policy.md:33` | **Draft policy claim** | "retained for **12 months** from your last activity and then deleted through our cascade deletion process" |

### 1.5 Where two documents disagree — shown, not reconciled

| Category | Statement A | Statement B |
|---|---|---|
| Account deletion requests | **7 years**, anonymized after 1 year — Doc 01 §5.1 row 4 | **24-month** evidence clock with identity strip — SCL-085 (PROPOSED), already the built behaviour |
| Guardian consent events | **Permanent**, anonymized after 1 year — Doc 01 §5.1 row 5 | Same 24-month strip — SCL-085 |
| User-identifying data | **12 months** from last activity — Doc 07E §5.1 | Doc 01 §5.1 has no inactivity concept at all; its clocks run from the event, not from last use |
| Stripe/billing timing | §40.2.1 cancel at request; §41 checklist; Doc 05D §10.1 "immediate cancellation at the deletion request" | §40.3 (later, and what the build follows) cancel at **T+7** — SCL-086 |
| Tutor conversation content | Doc 03 §14.2 "authoritative retention schedule" | Same section marked `[BUSINESS TARGET — Pending Legal Implementation]` |
| Analytics class 2 | **Indefinite** — Doc 07E §5.2 | Amended COPPA Rule prohibits indefinite retention of children's data; 07E resolves this only by routing under-13 to §10 hard-delete, which is **not built** (§3) |

---

## Part 2 — Reconciliation against production

### 2.0 What is actually scheduled

`vercel.json:6-31` — six cron entries, all gated by `cronAuthorized()`
(`server/routes/internal-cron-routes.ts:29-40`, timing-safe `Bearer $CRON_SECRET`; **an unset
`CRON_SECRET` returns 404 and silently disables all six**).

| Schedule (UTC) | Path | Does it delete anything? |
|---|---|---|
| `0 3 * * *` | `/api/internal/legal-acceptance-drain` | **No** — stamps `processed_at`, never removes rows (`server/lib/legal-acceptance.ts:208,228`) |
| `0 2 * * *` | `/api/internal/execute-deletions` | **Yes** — the whole deletion vertical + four housekeeping mechanisms |
| `30 3 * * *` | `/api/internal/stale-session-sweep` | **No** — status transition to `abandoned` only (`server/lib/stale-session-sweep.ts:60-89`) |
| `0 4 * * *` | `/api/internal/baseline-pending-sweep` | **No** — read-only alerting |
| `30 4 * * *` | `/api/internal/notification-dispatch-sweep` | **No** — sends mail |
| `0 5 * * *` | `/api/internal/notification-retention-sweep` | **Yes** — the only standalone deleting cron |

A seventh handler, `/api/internal/crisis-sla-sweep` (`internal-cron-routes.ts:138`), has no cron
entry anywhere; it is alerting-only and deletes nothing.

### 2.1 Category-by-category reconciliation

Legend — **✅ enforced** / **⚠ mechanism exists, no live invoker** / **❌ no mechanism**.

| # | Category | Specified | Mechanism | Period match? |
|---|---|---|---|---|
| 1 | Account-deletion grace | 7 days (Doc 01 §40, App A.5) | ✅ `getDeletionGraceDays()` `server/lib/account-deletion-runtime-config.ts:39-78`, from `account_deletion_runtime_config.grace_period_days`; enforced by `execute-deletions` | **Yes.** Prod row = `7` (verified) |
| 2 | Anonymized `audit_logs` purge | 365 days (Doc 01 §5.1) | ✅ `public.apply_audit_logs_retention('purge_expired', …)` — `supabase/migrations/20260917100000_deletion_audit_actions.sql:145-200`; window from `audit_logs_retention_days()` `:104-128` | **Yes.** Prod row = `365` (verified). The **only** period SQL reads from config |
| 3 | `audit_logs` identity strip at hard delete | ids NULL at T+7 (Doc 01 §5.1) | ✅ `apply_audit_logs_retention('strip_identity', profile)` inside `complete_deletion_log` (`:469`) | **Yes** |
| 4 | Deletion evidence identity | 24 months (SCL-085) | ✅ `public.sweep_deletion_evidence()` — `20260917120000_deletion_sweeps_and_config.sql:110-176`; window `deletion_evidence_retention_months()` `:78-86` = **24, hardcoded in SQL** | Matches SCL-085, **not** Doc 01 §5.1's 7-year/permanent rows |
| 5 | Notification events/messages/delivery | **NOT SPECIFIED in `docs/Spec`** | ✅ `public.sweep_notification_retention()` at 05:00; `notification_retention_days()` = **90, hardcoded in SQL** (`20260915100000_…:37-45`) | No spec to match. Period lives only in `contracts/notifications.contract.md` C11.1 |
| 6 | Do-not-contact suppression | indefinite (SCL-090) | ✅ Resend team suppression list; outcome tracked in `deletion_request_log.suppression_status` (verified present in prod) | Yes |
| 7 | **Tutor conversations / messages / question links / memory summaries** | **7 days post-entitlement-loss** (Doc 03 §14.2) | ⚠ `sweep7d` `server/services/retention-sweep.ts:116-218` — **no invoker** | **No. Never runs.** |
| 8 | **Tutor instruction assignments / exposures** | **90 days** (Doc 03 §14.2) | ⚠ `sweep90d` `:239-408` — no invoker, and blocked on `BIGQUERY_ARCHIVE_DATASET` | **No. Never runs.** |
| 9 | **Crisis-flagged conversations / injection log** | **180 days** (Doc 03 §14.2) | ⚠ `sweep180d` `:440-611` — no invoker, archive-blocked | **No. Never runs.** |
| 10 | **LISA cost telemetry / quota appeals** | **365 days** (Doc 03 §14.2) | ⚠ `sweep365d` `:621-631` returns `{ok:false, reason:"365d_tables_not_provisioned"}` | **No. Structured no-op.** |
| 11 | **User-identifying data, inactivity** | **12 months from last activity** (Doc 07E §5.1; draft policy `Lyceon Privacy Policy.md:33`) | ❌ **NOT FOUND.** 07E §9 puts the inactivity job at V1.1+; no job, no `last_activity` reader, no notification | **No mechanism at all** |
| 12 | **Under-13 hard-delete-everywhere** | immediate, no grace (Doc 07E §10) | ❌ **NOT FOUND.** No age branch in the cascade or the executor | **No mechanism at all** |
| 13 | Auth events (90 d) / identity mutations (365 d) / entitlement events (7 y) / support ops (365 d) | Doc 01 §5.1 rows 1,2,3,6 | ❌ **NOT FOUND.** `audit_logs` has **one** purge window (365 d) for all actions; no per-category tiering exists | **No.** Six specified tiers, one implemented window |
| 14 | `observability_runtime_config` retention values | "Retention values live in `observability_runtime_config`" (Doc 01 §5.1 `:229`) | ❌ Table exists, **0 rows in prod** (verified) | **No values seeded** |
| 15 | `audit_logs_archive` cold storage at 90 d | Doc 01 §5.1 `:265` | ❌ **NOT FOUND** — no such table in prod's 103 |
| 16 | Production logs 90 d hot / 1 y cold | Doc 01A `:542` | ❌ Not verifiable in-repo; Vercel/Cloud Logging dashboard-only |
| 17 | Idempotency records 30 d / 7 d per scope | Doc 01A §29.1 `:795` | ❌ **NOT FOUND.** `idempotency_records.expires_at` is `NOT NULL` with an index (`genesis.sql:340-343`) and **no sweeper** | The index exists for a sweep never written |
| 18 | Revoked HMAC secrets, purge at `revoked_at + 7 d` | Doc 01A §65.1 `:1725` | ❌ **NOT FOUND** — no purge of `service_auth_secrets` |
| 19 | Privileged access grants ≤ 90 d | Doc 06B `:238`,`:854` | ❌ **NOT FOUND** — no `privileged_sessions` / `privileged_session_actions` tables in prod |
| 20 | Guardian consent token, 14 d | `server/routes/profile-routes.ts:365-366` (hardcoded) | ❌ **NOT FOUND.** Nothing sets `status='expired'`; nothing deletes. Removed only by the cascade |
| 21 | Rate-limit buckets | per-bucket `window_seconds` | ❌ **NOT FOUND.** Rows only ever inserted/updated; removed only by `profiles` FK cascade |
| 22 | Financial records 7 years | Doc 09 §9 | ❌ Stripe-side; not ours to enforce. `deletion_billing_record` has **no strip and no delete** at all |

### 2.2 The defect that matters most

**The account-deletion cascade does not touch a single LISA table, and every LISA table holds an
`ON DELETE RESTRICT` foreign key to `profiles`.** Verified against production, not the migration
file:

- The live `public.execute_account_deletion_cascade` body is 25,394 characters and mentions
  `tutor_conversations`, `tutor_messages` and `crisis_review_cases` **zero times** each.
- Nine RESTRICT edges into `profiles` / `tutor_conversations` / `crisis_review_cases` exist in
  prod: `tutor_conversations`, `tutor_messages`, `tutor_question_links`,
  `tutor_memory_summaries`, `tutor_instruction_assignments`, `tutor_instruction_exposures`,
  `tutor_injection_log`, `crisis_review_cases` (all `student_id → profiles`), plus
  `crisis_review_audit_log.reviewer_id → profiles` and
  `crisis_review_cases.conversation_id → tutor_conversations`.

So `DELETE FROM public.profiles` raises a foreign-key violation for **any account that has ever
used the AI tutor**. Per `server/lib/account-deletion-execute.ts:783-785` a cascade RAISE rolls
the request back to `'pending'`, and it retries every night, forever, without ever succeeding.

**Blast radius today: 2 of 117 live profiles cannot be deleted.** That is small only because the
tutor is barely used yet — it is 100% of tutor users, and the tutor is the product's headline
feature. At launch this is every paying student.

This contradicts Doc 03 §14.2's own delete-trigger definition (`:1263`): "All LISA tables cascade
on hard delete at end of window." The spec is right and the build is wrong, so per CLAUDE.md this
is a **code defect, not a spec change** — no SCL is filed for it. It is nonetheless the single
most important line in this report: the erasure path the retention policy will promise does not
complete for tutor users.

### 2.3 Data retained that the spec never classified

`legal_acceptance_outbox` was the known case. It is not the only one. From the 103 prod tables,
cross-referenced against §2.1 and the cascade's table list:

**Unbounded AND unreachable by the cascade** (grows forever, survives account deletion):

| Table | Prod rows | Note |
|---|---|---|
| `idempotency_records` | 0 | `expires_at NOT NULL` + index, no sweeper |
| `usage_rate_limit_ledger` | 151 | only `auth.users` FK cascade |
| `stripe_webhook_events` | 14 | per-row rollback delete only |
| `tutor_turn_metrics` | 29 | no tier, no cascade entry |
| `tutor_context_resolution_log` | 19 | cascades from conversations, which are never deleted |
| `crisis_review_audit_log` | 0 | `case_id` FK is RESTRICT — actively blocks the 180 d case delete |
| `mastery_derivation_gap_ledger` | 0 | no mechanism |
| `psi_occurred_at_backfill_log` | 42 | one-off backfill log, never pruned |
| `deletion_billing_record` | 0 | not touched by `sweep_deletion_evidence` — no strip, no delete |
| 18 × `*_runtime_config_history` | — | append-only by trigger, no purge |
| `mastery_constants_change_log` | — | append-only, no purge |
| `anonymized_actors` | 4 | permanent **by design** (SCL-088) |
| `deletion_request_log` / `deletion_consent_evidence` | 0 | rows permanent by design; identity stripped at 24 m |

**Bounded only by account deletion, with no time-based rule:** `legal_acceptances` (13),
`legal_acceptance_outbox` (0 — rows are stamped `processed_at`, never removed),
`rate_limit_ledger` (5), `abuse_scores`, `abuse_score_incidents`, `guardian_links` (5),
`guardian_consent_requests` (0), `review_schedule`, and every `student_*_kpi` / `student_*_mastery`
/ projection table.

**An orphan worth a look:** `anonymized_actors` holds 4 rows while `deletion_request_log` holds 0.
Four accounts were deleted before the evidence bundle existed, so the evidence side has no record
of them at all. Those four deletions are unprovable under Doc 06D §6.5 by construction.

### 2.4 Cross-cutting conditions that can silence several mechanisms at once

1. **`ACCOUNT_DELETION_LIFECYCLE_V2 !== "true"` disables four mechanisms simultaneously.**
   `sweep_deletion_evidence`, `apply_audit_logs_retention('purge_expired')`,
   `reconcile_deletion_log` and `rewrite_anonymized_actors` all live inside
   `runEvidenceHousekeeping` (`server/lib/account-deletion-execute.ts:657-773`), reached only past
   the flag check at `internal-cron-routes.ts:88-96`.
2. **Unset `CRON_SECRET` ⇒ 404 on all six crons**, silently, with no error log.
3. **Three registry files that locked documents depend on do not exist:**
   `infra/retention-policy-registry.yaml` (Doc 07E §6, Doc 06D §9),
   `infra/privileged-op-source-registry.yaml` (Doc 06B §8.6),
   `infra/release-gates.yaml` (Doc 06A §10). All three **NOT FOUND**.
4. **Periods are mostly hardcoded, not config-driven.** Only `anonymization_retention_days` is
   read from a config table by SQL. 90 days (notifications) and 24 months (evidence) are literals
   in SQL functions; 7 / 90 / 180 (LISA) and 7 (stale sessions) are TypeScript literals.
5. **Correction to a caveat worth recording:** the three 2026-09-17 deletion migrations are
   marked owner-run and I verified they **are applied in prod** — `suppression_status`,
   `sweep_deletion_evidence`, `apply_audit_logs_retention`, `audit_logs_retention_guard`,
   `record_deletion_suppression_outcome` and `deletion_evidence_retention_months` all exist, and
   the three App A.5 config rows are seeded. Mechanisms 1–4 and 6 in §2.1 are genuinely live.

---

## Part 3 — Analytics

**The brief's premise needs correcting before the questions can be answered.** PostHog is not
what is collecting. It is not installed, not configured, and not present in any bundle — it
exists only as target-state prose in `docs/Spec`. What ships today is **Microsoft Clarity**, a
session-replay product, and **Vercel Analytics**. Neither is disclosed in the published legal
corpus, and neither has an age or role gate.

### 3.1 Is PostHog currently initialised, and on which surfaces?

**No. NOT FOUND, exhaustively.** Searched `posthog`, `posthog-js`, `posthog-node`, `PostHog`,
`POSTHOG`, `phc_` across `client/`, `server/`, `apps/`, `packages/`, `shared/`, every
`package.json`, `pnpm-lock.yaml`, `node_modules/`, `dist/`, and `client/index.html`: **zero
matches**. I re-ran this myself over the source tree and confirmed it.

PostHog appears only in specification documents (e.g. `docs/Spec/…07E…:7,27,139,213`), which
describe an `analytics_user_id` model, a `bulk_delete` cascade with `delete_events: true` +
`delete_recordings: true`, and a PostHog→BigQuery export. **None of it is built.** For a COPPA
report the consequence is blunt: 07E must not be read as evidence of deployed controls.

**What is initialised:**

| Vendor | Dependency | Init site | Scope |
|---|---|---|---|
| **Microsoft Clarity** | `package.json:54` `"@microsoft/clarity": "^1.0.2"` | `client/src/main.tsx:54` `clarity.init(projectId)`, called at `:69` | **Global** — module top level, *before* `createRoot()` at `:71` |
| **Vercel Analytics** | `package.json:88` `"@vercel/analytics": "^2.0.1"` | `client/src/App.tsx:319` `<Analytics />` | **Global** — sibling of `<Router />`, outside `<Switch>`, outside `DeletionGate` and `RequireRole` |

Both therefore load on **every** surface in the route registry (`client/src/App.tsx:62-240`):
student (`/dashboard`, `/practice`, `/practice/session/:sessionId`, `/full-test`, `/chat`,
`/tutor`, `/mastery`, `/review-errors`), guardian (`/guardian`, `/profile`, `/notifications`),
admin (included in every `RequireRole allow` list), and marketing/public (`/`, `/login`, `/blog`,
`/legal`, `/digital-sat`, `/trust`). There is no surface-scoping mechanism of any kind.

### 3.2 What does it capture?

**Clarity.** `clarity.init(projectId)` passes a project-ID string and **no options object**.
Nothing is configured in the repo, so every behaviour is the vendor default:

| Setting | In repo | Effective |
|---|---|---|
| Autocapture (clicks, scrolls, rage/dead clicks) | unset | **on** |
| Pageviews | unset | **on** |
| **Session recording** | **unset — no disable flag passed** | **ON.** Session replay is Clarity's primary function |
| Heatmaps | unset | **on** |
| `identify()` / person profiles | no call site (`grep '\.identify('` → 0) | anonymous only |

**Session recording on a student surface — the sharpest version of the question — is ON.** Because
init is global and pre-router, DOM session replay of practice sessions, full-length exams and
**AI-tutor chat (`/chat`, `/tutor`)** is in scope whenever the consent flag is true in a
production build. The team's own note concedes the masking posture:
`docs/analytics-event-taxonomy.md:24` — "No PII is explicitly sent to Clarity (relies on
Clarity's built-in PII masking)." The same doc's claim at `:23` that "session recording can be
disabled by user" is **not substantiated by any code** — there is no per-user toggle.

Note the collision with a published promise: `legal/privacy-policy/v2/en.md:125` states a
connected guardian cannot see the student's conversations with LISA. Session replay of `/chat`
captures exactly that content for a third-party processor.

**Vercel Analytics.** Bare `<Analytics />`, no props, no `beforeSend` scrubber — so full URL
paths are transmitted as-is, including the `/practice/session/:sessionId` path parameter
(`client/src/App.tsx:159`).

**Custom events: NOT FOUND.** Zero `.capture()`, `.track()`, `.identify()` calls repo-wide. The
~17 event names in `docs/analytics-event-taxonomy.md:36-64` are explicitly labelled
"Core Events (Skeleton - Not Yet Implemented)".

### 3.3 Is there any age or role gate on initialisation?

**No. NOT FOUND for either vendor.**

**Vercel Analytics: no gate of any kind.** `client/src/App.tsx:319` is unconditional — no role,
no age, no consent, no env flag, not even a production check.

**Clarity has four gates, none of them age or role** (`client/src/main.tsx:42-52`):

```ts
const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID;
if (!projectId) return;                            // 1. env var present
if (import.meta.env.MODE !== "production") return; // 2. prod build only
if (window.__lyceonClarityInited) return;          // 3. idempotence
if (!readAnalyticsConsent()) return;               // 4. consent flag
```

- **Role gate: NOT FOUND.** Init runs at `:69`, before `createRoot` at `:71`, so
  `SupabaseAuthProvider` has not mounted and no role exists to check.
- **`is_under_13` / date-of-birth gate: NOT FOUND.** The identifiers do not appear in
  `main.tsx` at all. Age logic exists elsewhere and is never consulted on this path.
- **The consent gate is inert.** The setter `window.__lyceonSetAnalyticsConsent`
  (`main.tsx:59-66`) has **zero call sites** — I verified: the only occurrences repo-wide are its
  own type declaration (`:13`) and its own definition (`:59`). There is no consent banner or
  settings control anywhere in `client/src`.

Four consequences, stated precisely:

1. **No user, parent or guardian can grant or revoke analytics consent.** The documented opt-in
   is not a product feature.
2. **Default is deny** (`:26` requires the literal `"true"`; `:28` returns `false` on any read
   failure), so Clarity is **almost certainly dark in production today** — a fortunate accident
   of an unfinished feature, not a designed control.
3. The flag lives in **`localStorage`** — per-device, not account-bound, not server-authoritative,
   carrying no record of *who* consented. **It could not evidence verifiable parental consent
   even if the UI existed.**
4. The setter is installed as a non-configurable, non-writable global, so anything running in the
   page can flip consent to `true` and start session recording on a student surface with no age
   or role check in between.

### 3.4 What retention does the analytics project carry, and where is it configured?

**Dashboard-only for every vendor. NOT FOUND in the repo.**

- **Clarity:** no retention, TTL, sampling or masking call anywhere. `clarity.init(projectId)` is
  the entire configuration surface; everything else lives in the Clarity console, outside version
  control. The project ID is env-var-only (`VITE_CLARITY_PROJECT_ID`); `client/.env.example`
  carries an **empty placeholder** (`VITE_CLARITY_PROJECT_ID=`, read via `git show`), so no live
  ID is committed. **Whether it is set in Vercel production is not determinable from here and
  needs a dashboard check** — that single variable decides whether Clarity is dark or one
  `localStorage` write from recording.
- **Vercel Analytics:** no analytics block in `vercel.json`; plan/dashboard-governed.
- **PostHog:** nothing to configure.
- **The spec-mandated registry does not exist.** `infra/retention-policy-registry.yaml` is
  **NOT FOUND**, so 07E §12's four CI proving mechanisms have nothing to assert against.
- **First-party, and pointing the other way:** `infra/terraform/bigquery.tf:16` provisions dataset
  `lyceon_analytics_archive_prod` with expiry **deliberately disabled** (`:27-29`:
  "`default_table_expiration_ms` is intentionally omitted (no expiry)"), for four
  `retention__*` tutor-derived tables. The comment justifies it by the "pseudonymized **13+**
  class" — but no age-stratification logic exists at that layer, because 07E §10 is unbuilt.

### 3.5 Does any existing consent text cover analytics as a purpose?

**No.** Searched all nine published slugs in `legal/` for `analytic`, `tracking`, `cookies`,
`PostHog`, `Clarity`, `Microsoft`, `session record`, `heatmap`, `replay`, `third-party`,
`processors`.

- **"Analytics" is named once in the whole corpus**, and it refers to BigQuery, not to any
  client-side vendor: `legal/privacy-policy/v2/en.md:139` — "| **Google Cloud (BigQuery)** |
  Long-term retention and analytics | Archived learning data |".
- **Microsoft / Clarity is not named anywhere.** I verified: `grep -rniE "clarity|microsoft"
  legal/` returns exactly one hit, and it is ordinary English —
  `legal/privacy-policy/v2/en.md:67` "improve clarity and instructional effectiveness". A
  session-recording sub-processor ships in the entry bundle and is absent from the sub-processor
  table. That directly contradicts the published commitment at
  `legal/trust-and-safety/v2/en.md:31`: "**Named providers.** We name every service provider that
  processes your data, and what each one receives, in the Privacy Policy."
- **Vercel is named for hosting only** — "Application hosting and delivery … Request and log
  data" (`:136`). Client-side pageview beaconing is not that.
- **Section 9 "Cookies and Tracking"** (`:207-213`) discloses functional/security/performance
  purposes and disclaims only *advertising and cross-site* tracking. True of Clarity, but it does
  not authorise first-party behavioural session capture of a minor's exam.
- **The corpus's under-13 protections are scoped to the AI tutor, not to analytics:**
  `legal/privacy-policy/v2/en.md:77` and `legal/parent-guardian-terms/v2/en.md:60` both limit the
  promise to "third-party **AI** provider". A session-recording vendor is not an AI provider, so
  the promise does not reach Clarity — and no under-13 check exists on that path.

### 3.6 The launch-blocking assessment the brief asked for

The brief's test was: *analytics running on student surfaces without an age gate is
launch-blocking.* That condition is met, with one mitigating fact and one aggravating one.

- **Met:** two analytics vendors load globally on student surfaces with **no age gate and no role
  gate**. One of them is a session-replay product with recording on by default.
- **Mitigating:** Clarity's consent flag defaults to deny and nothing can set it, so it is
  probably not recording today. This is an accident, not a control, and it is one env var plus
  one `localStorage` write from being false.
- **Aggravating:** **Vercel Analytics has no gate at all** — not consent, not production, not
  role. It is collecting on student surfaces right now, and it is not disclosed as an analytics
  purpose in the published policy.

Either way the amended Rule requires the category be named and bounded, and today it is neither.

---

## Part 4 — The gaps, ranked

### List 1 — Specified period, working mechanism. Publishable as-is.

| Category | Period to publish | Mechanism |
|---|---|---|
| Account-deletion grace before erasure | 7 days | `execute-deletions` cron + `grace_period_days` (seeded, verified) |
| Anonymized audit records after deletion | 365 days | `apply_audit_logs_retention('purge_expired')`, window from config |
| Identity in audit records at deletion | severed immediately at T+7 | `apply_audit_logs_retention('strip_identity')` |
| Deletion-request evidence (identity fields) | identity destroyed at 24 months; dated aggregate kept | `sweep_deletion_evidence()` |
| Notification records | 90 days | `sweep_notification_retention()`, 05:00 cron |
| Do-not-contact requests | kept until the subject lifts it | Resend suppression list + `suppression_status` |

Caveat for counsel: all six run inside crons gated on `CRON_SECRET`, and five of the six sit
behind `ACCOUNT_DELETION_LIFECYCLE_V2`. Publishing these periods assumes both remain set.

### List 2 — Specified period, no mechanism. Build it, or publish what we can honour.

Ranked by exposure. "Cheaper" is my judgement of build-vs-narrow, and it is a recommendation, not
a ruling.

| # | Category | Specified | Cheaper path | Why |
|---|---|---|---|---|
| 1 | **Tutor conversation content** (conversations, messages, question links, memory summaries) | 7 days post-entitlement-loss | **Build** | The sweep already exists and is tested. It needs (a) a Cloud Scheduler job, (b) a writer for `tutor_conversations.deleted_at` — which **no code sets today** — and (c) the cascade fix in §2.2. This is the most sensitive category we hold on minors; publishing "we keep tutor chats indefinitely" is not a real option |
| 2 | **Account deletion completing at all for tutor users** | erasure at T+7 | **Build — launch-blocking** | §2.2. Not a retention period but the precondition for every period in List 1 |
| 3 | Tutor instruction assignments / exposures | 90 days | **Build**, after #1 | Same sweep; additionally blocked on `BIGQUERY_ARCHIVE_DATASET`. Alternative: drop the BigQuery archival step and delete outright — archival is a product choice, not a legal one |
| 4 | Crisis-flagged conversations / injection logs | 180 days | **Build**, after #1 | Safety data on minors. Note the `crisis_review_audit_log.case_id` RESTRICT FK blocks the delete as written |
| 5 | LISA cost telemetry / quota appeals | 365 days | **Narrow** | Tables not provisioned; the sweep is a declared no-op. Publish only when they exist |
| 6 | **Inactivity expiry of user-identifying data** | 12 months from last activity | **Narrow** | 07E itself puts the trigger at V1.1+. Publishing a 12-month promise with no job is the exact failure mode this report exists to prevent. Publish "until you delete your account", add inactivity later |
| 7 | **Under-13 hard-delete-everywhere** | immediate, no grace | **Decide first, then build** | Under-13 is "blocked at signup; deleted if detected" per the policy draft. If that block is real, the variant may be unnecessary; if it is not, this is a COPPA obligation with no implementation |
| 8 | Per-category audit tiers (90 d auth / 365 d identity / 7 y billing / 365 d support) | Doc 01 §5.1 | **Narrow** | One 365-day window exists for all actions. Publishing four tiers we do not have is a misstatement; publishing one honest window is accurate |
| 9 | Audit cold storage at 90 days | Doc 01 §5.1 | **Narrow** | `audit_logs_archive` does not exist. Drop the claim |
| 10 | Idempotency records (30 d / 7 d) | Doc 01A §29.1 | **Build — cheap** | A one-predicate sweep on an `expires_at` column that already has an index built for it |
| 11 | Revoked service-auth secrets (7 d after revoke) | Doc 01A §65.1 | **Build — cheap** | One predicate; not personal data, so low legal weight |
| 12 | Guardian consent tokens (14 d) | `profile-routes.ts:365` | **Build — cheap** | Nothing expires them; the `expired` status in the CHECK is never written |
| 13 | Privileged access grants (≤ 90 d) | Doc 06B | **Narrow** | The tables do not exist in prod at all |

### List 3 — No specified period at all. These need a ruling before anything is published.

The amended Rule requires a stated timeframe and prohibits indefinite retention of children's
data, so each of these needs an owner/counsel decision, not a build decision.

| Category | Currently | Question for the ruling |
|---|---|---|
| **Analytics events (Clarity, Vercel Analytics)** | Vendor default, dashboard-only, undisclosed | What is the retention, and is the category disclosed at all? This is the Part 3 finding |
| **Pseudonymized event stream (07E class 2)** | **Explicitly indefinite** | The one place the corpus states "no expiry". Defensible only if the pseudonymization holds and under-13 never enters it — neither is currently built |
| BigQuery `lyceon_analytics_archive_prod` | Expiry deliberately omitted | Same question, first-party |
| `deletion_billing_record` | No strip, no delete | Sits inside the evidence bundle but outside its 24-month sweep |
| 18 × `*_runtime_config_history` + `mastery_constants_change_log` | Append-only, no purge | Operator actions, not student data — but they carry `profiles` FKs |
| `usage_rate_limit_ledger` (151 rows), `rate_limit_ledger` | No time rule | Behavioural traces of minors |
| `tutor_turn_metrics` (29), `tutor_context_resolution_log` (19) | No tier, no cascade | Tutor-derived, outside §14.2's ten tables |
| `stripe_webhook_events` (14) | No rule | Contains payer data |
| `psi_occurred_at_backfill_log` (42), `mastery_derivation_gap_ledger` | No rule | One-off engineering logs that were never cleaned up |
| `legal_acceptances` (13) / `legal_acceptance_outbox` | Deletion-bound only | The published policy already commits to ≥3 years for billing consent (`legal/privacy-policy/v2/en.md:169`); nothing enforces it |
| `anonymized_actors` (4), `deletion_request_log`, `deletion_consent_evidence` | Permanent by design | Intentional under SCL-085/088; the policy must say so plainly rather than omit it |

### What the published policy says today

`legal/privacy-policy/v2/en.md` §6 (`:155-171`) contains **no numeric timeframe for any category
except** the California billing-consent rule at `:169`. It says "a reasonable timeframe" (`:161`)
and "a limited period" (`:165`). Those are precisely the formulations the amended Rule replaces
with named categories and stated timeframes. **The good news is that nothing currently published
is falsified by this report** — the policy is silent, not wrong. The draft at
`docs/Spec/Lyceon Privacy Policy.md:33`, which promises "retained for 12 months from your last
activity and then deleted through our cascade deletion process", **would be** falsified on
publication: no inactivity mechanism exists (§2.1 row 11).

---

## Part 5 — SCLs filed

Numbers re-derived at the moment of use, 2026-09-17, after `git fetch --all --prune`, across all
**18** remote branches and the head of every one of the **6** open PRs (#781, #778, #775, #774,
#773, #728). Highest allocated anywhere: `SCL-090`. Next free: **SCL-091**.

**Filed:** `SCL-091`, `SCL-092`, and an addendum appended to the existing `SCL-090`.

Of the four items the brief listed as "known to be outstanding", **only one was genuinely
unfiled** — see the closing section.

---

## Part 6 — What in this brief turned out to be wrong

Stated plainly, because the brief asked.

1. **"PostHog will be collecting at launch."** PostHog is not installed and never was — zero
   matches in source, manifests, lockfile, `node_modules`, `dist` or HTML. The analytics that
   actually ships is **Microsoft Clarity** (session replay, recording on by default) and
   **Vercel Analytics**. The whole of Part 3 had to be answered about different vendors than the
   brief names, and the answer is worse than the question anticipated: a session-recording
   processor is live on student surfaces and is **not named in the privacy policy at all**, while
   the policy separately promises "we name every service provider".

2. **"Doc 05E '§3.1' is a mis-citation and `anonymized_actors` has no spec anchor" — already
   filed.** This is `SCL-088` (PROPOSED, 2026-09-16), which covers both halves and records the
   fix. Nothing to file.

3. **"Doc 01 Stripe timing is internally inconsistent across §40.2, §40.3, §41 and Doc 05D
   §10.1" — already captured.** `SCL-086`'s own *Owner action* clause says: "reconcile §41's
   checklist line and Doc 05D §10.1's 'immediate subscription cancellation at the deletion
   request' to the T+7 timing." The inconsistency is recorded and assigned; a second SCL would
   duplicate it.

4. **"Four are already known to be outstanding and should be filed if they are not already."**
   Only **one** was: the Doc 06D §6.5 / Doc 06B §8.6 correlation key. That is now `SCL-091`. The
   SCL-090 addendum was genuinely needed and is appended to the existing entry rather than given
   a new number, since it refines a ruling already recorded there.

5. **"Prod is readable through the Supabase MCP for table inventory and row counts."** True, and
   it was more load-bearing than the brief expected — the decisive finding in Part 2 (the live
   cascade body contains no tutor table, and nine RESTRICT FKs block the profile delete) could
   only be established against production. The migration files alone would have understated it.

6. **The brief's framing that the retention work is mostly a documentation exercise.** It is not.
   The single largest finding is not a missing period but a **broken erasure path**: account
   deletion cannot complete for any account that has used the AI tutor (§2.2). A retention policy
   describing deletion timeframes cannot honestly be published until the deletion completes.

7. **One thing the brief implied that is better than expected:** nothing currently published is
   contradicted by this report. The live privacy policy is silent on timeframes rather than wrong
   about them, so this is an omission to close, not a misstatement to retract.

8. **An evidence gap I could not close.** Whether `VITE_CLARITY_PROJECT_ID` is set in Vercel
   production is not determinable from the repo or from this environment (egress to `lyceon.ai`
   is blocked by policy, and `client/.env.example` is read-denied to my tooling — I read it
   through `git show` instead and it holds an empty placeholder). That one variable decides
   whether Clarity is dark or one `localStorage` write from recording minors' sessions. **It
   needs a dashboard check.**
