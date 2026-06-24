# Pre-Implementation Verification Gate — Doc 05D

> Mirrors 05B §11 / 05C §11. Every item verified against **live prod** (`hncolwkccbbjkfithhlo`) via Supabase MCP `execute_sql` on 2026-06-24.
> Implements §11.1 items A–N. Each item: **PASS** (no action), **RECONCILED** (deviation resolved by owner ruling), or **OPEN-GATE** (blocks until resolved in build).

---

## A. 05D-Owned Objects Do Not Pre-Exist

**Verdict: PASS**

All 7 05D-owned objects confirmed absent from prod:

| Object | Type | Exists? |
|--------|------|---------|
| `mastery_constants_change_log` | table | NO |
| `capture_mastery_constant_change` | function | NO |
| `trg_capture_mastery_constant_change` | trigger on `mastery_constants` | NO |
| `constant_affects_formula_hash` | function | NO |
| `canonicalize_active_mastery_constants_state` | function | NO |
| `backfill_recompute_student` | function | NO |
| `canonical_mastery_events_for_student` | function | NO |
| `cascade_account_deletion` | function | NO |

**pgcrypto extension:** PRESENT in `extensions` schema.
```
extname=pgcrypto, schema=extensions
```
All existing code correctly qualifies calls as `extensions.digest(...)`. 05D trigger/serializer must follow the same pattern.

No column-by-column reconciliation needed — greenfield for all 05D objects.

---

## B. Sibling RPCs (Read-Only Dependencies)

**Verdict: PASS (with naming reconciliation)**

| RPC | Exists? | Signature |
|-----|---------|-----------|
| `compute_mastery_for_entity` | YES | `(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text DEFAULT NULL)` |
| `recompute_skill_mastery` | YES | `(p_student_id uuid, p_section text, p_domain text, p_skill text)` |
| `refresh_domain_mastery` | YES | `(p_student_id uuid, p_section text, p_domain text)` |
| `apply_mastery_event` | YES | `(p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamptz, p_event_id uuid, p_question_id text, p_section_state text DEFAULT NULL)` |
| `canonical_mastery_events` | YES | `(p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text)` — per-entity, NOT per-student |
| `canonicalize_mastery_constants` | YES | `()` — returns JSONB with 23 formula keys |
| `canonicalize_mastery_constants_serialized` | YES | `()` — returns TEXT, 23-line deterministic serialization |
| `compute_section_projection` | YES | `(p_student_id uuid, p_section text, p_t_now timestamptz DEFAULT now())` |
| `bump_projection_refresh_counter` | YES | `(p_student_id uuid, p_section text)` |
| `refresh_student_kpi_rollups` | **NO** | Not a single function — individual refreshers exist (see below) |

**KPI refreshers (called by `refresh_domain_mastery` §4.9):**
- `refresh_skill_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamptz DEFAULT now())` — YES
- `refresh_domain_kpi(p_student_id uuid, p_section text, p_domain text, p_t_now timestamptz DEFAULT now())` — YES
- `refresh_section_kpi(p_student_id uuid, p_section text, p_t_now timestamptz DEFAULT now())` — YES
- `refresh_overall_kpi(p_student_id uuid, p_t_now timestamptz DEFAULT now())` — YES
- `read_kpi_recency_constants(OUT short_days integer, OUT long_days integer)` — YES

**Naming reconciliation:** 05D §11.B references `refresh_section_kpi` / `refresh_overall_kpi` — both exist. The spec also references a `canonical_mastery_events_for_student` per-student accessor. The live `canonical_mastery_events` is per-entity (requires entity_type/section/domain/skill). The per-student accessor (`canonical_mastery_events_for_student`) must be built as a new additive function for backfill (R3 ruling). It wraps the per-entity accessor, iterating over all (section, domain, skill) tuples for a student.

---

## C. Two-Table Contract Verification (§4.0)

**Verdict: PASS**

### mastery_event_audit_log — 20 columns

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `audit_row_id` | uuid | NO | `gen_random_uuid()` | PK |
| `student_id` | uuid | NO | | |
| `section` | text | NO | | CHECK `IN ('M','RW')` |
| `domain` | text | NO | | |
| `skill` | text | NO | | |
| `source_family` | text | NO | | CHECK `IN ('test','practice','review')` |
| `event_source_kind` | text | NO | | CHECK `IN ('practice_attempt','diagnostic_attempt','review_error_attempt','full_length_answer')` |
| `event_id` | uuid | NO | | |
| `question_id` | text | YES | | TEXT not uuid (SP-21 authoritative) |
| `difficulty` | smallint | YES | | |
| `correct` | boolean | YES | | |
| `occurred_at` | timestamptz | YES | | |
| `mastery_score_before` | numeric(5,4) | YES | | R6: (5,4) is implementation-authoritative, not spec's (10,9) |
| `mastery_score_after` | numeric(5,4) | YES | | R6: same |
| `mastery_level_before` | smallint | YES | | |
| `mastery_level_after` | smallint | YES | | |
| `event_count_after` | integer | NO | | CHECK `>= 0` |
| `constants_snapshot_hash` | text | NO | | |
| `mastery_model_version` | text | NO | | |
| `applied_at` | timestamptz | NO | `now()` | |

**Constraints:**
- PK: `mastery_event_audit_log_pkey (audit_row_id)`
- UNIQUE: `mastery_event_audit_log_dedup_uq (event_source_kind, event_id)` — INV-05A-10 load-bearing constraint **PRESENT** ✓

**Tables are NOT unified** — two separate tables confirmed ✓

### mastery_domain_refresh_audit_log — 13 columns

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `audit_row_id` | uuid | NO | `gen_random_uuid()` | PK |
| `student_id` | uuid | NO | | |
| `section` | text | NO | | CHECK `IN ('M','RW')` |
| `domain` | text | NO | | |
| `mastery_score_before` | numeric(5,4) | YES | | R6: implementation-authoritative |
| `mastery_score_after` | numeric(5,4) | YES | | R6: same |
| `mastery_level_before` | smallint | YES | | |
| `mastery_level_after` | smallint | YES | | |
| `event_count_after` | integer | NO | | CHECK `>= 0` |
| `constants_snapshot_hash` | text | NO | | |
| `mastery_model_version` | text | NO | | |
| `triggered_by` | text | YES | | **NO CHECK constraint** — OPEN-GATE (Q2 fix) |
| `applied_at` | timestamptz | NO | `now()` | |

**Missing per spec:** `last_event_id`, `last_event_occurred_at` — SKIP per Q6=(b) owner ruling (aspirational).

---

## D. Audit Write Call Sites

**Verdict: PASS**

### apply_mastery_event → mastery_event_audit_log
Confirmed in live function body: §4.8 audit insert present. 19-column INSERT (all columns except `audit_row_id` which uses DEFAULT). Includes `unique_violation` exception handler for idempotent re-entry (§4.11 / RB-05A-V1-01). **PRESENT ✓**

### refresh_domain_mastery → mastery_domain_refresh_audit_log
Confirmed in live function body: §4.8 audit insert present. 13-column INSERT including `triggered_by` via `current_setting('app.mastery_refresh_trigger', true)`. **PRESENT ✓**

Both inserts are blocking and within the canonical upsert transaction. No `BLOCKING_UPSTREAM_GAP`.

---

## E. RLS / GRANTs

**Verdict: PASS (existing tables) + OPEN-GATE (new table)**

### RLS status

| Table | RLS Enabled | RLS Forced | Policies |
|-------|-------------|------------|----------|
| `mastery_event_audit_log` | YES | NO | NONE (default deny for anon/authenticated) |
| `mastery_domain_refresh_audit_log` | YES | NO | NONE (default deny for anon/authenticated) |
| `mastery_constants` | YES | NO | NONE (default deny for anon/authenticated) |
| `mastery_constants_change_log` | — | — | DOES NOT EXIST YET — **must create with RLS + service_role SELECT policy** |

### GRANTs (existing tables)

| Table | Grantees with privileges |
|-------|--------------------------|
| `mastery_event_audit_log` | `postgres` (ALL), `service_role` (ALL) — no `anon`, no `authenticated` ✓ |
| `mastery_domain_refresh_audit_log` | `postgres` (ALL), `service_role` (ALL) — no `anon`, no `authenticated` ✓ |
| `mastery_constants` | `postgres` (ALL), `service_role` (ALL) — no `anon`, no `authenticated` ✓ |

**Note on spec vs implementation:** §11.E spec references `admin_role` — does not exist in Supabase 3-role model (SP-20). All admin operations fold into `service_role` per 05B precedent. No `authenticated` SELECT policy needed — these are internal/service tables. Service_role bypasses RLS.

**OPEN-GATE:** `mastery_constants_change_log` must be created with: RLS ENABLE, no anon/authenticated policies, GRANT ALL to service_role. The §10 cascade path will need DELETE privilege (service_role already has ALL).

### Triggers on mastery_constants

No triggers currently exist on `mastery_constants`. The `ENABLE ALWAYS` capture trigger (`trg_capture_mastery_constant_change`) is a 05D build item (INV-05D-14).

---

## F. Formula / Operational Key Boundary

**Verdict: PASS — 23 formula keys confirmed, byte-exact match**

### Live canonicalize_mastery_constants_serialized() output (23 keys)

```
difficulty_weight_easy=0.79
difficulty_weight_hard=1.20
difficulty_weight_medium=1.0
mastery_level_0_max=0.19
mastery_level_1_max=0.39
mastery_level_1_min=0.20
mastery_level_2_max=0.59
mastery_level_2_min=0.40
mastery_level_3_max=0.79
mastery_level_3_min=0.60
mastery_level_4_min=0.80
mastery_max=1.0
mastery_min=0.0
mastery_model_version="v1.0"
MIN_EVENTS_FOR_MASTERY=5
POSITION_HALF_LIFE=30
ROUND_ACCURACY_DECIMALS=6
ROUND_EVIDENCE_DECIMALS=6
ROUND_MASTERY_PCT_DECIMALS=2
ROUND_MASTERY_SCORE_DECIMALS=4
ROUNDING_MODE="HALF_UP"
weight_source_practice=0.30
weight_source_review=0.20
weight_source_test=0.50
```

### Live canonicalize_mastery_constants() JSONB output (23 keys)

Confirmed: exact same 23-key set as the serialized form. CTO-verified authoritative list matches 1:1.

### Operational keys (excluded from hash, 12 total)

| Key | Value | Spec |
|-----|-------|------|
| `DIAGNOSTIC_TOTAL_QUESTIONS` | 40 | Q8: OPERATIONAL (not in hash) |
| `KPI_RECENCY_WINDOW_SHORT_DAYS` | 7 | Doc 05B §9 |
| `KPI_RECENCY_WINDOW_LONG_DAYS` | 30 | Doc 05B §9 |
| `PROJECTION_BOUND_ROUND_TO` | 10 | Doc 05C §4.1 |
| `PROJECTION_DOMAIN_WEIGHTS` | {M: {...}, RW: {...}} | Doc 05C §4.2/§4.3 |
| `PROJECTION_MAX_DELTA` | 100 | Doc 05C §4.1 |
| `PROJECTION_MIDPOINT_ROUND_TO` | 10 | Doc 05C §4.1 |
| `PROJECTION_MIN_DELTA` | 25 | Doc 05C §4.1 |
| `PROJECTION_REFRESH_EVENT_THRESHOLD` | 40 | Doc 05C §4.1/§8.2 |
| `PROJECTION_REFRESH_TIME_THRESHOLD_HOURS` | 24 | Doc 05C §4.1/§8.2 |
| `PROJECTION_SECTION_MAX_SCORE` | 800 | Doc 05C §4.1 |
| `PROJECTION_SECTION_MIN_SCORE` | 200 | Doc 05C §4.1/§6.5 |

**Total mastery_constants rows:** 35 (23 formula + 12 operational). The `constant_affects_formula_hash` classifier must enumerate exactly these two sets.

**§11.K reconciliation:** The 05D spec's `v_formula` array uses UPPER_SNAKE_CASE placeholder names that do NOT match the actual 05A keys (mixed-case). The authoritative key set is the 23-key list above. The classifier must use THESE keys, not the spec's placeholder names. **RECONCILED** — no migration needed, resolved at build time.

---

## G. Cascade Target Inventory

**Verdict: OPEN-GATE — 21 tables found vs spec's 10 (Q9=(a) applied: event sources → Layer 2 anonymize)**

### Complete student-data surface (live, 21 tables)

The original §G inventory searched for `student_id` columns only. Two event-source tables and two session-container/legal tables use `user_id` instead — they were missed. The canonical cascade surface is **every table holding this student's data**, not just tables with a column named `student_id`.

#### Tables via `student_id` (17)

| # | Table | FK to profiles.id? | Delete Rule | Inter-table FKs |
|---|-------|---------------------|-------------|-----------------|
| 1 | `review_error_attempts` | YES | NO ACTION | FK → `review_session_items.id` (CASCADE), FK → `questions.id` (NO ACTION) |
| 2 | `review_session_items` | YES | NO ACTION | FK → `review_sessions.id` (CASCADE), FK → `questions.id` (NO ACTION) |
| 3 | `review_sessions` | YES | NO ACTION | — |
| 4 | `review_schedule` | YES | NO ACTION | FK → `questions.id` (NO ACTION) |
| 5 | `mastery_event_audit_log` | NO (logical ref) | — | — |
| 6 | `mastery_domain_refresh_audit_log` | NO (logical ref) | — | — |
| 7 | `student_skill_mastery` | NO (logical ref) | — | — |
| 8 | `student_domain_mastery` | NO (logical ref) | — | — |
| 9 | `student_skill_kpi` | NO (logical ref) | — | — |
| 10 | `student_domain_kpi` | NO (logical ref) | — | — |
| 11 | `student_section_kpi` | NO (logical ref) | — | — |
| 12 | `student_overall_kpi` | NO (logical ref) | — | — |
| 13 | `student_kpi_rollups_current` | NO (logical ref) | — | — |
| 14 | `student_section_projections` | NO (logical ref) | — | — |
| 15 | `student_section_projection_snapshots` | NO (logical ref) | — | — |
| 16 | `student_projection_refresh_state` | NO (logical ref) | — | — |
| 17 | `projection_refresh_outbox` | NO (logical ref) | — | — |

#### Tables via `user_id` (4 — MISSED in original inventory)

| # | Table | FK to profiles.id? | Delete Rule | Inter-table FKs | Role |
|---|-------|---------------------|-------------|-----------------|------|
| 18 | `practice_session_items` | YES (`user_id`) | NO ACTION | FK → `practice_sessions.id` (CASCADE), FK → `questions.id` (NO ACTION) | **Event source** — `canonical_mastery_events` reads `WHERE pi.user_id = p_student_id AND status='answered'` |
| 19 | `practice_sessions` | YES (`user_id`) | NO ACTION | — | Session container for #18 |
| 20 | `legal_acceptances` | YES (`user_id`) | **CASCADE** | — | Auto-deletes when profile deleted |
| 21 | `legal_acceptance_outbox` | NO (logical ref) | — | — | Delivery queue for #20 |

`mastery_constants_change_log` is NOT in this list (it has `actor_session_user`, not `student_id` — correctly excluded from cascade per owner ruling).

### Q9 — Event Source Table Treatment in Anonymized-Retention Mode (OWNER QUESTION)

`canonical_mastery_events` derives from exactly **two source tables** (confirmed in live function body):
1. `practice_session_items` — practice + diagnostic events (via `user_id`, `status='answered'`)
2. `review_error_attempts` — review events (via `student_id`)

In **anonymized-retention mode** (Q5 default once privacy sign-off clears), Layer 2 anonymizes the derived aggregates (`mastery_event_audit_log`, `mastery_domain_refresh_audit_log`, mastery/KPI/projection tables) with a one-way `gen_random_uuid()` surrogate. But Layer 1 **hard-deletes** these two event source tables — the raw event stream is destroyed while the derived aggregates survive anonymized.

**Asymmetry:** the ML-retention value of anonymized-retention lives in the event stream (per-question, per-difficulty, per-timestamp granularity), not in the pre-aggregated mastery scores. If the source events are hard-deleted while the aggregates are retained, the anonymized data has no re-derivation path and limited ML utility.

**Q9: In anonymized-retention mode, do the raw event source tables (`practice_session_items`, `review_error_attempts`) get hard-deleted (Layer 1) or anonymized (Layer 2 surrogate)?**

**Q9=(a) ANSWERED:** Event-source tables are **anonymized-and-retained** (Layer 2). Owner ruling: every response is world-model training corpus — event-stream preservation is a platform invariant. The ML-retention value lives in the per-event stream (per-question, per-difficulty, per-timestamp granularity), not the pre-aggregated mastery scores.

**Consequence applied:** The `user_id` column in `practice_session_items` (not `student_id`) gets the same surrogate replacement. The cascade function must parameterize the target column name per table (see INV-05D-18).

**FK-cascade constraint (discovered):** Retaining event sources requires retaining their FK-parent session containers — deleting a parent would CASCADE-delete the retained children:
- `review_error_attempts` FK → `review_session_items` FK → `review_sessions`: all three must be Layer 2 anonymized
- `practice_session_items` FK → `practice_sessions`: both must be Layer 2 anonymized

This means steps 1–3 and 5–6 are ALL Layer 2 in anonymized-retention mode (not just the event-source steps 1 and 5). Only step 4 (`review_schedule`, no FK from retained tables) remains Layer 1 hard-delete.

### Review-Table CASCADE FK Interaction

The review tables have **internal cascading FKs** that create an ordering constraint:

```
review_sessions
  └─ CASCADE → review_session_items
                  └─ CASCADE → review_error_attempts
```

All three also have direct `student_id` FK → `profiles.id` (NO ACTION). The cascade function must pick ONE deletion strategy and commit to it:

**Strategy A — Children-first explicit:** Delete `review_error_attempts` → `review_session_items` → `review_sessions` → `review_schedule` in that order. Each DELETE returns a count. The CASCADE FKs are never triggered because children are already gone when the parent is deleted. **Pro:** every delete count is verifiable; no hidden side effects. **Con:** 4 explicit DELETE statements instead of 2.

**Strategy B — Parent-first CASCADE-reliant:** Delete `review_sessions` (CASCADE auto-deletes `review_session_items` → `review_error_attempts`), then delete `review_schedule`. **Pro:** fewer statements. **Con:** CASCADE-deleted row counts are invisible to the function's delete verification; mixing explicit + implicit deletion makes targeting harder to prove in test.

**Committed strategy: A (children-first explicit).** Rationale: for a PERMANENT irreversible hard-delete, every deleted row must be counted and verified. CASCADE hides row counts and makes the exact-target test (§10 rehearsal requirement) unable to assert per-table deletion counts. The same children-first approach applies to practice tables (`practice_session_items` → `practice_sessions`).

### Practice-Table CASCADE FK Interaction

```
practice_sessions
  └─ CASCADE → practice_session_items
```

Both have `user_id` FK → `profiles.id` (NO ACTION). Children-first: delete `practice_session_items` → `practice_sessions`.

### Committed Delete Order — Layer 1 Hard-Delete (21 tables)

The function deletes in this exact order. Each step includes the column used for targeting and the ordering rationale.

| Step | Table | Target Column | Rationale |
|------|-------|---------------|-----------|
| 1 | `review_error_attempts` | `student_id` | Leaf child — FK CASCADE from `review_session_items`; must delete before parent |
| 2 | `review_session_items` | `student_id` | Child of `review_sessions` (FK CASCADE); must delete before parent |
| 3 | `review_sessions` | `student_id` | Parent of #2; safe now that children are gone |
| 4 | `review_schedule` | `student_id` | Independent review table; FK to `questions` (NO ACTION on questions, we're deleting FROM here) |
| 5 | `practice_session_items` | `user_id` | Leaf child — FK CASCADE from `practice_sessions`; **event source table** for `canonical_mastery_events`; must delete before parent |
| 6 | `practice_sessions` | `user_id` | Parent of #5; safe now that children are gone |
| 7 | `projection_refresh_outbox` | `student_id` | Outbox queue — delete pending refresh requests before the projections they reference |
| 8 | `student_section_projection_snapshots` | `student_id` | Historical snapshots — no FK deps, delete before live projections |
| 9 | `student_section_projections` | `student_id` | Live projections — logically depends on KPI/mastery; delete before KPIs |
| 10 | `student_projection_refresh_state` | `student_id` | Refresh-tracking state for projections; delete alongside projections |
| 11 | `student_skill_kpi` | `student_id` | Leaf KPI — most granular; delete before section/overall rollups |
| 12 | `student_domain_kpi` | `student_id` | Domain-level KPI; delete before section rollup |
| 13 | `student_section_kpi` | `student_id` | Section-level KPI; delete before overall |
| 14 | `student_overall_kpi` | `student_id` | Top-level KPI rollup |
| 15 | `student_kpi_rollups_current` | `student_id` | Denormalized KPI view; delete after source KPI tables |
| 16 | `student_domain_mastery` | `student_id` | Domain mastery — logically aggregates skill mastery |
| 17 | `student_skill_mastery` | `student_id` | Skill mastery — base mastery layer |
| 18 | `mastery_domain_refresh_audit_log` | `student_id` | Audit log — append-only except cascade (INV-05D-15); delete after the tables it audits |
| 19 | `mastery_event_audit_log` | `student_id` | Audit log — append-only except cascade (INV-05D-15); delete after the tables it audits |
| 20 | `legal_acceptance_outbox` | `user_id` | Delivery queue — delete before the acceptance it references |
| 21 | `legal_acceptances` | `user_id` | Has FK CASCADE to profiles — would auto-delete anyway, but explicit delete is safer for count verification |

**Ordering constraints enforced:**
- Steps 1–3: children-first for review FK CASCADE chain
- Steps 5–6: children-first for practice FK CASCADE chain
- Steps 7–10: projection layer before KPI layer (logical dependency)
- Steps 11–15: KPI leaf-to-root
- Steps 16–17: domain before skill mastery (logical dependency — domain aggregates skills)
- Steps 18–19: audit logs LAST among mastery tables (they audit the tables deleted in steps 16–17)
- Steps 20–21: legal tables last (independent of mastery layer)

**No FK enforces** the ordering among the 13 mastery/KPI/projection tables (steps 7–19) — they use logical `student_id` references without DB-level FKs. The committed order above is the function's imposed ordering; the exact-target test (PR-3 rehearsal) must prove: (a) every step deletes exactly the target student's rows, (b) no step fails due to FK violation, (c) no CASCADE side-effect deletes rows not counted by the function.

**Layer 1 / Layer 2 Split (Q9=(a) applied):**

| Steps | Tables | hard-delete mode | anonymized-retention mode |
|-------|--------|-------------------|---------------------------|
| 1–3 | `review_error_attempts`, `review_session_items`, `review_sessions` | Hard-delete | **Anonymize** (`student_id` → `v_surrogate`) — step 1 is event source; steps 2–3 retained as FK parents |
| 4 | `review_schedule` | Hard-delete | Hard-delete — no FK from retained tables |
| 5–6 | `practice_session_items`, `practice_sessions` | Hard-delete | **Anonymize** (`user_id` → `v_surrogate`) — step 5 is event source; step 6 retained as FK parent |
| 7–17 | Projection, KPI, mastery tables | Hard-delete | Anonymize (`student_id` → `v_surrogate`) |
| 18–19 | Audit logs | Hard-delete | Anonymize (`student_id` → `v_surrogate`) |
| 20–21 | Legal tables | Hard-delete | Hard-delete — independent of mastery layer |

**Column-name divergence in anonymize mode:** Steps 5–6 target `user_id` (not `student_id`); the cascade function must parameterize the surrogate-update column name per table. This is the same column-name difference that INV-05D-18 (canonical-ID invariant) tracks for deferred retrofit (GAP-HY-20).

---

## H. 04B→05C Seam (§12)

**Verdict: OPEN-GATE — BLOCKING_UPSTREAM_GAP**

The two §12 items require 04B to satisfy the 05C seam before the §9 sweep/outbox consumer and projection deploy can proceed. This gate is recorded in GAP-MA-12. The 05D build locks the spec; the sweep deploys only after 04B satisfies the seam (§12.3).

---

## I. Privacy/Compliance Gate (§10.4)

**Verdict: OPEN-GATE — BLOCKING_PRIVACY_GAP**

Layer 2 anonymized retention for minor data requires privacy/compliance sign-off. Until then, Layer 2 = hard-delete fallback (both modes built, hard-delete is default). The gate is recorded in GAP-MA-12. This does NOT block PR-1 through PR-2 (governance substrate + classifier); it gates PR-3 (cascade) deploy.

---

## J. CI Guards

**Verdict: OPEN-GATE — all 9 guards are build items**

| CI Guard | Invariant | Status |
|----------|-----------|--------|
| `no_constants_change_recompute_path` | INV-05D-13 | BUILD (PR-6) |
| `operational_key_set_matches_formula_hash_complement` | §6.3 | BUILD (PR-6) |
| `classifier_is_closed_world` | RB-05D-V1-03 | BUILD (PR-6) |
| `constants_state_hash_single_serializer` | RB-05D-V1-02 | BUILD (PR-6) |
| `no_reverse_anonymization_map` | INV-05D-16 | BUILD (PR-6) |
| `surrogate_is_uuid_only` | RB-05D-V1-05 | BUILD (PR-6) |
| `audit_log_append_only_except_cascade` | INV-05D-15 | BUILD (PR-6) |
| `capture_trigger_is_enable_always` | INV-05D-14 | BUILD (PR-6) |
| `backfill_calls_recompute_skill_mastery` | RB-05D-V1-A | BUILD (PR-6) |

None exist yet. All are PR-6 scope.

---

## K. Formula-Key-Registry Reconciliation (RB-05D-V1-03)

**Verdict: RECONCILED — no migration needed**

The `constant_affects_formula_hash` classifier's `v_formula` array must equal the 23 keys that `canonicalize_mastery_constants_serialized()` serializes. Live verification confirms exactly 23 keys in the serialized output (listed in §F above). The classifier is a build item — it will use the authoritative 23-key set, not the 05D spec's placeholder names.

The complementary operational set (12 keys) is enumerated in §F above. The CI guard `operational_key_set_matches_formula_hash_complement` will enforce this boundary at build time.

---

## L. 05A Recompute RPC Signature (RB-05D-V1-A)

**Verdict: PASS**

`recompute_skill_mastery` exists with signature:
```
(p_student_id uuid, p_section text, p_domain text, p_skill text) → student_skill_mastery
```

This matches the §7.2 backfill call site's expected parameter shape. The function is SECURITY DEFINER with `SET search_path TO 'public', 'pg_temp'`.

**TODO landmine confirmed in live function body:**
```sql
-- TODO(05B): refresh_domain_mastery(p_student_id,p_section,p_domain) is owned by 05B (a later
-- item) and MUST be called here once 05B lands, per Doc 05A §5.1 — else skill/domain drift.
-- Tracked in the B-WS3-1 contract §G as a hard sequential dependency; not in B-WS3-1 scope.
```

**Q4 ruling = (a):** Close the TODO fully. Wire `recompute_skill_mastery` to call `refresh_domain_mastery(p_student_id, p_section, p_domain)` → `bump_projection_refresh_counter(p_student_id, p_section)` as a complete standalone chain. Must prove no double-refresh under backfill (where backfill_recompute_student calls recompute_skill_mastery per skill, then refresh_domain_mastery per domain — the domain refresh must not fire twice). **HALT if double-fire risk.**

---

## M. Outbox-Consumer Failure Contract (RB-05D-V1-D)

**Verdict: OPEN-GATE — consumer is a build item**

The outbox consumer (`§9.2`) must demonstrate:
1. `FOR UPDATE SKIP LOCKED` claim
2. All-or-nothing `processed_at` (set only after both M/RW refreshes + counter reset)
3. Dead-letter-after-N path

None of this exists yet. Build item for PR-5 (schedules). Degraded mode (no dead-letter) ships until §11.N is resolved.

---

## N. projection_refresh_outbox Table Shape (RB-05D-V1-10)

**Verdict: OPEN-GATE — BLOCKING_05C_CONTRACT_GAP (ship degraded)**

### Live schema (5 columns)

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `outbox_id` | bigint | NO | — |
| `student_id` | uuid | NO | — |
| `reason` | text | NO | — |
| `requested_at` | timestamptz | NO | `now()` |
| `processed_at` | timestamptz | YES | — |

**Missing per §9.2 contract:**
- `attempt_count` (or equivalent retry counter) — **ABSENT**
- `failed` / terminal status marker — **ABSENT**

Per owner ruling (R10): ship in degraded mode. The §9.2 outbox consumer deploys with at-least-once retry without bounded dead-letter. Stuck rows retry indefinitely with ops alerting on age. The 05C-owned additive columns (`attempt_count`, `failed`) are a 05C deploy-time reconciliation within §16.3 post-lock additive-clarification scope.

---

## Summary — Gate Status

| Item | Verdict | Action Required |
|------|---------|-----------------|
| **A** | PASS | Greenfield — build all 7 objects |
| **B** | PASS | `canonical_mastery_events_for_student` = new build (R3) |
| **C** | PASS | Dedup UNIQUE present; tables not unified |
| **D** | PASS | Both audit write call sites confirmed |
| **E** | PASS + OPEN-GATE | Existing tables correct; `mastery_constants_change_log` needs RLS at creation |
| **F** | PASS | 23 formula keys byte-exact match; 12 operational confirmed |
| **G** | OPEN-GATE (Q9=(a) applied) | 21-table inventory; committed delete order (children-first, 21 steps); Q9=(a): event sources + FK parents → Layer 2 anonymize; seam contract documented; INV-05D-18 canonical-ID invariant |
| **H** | OPEN-GATE | `BLOCKING_UPSTREAM_GAP` — 04B→05C seam |
| **I** | OPEN-GATE | `BLOCKING_PRIVACY_GAP` — privacy sign-off gates Layer 2 default |
| **J** | OPEN-GATE | All 9 CI guards are build items (PR-6) |
| **K** | RECONCILED | 23-key set authoritative; classifier uses live keys not spec placeholders |
| **L** | PASS | RPC signature matches; TODO landmine confirmed (Q4 build item) |
| **M** | OPEN-GATE | Consumer is build item (PR-5); degraded until §11.N resolved |
| **N** | OPEN-GATE | `BLOCKING_05C_CONTRACT_GAP` — ship degraded |

### Blocking Gates (must resolve before respective PRs deploy)

1. **BLOCKING_PRIVACY_GAP** (§10.4) — gates PR-3 cascade Layer 2 default mode
2. **BLOCKING_05C_CONTRACT_GAP** (§11.N) — gates PR-5 dead-letter; ship degraded
3. **BLOCKING_UPSTREAM_GAP** (§12/§11.H) — gates §9 sweep/outbox deploy

### Non-Blocking (build-time resolution)

- §11.K formula-key reconciliation: resolved (23 keys, live-verified)
- §11.E RLS on new table: handled at creation time in PR-1
- §11.G 21-table cascade inventory: committed delete order (children-first, 21 steps); Q9 owner question on event-source anonymization
- §11.L TODO closure: PR-4 build item per Q4

### Q2 triggered_by Path Analysis

#### Caller audit (exhaustive — prod DB + repo grep)

**Prod function bodies calling `refresh_domain_mastery` (live `pg_proc.prosrc LIKE` query):**

| Caller | Active call? | Path |
|--------|-------------|------|
| `apply_mastery_event` | **YES** — `PERFORM public.refresh_domain_mastery(...)` at §4.9 | Event-time path |
| `recompute_skill_mastery` | **NO** — reference is in a TODO comment only, not an active `PERFORM` | Pending Q4 closure (will become active) |

**Repo grep (`*.ts`, `*.tsx`, `*.js`, `*.jsx`):** ZERO app-layer callers. `refresh_domain_mastery` is never called as a Supabase RPC from application code.

**Future callers (build items, not yet in prod):**
- `backfill_recompute_student` (§7.2) — will call `recompute_skill_mastery` per skill, which after Q4 closure chains to `refresh_domain_mastery`
- No other planned callers identified in spec or contracts

**Conclusion: exactly TWO callers will exist after Q4 closure** — `apply_mastery_event` (event-time) and `recompute_skill_mastery` (recompute-time, chained from backfill). Both must set the GUC before the CHECK can land. No third caller exists that would break the CHECK.

#### Cross-doc edit: apply_mastery_event SET LOCAL (05A-owned)

Adding `SET LOCAL app.mastery_refresh_trigger = 'event'` to `apply_mastery_event` before its `PERFORM public.refresh_domain_mastery(...)` call is a **05A-owned cross-doc edit** — same class as the Q4 TODO closure in `recompute_skill_mastery`. Both modify locked 05A functions per owner rulings (Q2=(a) and Q4=(a) respectively).

This requires a **Karl spec annotation on 05A** acknowledging the cross-doc modification. The annotation should note: "05A §4.9 `apply_mastery_event` modified by 05D build per Q2=(a) ruling to set `app.mastery_refresh_trigger = 'event'` before calling `refresh_domain_mastery`, enabling the `triggered_by` CHECK constraint on `mastery_domain_refresh_audit_log`."

#### GUC resolution by path

| Path | Caller | SET LOCAL value | triggered_by resolves to |
|------|--------|-----------------|--------------------------|
| Event-time (current) | `apply_mastery_event` | **NONE** (no SET LOCAL in current code) | **NULL** (current_setting with missing_ok=true) |
| Event-time (after fix) | `apply_mastery_event` | `'event'` | `'event'` |
| Recompute-time (after Q4) | `recompute_skill_mastery` → `refresh_domain_mastery` | Must be set by either `recompute_skill_mastery` or the calling `backfill_recompute_student` | `'backfill_recompute'` |

The CHECK constraint `IN ('event', 'backfill_recompute')` **cannot land** until:
1. `apply_mastery_event` sets `SET LOCAL app.mastery_refresh_trigger = 'event'` (05A cross-doc edit)
2. The backfill/recompute path sets `SET LOCAL app.mastery_refresh_trigger = 'backfill_recompute'`
3. Both SET LOCALs and the CHECK constraint land in the **same migration**

If the CHECK is added without #1, all existing event-time audit inserts will fail (triggered_by = NULL violates CHECK). This is a **breaking change** if not coordinated.

---

---

## Deletion-Lifecycle Seam Map

> Read-only audit of the live implementation (PRs #403–#411, merged to main 2026-06-22). Maps the 3-layer ownership model and identifies where 05D §10's `cascade_account_deletion` plugs into the existing lifecycle. NO code produced — audit + plan only.

### 3-Layer Ownership Model

| Layer | Owner | Scope | Status |
|-------|-------|-------|--------|
| **1. Identity/Platform** (Doc 01 §40) | Doc 01 | Full-account teardown orchestration: grace request/cancel/recover, profile PII scrub (`deidentify_user`), Stripe cancellation, auth disable, grace-expiry driver | PARTIALLY BUILT — request/cancel/recover BUILT (#403–#411); `deidentify_user` APPLIED (profiles PII only, HY-15); grace-expiry driver NOT autonomous (OP-01/OP-03) |
| **2. Mastery Cascade** (Doc 05D §10) | Doc 05D | `cascade_account_deletion(p_student_id, p_mode)` — mastery-layer slice: 21 tables in committed order, Layer 1 hard-delete or Layer 2 anonymize per mode | NOT BUILT (GAP-MA-12) |
| **3. Tutor/LISA Cascade** (Doc 03A) | Doc 03A | `tutor_conversations`, `tutor_messages`, `memory_summaries`, `instruction_*`, `question_links` — conversation-store feature-table cascade | NOT BUILT (GAP-HY-15 feature-table cascade, gated on Doc 03A V2 retention) |

### Current Execution Flow (as-built)

```
[Vercel CRON or manual trigger]
  → POST /api/internal/execute-deletions (CRON_SECRET + flag gate)
    → executeDueDeletions(admin, requestId?)
      → SELECT from account_deletion_requests
          WHERE status='pending' AND scheduled_hard_delete_at <= now()
      → FOR EACH expired request:
          → admin.rpc('deidentify_user', { target_user_id, deleted_email })
            → profiles PII scrub ONLY (name→'Deleted User', email→hash, dob→NULL, etc.)
          → UPDATE account_deletion_requests SET status='completed'
      ← returns { processed, failed, results[] }
```

**What's missing from the execution flow:**

1. **Feature-table cascade** — `executeDueDeletions` calls `deidentify_user` which only scrubs `profiles` PII. The 21 mastery/KPI/projection/practice/review tables (§G inventory) are UNTOUCHED. Student data in these tables survives "deletion."
2. **Tutor cascade** — `tutor_conversations`/`messages`/`memory_summaries` untouched (GAP-HY-15/TU-03). Verbatim minor–AI conversations survive de-identification.
3. **Autonomous scheduling** — `POST /api/internal/execute-deletions` exists but is NOT scheduled in `vercel.json` (only `legal-acceptance-drain` is). The T+7 sweep never fires autonomously (GAP-OP-01/OP-03).

### Where cascade_account_deletion Plugs In

05D §10 builds `cascade_account_deletion(p_student_id uuid, p_mode text)` as a **callable unit** — a single RPC that handles the mastery-layer slice (21 tables, Layer 1 or Layer 2 per mode).

**Integration point:** `executeDueDeletions()` in `server/lib/account-deletion-execute.ts` calls the cascade RPCs **before** `deidentify_user`:

```
→ executeDueDeletions(admin, requestId?)
  → FOR EACH expired request:
      → admin.rpc('cascade_account_deletion', { p_student_id, p_mode })  ← NEW (05D §10)
      → admin.rpc('cascade_tutor_data', { ... })                        ← FUTURE (Doc 03A)
      → admin.rpc('deidentify_user', { target_user_id, deleted_email }) ← EXISTING
      → UPDATE account_deletion_requests SET status='completed'
```

**Ordering constraint:** Feature-table cascades (mastery + tutor) must run BEFORE `deidentify_user`. While `deidentify_user` does an UPDATE (not DELETE) so RESTRICT FKs don't block it, the cascade should run while the profile UUID is still resolvable for audit/logging purposes.

**RESTRICT-gated tables (Doc 01 ownership):** `account_deletion_requests` itself has `profile_id FK → profiles.id RESTRICT` — the profile row can never be hard-deleted while deletion request rows exist. This is by design: the request is the audit trail. `deidentify_user` UPDATEs (not DELETEs) the profile, so RESTRICT is not triggered.

---

## Q10 — Grace-Expiry Driver Ownership (OWNER QUESTION)

The account-deletion lifecycle has a gap at the **grace-expiry driver** — the autonomous process that selects expired pending requests and triggers the cascade chain.

**Current state:**
- `POST /api/internal/execute-deletions` EXISTS and is CRON_SECRET + flag gated
- It calls `executeDueDeletions()` which selects `WHERE status='pending' AND scheduled_hard_delete_at <= now()`
- But it is NOT scheduled — no `vercel.json` cron, no `pg_cron` job, no GHA schedule fires it
- GAP-OP-01 (scheduling infrastructure) is OPEN; GAP-OP-03 (auto-execute) is PARTIAL

**Q10: Who owns the grace-expiry driver that calls `cascade_account_deletion` when the 7-day grace expires?**

- **(a) Doc 01 (identity/platform)** — the driver is platform infrastructure that orchestrates all three cascade layers. Doc 01 owns the `/execute-deletions` endpoint and `executeDueDeletions`. The driver is a scheduling concern (GAP-OP-01), not a mastery concern.
- **(b) Doc 05D (mastery governance)** — 05D's cascade is the most complex (21 tables, two modes) and the driver's correctness is entangled with the cascade's ordering and mode selection.
- **(c) Shared** — Doc 01 owns the scheduling/CRON trigger; 05D owns the cascade RPC called by it. The driver fires the cascade but doesn't own its internals.

**Recommendation:** (c) matches the as-built seam — Doc 01 owns the endpoint/scheduling, 05D owns the callable cascade RPC. But the driver itself (the autonomous scheduler that fires it) is Doc 01/OP-01 scope.

Do NOT resolve — this is an owner call on infrastructure ownership.

---

## INV-05D-18 — Canonical Profile-Reference Column Name

**Invariant:** `student_id` is THE canonical column name for the per-profile UUID on every feature table. `user_id` as a profile-reference column name is **FORBIDDEN** for new tables going forward.

**Rationale:** The cascade function targets student data across 21 tables. 17 use `student_id`; 4 use `user_id` (`practice_session_items`, `practice_sessions`, `legal_acceptances`, `legal_acceptance_outbox`). The column-name inconsistency forces the cascade function to parameterize the target column per table, complicates the surrogate-update in anonymized-retention mode, and creates a class of bugs where `WHERE student_id = p_student_id` silently misses `user_id` tables (the original §G inventory missed all 4 `user_id` tables for exactly this reason).

**Enforcement:** CI guard (PR-6 scope) must reject any new migration adding a `user_id` column that references `profiles.id` — force `student_id` instead.

**Existing violations:** 4 tables tracked as GAP-HY-20 (deferred retrofit, NOT in 05D scope):
- `practice_session_items.user_id`
- `practice_sessions.user_id`
- `legal_acceptances.user_id`
- `legal_acceptance_outbox.user_id`

---

_Generated by live-prod introspection on 2026-06-24. All queries executed via Supabase MCP `execute_sql` against project `hncolwkccbbjkfithhlo`._
