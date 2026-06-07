# Pass 2 — Correctness

**Audit:** Claude state-assessment (read-only)
**HEAD audited:** `be91469fb7e9cd3847d5fa54cc31b4bb46dc97ac` (`2026-06-06 22:37:46 -0500`, Merge #339)
**Live-state ground truth:** `docs/SpecAudit/00-supabase-live-state.csv` (generated `2026-06-07 03:03:35+00`, Postgres 17.6)
**Scope of this pass:** For everything that exists (IMPLEMENTED or PARTIAL), does it match what the spec says? Formulas, constants, anti-leak behavior, auth/entitlement derivation, idempotency, guardian visibility, determinism. Where the live DB and the repo disagree, that disagreement is itself a finding.

> Evidence discipline: repo claims carry `file:line`; DB claims carry the capture section (A1/A2/A7/B1/C1/D1…) + object name. Severity scheme is provisional (not locked). The deployed schema records **zero** applied migrations (capture H1), so repo migration SQL is an audit subject, never evidence of deployed reality.

---

## CC-P2-001 — `questions` answer key is readable by `anon` at the database trust boundary (anti-leak)

- **Severity:** CRITICAL
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §5.2 — *"Any endpoint serving questions before submission **must** return `correct_answer: null, explanation: null` … Any deviation is a leak."*; §17 hard stops; CLAUDE.md anti-leak invariant.
- **Evidence (DB):**
  - Policy C1: `questions :: questions_select_accessible :: PERMISSIVE :: roles={anon,authenticated} :: cmd=SELECT :: USING: true` (and `questions_select_authenticated :: USING: true`).
  - Columns A2: `questions` col 14 `explanation text`, col 48 `correct_answer text` (NOT NULL). A1: `questions` has 280 rows.
  - Grant A7: `questions | anon | SELECT`.
- **Evidence (repo, mitigant context):** The server serializers are anti-leak-safe — `projectStudentSafeQuestion` hardcodes `correct_answer: null, explanation: null` (`shared/question-bank-contract.ts:191-227`), used by every pre-submit path (`server/routes/practice-canonical.ts:440-471`, `server/routes/full-length-exam-routes.ts`, `server/routes/review-session-routes.ts:383-384`). No client-side anon read of `questions` exists in `client/src`.
- **Statement:** The anti-leak invariant is enforced in application serialization but **not at the database trust boundary**: any holder of the public `anon` key can `SELECT correct_answer, explanation FROM questions` for all 280 rows directly via PostgREST, bypassing the API. The spec's "must never reveal" is a property of the data boundary, not only the happy-path endpoint.

---

## CC-P2-002 — Nine RLS-disabled tables carry full `anon`/`authenticated` write grants

- **Severity:** CRITICAL
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §4.3 / §6.1 server-authoritative ("never trust client claims … validate server-side only"); §17 hard stops (no client-trusted writes); for `constants_audit_log` specifically, Doc 05D INV-05D-08 (mastery audit logs are append-only — no UPDATE/DELETE for any role except the deletion cascade).
- **Evidence (DB):** A1 `rls_enabled=false` for: `constants_audit_log`, `documents`, `embeddings`, `question_classification_updates`, `question_embeddings`, `sat_math_topics_ref`, `sat_rw_skills_ref`, `sat_sections_ref`, `test_forms` (9 tables). A7 shows each of these granted `INSERT`, `UPDATE`, **and** `DELETE` to both `anon` and `authenticated`. Neither `anon` nor `authenticated` has `bypasses_rls` (I2), so with RLS off the grants govern directly.
- **Statement:** With RLS disabled, the table grants are the only access control. Any holder of the `anon` key can insert/update/delete rows in the exam form bank (`test_forms`), the constants audit trail (`constants_audit_log`, append-only per spec), the SAT taxonomy reference tables, and the embeddings/documents tables. *(The audit brief's "seven" undercounts; the capture shows nine.)*

---

## CC-P2-003 — Mastery engine runs a non-V1.0 formula family; the V1.0 canonical RPC and its objects are absent

- **Severity:** CRITICAL
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/Doc 05A — Mastery Formula & Skill Mastery.md` §4.1 (canonical RPC named **`apply_mastery_event`**) and §13 — *"Legacy `apply_learning_event_to_mastery` and `upsert_skill_mastery` RPCs (EMA / Bayesian shapes) are explicitly NOT V1.0 contracts."* `docs/Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md` §4.1 (macro-average formula) and §10.1 constants: `POSITION_HALF_LIFE=30`, source weights `test=0.50/practice=0.30/review=0.20`, difficulty weights `0.79/1.0/1.20`, `MIN_EVENTS_FOR_MASTERY=5`, mastery NULL below threshold. (Doc 05 Parent, locked 2026-05-13, is the later/controlling document over Doc 02C V4, 2026-04-22 — see CC-P2-016.)
- **Evidence (DB):** `apply_mastery_event` = **0 occurrences** in the capture. The spec-canonical objects `mastery_events`, `student_skill_weekly_snapshot`, `mastery_event_audit_log` are **absent** from A1/B1. The functions actually present (B1) are `apply_learning_event_to_mastery` (delta/alpha via `get_base_delta`/`get_difficulty_multiplier`) and `upsert_skill_mastery`/`upsert_cluster_mastery` ("True Half-Life … Beta priors").
- **Evidence (repo):** Runtime calls the legacy RPC: `apps/api/src/services/mastery-write.ts:74` → `.rpc("apply_learning_event_to_mastery", …)`, invoked from practice (`server/routes/practice-canonical.ts:2467`), review (`server/routes/review-session-routes.ts:864`), and full-length (`apps/api/src/services/fullLengthExam.ts:1850`).
- **Statement:** The deployed mastery engine implements a formula family that Doc 05A explicitly disqualifies as a V1.0 contract; the V1.0-canonical `apply_mastery_event` (macro-average, position-half-life, NULL-below-5) and its event/snapshot tables do not exist. The product's core "earned-from-observed-events" mastery math does not match the controlling spec.

---

## CC-P2-004 — The live mastery write RPC has no SQL definition anywhere in the repository

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** CLAUDE.md "Verify before you say done" / Doc 05D constants-governance & versioning (`mastery_model_version`, `constants_snapshot_hash` written at compute time) — all presuppose the canonical writer is defined and reproducible. Capture H1: *"0 applied migrations recorded."*
- **Evidence:** `apps/api/src/services/mastery-write.ts:74` calls `apply_learning_event_to_mastery`, but no `CREATE FUNCTION public.apply_learning_event_to_mastery` exists in any `supabase/migrations/*.sql` (confirmed independently by two trace passes). The function exists only in the live DB (B1). By contrast `upsert_skill_mastery` *is* defined across `supabase/migrations/20251222_…`, `20260210_mastery_v1.sql`, `20260211_*` — but is dead runtime code (zero TS callers).
- **Statement:** The sole runtime mastery writer is an unversioned live-DB object; the canonical write path cannot be reproduced or reviewed from the migration history. Combined with H1 (zero recorded migrations), the deployed mastery schema is not traceable to repo source.

---

## CC-P2-005 — Two mastery formula families both write `student_skill_mastery`; neither matches Doc 05

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** Doc 05 Parent §4.1 (single macro-average formula); Doc 05A §13 (both legacy families are not V1.0 contracts and are to be retired).
- **Evidence (DB, B1):** `apply_learning_event_to_mastery` (delta/alpha) and `upsert_skill_mastery`/`upsert_cluster_mastery` (comment: *"True Half-Life formula: exponential decay of evidence (E,C) with Beta priors"*) both target `student_skill_mastery`/`student_cluster_mastery`. The migration lineage shows the `upsert_*` shape evolving raw-accuracy → EMA (`20260210_mastery_v1.sql`) → Bayesian half-life (`20260211_mastery_true_halflife_weights_rounding.sql`). None is the Doc 05 macro-average / position-weighted shape.
- **Statement:** Two differently-shaped mastery writers remain installed against the same canonical table, and both diverge from the Doc 05 formula. (Writer-coexistence governance is covered in CC-P3-008; this finding is the formula-correctness defect.)

---

## CC-P2-006 — App-layer mastery constants diverge from the DB constants table and from spec

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** Doc 05 Parent §9.3 / Doc 05D INV-05D-04 — *"All Doc 05 family code MUST read constants from the `mastery_constants` table by canonical name. Literal constant values in code are forbidden."*; Doc 05 §10.1 constant values.
- **Evidence (repo):** `apps/api/src/services/mastery-constants.ts` hardcodes `HALF_LIFE_WEEKS = 6.0` (42 days), `ALPHA = 0.20`, `BASE_DELTA = 10.0`, `M_INIT = 50.0`.
- **Evidence (DB):** `mastery_constants` table (A1, 14 rows; comment *"True Half-Life formula"*) carries `HALF_LIFE_DAYS = 21` per `supabase/migrations/20260211_mastery_constants.sql`. The app's `ALPHA/BASE_DELTA/M_INIT` match only the dead EMA-v1 migration shape, not the live function and not Doc 05 (`0.79/1.0/1.20`, `0.50/0.30/0.20`).
- **Statement:** App code carries literal mastery constants (forbidden by §9.3) that disagree with the DB table by 2× on half-life (42 d vs 21 d) and reflect a superseded formula shape. *(Mitigant: the file comments mark these as projection/display-only; they are not on a DB write path — but the literal-constants prohibition is unconditional.)*

---

## CC-P2-007 — `is_guardian_of` omits the entitlement-active condition of the guardian invariant

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/lyceon-coding-standards.md` §6.2 — *"Guardian visibility is derived **only if both** conditions are true: 1. Guardian link is active 2. Student entitlement is active."*; CLAUDE.md guardian model.
- **Evidence (DB, B1 line 6165):**
  ```sql
  CREATE OR REPLACE FUNCTION public.is_guardian_of(p_student_id uuid) … AS $function$
    select exists (select 1 from public.profiles s
      where s.id = p_student_id
        and s.role = 'student'::public.profile_role
        and s.guardian_profile_id = auth.uid());
  $function$
  ```
  The predicate checks role + linkage only — **no entitlement check, no link-active/status check.** It is the `USING` clause for guardian SELECT on the live tables `practice_sessions`, `student_skill_mastery`, `student_domain_mastery`, `student_section_projections`, `student_study_plan_days`, `student_study_profile`, `student_question_attempts`, `student_cluster_mastery`, `progress` (C1).
- **Statement:** Guardian RLS visibility is granted on link alone; a guardian of a student whose entitlement has lapsed still reads all linked learning state, violating the two-condition derivation. *(Reconciliation note: Doc 01 V6 §17 line 879 mandates "maintain guardian visibility during grace," and §13 scopes entitlement to the student profile; this is a candidate tension between coding-standards §6.2 and Doc 01 V6 — recorded secondarily as AMBIGUITY. The §6.2 rule as written is not met regardless.)*

---

## CC-P2-008 — Guardian RLS exposes per-attempt/per-skill rows and the internal `mastery_score`, contradicting aggregate-only visibility

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust (V6).md` §16 — *"Guardians see **aggregate data only** … What guardians cannot see: Individual question content; Student's specific answers; Raw mastery deltas or per-question performance"* (INV-02-06). Doc 05 Parent §18 acceptance #20 — *"Student-role and guardian-role API routes MUST NOT return `mastery_score` … or `mastery_pct`; … see only `mastery_level`."*
- **Evidence (DB, C1):** `is_guardian_of`-gated guardian SELECT exists on `student_skill_mastery` (internal per-skill row incl. the `mastery_score` column; A1 23 rows), `student_question_attempts`, `answer_attempts`, `attempts`, `competency_events`, `progress` — all per-attempt or internal-skill granularity, not aggregate.
- **Statement:** RLS grants guardians row-level read of per-attempt tables and the internal skill-mastery row (including `mastery_score`), contradicting the aggregate-only invariant and the mastery-score non-exposure rule. *(Mitigant: `answer_attempts`/`attempts`/`competency_events`/`student_question_attempts`/`progress` are currently empty — A1 = 0 rows — so the live exposure today is via `student_skill_mastery`; the policy posture itself is the drift.)*

---

## CC-P2-009 — Two parallel guardian-derivation mechanisms in RLS; the non-canonical one dominates

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** Doc 01 V6 §16 — guardian dashboard *"derived from … `guardian_links`, `profiles`, `student_domain_mastery`, `full_length_exam_score_rollups`"*; the canonical link table is `guardian_links` (migration `supabase/migrations/20260309_guardian_links_canonical.sql`).
- **Evidence (DB):** `is_guardian_of` derives from `profiles.guardian_profile_id` (B1 6165) and gates the majority of guardian policies (C1); but `user_competencies_guardian_read` derives via a direct `guardian_links gl` join (C1). Two different sources of guardian truth coexist (`profiles.guardian_profile_id` vs `guardian_links`), with A1 showing `guardian_links` = 4 rows.
- **Statement:** Guardian visibility is derived two different ways across RLS policies, and the dominant mechanism keys off `profiles.guardian_profile_id` rather than the canonical `guardian_links` table the spec names, risking divergence between the two link records.

---

## CC-P2-010 — `accounts`/`account_members` vs `lyceon_accounts`/`lyceon_account_members` split-brain (writer/reader on different tables)

- **Severity:** HIGH
- **Tag:** DRIFT
- **Spec basis:** Doc 01 V6 (single canonical account/entitlement model); CLAUDE.md "one coherent codebase … never fork a second version."
- **Evidence (DB):** A1 row counts diverge — `accounts` 13 / `account_members` 13 vs `lyceon_accounts` 19 / `lyceon_account_members` 19. Both families carry the entitlement-relevant `entitlements` RLS via *both* `account_members` (`read_entitlements_for_member_accounts`) and `lyceon_account_members` (`entitlements_select_for_member_accounts`) (C1).
- **Evidence (repo):** The RPC `ensure_account_for_user` writes `lyceon_accounts`/`lyceon_account_members` (`supabase/migrations/20260108_sprint21_hardening.sql:57`), called widely (`server/lib/account.ts:141` from billing/middleware). TS read paths use the plain names: `server/lib/account.ts:165` `.from('account_members')`, `:183` `.from('account_members').select('…, accounts(created_at)')`. A CI contract test forbids `.from('lyceon_accounts')` in runtime TS.
- **Statement:** Writes land in the `lyceon_*` family while runtime reads target the `accounts`/`account_members` family; the row-count divergence (19 vs 13) indicates the two are not the same rows. Account/membership resolution is split across two parallel table families with no single source of truth.

---

## CC-P2-011 — Full-length review unlock gates on `session.status`, not the spec-required scoring row

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** `docs/Spec/Doc 04C — Score Reports, Review Unlock & Student_Guardian Exam Surfaces.md` §2.5/§2.7 (review reveal gated on a completed `score_runs`/scoring row, not status alone). Acknowledged in `docs/alignment/KNOWN-GAPS.md`.
- **Evidence (repo):** `apps/api/src/services/fullLengthExam.ts:3465` reveals answers when `session.status === "completed"` (`projectFullQuestionFields`) vs `projectSafeQuestionFields` otherwise. The gate is status-based; no `score_runs` row is consulted.
- **Statement:** Post-exam answer reveal is gated on a status enum rather than the canonical scoring-completion record the spec requires. Currently safe because scoring is synchronous, but not spec-conformant and fragile if scoring becomes asynchronous.

---

## CC-P2-012 — Tutor anti-leak secondary filter covers only the practice surface, not review; replay is unfiltered

- **Severity:** MEDIUM
- **Tag:** DRIFT
- **Spec basis:** Doc 03 §17 / Doc 03A §1.4 (INV-03-04) — *"LISA MUST NOT reveal correct answers … pre-submit, regardless of student framing."* Applies to all pre-submit surfaces.
- **Evidence (repo):** Field-level safety holds — no `correct_answer`/`explanation` is passed to the LLM (`server/routes/tutor-runtime.ts:1294-1353`; worker schema has no such fields). But the post-generation `hasDirectAnswerLeak` regex guard runs only when `source_surface === "practice"` (`server/routes/tutor-runtime.ts:1365-1378`); the `review` pre-submit surface is not filtered. `GET /api/tutor/conversations/:id` (`:910-921`) replays stored verbatim message text with no leak filter.
- **Statement:** The defense-in-depth leak filter for tutor-generated natural language is scoped to practice only, leaving review pre-submit unguarded, and conversation replay applies no filter. (No confirmed field leak; this is a coverage gap in the secondary guard.)

---

## CC-P2-013 — RAG v2 student sanitizer is denylist key-deletion, not allowlist projection

- **Severity:** LOW
- **Tag:** DRIFT
- **Spec basis:** §5.2 anti-leak (answers must be structurally absent pre-submit, not stripped after assembly).
- **Evidence (repo):** `apps/api/src/routes/rag-v2.ts:16-61` builds the response from RAG output (which reads `correct_answer`/`explanation` internally — `apps/api/src/lib/rag-service.ts:604-605,937-950`) then deletes a fixed `sensitiveKeys` list. A newly added answer-bearing field outside that list would pass through.
- **Statement:** The RAG student path nulls answers by post-hoc key deletion rather than the canonical allowlist `projectStudentSafeQuestion`; structurally weaker than every other surface and reliant on an exhaustive denylist.

---

## CC-P2-014 — Idempotency and Stripe dedup are conformant (verified-correct)

- **Severity:** LOW (informational / positive)
- **Tag:** AMBIGUITY → recorded as conformant
- **Spec basis:** §4.2 (mutations idempotent via `idempotency_key`; Stripe webhooks deduped via event ledger).
- **Evidence (repo):** Practice/review submit handle idempotent replay (status-guarded replay paths `server/routes/practice-canonical.ts:2298-2431`; review submit gated on `item.status==='served'`). Stripe dedup ledger present: `stripe_webhook_events` (A1) written by `server/lib/webhookHandlers.ts`, created in `supabase/migrations/20260108_sprint21_hardening.sql`.
- **Statement:** No defect. Recorded so the matrix distinguishes "verified conformant" from "unverified." *(Caveat: `stripe_webhook_events` has no purge policy — see Pass 1.)*

---

## CC-P2-015 — `student_skill_mastery` write-lockdown is correctly enforced (verified-correct)

- **Severity:** LOW (informational / positive)
- **Tag:** recorded as conformant
- **Spec basis:** Doc 05 Parent §2.4/§6.1 — Doc 05-owned tables writable only by `service_role`; RLS denies write to `authenticated`/`anon`.
- **Evidence (DB, C1):** `student_skill_mastery :: skill_mastery_no_direct_write :: roles={authenticated} :: cmd=ALL :: USING false / WITH CHECK false`; only `*_self_select`, `*_admin_select`, `*_guardian_select` SELECT policies otherwise. `student_domain_mastery` mirrors this (`*_service_all`).
- **Statement:** The "repo must not own mastery math / no direct writes" lockdown is correctly implemented at the RLS layer. (Orthogonal to CC-P2-008, which concerns guardian *read* over-exposure.)

---

## CC-P2-016 — Spec-internal contradiction: Doc 02C V4 vs Doc 05 family define different mastery + domain formulas

- **Severity:** HIGH
- **Tag:** AMBIGUITY
- **Spec basis:** `docs/Spec/Doc 02C — Mastery, KPI & Database Canonical Contract.md` §16/§21 (pooled weighted-fraction; domain mastery = attempts-weighted average of skill mastery; 1–5 difficulty; RPC `apply_learning_event_to_mastery`) **vs** `docs/Spec/Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent).md` §4.1/§4.7 + Doc 05A §4.1 (macro-average position-weighted; domain mastery = independent event aggregation; 1–3 buckets; RPC `apply_mastery_event`).
- **Evidence:** Both documents are in `docs/Spec/`. Doc 05 Parent locked 2026-05-13 supersedes PDF-05/PDF-09; Doc 02C V4 dated 2026-04-22. Doc 05A §13 explicitly retires the Doc 02C RPC names. Reading A: Doc 05 (later) controls. Reading B: Doc 02C V4 is still labelled "Canonical Contract" and not explicitly superseded by Doc 05.
- **Statement:** Two canonical docs define incompatible mastery and domain-mastery formulas, constant sets, difficulty scales, and RPC names. Per HALT discipline both readings are recorded; the audit's correctness findings (CC-P2-003/005/006) are written against Reading A (Doc 05 controls) because it is later-dated and explicitly retires the Doc 02C contract. This conflict must be resolved by the spec owner.

---

### Pass 2 summary

| ID | Severity | Tag | One-line |
|---|---|---|---|
| CC-P2-001 | CRITICAL | DRIFT | `anon` can `SELECT correct_answer/explanation FROM questions` (USING true) |
| CC-P2-002 | CRITICAL | DRIFT | 9 RLS-off tables with `anon`/`authenticated` INSERT/UPDATE/DELETE |
| CC-P2-003 | CRITICAL | DRIFT | Live mastery formula is non-V1.0; `apply_mastery_event` + event/snapshot tables absent |
| CC-P2-004 | HIGH | DRIFT | Runtime mastery RPC has no SQL definition in repo (unversioned live object) |
| CC-P2-005 | HIGH | DRIFT | Two mastery formula families write `student_skill_mastery`; neither matches Doc 05 |
| CC-P2-006 | MEDIUM | DRIFT | App mastery constants diverge from DB (42d vs 21d) and from spec; literal constants forbidden |
| CC-P2-007 | HIGH | DRIFT | `is_guardian_of` omits entitlement-active condition |
| CC-P2-008 | HIGH | DRIFT | Guardian RLS exposes per-attempt rows + internal `mastery_score` (aggregate-only violated) |
| CC-P2-009 | MEDIUM | DRIFT | Two guardian-derivation mechanisms; non-canonical `profiles.guardian_profile_id` dominates |
| CC-P2-010 | HIGH | DRIFT | `accounts`/`account_members` vs `lyceon_accounts`/`lyceon_account_members` split-brain |
| CC-P2-011 | MEDIUM | DRIFT | Full-length review unlock gates on status, not `score_runs` row |
| CC-P2-012 | MEDIUM | DRIFT | Tutor leak filter covers practice only, not review; replay unfiltered |
| CC-P2-013 | LOW | DRIFT | RAG v2 sanitizer is denylist deletion, not allowlist projection |
| CC-P2-014 | LOW | (conformant) | Idempotency + Stripe dedup verified correct |
| CC-P2-015 | LOW | (conformant) | `student_skill_mastery` write-lockdown correctly enforced |
| CC-P2-016 | HIGH | AMBIGUITY | Doc 02C V4 vs Doc 05 define incompatible mastery/domain formulas |
