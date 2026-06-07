# Closure Pass (CC2) — Targeted Verification

**Audit:** Claude state-assessment, closure pass (read-only). Bounded follow-up on first-pass NEEDS-REVIEW items + unverified correctness questions. Not a re-run; CC-P1/P2/P3 stand.
**HEAD:** `b7399ec` (audit commit) atop `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac`; `git diff --stat be91469 HEAD` excluding `docs/SpecAudit/01-code-audit-claude/` is **empty** → audited code tree == `be91469`.
**Ground truth:** `docs/Spec/` (read-only) + `docs/SpecAudit/00-supabase-live-state.csv` (read-only; H1: 0 migrations). **`00-supabase-live-state-constants.md` is ABSENT** → constants row-value items are UNVERIFIABLE-PENDING-DATA.
**Independence:** `docs/SpecAudit/02-code-audit-codex/` not read.

> Evidence: `file:line` (repo) or capture section + object (DB). AMBIGUITY = both readings recorded. Each item below ends with any first-pass classification it confirms or corrects.

---

## CC2-A — Full-length scoring math vs Doc 04B → **FINDING CC2-001 (CRITICAL)**

**Verdict:** (c) The deployed scoring is a **lookup-table approach the spec does not describe** — not the Doc 04B closed-form formula, and not even a different closed-form.

**Deployed (TypeScript, runs in app code):** `completeExam()` (`apps/api/src/services/fullLengthExam.ts:2911`) → `computeExamScores()` (`:1672`) → `calculateSectionScaledScore()` → `getModeledScaledScore()` (`apps/api/src/services/fullLengthScoreTables.ts:33-52`), which is a **direct array index**: `table.scaledByRawCorrect[boundedRaw]` where `boundedRaw = total correct across M1+M2`. The tables (`fullLengthScoreTables.ts:7-18`) are two static arrays — RW 55 entries, Math 45 entries — linearly spaced 200→800 (~11/step RW, ~13.6/step Math). `is_correct` is computed in TS at submit time by comparing the student letter to the denormalized `question_correct_answer` (`fullLengthExam.ts:2485-2491`). Rollups (`full_length_exam_score_rollups`, migration `20260218`) store only raw counts + `overall_score`; no scaled/partial/version/constants columns.

**Spec (Doc 04B "Full length scoring V4.3" §6.1/§6.3):** closed-form `ceiling=max(430, 800·(r₁/N₁)^0.5)`; difficulty-weighted M2 deductions `D_e=15, D_m=9, D_h=6`; raw floor `200+400·(r₁+r₂)/N_total`; path floor `min(580, 450+15·(r₁−T))` else `200`; clamp [200,800]; round-half-up to 10. §5.12: *"All scoring computation runs inside Postgres … Correct answers never cross out of the database into application code."*

**Per-constant:** all 13 Doc 04B constants (α, C_floor, C_max, D_e/m/h, R_base, R_mult, F_A, F_B_base/bonus/cap, R_round) are **ABSENT** from the deployed path; module-2 path, per-difficulty deductions, and routing threshold T are never consulted; raw input is a flat M1+M2 total rather than the spec's `(r₁, r₂, n_e/m/h^M2)` decomposition.

**Also confirmed divergent:** scoring in TS not PL/pgSQL (answers cross into app code, contra §5.12); `score_runs`/`score_run_event_ledger`/`scoring_constants`/`scoring_model_versions` absent (confirms **CC-P1-003**); idempotency via rollup upsert on `session_id`, not an outbox-event ledger; no partial-scoring (`total_scaled=NULL` / `partial_display_scaled`) support.

**First-pass:** *sharpens* CC-P1-009 ("scoring math in app code") and CC-P1-003 — the scoring is not merely relocated to TS, it implements an entirely different (linear lookup) model that uses **none** of the canonical formula the spec treats as load-bearing IP.

---

## CC2-B — Quota / rate-limit numerics vs spec → **FINDING CC2-002 (HIGH)** + UNVERIFIABLE sub-items

**Practice daily quota — DRIFT (corrects first pass).** Spec Doc 02B §12 Entitlement Matrix, §13 Quota Contract, Appendix A `practice_runtime_config.daily_quota_free` = **40 / calendar-day** (reset at America/Chicago midnight). Deployed `check_and_reserve_practice_quota` (capture B2): `v_limit := 20` over `interval '24 hours'` (rolling). Two drifts: limit 40→20, and calendar-day→rolling-window. Constants are **code/DB literals**, not a `practice_runtime_config` table (which is absent — confirms CC-P1-001).

**Tutor density — DRIFT.** Spec Doc 03 §13 hard limits are per-minute (12)/hour (60)/day (120)/week (2,500)/month (10,000), in message counts. Deployed `check_and_reserve_tutor_budget` (B2) uses a **5-minute density window** (10 global / 6 session free; 18/12 entitled) — a structure absent from §13; effective ~2/min vs spec 12/min, and the per-day/week/month caps are not implemented.

**UNVERIFIABLE (no spec anchor in the readable corpus):** full-length `v_limit:=2`/7d; calendar `v_limit:=3`/7d; tutor token budget 60,000/300,000 per 24h (Doc 02B Appendix A marks tutor rate limits "(product decision — pending)"); cost budget 900,000/4,000,000 micros; cost estimator 75/300 micros per 1K; cooldowns 2min/5min; reservation TTL 15min. These deployed values have no locked spec value to compare against → recorded UNVERIFIABLE rather than MATCH/DRIFT.

**First-pass:** **CORRECTS** the Pass-1 matrix row *"Free daily practice quota 40 (D02B-016/018) → IMPLEMENTED"* → **DRIFT** (spec 40/calendar-day vs deployed 20/rolling-24h). The first pass read the spec value right but wrongly called it implemented.

---

## CC2-C — `deidentify_user` vs deletion/retention matrix → **FINDING CC2-003 (HIGH)**

**Verdict:** FINDING. The deployed `deidentify_user(target_user_id, deleted_email)` (capture B2, `00-supabase-live-state.csv:5492-5635`) leaves multiple student-linked tables untouched, and the FK cascades that might otherwise cover them **do not fire** because the function **scrubs** the profile (UPDATE) and account deletion only **disables** the `auth.users` row — neither parent is deleted.

**Covered correctly** — hard-deletes: `practice_session_items`, `practice_sessions` (→ `practice_events` via `practice_events_session_id_fkey ON DELETE CASCADE`, capture FK 1402), `answer_attempts`, `student_question_attempts`, `student_skill_mastery`, `student_cluster_mastery`, `review_session_items/events/sessions/error_attempts`, `user_competencies`, `competency_events`, `full_length_exam_score_rollups`, `full_length_exam_sessions` (→ `_modules`/`_questions`/`_responses` via CASCADE, FK 1341/1343/1348-1350), study-plan/profile, `student_kpi_counters_current`, `student_kpi_snapshots`, `tutor_interactions` (dead table), `notifications`, prefs, `guardian_consent_requests`, `usage_daily`. Scrubs (retain row): `profiles` (PII nulled), `legal_acceptances` (IP/UA nulled), `entitlements` (billing scrubbed, plan→free), `guardian_links` (status→revoked).

**Uncovered student-linked tables (each a gap):**
| Table | Why not covered | Sensitivity |
|---|---|---|
| `tutor_conversations`, `tutor_messages`, `tutor_memory_summaries`, `tutor_instruction_assignments`, `tutor_instruction_exposures`, `tutor_question_links` | Not deleted; their `student_id → profiles(id) ON DELETE CASCADE` (FK 1510/1537/1529…) never fires because the profile is scrubbed not deleted | **Verbatim student–AI conversations + teaching profile survive de-identification** |
| `student_domain_mastery` (8 rows), `student_section_projections`, `student_kpi_rollups_current` (30 rows) | Not deleted; Doc 05D §10 names these in the cascade | Product-facing mastery/KPI/projection retained |
| `usage_rate_limit_ledger` | Not deleted; `→ auth.users ON DELETE CASCADE` (FK 1560) doesn't fire (auth row only disabled) | Activity history retained |
| `guardian_link_audit` | Not deleted; `→ profiles ON DELETE CASCADE/SET NULL` doesn't fire | Linkage history retained |
| `system_event_logs` | Not deleted | Event log with user refs retained |

**Spec basis:** Doc 03 §14.2 / INV-03-19 (tutor data deleted on request; no indefinite retention); Doc 05D §10 / D05D-006 (FK-ordered hard-delete of all 05A/05B/05C derived rows incl. domain mastery, projections, KPI rollups); Privacy Policy deletion commitments. *(Doc 07E §5.2 makes hard-delete the V1 fallback, so the delete model itself is acceptable; the uncovered tables are the defect.)*

**First-pass:** *extends with concrete table evidence* CC-P1-007 (deletion path), CC-P3-006 / CC-P1-008 (verbatim tutor store with no expiry) — the de-identification routine, even when invoked, does not reach the tutor conversation store or three Doc 05 derived tables.

---

## CC2-D — Server-authoritative exam timer → **CONFORMANT**

**Verdict:** SERVER-AUTHORITATIVE. `startModule` writes `started_at`/`ends_at` from server `new Date()` (`fullLengthExam.ts:2317-2326`); `calculateTimeRemaining` derives remaining from DB `endsAt` vs server `Date.now()` (`:1746-1754`); late detection `isLate = now > ends_at` server-side, persisted as `submitted_late` (`:2702-2714`); expired-timer auto-submit is server-driven (`:2436-2443`). The `SubmitModuleParams`/`SubmitAnswerParams` interfaces (`:251-272`) and `full-length-exam-routes.ts` pass **no** client timestamp/elapsed; none is trusted in any state decision.

**First-pass:** **RESOLVES** the Pass-1 matrix NEEDS-REVIEW *"Server-authoritative continuous timer (D02B-035/D04A-001/010)"* → **CONFORMANT**.

---

## CC2-E — Module-2 adaptive path disclosure → **FINDING CC2-004 (MEDIUM)**

**Verdict (app layer):** FINDING. The routed adaptive bucket reaches the student:
- **Review phase:** `getExamReview` builds `formattedModules` with `difficultyBucket: m.difficulty_bucket` (`fullLengthExam.ts:3539-3547`), and the client **renders** it: `FullLengthReviewView.tsx:125` → `<Badge>Adaptive: {module.difficultyBucket}</Badge>` (e.g. "Adaptive: hard").
- **During exam:** `submitModule` returns `nextModule.difficultyBucket` to the client (`fullLengthExam.ts:2808-2814`; passed through `full-length-exam-routes.ts:543-548`). The client type carries it (`ExamRunner.tsx:98`) but does not currently render it.
- Active question-serve / session-state payloads correctly omit it (`getCurrentSession` uses `projectStudentSafeQuestion`, comment cites *"Doc 04A §10.2: difficulty must not appear in the active-section payload"*, `:2241`). `module1_correct_count`, `module_2_variant`, and `full_length_adaptive_config` thresholds are not serialized.

**Spec basis:** Doc 02B INV-02B-14 / D02B-041 (module_2_variant is server-only, MUST NOT appear in any API response); Doc 04A §3.4 / D04A-021 (module2_path not in student/guardian responses; admin/audit only); Doc 04C §2.2 / D04C-002 (forbids "easy/hard module" framing in any student-facing report — explicitly **including** post-completion). Per-question `difficulty` reveal post-unlock is permitted (D04C §2.6), but the **module-level adaptive-path badge** is the routed variant and is not.

**Verdict (DB/PostgREST layer):** latent-SAFE. Students hold RLS SELECT on their own `full_length_exam_modules` rows (capture C1 `flx_modules_select`/`modules_select_own`), so `difficulty_bucket` is PostgREST-readable in principle — but the browser holds **no** Supabase client (only `SupabaseProfile` type is imported in `client/src`; all access via `csrfFetch` to the server API). So the DB-layer exposure is not reachable from the app as built.

**First-pass:** **RESOLVES** the Pass-1 NEEDS-REVIEW *"Module-2 path internal-only (D02B-041/D04A-021)"* → **FINDING** (disclosed in the review UI and the submit response); DB-layer reclassified latent-SAFE (no client PostgREST path).

---

## CC2-F — Difficulty domain integrity → **FINDING CC2-005 (MEDIUM)**

**Verdict:** FINDING (at-rest constraint missing); jsonb path conformant at the function boundary.

- **No at-rest CHECK.** `questions.difficulty` is a bare `integer`, **nullable** (`YES`) (capture A2 `:593`). No CHECK constraint references `questions.difficulty` anywhere (A3 search returns only `tutor_instruction_exposures_rendered_difficulty_check` for 1–5). Spec Doc 02A INV-02A-05 / D02A-003 require *"the DB constraint must be `check (difficulty between 1 and 3)`."* The 1–3 domain is enforced only at **write time** by `normalize_difficulty_bucket` (B2 `:6466` — raises outside 1/2/3), and only on the mastery-event path — not on direct `questions` inserts, and nullability is unconstrained.
- **jsonb reconciliation — conformant.** `review_session_items` carries both `question_difficulty` (jsonb, A2 col 21) and `question_difficulty_bucket` (integer, col 31). `normalize_difficulty_bucket_from_jsonb` (B2 `:6483`) parses the jsonb to an int and delegates to `normalize_difficulty_bucket` (→ 1–3). The integer **bucket** is the normalized value feeding mastery; the jsonb is a denormalized snapshot. The jsonb→bucket path is spec-conformant (normalized to 1–3 before mastery); the dual columns are a denormalization smell, not a correctness defect.

**First-pass:** **RESOLVES** Pass-1 NEEDS-REVIEW *"Difficulty 1–3 only; `check (difficulty between 1 and 3)`"* → **DRIFT** (no at-rest CHECK; write-time-only guard on one path; column nullable).

---

## CC2-G — Question lifecycle / never-delete → **FINDING CC2-006 (MEDIUM)**

**Verdict:** FINDING (no retirement mechanism; history-erasing cascade topology) — code paths conformant.

- **Code:** no application path deletes `questions` (grep across `server/`, `apps/`, `scripts/`, `supabase/migrations/` for delete-from-questions → none). Conformant.
- **Retirement mechanism MISSING.** Spec Doc 02A INV-02A-12 / D02A-008 require items be **retired in place** via `active_status = 'retired'` (never deleted). The live `questions` table has no `active_status`/`status`/`is_active`/`retired` column (A2 `:587-607`); no migration adds one; no code sets it. (`question_versions.lifecycle_status` is a versioning column, not question retirement.) So retirement cannot be expressed — the never-delete invariant has **no enforcement mechanism**.
- **Cascade topology (capture FK):** FKs to `questions(id)` with `ON DELETE CASCADE`: `answer_attempts`, `attempts`, `full_length_exam_questions`, `full_length_exam_responses`, `practice_events`, `progress` — a question delete would **erase historical attempt data**. `practice_session_items` and `question_versions` are `RESTRICT`; tutor links `SET NULL`. RLS exposes only SELECT on `questions` (C1), so PostgREST delete is blocked for `anon`/`authenticated`, but `service_role`/admin could delete and trigger the cascade.

**First-pass:** **RESOLVES** Pass-1 NEEDS-REVIEW *"Items never deleted; `active_status=retired`"* → **FINDING** (mechanism absent; cascade FKs would destroy history if a delete occurred).

---

## CC2-H — SM-2 / review scheduling → **FINDING CC2-007 (MEDIUM)**

**Verdict:** MISSING (with spec-acknowledged launch-simplification caveat). No SM-2 algorithm, no `review_schedule` table, no `review_runtime_config`. Grep of all migrations for `sm2|ease_factor|interval_days|repetition_count|next_review_at|review_schedule` → zero. Deployed review is a **flat "unresolved mistakes" queue**: `server/services/review-queue.ts` selects incorrect past answers minus those since answered correctly in `review_error_attempts`; `server/routes/review-session-routes.ts` `submitReviewSessionAnswer` marks items answered + emits a mastery event, with no interval/ease/graduation/`next_review_at` update. `20260314_review_session_lifecycle.sql` creates `review_sessions/items/events` with a `queued/served/answered/skipped` status only.

**Spec basis:** Doc 02B §16 (SM-2 params: initial ease 2.5, intervals 1d/6d, ease min 1.3, graduation 1 launch/5 target; `review_schedule` table "target state"; Launch Scope Matrix: "Full SM-2 interval growth → No" but "One-success graduation (simplified) → Yes" and "`review_schedule` table → Yes if feasible"). Even the simplified launch target (one-success graduation + `review_schedule`) is absent; parameters would be code/DB literals but none exist (`review_runtime_config` absent — confirms CC-P1-001).

**First-pass:** **RESOLVES** Pass-1 NEEDS-REVIEW *"SM-2 scheduling (D02B-031)"* → **MISSING** (with launch-scope caveat).

---

## CC2-I — Domain-mastery aggregation shape → **recorded under both CC-P2-016 readings (CC2-008)**

**Verdict:** The deployed `refresh_domain_mastery_for_student_domain` (B2 `:6681`) computes domain mastery as the **attempts-weighted average of skill `mastery_score`**: `sum(ssm.mastery_score * ssm.attempts) / nullif(sum(ssm.attempts),0)` over `student_skill_mastery` rows for the domain (`:6728`), with `mastery_pct = round(that * 100, 2)` and `map_mastery_level(...)`.

- **Reading A (Doc 05 controls):** **DRIFT.** Doc 05B §2.1 / Doc 05 Parent §4.7 (D05P-025) require domain mastery be computed **independently from the event stream**, explicitly *"NOT a weighted average of skill mastery values."* The deployed roll-up is the forbidden shape.
- **Reading B (Doc 02C V4 controls):** **CONFORMANT.** Doc 02C V4 §21 (D02C-005) defines `domain_mastery = SUM(skill_mastery × skill_attempts) / SUM(skill_attempts)` — exactly the deployed computation.

This corroborates that the deployed mastery engine follows the **Doc 02C V4 lineage** end-to-end (consistent with CC-P2-003 formula and CC2-A scoring both ignoring the Doc 05 family). Registry-ready for either owner ruling on **CC-P2-016**.

---

## CC2-J — Constants row values → **UNVERIFIABLE-PENDING-DATA**

`docs/SpecAudit/00-supabase-live-state-constants.md` does not exist (pre-flight `ls` failed), and the CSV capture contains schema + function bodies but **no row dump** of `mastery_constants` / `kpi_constants` / `full_length_adaptive_config` / `test_forms.blueprint`. Per the pre-flight rule, every numeric row-value comparison under both CC-P2-016 readings is UNVERIFIABLE-PENDING-DATA. *(Note: constants embedded in function bodies — e.g. quota `v_limit` values, mastery `get_base_delta`/`get_difficulty_multiplier`, difficulty buckets — were verifiable and are covered in CC2-B/CC2-A/CC2-F; only the configuration-table row values are blocked.)*

---

## Delta table

### New CC2 findings
| ID | Item | Severity | Tag | One-line |
|---|---|---|---|---|
| CC2-001 | CC2-A | CRITICAL | DRIFT | Full-length scoring is a linear TS lookup table; uses none of Doc 04B's closed-form formula/constants; runs in app code |
| CC2-002 | CC2-B | HIGH | DRIFT | Practice quota 40/calendar-day → deployed 20/rolling-24h; tutor density window mismatched; budgets unanchored |
| CC2-003 | CC2-C | HIGH | DRIFT/MISSING | `deidentify_user` leaves tutor conversation store + `student_domain_mastery`/`section_projections`/`kpi_rollups_current` + rate-limit/audit logs uncleaned (cascades don't fire) |
| CC2-004 | CC2-E | MEDIUM | DRIFT | Module-2 adaptive bucket disclosed in review UI + `submitModule` response (student-facing) |
| CC2-005 | CC2-F | MEDIUM | DRIFT | No at-rest `check (difficulty between 1 and 3)`; `questions.difficulty` bare nullable integer |
| CC2-006 | CC2-G | MEDIUM | MISSING | No `active_status` retirement mechanism; 6 CASCADE FKs to `questions` would erase history |
| CC2-007 | CC2-H | MEDIUM | MISSING | SM-2 / `review_schedule` / `review_runtime_config` entirely absent; review is a flat unresolved-mistakes queue |
| CC2-008 | CC2-I | — | AMBIGUITY | Domain mastery = attempts-weighted avg of skill mastery → CONFORMANT (Doc 02C) / DRIFT (Doc 05); informs CC-P2-016 |

### Verified-conformant
| Item | Result |
|---|---|
| CC2-D | Exam timer is server-authoritative (`ends_at`/`started_at`/`submitted_late` from server clock; no client time trusted) |
| CC2-F (jsonb sub-item) | `normalize_difficulty_bucket_from_jsonb` normalizes the review jsonb difficulty to 1–3 before mastery |

### First-pass classifications corrected/resolved
| First-pass entry | Was | Now | By |
|---|---|---|---|
| Pass-1 matrix "Free daily practice quota 40 → IMPLEMENTED" | IMPLEMENTED | **DRIFT** (40 spec vs 20 deployed) | CC2-002 |
| Pass-1 matrix "Server-authoritative continuous timer" | NEEDS-REVIEW | **CONFORMANT** | CC2-D |
| Pass-1 matrix "Module-2 path internal-only" | NEEDS-REVIEW | **FINDING** (disclosed in review) | CC2-004 |
| Pass-1 matrix "Difficulty 1–3 CHECK" | NEEDS-REVIEW | **DRIFT** (no at-rest CHECK) | CC2-005 |
| Pass-1 matrix "Items never deleted / active_status=retired" | NEEDS-REVIEW | **FINDING** (no mechanism) | CC2-006 |
| Pass-1 matrix "SM-2 scheduling" | NEEDS-REVIEW | **MISSING** | CC2-007 |
| CC-P1-009 / CC-P1-003 (scoring in TS) | stated location only | **sharpened**: lookup table, not the spec formula | CC2-001 |
| CC-P1-007 / CC-P3-006 / CC-P1-008 (deletion/retention) | endpoint/cron gaps | **extended**: table-level deletion misses incl. tutor store | CC2-003 |
| CC-P2-016 (mastery formula conflict) | spec-internal conflict | **+ domain-mastery datapoint** (deployed = Doc 02C shape) | CC2-008 |

### UNVERIFIABLE
| Item | Reason |
|---|---|
| CC2-J | `00-supabase-live-state-constants.md` absent; no config-table row dump in the capture |
| CC2-B sub-items (full-length 2/7d, calendar 3/7d, tutor token/cost budgets, cooldowns, reservation TTL) | No locked spec value to compare against (Doc 02B Appendix A marks tutor limits "product decision — pending") |

**CC2 totals:** 7 new defect findings (1 CRITICAL, 2 HIGH, 4 MEDIUM) + 1 AMBIGUITY datapoint; 2 verified-conformant; 6 first-pass classifications corrected/resolved; 2 UNVERIFIABLE buckets.
