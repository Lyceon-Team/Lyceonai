# Pass 1 — Existence

**Audit:** Claude state-assessment (read-only)
**HEAD audited:** `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac` (`2026-06-06 22:37:46 -0500`, Merge #339)
**Live-state ground truth:** `docs/SpecAudit/00-supabase-live-state.csv` (generated `2026-06-07 03:03:35+00`, Postgres 17.6; **H1: 0 applied migrations recorded**)
**Scope of this pass:** For every capability the corpus describes — does anything in the repo or live DB implement it? Classify IMPLEMENTED / PARTIAL / MISSING. Then the inverse: inventory what EXISTS that the spec does not describe (UNSPECED).

> Evidence discipline: repo claims carry `file:line`; DB claims carry the capture section (A1/A2/A7/B1/C1/D1/G1/H1) + object name. Severity scheme provisional. A recurring structural finding underlies this whole pass: **the deployed schema uses different table/function names than the canonical specs**, so many capabilities are "implemented under a parallel name" rather than cleanly IMPLEMENTED or MISSING.

---

## 1. Coverage matrix (spec area → existence status → evidence)

### Identity, Access & Profiles (Doc 01 V8/V6, Doc 01A)

| Spec area | Status | Evidence |
|---|---|---|
| Canonical identity on `profiles`, 1:1 with `auth.uid()` (D01-001) | IMPLEMENTED | A1 `profiles` 61 rows; `server/lib/profile-bootstrap.ts:94` insert; D1 `profiles_set_updated_at`, `set_student_link_code` triggers |
| Legacy `users` deprecated (D01-002) | PARTIAL | A1 `users` still present (45 rows) with `password`/`two_factor_secret`/`password_reset_token` columns (A2); orphaned — no runtime writer (see UNSPECED §2) |
| `profile-service.ts` is the **sole** canonical writer (D01-004/005) | MISSING | 5 TS writers + 1 RPC write `profiles` (Pass 3 CC-P3-002 / Pass 2 CC-P2-010 reader-split). The single-writer contract is not met |
| Server-side role resolution; no client trust (D01-006/011) | IMPLEMENTED | `server/middleware/supabase-auth.ts` resolves from `profiles`; enum `profile_role` (E1: student/guardian/admin) |
| MFA required for admin/tutor/teacher; TOTP/WebAuthn only (D01-008/009) | MISSING | No 2FA code anywhere (orphaned-fn trace); `users.two_factor_secret` is a dead column; MFA factors would live in `auth.mfa_factors` (out of public scope, unverifiable) |
| Constants-in-DB doctrine: `auth_runtime_config`, `consent_runtime_config`, `entitlement_runtime_config`, `account_deletion_runtime_config`, `auth_mfa_config` (D01-035, D01A-001/002) | MISSING | All `*_runtime_config` tables absent (A1 presence check = 0). Constants live in code (`apps/api/src/services/mastery-constants.ts`) → see CC-P1-001 |
| `*_runtime_config_history` append audit (D01A-005) | MISSING | Absent (A1) |
| Audit logging to `audit_logs` for identity events (D01-036) | PARTIAL | `audit_logs` exists (A1) but **0 rows**; `system_event_logs` (2 rows) and `guardian_link_audit` are written instead (`server/routes/guardian-routes.ts:37,65`) |
| IdempotencyService + `idempotency_records` (D01A-015..019) | MISSING | `idempotency_records` absent (A1). Idempotency is ad-hoc per-domain (Stripe ledger; practice status-guards) → CC-P1-002 |
| RateLimitLedger (D01A-020) | IMPLEMENTED | A1 `usage_rate_limit_ledger` 39 rows; `supabase/migrations/20260408_rate_limit_ledger_truth.sql`; B1 `check_and_reserve_*` quota fns |
| Structured logging + PII redaction (D01A-007/008) | IMPLEMENTED | `server/lib/logger.ts` redacts `password` etc.; verified by anti-leak/secrets traces |

### Billing, Entitlements & Guardian Trust (Doc 01)

| Spec area | Status | Evidence |
|---|---|---|
| Stripe customer per profile; webhook idempotency (D01-014/015) | IMPLEMENTED | A1 `stripe_webhook_events`; `server/lib/webhookHandlers.ts`; `supabase/migrations/20260108_sprint21_hardening.sql` |
| Entitlement on profile; payment ≠ permission (D01-018, D02B-017) | PARTIAL | A1 `entitlements` 32 rows but linked via `accounts`/`lyceon_accounts` (split-brain — CC-P2-010); B1 `ensure_account_for_user`, `entitlements_writer_quarantine` |
| Guardian links + consent workflow (D01-021/026/028) | IMPLEMENTED | A1 `guardian_links` 4, `guardian_consent_requests` 2, `guardian_link_audit`, `guardian_preferences`; B1 `link_guardian_by_email`, `is_guardian_of` |
| Guardian visibility = link AND entitlement active (D01-023, D04C-005) | MISSING (broken) | `is_guardian_of` (B1:6165) checks link only, not entitlement → **CC-P2-007** |
| Guardian aggregate-only visibility (D01-023, INV-02-06) | PARTIAL (broken) | Guardian SELECT exists on per-attempt/internal-skill tables → **CC-P2-008** |
| Account deletion 7-day lifecycle + `deidentify_user` at T+7 (D01-031/032/033) | PARTIAL | B1 `deidentify_user` exists; `account_deletion_requests` (A1, 0 rows); endpoint `server/routes/account-deletion-routes.ts:144` has **no autonomous caller** → CC-P1-007 |
| Under-13 birthday transition daily job (D01-030); consent-expiry 30-day deletion (D01-027) | MISSING | No scheduled job (G1: 0 cron jobs) → CC-P1-006 |

### Content Supply Chain & Canonical IDs (Doc 02A)

| Spec area | Status | Evidence |
|---|---|---|
| Canonical question ID `SAT{M\|RW}{1\|2}[A-Z0-9]{6}` (D02A-009) | IMPLEMENTED | A2 `questions.canonical_id`; served via `QUESTION_SAFE_SELECT` (`server/routes/questions-runtime.ts:13`); format not byte-verified here |
| Difficulty integer 1–3 only; `check (difficulty between 1 and 3)` (D02A-003) | NEEDS-REVIEW | B1 `normalize_difficulty_bucket`, `get_difficulty_multiplier(p_bucket integer)`; A2 `questions.difficulty` present; CHECK constraint not confirmed in capture |
| Items never deleted; `active_status=retired` (D02A-008) | NEEDS-REVIEW | A2 has status columns on `questions`; retention behavior not traced |
| Internal option metadata never client-facing (INV-02A-07) | IMPLEMENTED | `projectStudentSafeQuestion` allowlist (`shared/question-bank-contract.ts:191`) |

### Practice Engine (Doc 02B §14)

| Spec area | Status | Evidence |
|---|---|---|
| Resumable sessions, prefill items, server-authoritative (D02B-021/026) | IMPLEMENTED | A1 `practice_sessions` 83, `practice_session_items` 362, `practice_events` 122; `server/routes/practice-canonical.ts` |
| Pre-submit payload omits answer/explanation (D02B-022, ALM-001) | IMPLEMENTED (app) / BROKEN (DB) | App serializer safe; but `anon` can read `questions` answers directly → **CC-P2-001** |
| Idempotent submit via `client_attempt_id` (D02B-024) | IMPLEMENTED | Status-guarded replay `server/routes/practice-canonical.ts:2298-2431` (CC-P2-014) |
| Deterministic seeded tie-break selection (D02B-027) | IMPLEMENTED | `apps/api/src/services/adaptiveSelector.ts`; `packages/shared/src/rng.ts` |
| Free daily quota 40 (D02B-016/018) | IMPLEMENTED | B1 `check_and_reserve_practice_quota`; A1 `usage_daily` |

### Review Engine (Doc 02B §16)

| Spec area | Status | Evidence |
|---|---|---|
| Review sessions/items/events; wrong-answer entry (D02B-029) | IMPLEMENTED | A1 `review_sessions` 8, `review_session_items` 22, `review_session_events` 38, `review_error_attempts` 7 |
| Tutor-in-review answer-withholding (D02B-030, ALM-007) | PARTIAL | Field-safe, but leak filter scoped to practice surface only → CC-P2-012 |
| SM-2 scheduling (D02B-031) | NEEDS-REVIEW | `supabase/migrations/20260310_review_event_taxonomy.sql`; SM-2 params not confirmed as DB config |

### Full-Length Exams & Scoring (Doc 04 / 04A / 04B / 04C)

| Spec area | Status | Evidence |
|---|---|---|
| Canonical exam schema: `test_sessions`, `test_session_answers`, `test_forms`, `score_runs`, `scoring_model_versions`, `score_run_event_ledger`, `exam_runtime_outbox`, `exam_failure_ledger` (D04A/04B) | MISSING | Presence check = 0 for all except `test_forms` (stub, RLS-off, 1 row). Exam engine is built on the **UNSPECED** `full_length_exam_*` family → **CC-P1-003** |
| Exam runtime (sessions/modules/questions/responses/rollups) | IMPLEMENTED (parallel name) | A1 `full_length_exam_sessions` 1, `_modules` 4, `_questions`, `_responses`, `_score_rollups`; `apps/api/src/services/fullLengthExam.ts` |
| Server-authoritative continuous timer (D02B-035, D04A-001/010) | NEEDS-REVIEW | `client/src/hooks/useTimer.ts` is UI-only; server enforcement present in `fullLengthExam.ts` but not deeply traced this pass |
| Scoring in PL/pgSQL; answers never leave DB (D04B-007) | MISSING (as specced) | No `score_runs`/scoring fn in B1; scaled-score logic is in TS `apps/api/src/services/fullLengthScoreTables.ts` (answers cross into app) → CC-P1-009 |
| Insert-once `score_runs` w/ REVOKE UPDATE/DELETE (D04B-009) | MISSING | `score_runs` absent |
| Module-2 path internal-only (D02B-041, D04A-021) | NEEDS-REVIEW | `full_length_adaptive_config` (A1, 2 rows); disclosure-suppression not traced |
| Review unlock gated on `score_runs` success (D04C-004) | PARTIAL (drift) | Gated on `session.status` instead → CC-P2-011 |
| Scaled-score conversion tables `sat_score_tables` (D02B-044) | MISSING | Absent (A1); logic in code |

### Mastery, KPI, Projections (Doc 02C / Doc 05 family)

| Spec area | Status | Evidence |
|---|---|---|
| Canonical RPC `apply_mastery_event` + `mastery_events` + `student_skill_weekly_snapshot` + `mastery_event_audit_log` (Doc 05A) | MISSING | All absent (presence check = 0). Runtime uses legacy `apply_learning_event_to_mastery` → **CC-P1-004 / CC-P2-003** |
| `student_skill_mastery` write-locked to service_role (D05P-021) | IMPLEMENTED | C1 `skill_mastery_no_direct_write` USING/CHECK false (CC-P2-015) |
| Mastery from observed events only; no predicted score (D05P-026/031) | NEEDS-REVIEW | No "predicted score" table found; per-row exposure of `mastery_score` to guardian (CC-P2-008) is the related defect |
| Domain mastery as independent aggregation (D05P-025) | NEEDS-REVIEW | B1 `refresh_domain_mastery_for_student_domain`; formula shape not byte-verified (engine is non-V1.0 anyway — CC-P2-003) |
| KPI rollups/counters/snapshots (Doc 05B) | PARTIAL | A1 `student_kpi_rollups_current` 30, `student_kpi_counters_current` 0, `student_kpi_snapshots` 0; B1 `upsert_student_kpi_counters_current` has zero TS callers |
| Score projections + daily sweep + `projection_refresh_outbox` + `student_projection_refresh_state` (Doc 05C) | PARTIAL | A1 `student_section_projections` 2 rows exist; refresh-outbox/state tables absent; no daily sweep job → CC-P1-005 |
| Constants governance: append-only change log via ENABLE ALWAYS trigger (D05D-002) | PARTIAL | D1 `trg_audit_mastery_constants_changes`, `trg_audit_kpi_constants_changes` exist (origin-enabled, not ENABLE ALWAYS); `constants_audit_log` is **RLS-off + anon-writable** → CC-P2-002 |

### LISA / Tutor (Doc 03 family + ADR-001)

| Spec area | Status | Evidence |
|---|---|---|
| Persistence in Supabase; GCP stateless (ADR §3) | IMPLEMENTED | A1 `tutor_conversations` 2, `tutor_messages`, `tutor_instruction_*`, `tutor_memory_summaries`; worker has no Supabase client (CC-P3-006 PASS half) |
| Tutor never writes mastery (D03-006) | IMPLEMENTED | No mastery import under tutor paths (CC-P3-008 PASS half) |
| Tutor→review→`mastery_outbox` seam (ADR §5) | MISSING | `mastery_outbox` absent → **CC-P3-007** |
| LISA retention crons 7/90/180/365-day (D03-001/002) | MISSING | G1: 0 cron jobs; no purge caller → CC-P1-008 |
| `tutor_interactions` verbatim columns dropped (one-time) | IMPLEMENTED | `supabase/migrations/20260606_tutor_interactions_drop_verbatim.sql`; A1 `tutor_interactions` 0 rows |

### Cross-cutting platform

| Spec area | Status | Evidence |
|---|---|---|
| Legal acceptances / clickwrap (Privacy/Refund/Subscription docs) | IMPLEMENTED | A1 `legal_acceptances` 33 rows; `supabase/migrations/20251223_legal_acceptances.sql` |
| Notifications | IMPLEMENTED | A1 `notifications`, `user_notification_preferences`; `supabase/migrations/20260327_notifications_contract.sql` |
| Study calendar / plan (student-owned) | IMPLEMENTED | A1 `student_study_plan_days` 28, `_tasks` 80, `student_study_profile` 1; `apps/api/src/routes/calendar.ts` |
| Scheduled jobs (retention, snapshots, reconciliation, deletion) | MISSING | **G1: `(0 jobs defined)`, G2: `(0 run-history rows)`** → CC-P1-006 |
| Analytics warehouse / BigQuery (Doc 07) | MISSING (out of V1 scope per spec) | No analytics tables in `public`; I5 shows no warehouse schema; spec defers to V1.1+ |

---

## 2. UNSPECED inventory (exists in repo/DB, not described by the corpus)

### Orphaned DB functions referencing absent tables
- **`ingestion_v4_*` / `v4_*` family (10 functions, B1):** `update_ingestion_v4_jobs_updated_at`, `update_ingestion_v4_queue_updated_at`, `v4_acquire_worker_lock`, `v4_release_worker_lock`, `v4_renew_worker_lock`, `v4_queue_reset_stale_locks`, `v4_increment_cluster_usage`, `v4_mark_style_pages_used`, `v4_set_primary_cluster`, `v4_debug_queue_schema`. Reference `ingestion_v4_jobs`/`ingestion_v4_queue` tables **absent from A1**. **Zero repo callers** (trace confirmed). → CC-P1-010
- **`vectors`/`match_vectors`/`create_vectors_table_if_not_exists` (B1):** reference a `vectors` table absent from A1; only defined in `database/supabase-vector-setup.sql` (not an applied migration); **zero repo callers**. Live RAG uses `match_questions` over `question_embeddings`.
- **`enqueue_render_pages_if_missing` (×3 overloads) / `_v2` (B1):** PDF page-render ingestion enqueue; no live caller; references render-pipeline tables not in A1.

### Orphaned / legacy parallel tables (present in A1, not the canonical name and/or empty + CI-forbidden in runtime)
- Identity/account: **`users`** (45 rows, legacy), **`accounts`/`account_members`** (13/13) coexisting with **`lyceon_accounts`/`lyceon_account_members`** (19/19) — split-brain (CC-P2-010).
- Attempts (all 0 rows, CI-forbidden in runtime): **`attempts`**, **`answer_attempts`**, **`exam_attempts`**, **`exam_responses`**, **`student_question_attempts`** (0 rows), **`practice_attempts_v0`**.
- Legacy exam family (all 0 rows): **`exam_forms`**, **`exam_form_items`**, **`exam_sections`**, **`exam_score_rollups`** (writer `apps/api/src/services/exams/exam-form-write.ts` is dead code).
- Tutor/chat: **`chat_messages`** (0 rows, CI-forbidden), **`tutor_interactions`** (verbatim-stripped, dormant).
- LMS-style scaffolding never wired to SAT runtime: **`courses`**, **`sections`**, **`items`**, **`orgs`**, **`memberships`**, **`transcripts`**, **`progress`**, **`user_competencies`**, **`competency_events`**, **`difficulty_levels_ref`**.
- RAG/ingestion: **`documents`**, **`embeddings`**, **`question_embeddings`** (1856 kB, 0 rows), **`question_classification_updates`** — several RLS-off (CC-P2-002).
- Odd object: **`v_half_life_days`** — `kind=table` (A1) despite a view-style name, 0 rows.

### Dead auth columns (no runtime reader/writer; auth is 100% Supabase Auth)
- `users.password` (`shared/schema.ts:38`, comment "Legacy migration source table"), `users.two_factor_secret`, `users.password_reset_token` — defined only in `database/migrations/0001_core_schema.sql`; no bcrypt/argon/TOTP code exists. → CC-P1-012

### Unspec'd schemas (I5, context only)
- `stripe` schema (likely Stripe FDW), `copilot` schema, `cron`, `net` — present in the database; not described by the public-scope spec corpus.

### Repo-level sprawl (not DB)
- ~30 root-level `*.md`/`*.json` audit/summary artifacts (e.g. `PRODUCTION_AUDIT_REPORT.md`, `auth-proof-bundle.txt` 109 KB, `audit_output.json`); two migration systems (`migrations/` empty Drizzle journal + 60 `supabase/migrations/*.sql`); `deprecated/` and `attached_assets/` prompt dumps. Coherence/hygiene observations, not invariant defects.

---

## 3. Pass 1 findings (discrete existence gaps)

**CC-P1-001 — HIGH — MISSING — Constants-in-DB doctrine unimplemented (`*_runtime_config` tables absent).**
Spec: Doc 01A §1/§2 (D01A-001/002), Doc 01 V8 §23 (D01-035), Doc 02B INV-02B-15. Evidence: presence check = 0 for `auth_runtime_config`, `consent_runtime_config`, `entitlement_runtime_config`, `account_deletion_runtime_config`, `exam_runtime_config`, `practice_runtime_config`, `review_runtime_config`. Constants live as code literals (`apps/api/src/services/mastery-constants.ts`). The DB has only `mastery_constants`, `kpi_constants`, `full_length_adaptive_config` (A1).

**CC-P1-002 — MEDIUM — MISSING — Canonical IdempotencyService / `idempotency_records` absent.**
Spec: Doc 01A Part IV (D01A-015..019). Evidence: `idempotency_records` not in A1. Idempotency is per-domain ad-hoc (Stripe ledger `stripe_webhook_events`; practice/review status-guards). The unified `(scope, client_key)` primitive and 409-on-conflict contract do not exist.

**CC-P1-003 — HIGH — MISSING — Doc 04 canonical exam schema absent; exam engine runs on an UNSPECED parallel family.**
Spec: Doc 04A §5, Doc 04B §5/§7. Evidence: `test_sessions`, `test_session_answers`, `score_runs`, `scoring_model_versions`, `score_run_event_ledger`, `exam_runtime_outbox`, `exam_failure_ledger` all absent (presence check = 0); only `test_forms` exists as an RLS-off stub (1 row). The live engine uses `full_length_exam_sessions/modules/questions/responses/score_rollups` (A1). Every Doc 04 guarantee anchored on `score_runs` (insert-once, version-pinned PL/pgSQL scoring, outbox, review-unlock gate) is therefore unimplemented as specified.

**CC-P1-004 — CRITICAL — MISSING — Mastery V1.0 objects absent (cross-ref CC-P2-003).**
Spec: Doc 05A §4.1. Evidence: `apply_mastery_event`, `mastery_events`, `student_skill_weekly_snapshot`, `mastery_event_audit_log` all absent. Runtime calls legacy `apply_learning_event_to_mastery` (`apps/api/src/services/mastery-write.ts:74`).

**CC-P1-005 — MEDIUM — PARTIAL — Score-projection refresh infrastructure absent.**
Spec: Doc 05C §4. Evidence: `student_section_projections` exists (A1, 2 rows) but `projection_refresh_outbox` and `student_projection_refresh_state` are absent and no daily sweep job exists (G1: 0 jobs). Projections cannot refresh on the 24h/40-event cadence the spec requires.

**CC-P1-006 — HIGH — MISSING — No scheduling infrastructure; every recurring spec behavior is unscheduled.**
Spec: Doc 01 §17/§19 (birthday transition, consent-expiry deletion, T+7 hard delete), Doc 05C/05D (snapshots, recompute), Doc 03 §14.2 (retention), Doc 06D §9 (retention registry). Evidence: **G1 `(0 jobs defined)`, G2 `(0 run-history rows)`** despite `pg_cron 1.6.4` installed (F1); no Vercel `crons` (`vercel.json`), no GitHub Actions `schedule:` (`.github/workflows/`), no node-cron/BullMQ in any `package.json`.

**CC-P1-007 — HIGH — PARTIAL — Account deletion executes only by manual admin call; grace window expires silently.**
Spec: Doc 01 §19 (D01-032). Evidence: `deidentify_user` (B1) and `POST /api/account/execute-deletions` (`server/routes/account-deletion-routes.ts:144`) exist and are correct, but have **no autonomous caller** (trace confirmed) and no scheduled trigger (CC-P1-006). `account_deletion_requests` (A1, 0 rows).

**CC-P1-008 — HIGH — MISSING — LISA retention/pseudonymization crons unbuilt (cross-ref CC-P3-006).**
Spec: Doc 03 §14.2 / INV-03-19 (7-day soft-delete + 90/180/365-day archival). Evidence: verbatim `tutor_messages`/`tutor_conversations` exist (A1) with no purge job (G1: 0 jobs); `docs/alignment/KNOWN-GAPS.md` marks "PR2 retention crons" unchecked.

**CC-P1-009 — MEDIUM — MISSING — Scaled-score conversion table `sat_score_tables` absent; scoring math runs in app code.**
Spec: Doc 02B §19 (D02B-044), Doc 04B §5.12 (scoring in PL/pgSQL, "correct answers never cross out of the database"). Evidence: `sat_score_tables` absent (A1); conversion logic is TypeScript (`apps/api/src/services/fullLengthScoreTables.ts`), so answer keys cross into app code — contrary to D04B-007.

**CC-P1-010 — MEDIUM — UNSPECED — Orphaned ingestion/vector/render function families with zero callers.**
Evidence: `ingestion_v4_*`/`v4_*` (10 fns), `vectors`/`match_vectors`/`create_vectors_table_if_not_exists`, `enqueue_render_pages_if_missing(_v2)` — all reference tables absent from A1; trace found no repo callers. Latent surface / cleanup debt.

**CC-P1-011 — MEDIUM — UNSPECED — Extensive legacy parallel tables coexist with canonical ones.**
Evidence (A1): `users`/`accounts`/`account_members` beside `profiles`/`lyceon_accounts`; `attempts`/`answer_attempts`/`exam_attempts`/`exam_responses`/`student_question_attempts` (all 0 rows); `exam_forms`/`exam_form_items`/`exam_sections` (0 rows, dead writer); `chat_messages` (0 rows); LMS scaffolding (`courses`/`sections`/`items`/`orgs`/`memberships`/`transcripts`/`progress`/`user_competencies`/`competency_events`). Several are CI-forbidden in runtime, confirming intended-legacy status without removal.

**CC-P1-012 — MEDIUM — UNSPECED — Dead plaintext-auth columns on `users`; MFA unimplemented.**
Evidence: `users.password`/`two_factor_secret`/`password_reset_token` exist with no runtime reader/writer (auth is 100% Supabase Auth); no TOTP/WebAuthn code (Doc 01 §11 D01-008/009 unmet — see Identity matrix row).

**CC-P1-013 — MEDIUM — PARTIAL — `audit_logs` is empty despite a broad mandated audit surface.**
Spec: Doc 01 §22 (D01-036). Evidence: `audit_logs` (A1) "admin-only" but **0 rows**; actual audit writes go to `system_event_logs` (2 rows) and `guardian_link_audit`. The comprehensive identity-event audit trail the spec enumerates is not being populated in the canonical table.

---

### Pass 1 summary

| ID | Severity | Tag | One-line |
|---|---|---|---|
| CC-P1-001 | HIGH | MISSING | `*_runtime_config` constants tables absent; constants in code |
| CC-P1-002 | MEDIUM | MISSING | No canonical IdempotencyService / `idempotency_records` |
| CC-P1-003 | HIGH | MISSING | Doc 04 exam schema (`score_runs` et al.) absent; engine on UNSPECED `full_length_exam_*` |
| CC-P1-004 | CRITICAL | MISSING | Mastery V1.0 objects (`apply_mastery_event`, `mastery_events`) absent |
| CC-P1-005 | MEDIUM | PARTIAL | Projection refresh outbox/state + daily sweep absent |
| CC-P1-006 | HIGH | MISSING | Zero scheduling infrastructure (pg_cron 0 jobs; no Vercel/GHA cron) |
| CC-P1-007 | HIGH | PARTIAL | Account deletion never auto-executes (no caller/scheduler) |
| CC-P1-008 | HIGH | MISSING | LISA retention/pseudonymization crons unbuilt |
| CC-P1-009 | MEDIUM | MISSING | `sat_score_tables` absent; scoring math in app code |
| CC-P1-010 | MEDIUM | UNSPECED | Orphaned `ingestion_v4_*`/`vectors`/render fns, zero callers |
| CC-P1-011 | MEDIUM | UNSPECED | Legacy parallel tables coexist with canonical |
| CC-P1-012 | MEDIUM | UNSPECED | Dead auth columns on `users`; MFA unimplemented |
| CC-P1-013 | MEDIUM | PARTIAL | `audit_logs` empty despite mandated audit surface |
