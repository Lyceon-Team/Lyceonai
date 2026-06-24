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

**Verdict: OPEN-GATE — 17 tables found vs spec's 10**

### All tables with `student_id` column (live, 17 total)

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

### FK-ordered cascade (Layer 1 hard-delete)

The review tables have internal cascading FKs:
- `review_error_attempts` → `review_session_items` (CASCADE)
- `review_session_items` → `review_sessions` (CASCADE)

So deleting `review_sessions` cascades to `review_session_items` → `review_error_attempts`. But all 4 review tables also have direct `student_id` FK → `profiles.id` with NO ACTION, meaning explicit delete per table is needed.

The mastery/KPI/projection tables (13 tables) have NO FK constraints to each other or to `profiles` — `student_id` is a logical reference only. Delete order among them is unconstrained by DB FKs but logically should follow the dependency chain (projections → KPIs → domain mastery → skill mastery → audit logs).

**OPEN-GATE:** The §10 cascade must be verified against this live 17-table inventory, not the spec's 10-table list. The build must enumerate all 17 and determine the safe delete order. `mastery_constants_change_log` is NOT in this list (it has `actor_session_user`, not `student_id` — correctly excluded from cascade per owner ruling).

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
| **G** | OPEN-GATE | 17-table inventory (vs spec 10); cascade must cover all 17 |
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
- §11.G 17-table cascade inventory: cascade SQL must enumerate all 17 (not spec's 10)
- §11.L TODO closure: PR-4 build item per Q4

### Q2 triggered_by Path Analysis

The `refresh_domain_mastery` audit insert uses `current_setting('app.mastery_refresh_trigger', true)` for `triggered_by`. On the **event-time path** (called via `apply_mastery_event`), no `SET LOCAL` is issued for this GUC — `current_setting` with `missing_ok=true` returns **NULL**. The CHECK constraint `IN ('event','backfill_recompute')` cannot be added until the event-time path sets `SET LOCAL app.mastery_refresh_trigger = 'event'` in `apply_mastery_event` before calling `refresh_domain_mastery`. Both the SET LOCAL and the CHECK must land in the **same migration** (PR-1 or dedicated follow-up).

---

_Generated by live-prod introspection on 2026-06-24. All queries executed via Supabase MCP `execute_sql` against project `hncolwkccbbjkfithhlo`._
