# **Doc 05A — Mastery Formula & Skill Mastery**

| Field | Value |
| ----- | ----- |
| **Document** | Doc 05A — Mastery Formula & Skill Mastery |
| **Version** | V1.0 |
| **Status** | Locked 2026-05-13 (in-lock-cycle cleanup applied across four rounds, RB-05A-V1-01..23; no version bump per Doc 04 family precedent) |
| **Scope** | The mastery formula's executable form (SQL function); the event-time mastery write RPC; the per-skill recompute function; the `student_skill_mastery` row schema, lifecycle, and exposed-field contract; the canonical position-assignment SQL; the `constants_snapshot_hash` computation rule; the diagnostic seeding contract; the permanent stress-test fixture; and the pre-implementation Supabase verification gate. |
| **Audience** | Engineering, AI, Product, Data, Security, QA, Ops |
| **Governed by** | Doc 05 Parent V1.0 (Locked 2026-05-13, RB-05P-V1-01..14) |
| **Depends on** | Doc 00 · Doc 01 · Doc 02 Preamble V3.0 · Doc 02A V6 · Doc 02B V4 · Doc 04 Parent V3.0 · Doc 04A V2.2 · Doc 04C V1.0 |
| **Sibling sub-docs** | 05B (Domain Mastery & KPI Rollups), 05C (Score Projections & Snapshots), 05D (Mastery Audit, Recompute & Constants Governance) |
| **Superseded** | None at the V1 boundary — 05A is a clean-slate sub-doc of the locked Parent. Legacy `apply_learning_event_to_mastery` and `upsert_skill_mastery` RPCs (EMA / Bayesian shapes) are explicitly NOT V1.0 contracts; 05A defines the V1.0 replacement. |

---

## **1\. Purpose**

Doc 05A is the implementation contract for skill-level mastery. It takes Parent V1.0's doctrine (the macro-average formula with per-source clamp, the 5-event threshold, the position-based recency, the source/difficulty weights) and locks it into executable SQL functions, row schemas, and audit-grade write paths.

This document defines:

* **The generic formula function** `compute_mastery_for_entity(...)`. Per Parent V1.0 Q5/Option A locked decision, this is a single SQL function reused by both 05A (skill mastery) and 05B (domain mastery), parameterized by the entity filter.  
* **The event-time mastery write RPC** `apply_mastery_event(...)`. The single canonical entry point for upstream answer-event commits to land mastery state. Invoked by Doc 02 (practice/review) and Doc 04 (full-length, post-finalization).  
* **The per-skill recompute function** `recompute_skill_mastery(student_id, skill_id)`. Truncates the derived skill mastery state and replays the canonical event history through the same formula function. Used by 05D's audit/recompute lifecycle. Per Parent §8, the recompute path MUST produce values byte-identical to the event-time path for the same event history.  
* **The `student_skill_mastery` row schema, lifecycle, and RLS policies.** Including the exposed-field contract per Parent acceptance criterion \#20 (RB-05P-V1-14): student/guardian routes see only `mastery_level`; the numeric `mastery_score` and `mastery_pct` are admin/internal/audit-only.  
* **The canonical position-assignment SQL.** The window function pattern with the locked `(occurred_at DESC, event_id DESC)` tiebreaker.  
* **The `constants_snapshot_hash` computation rule.** Stable hash of `mastery_constants` table contents at write time, populated on every mastery row per Parent §9.5 (RB-05P-V1-08).  
* **The diagnostic seeding contract.** 40-question diagnostic \= 8 SAT domains × 5 events per domain (per RB-05P-V1-13). Diagnostic questions are regular practice events; mastery sees no special source type.  
* **The pre-implementation verification gate** (per Parent §19.5 / RB-05P-V1-11). What 05A's implementation MUST verify against the installed Supabase state before any production cutover.  
* **The permanent stress-test fixture.** The 23 baseline scenarios from Parent's formula validation, plus 8 sparse-test scenarios per RB-05P-V1-07, encoded as executable test cases with expected mastery values to 6 decimals.

Doc 05A does NOT define:

* The domain mastery row schema or refresh contract — owned by 05B.  
* The section projection schema or formula — owned by 05C.  
* The KPI rollup table schemas — owned by 05B.  
* The audit log table schemas, recompute orchestration, or constants governance lifecycle — owned by 05D.  
* The diagnostic flow (which questions, in what order, with what UX) — owned by Doc 02B. 05A only defines what mastery sees: practice events with skill/domain/difficulty metadata.

---

## **2\. Doctrine (Sub-Doc Level)**

Doc 05A inherits Parent V1.0's 6 doctrinal principles in full:

1. **Mastery is an indicator, not a prediction.**  
2. **Mastery comes from proven events only.**  
3. **Mastery is server-authoritative.**  
4. **Mastery is deterministic.**  
5. **Mastery is auditable.**  
6. **Mastery surfaces respect anti-leak.**

In addition, 05A locks four sub-doc-level principles specific to the RPC and row contract:

### **2.1 Idempotency is mandatory at the RPC boundary**

Every `apply_mastery_event` invocation MUST be idempotent on the upstream event identifier. The same upstream event\_id submitted twice MUST produce one mastery transition, not two. This is enforced via a unique constraint on the mastery audit log per Parent §6.2 and §6.3, and via the RPC's pre-write deduplication check.

### **2.2 The formula function is the single source of truth for the formula**

The macro-average formula defined in Parent §4.1 is implemented as exactly one SQL function: `compute_mastery_for_entity(...)`. No other code path — including the recompute path, the domain refresh path, batch jobs, ad-hoc queries, or test fixtures — may re-implement the formula. Drift between event-time and recompute paths is forbidden by construction because both paths call the same function.

### **2.3 Constants are read at write time, hashed, and persisted with the row**

Per Parent §9.5 (RB-05P-V1-08), every `student_skill_mastery` row carries a `constants_snapshot_hash` populated at write time. The RPC reads `mastery_constants`, computes the hash, and writes it alongside the row in the same transaction. Audits can answer "this row was computed under exactly these constants" by joining the row's hash to the `constants_audit_log` history.

### **2.4 The exposed-field contract is enforced at the row level, not just the route level**

Per Parent acceptance criterion \#20 (RB-05P-V1-14), student-role and guardian-role routes MUST NOT return `mastery_score` or `mastery_pct`. 05A enforces this in two layers (RB-05A-V1-19):

1. **Student routes** may SELECT only the safe student-self columns `(student_id, section, domain, skill, mastery_level, computed_at)`. The `authenticated_student_read` RLS policy in §7.3 scopes rows to `auth.uid()`, and the column-level GRANTs in §7.4 restrict the `authenticated` role's SELECT to the safe column subset. Even if a route layer bug constructs `SELECT mastery_score FROM student_skill_mastery WHERE student_id = me`, Postgres rejects the column reference at the role-grant layer.  
2. **Guardians have NO SELECT policy on `student_skill_mastery`**, so guardian queries return zero rows regardless of column projection. Guardian aggregate access is owned by 05B (domain mastery) and 05C (section projection); per Parent acceptance criterion \#19, guardians never see per-skill mastery rows.

This is a defense-in-depth measure: row-level RLS \+ column-level GRANTs \+ route-layer projection. Failure in any single layer is caught by the other two.

---

## **3\. Hard Invariants**

Doc 05A enforces 12 hard invariants. Invariants 1–9 are inherited from Parent §6 and apply to all Doc 05 sub-docs; 10–12 are 05A-specific.

### **3.1 Invariants inherited from Parent §6**

| \# | Invariant | Parent ref | 05A enforcement |
| ----- | ----- | ----- | ----- |
| 1 | Service-role-only writes | Parent §6.1 | RLS policy `student_skill_mastery_service_only_write`; CI test `test_skill_mastery_authenticated_write_denied` |
| 2 | Single canonical write path per surface | Parent §6.2 | CI grep guard: only `apply_mastery_event` and `recompute_skill_mastery` may write `student_skill_mastery` |
| 3 | Deterministic recompute | Parent §6.3 | Test `test_recompute_equivalence`: replay event history, assert row-for-row equality with event-time output |
| 4 | Tutor never writes mastery | Parent §6.4 | CI grep guard: no path under `apps/tutor/**` may import the mastery write functions |
| 5 | Full-length post-finalization only | Parent §6.5 | RPC validation: `source_family = 'test'` requires `p_section_state = 'submitted'`; rejected otherwise |
| 6 | NULL for cold start / below threshold | Parent §6.6 | RPC sets `mastery_score IS NULL` when `total_events < MIN_EVENTS_FOR_MASTERY` |
| 7 | Versioned constants, never silent | Parent §6.7 | Every write reads `mastery_constants`, computes `constants_snapshot_hash`, persists alongside the row |
| 8 | No predicted scores, no AI confidence | Parent §6.8 | Row schema has no `predicted_score`, `confidence`, or `probability` column. CI grep against forbidden names. |
| 9 | Audit lifecycle separation from Doc 04D | Parent §6.9 | 05A writes to 05D-owned audit tables only, never to Doc 04D audit tables |

### **3.2 05A-specific invariants**

### **INV-05A-10 — Idempotency at the upstream event identity**

The mastery write RPC MUST be idempotent on `(event_source_kind, event_id)`. A duplicate submission with the same upstream event identity returns the existing mastery row state without writing again. Enforced via (a) an event-level advisory lock acquired before the audit-log read (RB-05A-V1-01), (b) a unique index on the mastery audit log's `(event_source_kind, event_id)` pair, and (c) a unique-violation handler in the audit insert that interprets the violation as completed idempotent re-entry rather than failure (RB-05A-V1-10).

### **INV-05A-11 — The formula function has a single implementation**

The macro-average formula MUST be implemented in exactly one SQL function: `compute_mastery_for_entity`. Any other implementation — even one that produces identical output — is a violation. Enforced via CI grep guard against ad-hoc occurrences of the formula's hallmark expressions (`weight_source_test`, `MIN(1.0,`, `position_weight`, etc.) outside the canonical function definition file.

### **INV-05A-12 — The exposed-field contract is enforced at the row layer**

Student-role SELECT policies on `student_skill_mastery` are scoped to the authenticated student's own rows. Guardians have **no** SELECT policy on this table — per Parent acceptance criterion \#19, guardian access is domain-aggregate-only via 05B's tables, not per-skill. Column-level grants further restrict the authenticated role to `(student_id, section, domain, skill, mastery_level, computed_at)` only; the columns `mastery_score`, `mastery_pct`, `acc_test`, `acc_practice`, `acc_review`, `event_count_total`, `last_event_id`, `last_event_occurred_at`, `mastery_model_version`, and `constants_snapshot_hash` are NOT accessible via any non-admin/non-service role. Enforced via the absence of `student_skill_mastery_guardian_read` policy AND via PostgreSQL column-level grants AND via route-layer projection; tested via `test_guardian_role_cannot_select_skill_mastery` and `test_student_role_cannot_select_mastery_score`. \<\!-- RB-05A-V1-02 \--\>

---

## **4\. The Mastery RPC Contract: `apply_mastery_event`**

`apply_mastery_event` is the single canonical entry point for upstream answer-event commits to land mastery state. Upstream Doc 02 (practice/review) and Doc 04 (full-length, post-finalization) invoke this function within the same database transaction as their canonical answer-event commit.

### **4.1 Function signature**

CREATE OR REPLACE FUNCTION public.apply\_mastery\_event(  
    p\_student\_id            uuid,  
    p\_section               text,            \-- 'M' or 'RW'  
    p\_domain                text,            \-- canonical SAT domain string per Doc 02  
    p\_skill                 text,            \-- canonical SAT skill string per Doc 02  
    p\_difficulty            smallint,        \-- 1 (easy), 2 (medium), 3 (hard)  
    p\_source\_family         text,            \-- 'practice', 'review', or 'test' (formula-facing)  
    p\_event\_source\_kind     text,            \-- table-of-origin precision; see §4.2 Step 2  
    p\_correct               boolean,  
    p\_occurred\_at           timestamptz,     \-- when the answer was given  
    p\_event\_id              uuid,            \-- upstream event identifier (idempotency key)  
    p\_question\_id           uuid,            \-- canonical question identifier  
    p\_section\_state         text DEFAULT NULL  \-- required when p\_source\_family \= 'test'; must be 'submitted'  
)  
RETURNS public.student\_skill\_mastery  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_constants            jsonb;  
    v\_constants\_hash       text;  
    v\_active\_version       text;  
    v\_existing\_audit\_row   uuid;  
    v\_before\_score         numeric;     \-- captured under lock for audit (RB-05A-V1-06)  
    v\_before\_level         smallint;    \-- captured under lock for audit (RB-05A-V1-06)  
    v\_total\_events         integer;  
    v\_acc\_test             numeric;  
    v\_acc\_practice         numeric;  
    v\_acc\_review           numeric;  
    v\_mastery\_score        numeric;  
    v\_mastery\_pct          numeric;  
    v\_mastery\_level        smallint;  
    v\_result\_row           public.student\_skill\_mastery;  
BEGIN  
    \-- See §4.2 through §4.10 for the full body.  
    \-- This signature block establishes the contract; the body is specified  
    \-- in subsequent subsections.  
    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.apply\_mastery\_event FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.apply\_mastery\_event TO service\_role;

**Upstream insert ordering precondition (RB-05A-V1-08 / HIGH1).** The caller MUST durably insert the upstream answer event into its canonical source table *before* invoking `apply_mastery_event`. If the caller invokes the RPC inside the same database transaction as the upstream insert, the insert MUST occur earlier in that transaction so that `canonical_mastery_events` can see it. The RPC does not accept its input parameters as sufficient evidence; it recomputes mastery from the canonical event history visible to it at call time. Calling the RPC before the upstream event is visible would silently produce mastery state that excludes the current event. Doc 02B (practice/review write paths) and Doc 04 (full-length finalization path) are the authorized callers and MUST satisfy this ordering.

**On `p_source_family` vs `p_event_source_kind`** (RB-05A-V1-10 / HIGH3). The formula consumes only the coarser `source_family` enum (`test`, `practice`, `review`) because the source-weight constants are defined at that granularity. The audit log and idempotency dedup index use the finer `event_source_kind` enum to guarantee that UUIDs originating from different upstream tables cannot collide in the dedup key. Allowed values for `event_source_kind`:

| `event_source_kind` | Maps to `source_family` |
| ----- | ----- |
| `practice_attempt` | `practice` |
| `diagnostic_attempt` | `practice` (per §11.4: diagnostics are regular practice events) |
| `review_error_attempt` | `review` |
| `full_length_answer` | `test` |

The mapping is enforced in §4.2 Step 2's cross-field validation. The audit log's unique constraint is `(event_source_kind, event_id)`; the dedup lock in §4.3 hashes `(event_source_kind, event_id)`. UUID collisions across distinct upstream tables are astronomically improbable with `gen_random_uuid()`, but the narrower key removes the assumption from the contract.

The function is `SECURITY DEFINER` because it must write `student_skill_mastery` rows that no role other than `service_role` may write. The `search_path` is locked to prevent search-path injection. Execute permission is restricted to `service_role` only.

### **4.2 Input validation (executed in this order)**

The RPC validates inputs in a fixed order. Any validation failure raises a `MASTERY_VALIDATION_FAILED` exception with a structured detail object identifying which check failed.

Step 1: Required-field check  
  \- p\_student\_id IS NOT NULL  
  \- p\_section IS NOT NULL  
  \- p\_domain IS NOT NULL  
  \- p\_skill IS NOT NULL  
  \- p\_difficulty IS NOT NULL  
  \- p\_source\_family IS NOT NULL  
  \- p\_event\_source\_kind IS NOT NULL  
  \- p\_correct IS NOT NULL  
  \- p\_occurred\_at IS NOT NULL  
  \- p\_event\_id IS NOT NULL  
  \- p\_question\_id IS NOT NULL

Step 2: Enum validation  
  \- p\_section ∈ {'M', 'RW'}  
  \- p\_difficulty ∈ {1, 2, 3}                  \-- Parent §11.2 / RB-05P-V1-06  
  \- p\_source\_family ∈ {'practice', 'review', 'test'}  
  \- p\_event\_source\_kind ∈ {'practice\_attempt', 'diagnostic\_attempt',  
                            'review\_error\_attempt', 'full\_length\_answer'}  
  \- (p\_event\_source\_kind, p\_source\_family) MUST satisfy the mapping table in §4.1:  
        practice\_attempt    → practice  
        diagnostic\_attempt  → practice  
        review\_error\_attempt → review  
        full\_length\_answer  → test  
    Any mismatch raises MASTERY\_SOURCE\_KIND\_FAMILY\_MISMATCH.

Step 3: Cross-field consistency  
  \- If p\_source\_family \= 'test' THEN p\_section\_state IS NOT NULL AND p\_section\_state \= 'submitted'  
    \-- Parent §11.4 / RB-05P-V1-04: full-length mastery requires submitted-section state  
  \- p\_occurred\_at \<= now() \+ interval '5 minutes'  
    \-- 5-minute clock skew tolerance; events further in the future are rejected

Step 4: Domain/skill canonicality (consultative; non-blocking in V1.0)  
  \- p\_domain SHOULD match one of the 8 canonical SAT domains per Parent §10.2  
  \- p\_skill SHOULD match a known skill per Doc 02  
  \- Mismatches log a warning but do not block the write in V1.0 (Doc 02 owns enforcement)

### **4.3 Idempotency check (event-level lock \+ audit lookup)**

Before computing anything, the RPC ensures that two concurrent submissions of the same upstream event cannot both compute and write. Per INV-05A-10, the dedup key is `(event_source_kind, event_id)` (RB-05A-V1-20).

**Why an event-level lock comes first.** Without it, a naïve check-then-write produces a TOCTOU race: two concurrent calls with the same event both read "no audit row," both proceed to compute, both attempt to write the audit row, and one fails with a unique-violation. That's wasted compute and a wrong error code. Locking on the event identity before any other work makes the second call wait, then find the audit row, and return idempotently. \<\!-- RB-05A-V1-01 \--\>

\-- Step 1: acquire an event-level advisory lock keyed by (event\_source\_kind, event\_id).  
\-- This serializes concurrent submissions of the SAME upstream event.  
\-- (The student-skill advisory lock acquired in §4.4 serializes concurrent  
\--  submissions of DIFFERENT events to the same student-skill pair. Both  
\--  locks are needed.)  
SET LOCAL lock\_timeout \= '5s';

BEGIN  
    PERFORM pg\_advisory\_xact\_lock(  
        hashtext('mastery\_event|' || p\_event\_source\_kind || '|' || p\_event\_id::text)  
    );  
EXCEPTION  
    WHEN lock\_not\_available OR query\_canceled THEN  
        RAISE EXCEPTION 'MASTERY\_LOCK\_TIMEOUT: could not acquire event-level lock for (%, %) within 5 seconds',  
            p\_event\_source\_kind, p\_event\_id;  
END;

\-- Step 2: now that we hold the event-level lock, the audit-log check is race-free.  
\-- If a prior call for this same event committed, its audit row is visible here.  
\-- The dedup key (event\_source\_kind, event\_id) avoids any cross-table UUID  
\-- collision concern (RB-05A-V1-10).  
SELECT skill\_mastery\_row\_id INTO v\_existing\_audit\_row  
FROM mastery\_event\_audit\_log              \-- owned by 05D  
WHERE event\_source\_kind \= p\_event\_source\_kind  
  AND event\_id          \= p\_event\_id  
LIMIT 1;

IF v\_existing\_audit\_row IS NOT NULL THEN  
    \-- This event was already processed. Return the existing row state  
    \-- without writing again. The caller sees a successful "no-op".  
    SELECT \* INTO v\_result\_row  
    FROM student\_skill\_mastery  
    WHERE student\_id \= p\_student\_id  
      AND section    \= p\_section  
      AND domain     \= p\_domain  
      AND skill      \= p\_skill;  
    RETURN v\_result\_row;  
END IF;

**Belt-and-suspenders rule for §4.8.** Even with the event-level lock above, if the audit insert in §4.8 ever raises `unique_violation` (e.g., from a code path that bypasses the lock), the handler MUST interpret it as "another transaction beat us to it" and return the existing mastery row idempotently. See §4.11. \<\!-- RB-05A-V1-01 \--\>

The `mastery_event_audit_log` table is owned by 05D. Its schema is referenced here; 05D defines the full audit contract. The dedup behavior is locked at the 05A boundary because it affects RPC semantics.

### **4.4 Acquire student-skill advisory transaction lock**

To prevent concurrent writes from producing inconsistent state, the RPC acquires a **student-skill advisory transaction lock** (via `pg_advisory_xact_lock`, not a row-level `SELECT ... FOR UPDATE`) keyed by `hashtext(student_id || section || domain || skill)`. The advisory lock auto-releases at transaction end and serializes any other transaction attempting to write the same `(student, section, domain, skill)` mastery row. The lock is bounded by an explicit transaction-local `lock_timeout`; if the lock cannot be acquired within 5 seconds, the function raises `MASTERY_LOCK_TIMEOUT` and the caller can retry. (RB-05A-V1-23)

\-- Bound the lock wait to 5 seconds, transaction-local so it does not leak  
\-- to other code paths on the same connection.  
\-- \<\!-- RB-05A-V1-07: explicit lock\_timeout enforcement \--\>  
SET LOCAL lock\_timeout \= '5s';

BEGIN  
    PERFORM pg\_advisory\_xact\_lock(  
        hashtext(p\_student\_id::text || '|' || p\_section || '|' || p\_domain || '|' || p\_skill)  
    );  
EXCEPTION  
    WHEN lock\_not\_available OR query\_canceled THEN  
        RAISE EXCEPTION 'MASTERY\_LOCK\_TIMEOUT: could not acquire advisory lock for (%, %, %, %) within 5 seconds',  
            p\_student\_id, p\_section, p\_domain, p\_skill;  
END;

`pg_advisory_xact_lock` itself blocks indefinitely; the bounded behavior comes from `SET LOCAL lock_timeout`, which converts the indefinite wait into a `lock_not_available` exception at the timeout boundary. The exception handler then surfaces a structured error code per §4.11. Two concurrent invocations with the same identifiers serialize at this point; lock auto-releases at transaction end.

### **4.5 Read constants and compute snapshot hash**

The RPC reads the active `mastery_constants` and computes the canonical hash of the constants snapshot. This hash is persisted alongside the row per INV-05A-11.

v\_constants := public.canonicalize\_mastery\_constants();           \-- jsonb for in-SQL use  
v\_constants\_hash := encode(  
    digest(public.canonicalize\_mastery\_constants\_serialized(), 'sha256'),  \-- text for hashing  
    'hex'  
);  
v\_active\_version := v\_constants-\>\>'mastery\_model\_version';   \-- e.g., 'v1.0'

The `canonicalize_mastery_constants()` function returns a JSONB object with keys sorted lexicographically, no whitespace, and only the keys that affect formula output. The exact contract is in §9.

### **4.6 Compute skill mastery via the formula function**

The RPC invokes `compute_mastery_for_entity` (defined in §6) with the entity filter set to the target `(student, skill)`. The formula function returns all values needed for the row: per-source accuracies, total event count, and the final mastery\_score.

SELECT  
    total\_events,  
    acc\_test,  
    acc\_practice,  
    acc\_review,  
    mastery\_score,  
    mastery\_pct,  
    mastery\_level  
INTO  
    v\_total\_events,  
    v\_acc\_test,  
    v\_acc\_practice,  
    v\_acc\_review,  
    v\_mastery\_score,  
    v\_mastery\_pct,  
    v\_mastery\_level  
FROM public.compute\_mastery\_for\_entity(  
    p\_student\_id    \=\> p\_student\_id,  
    p\_entity\_type   \=\> 'skill',  
    p\_section       \=\> p\_section,  
    p\_domain        \=\> p\_domain,  
    p\_skill         \=\> p\_skill  
);

`compute_mastery_for_entity` is pure: same inputs produce the same outputs. It does NOT write any tables. It reads the canonical event history (per Parent §7.1) plus `mastery_constants`, runs the formula, and returns the computed values.

### **4.7 Upsert the mastery row**

Before writing the new row state, the RPC reads the existing row state (if any) so the audit log can capture before/after transitions accurately. This read happens under the advisory lock acquired in §4.4, so the before-state is consistent with the upsert that follows.

\-- Read existing row state for audit purposes (RB-05A-V1-06).  
\-- This must occur AFTER the §4.4 advisory lock and BEFORE the upsert.  
\-- If no row exists, both v\_before\_score and v\_before\_level are NULL,  
\-- which is the correct audit representation of "first event for this entity."  
SELECT  
    mastery\_score, mastery\_level  
INTO  
    v\_before\_score, v\_before\_level  
FROM student\_skill\_mastery  
WHERE student\_id \= p\_student\_id  
  AND section    \= p\_section  
  AND domain     \= p\_domain  
  AND skill      \= p\_skill;

\-- Now perform the upsert with the new computed values.  
INSERT INTO student\_skill\_mastery (  
    student\_id, section, domain, skill,  
    mastery\_score, mastery\_pct, mastery\_level,  
    acc\_test, acc\_practice, acc\_review,  
    event\_count\_total,  
    mastery\_model\_version,  
    constants\_snapshot\_hash,  
    last\_event\_id,  
    last\_event\_occurred\_at,  
    computed\_at  
) VALUES (  
    p\_student\_id, p\_section, p\_domain, p\_skill,  
    v\_mastery\_score, v\_mastery\_pct, v\_mastery\_level,  
    v\_acc\_test, v\_acc\_practice, v\_acc\_review,  
    v\_total\_events,  
    v\_active\_version,  
    v\_constants\_hash,  
    p\_event\_id,  
    p\_occurred\_at,  
    now()  
)  
ON CONFLICT (student\_id, section, domain, skill)  
DO UPDATE SET  
    mastery\_score             \= EXCLUDED.mastery\_score,  
    mastery\_pct               \= EXCLUDED.mastery\_pct,  
    mastery\_level             \= EXCLUDED.mastery\_level,  
    acc\_test                  \= EXCLUDED.acc\_test,  
    acc\_practice              \= EXCLUDED.acc\_practice,  
    acc\_review                \= EXCLUDED.acc\_review,  
    event\_count\_total         \= EXCLUDED.event\_count\_total,  
    mastery\_model\_version     \= EXCLUDED.mastery\_model\_version,  
    constants\_snapshot\_hash   \= EXCLUDED.constants\_snapshot\_hash,  
    last\_event\_id             \= EXCLUDED.last\_event\_id,  
    last\_event\_occurred\_at    \= EXCLUDED.last\_event\_occurred\_at,  
    computed\_at               \= EXCLUDED.computed\_at  
RETURNING \* INTO v\_result\_row;

### **4.8 Write the audit log entry**

Per Parent §6.3 and §6.9, every mastery transition writes an audit row. The audit row links to the upstream event via `(event_source_kind, event_id)` for idempotency enforcement (INV-05A-10), and captures the before/after state for replay-based audits. (RB-05A-V1-20)

INSERT INTO mastery\_event\_audit\_log (  
    audit\_row\_id,                  \-- generated uuid  
    student\_id, section, domain, skill,  
    source\_family, event\_source\_kind, event\_id, question\_id,  
    difficulty, correct, occurred\_at,  
    mastery\_score\_before, mastery\_score\_after,  
    mastery\_level\_before, mastery\_level\_after,  
    event\_count\_after,  
    constants\_snapshot\_hash,  
    mastery\_model\_version,  
    applied\_at  
) VALUES (  
    gen\_random\_uuid(),  
    p\_student\_id, p\_section, p\_domain, p\_skill,  
    p\_source\_family, p\_event\_source\_kind, p\_event\_id, p\_question\_id,  
    p\_difficulty, p\_correct, p\_occurred\_at,  
    v\_before\_score,                 \-- captured under lock in §4.7 (RB-05A-V1-06)  
    v\_mastery\_score,  
    v\_before\_level,                 \-- captured under lock in §4.7 (RB-05A-V1-06)  
    v\_mastery\_level,  
    v\_total\_events,  
    v\_constants\_hash,  
    v\_active\_version,  
    now()  
);

The `mastery_event_audit_log` table is owned by 05D. Its full schema (including the `(event_source_kind, event_id)` unique constraint that enforces INV-05A-10) is specified in 05D. The 05A RPC writes to this table by contract; 05D guarantees its presence and shape. (RB-05A-V1-20)

### **4.9 Trigger downstream refreshes**

After the skill mastery row is written, 05A's RPC calls 05B's domain refresh and (transitively) 05C's projection refresh, all within the same transaction per Parent §7.8.

PERFORM public.refresh\_domain\_mastery(  
    p\_student\_id \=\> p\_student\_id,  
    p\_section    \=\> p\_section,  
    p\_domain     \=\> p\_domain  
);  
\-- refresh\_domain\_mastery internally calls refresh\_section\_projection

If any downstream refresh fails, the entire transaction rolls back: there is no partial mastery state. This rule is enforced at the transaction layer; the RPC does not catch downstream exceptions.

### **4.10 Return the updated row**

The function returns the full `v_result_row`. The caller (typically a route layer) sees the updated skill mastery state. The route layer then projects the row down to the role-appropriate column set per INV-05A-12 before returning to the client.

### **4.11 Error handling**

Errors raised by `apply_mastery_event` are structured. Each error type carries a code, a human-readable message, and a JSONB detail object.

| Error code | When raised | HTTP equivalent |
| ----- | ----- | ----- |
| `MASTERY_VALIDATION_FAILED` | Any §4.2 input validation step fails | 400 |
| `MASTERY_DOMAIN_UNKNOWN_WARN` | §4.2 Step 4 mismatch (logged as warning, NOT raised in V1.0) | n/a |
| `MASTERY_LOCK_TIMEOUT` | §4.4 advisory lock acquisition exceeds 5 seconds | 503 |
| `MASTERY_CONSTANTS_MISSING` | §4.5 cannot read required keys from `mastery_constants` | 500 |
| `MASTERY_COMPUTE_FAILED` | §4.6 `compute_mastery_for_entity` raises | 500 |
| `MASTERY_AUDIT_WRITE_FAILED` | §4.8 audit log insert fails for reasons OTHER than unique violation | 500 |

**Note on `unique_violation` at §4.8.** Per RB-05A-V1-01, a unique-violation on the audit insert is NOT raised as an error. The handler interprets it as a race-completed idempotent re-entry: the function rolls back its own write attempt, re-reads the existing `student_skill_mastery` row, and returns it as if the original call had been a duplicate. The caller sees a successful 200 response with the existing state. The §4.3 event-level lock makes this path rare, but the defense exists for any code path that bypasses the lock.

\-- Inside §4.8's audit insert block:  
EXCEPTION  
    WHEN unique\_violation THEN  
        \-- Race-completed idempotent re-entry. Read existing state and return.  
        SELECT \* INTO v\_result\_row  
        FROM student\_skill\_mastery  
        WHERE student\_id \= p\_student\_id  
          AND section \= p\_section  
          AND domain \= p\_domain  
          AND skill \= p\_skill;  
        RETURN v\_result\_row;  
END;

| `MASTERY_DOWNSTREAM_REFRESH_FAILED` | §4.9 domain or projection refresh raises | 500 |

All errors cause transaction rollback. The caller sees no partial state.

---

## **5\. The Recompute Function: `recompute_skill_mastery`**

`recompute_skill_mastery` is the sibling of `apply_mastery_event`. It exists to support 05D's audit, batch recompute, and constants-change lifecycles. Per Parent §8, it MUST produce values byte-identical to the event-time path for the same canonical event history.

### **5.1 Function signature**

CREATE OR REPLACE FUNCTION public.recompute\_skill\_mastery(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_domain      text,  
    p\_skill       text  
)  
RETURNS public.student\_skill\_mastery  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_constants            jsonb;  
    v\_constants\_hash       text;  
    v\_active\_version       text;  
    v\_total\_events         integer;  
    v\_acc\_test             numeric;  
    v\_acc\_practice         numeric;  
    v\_acc\_review           numeric;  
    v\_mastery\_score        numeric;  
    v\_mastery\_pct          numeric;  
    v\_mastery\_level        smallint;  
    v\_result\_row           public.student\_skill\_mastery;  
BEGIN  
    \-- Bound lock wait identically to apply\_mastery\_event (§4.4 / RB-05A-V1-07)  
    SET LOCAL lock\_timeout \= '5s';

    BEGIN  
        PERFORM pg\_advisory\_xact\_lock(  
            hashtext(p\_student\_id::text || '|' || p\_section || '|' || p\_domain || '|' || p\_skill)  
        );  
    EXCEPTION  
        WHEN lock\_not\_available OR query\_canceled THEN  
            RAISE EXCEPTION 'MASTERY\_LOCK\_TIMEOUT: could not acquire advisory lock for recompute of (%, %, %, %) within 5 seconds',  
                p\_student\_id, p\_section, p\_domain, p\_skill;  
    END;

    \-- Read constants identically to §4.5  
    v\_constants := public.canonicalize\_mastery\_constants();  
    v\_constants\_hash := encode(  
        digest(public.canonicalize\_mastery\_constants\_serialized(), 'sha256'),  
        'hex'  
    );  
    v\_active\_version := v\_constants-\>\>'mastery\_model\_version';

    \-- Run the formula function identically to §4.6  
    SELECT  
        total\_events, acc\_test, acc\_practice, acc\_review,  
        mastery\_score, mastery\_pct, mastery\_level  
    INTO  
        v\_total\_events, v\_acc\_test, v\_acc\_practice, v\_acc\_review,  
        v\_mastery\_score, v\_mastery\_pct, v\_mastery\_level  
    FROM public.compute\_mastery\_for\_entity(  
        p\_student\_id    \=\> p\_student\_id,  
        p\_entity\_type   \=\> 'skill',  
        p\_section       \=\> p\_section,  
        p\_domain        \=\> p\_domain,  
        p\_skill         \=\> p\_skill  
    );

    \-- Upsert the row identically to §4.7 EXCEPT:  
    \--   \- last\_event\_id and last\_event\_occurred\_at carry whatever the  
    \--     most-recent canonical event for this entity is, not a specific  
    \--     parameter (since recompute is not driven by a single event)  
    \--   \- The function does NOT write an audit log entry (this is a  
    \--     state recomputation, not an event application)  
    \--   \- The function DOES still trigger downstream refreshes, because  
    \--     downstream tables must stay consistent with the new skill state.  
    INSERT INTO student\_skill\_mastery (  
        student\_id, section, domain, skill,  
        mastery\_score, mastery\_pct, mastery\_level,  
        acc\_test, acc\_practice, acc\_review,  
        event\_count\_total,  
        mastery\_model\_version,  
        constants\_snapshot\_hash,  
        last\_event\_id,  
        last\_event\_occurred\_at,  
        computed\_at  
    )  
    SELECT  
        p\_student\_id, p\_section, p\_domain, p\_skill,  
        v\_mastery\_score, v\_mastery\_pct, v\_mastery\_level,  
        v\_acc\_test, v\_acc\_practice, v\_acc\_review,  
        v\_total\_events,  
        v\_active\_version,  
        v\_constants\_hash,  
        ce.event\_id,             \-- most-recent canonical event for this entity  
        ce.occurred\_at,  
        now()  
    FROM public.canonical\_mastery\_events(  
        p\_student\_id, 'skill', p\_section, p\_domain, p\_skill  
    ) ce  
    ORDER BY ce.occurred\_at DESC, ce.event\_id DESC  
    LIMIT 1                      \-- pick the most-recent event as the row's anchor  
    ON CONFLICT (student\_id, section, domain, skill)  
    DO UPDATE SET  
        mastery\_score             \= EXCLUDED.mastery\_score,  
        mastery\_pct               \= EXCLUDED.mastery\_pct,  
        mastery\_level             \= EXCLUDED.mastery\_level,  
        acc\_test                  \= EXCLUDED.acc\_test,  
        acc\_practice              \= EXCLUDED.acc\_practice,  
        acc\_review                \= EXCLUDED.acc\_review,  
        event\_count\_total         \= EXCLUDED.event\_count\_total,  
        mastery\_model\_version     \= EXCLUDED.mastery\_model\_version,  
        constants\_snapshot\_hash   \= EXCLUDED.constants\_snapshot\_hash,  
        last\_event\_id             \= EXCLUDED.last\_event\_id,  
        last\_event\_occurred\_at    \= EXCLUDED.last\_event\_occurred\_at,  
        computed\_at               \= EXCLUDED.computed\_at  
    RETURNING \* INTO v\_result\_row;

    \-- Edge case: if canonical\_mastery\_events returns zero rows (e.g., events were  
    \-- deleted after a row existed), the INSERT above writes zero rows. In that case,  
    \-- the existing row's mastery values should be set to NULL (insufficient evidence  
    \-- state). Handle this explicitly:  
    IF v\_result\_row.student\_id IS NULL THEN  
        UPDATE student\_skill\_mastery  
        SET mastery\_score \= NULL,  
            mastery\_pct   \= NULL,  
            mastery\_level \= NULL,  
            acc\_test \= NULL, acc\_practice \= NULL, acc\_review \= NULL,  
            event\_count\_total \= 0,  
            mastery\_model\_version   \= v\_active\_version,  
            constants\_snapshot\_hash \= v\_constants\_hash,  
            computed\_at             \= now()  
        WHERE student\_id \= p\_student\_id  
          AND section    \= p\_section  
          AND domain     \= p\_domain  
          AND skill      \= p\_skill  
        RETURNING \* INTO v\_result\_row;  
    END IF;

    PERFORM public.refresh\_domain\_mastery(p\_student\_id, p\_section, p\_domain);

    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.recompute\_skill\_mastery FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.recompute\_skill\_mastery TO service\_role;

### **5.2 Recompute return contract (RB-05A-V1-11 / HIGH4)**

`recompute_skill_mastery` returns one `student_skill_mastery` row per call. The exact return semantics:

| Canonical events present | Existing row exists | Returned row state |
| ----- | ----- | ----- |
| ≥ MIN\_EVENTS\_FOR\_MASTERY | yes or no | Row with computed `mastery_score`, `mastery_pct`, `mastery_level`, per-source accuracies, `event_count_total` ≥ 5 |
| 1 to MIN\_EVENTS\_FOR\_MASTERY − 1 | yes | Row updated to insufficient-evidence state: `mastery_score = NULL`, `mastery_pct = NULL`, `mastery_level = NULL`, `event_count_total` \= actual count |
| 1 to MIN\_EVENTS\_FOR\_MASTERY − 1 | no | New row inserted with insufficient-evidence state and `event_count_total` \= actual count |
| 0 (no canonical events) | yes | Row updated to zero-event state: all mastery and accuracy fields NULL, `event_count_total = 0`. The row is retained because deletion would lose audit linkage. |
| 0 (no canonical events) | no | No-op: function returns a row with `student_id` IS NULL to signal "no recompute necessary." Caller MUST handle this as "no row exists for this entity." |

This matrix ensures the function's `RETURNS public.student_skill_mastery` signature is honored in every case, and that callers can distinguish "row exists in insufficient-evidence state" from "no row at all." The zero-events-no-row case is the only one that returns a sentinel row; all others either insert or update.

### **5.3 The recompute equivalence guarantee**

Per Parent §8.2 and INV-05A-11, the following test MUST pass in CI:

Given a fixture event history H for student U and skill S:

1. Apply H one event at a time via `apply_mastery_event` (event-time path). Capture the resulting `student_skill_mastery` row R\_event.  
2. Truncate `student_skill_mastery` for `(U, S)`. Call `recompute_skill_mastery(U, ..., S)` (recompute path). Capture R\_recompute.  
3. Assert R\_event and R\_recompute are equal up to documented rounding precision on every column EXCEPT `computed_at`, `last_event_id`, and `last_event_occurred_at` (which capture wall-clock and most-recent-event info that legitimately differ between paths).

The two paths share the formula function, the position-assignment SQL, the constants read, and the row schema. The equivalence is structural, not a happy coincidence.

### **5.4 When recompute is invoked**

`recompute_skill_mastery` is invoked by:

* **05D's batch recompute job**, when a constants change requires re-deriving existing mastery rows.  
* **05D's admin recompute endpoint**, when an operator suspects mastery drift for a specific student-skill.  
* **05D's audit replay tooling**, when validating that a sequence of historical events produces a known mastery state.

`recompute_skill_mastery` is NOT invoked by the event-time path. Upstream Doc 02 / Doc 04 always call `apply_mastery_event`. The two functions are siblings, not alternatives.

---

## **6\. The Generic Formula Function: `compute_mastery_for_entity`**

`compute_mastery_for_entity` is the single SQL implementation of the macro-average formula locked in Parent §4.1. It is shared between 05A (skill mastery) and 05B (domain mastery) per Q5/Option A.

### **6.1 Function signature**

CREATE OR REPLACE FUNCTION public.compute\_mastery\_for\_entity(  
    p\_student\_id   uuid,  
    p\_entity\_type  text,             \-- 'skill' or 'domain'  
    p\_section      text,  
    p\_domain       text,  
    p\_skill        text DEFAULT NULL \-- required when p\_entity\_type \= 'skill'  
)  
RETURNS TABLE (  
    total\_events      integer,  
    acc\_test          numeric,  
    acc\_practice      numeric,  
    acc\_review        numeric,  
    mastery\_score     numeric,  
    mastery\_pct       numeric,  
    mastery\_level     smallint  
)  
LANGUAGE plpgsql  
STABLE                       \-- pure function: no writes, same input → same output  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_constants               jsonb;  
    v\_position\_half\_life      numeric;  
    v\_min\_events              integer;  
    v\_w\_test                  numeric;  
    v\_w\_practice              numeric;  
    v\_w\_review                numeric;  
    v\_d\_easy                  numeric;  
    v\_d\_medium                numeric;  
    v\_d\_hard                  numeric;  
    v\_mastery\_min             numeric;  
    v\_mastery\_max             numeric;  
    v\_round\_score\_dec         integer;  
    v\_round\_pct\_dec           integer;  
    v\_round\_acc\_dec           integer;  
    v\_total                   integer;  
    v\_acc\_test                numeric;  
    v\_acc\_practice            numeric;  
    v\_acc\_review              numeric;  
    v\_mastery\_raw             numeric;  
    v\_mastery\_score           numeric;  
    v\_mastery\_pct             numeric;  
    v\_mastery\_level           smallint;  
    \-- Validation counters captured in the same CTE chain (RB-05A-V1-18).  
    v\_bad\_diff                integer;  
    v\_bad\_src                 integer;  
    v\_bad\_section             integer;  
    v\_bad\_correct             integer;  
    v\_bad\_occurred\_at         integer;  
    v\_bad\_event\_id            integer;  
BEGIN  
    \-- Step 0: validate entity-type parameters  
    IF p\_entity\_type NOT IN ('skill', 'domain') THEN  
        RAISE EXCEPTION 'MASTERY\_INVALID\_ENTITY\_TYPE: %', p\_entity\_type;  
    END IF;  
    IF p\_entity\_type \= 'skill' AND p\_skill IS NULL THEN  
        RAISE EXCEPTION 'MASTERY\_SKILL\_REQUIRED: p\_skill must be non-NULL when entity\_type \= skill';  
    END IF;

    \-- Step 1: read the locked constants  
    \-- All formula constants — including rounding precisions and level boundaries —  
    \-- are read from mastery\_constants. No literals are hardcoded in the formula.  
    \-- \<\!-- RB-05A-V1-05: rounding decimals and level boundaries read from constants \--\>  
    v\_constants := public.canonicalize\_mastery\_constants();

    v\_position\_half\_life := (v\_constants-\>\>'POSITION\_HALF\_LIFE')::numeric;  
    v\_min\_events         := (v\_constants-\>\>'MIN\_EVENTS\_FOR\_MASTERY')::integer;  
    v\_w\_test             := (v\_constants-\>\>'weight\_source\_test')::numeric;  
    v\_w\_practice         := (v\_constants-\>\>'weight\_source\_practice')::numeric;  
    v\_w\_review           := (v\_constants-\>\>'weight\_source\_review')::numeric;  
    v\_d\_easy             := (v\_constants-\>\>'difficulty\_weight\_easy')::numeric;  
    v\_d\_medium           := (v\_constants-\>\>'difficulty\_weight\_medium')::numeric;  
    v\_d\_hard             := (v\_constants-\>\>'difficulty\_weight\_hard')::numeric;  
    v\_mastery\_min        := (v\_constants-\>\>'mastery\_min')::numeric;  
    v\_mastery\_max        := (v\_constants-\>\>'mastery\_max')::numeric;  
    v\_round\_score\_dec    := (v\_constants-\>\>'ROUND\_MASTERY\_SCORE\_DECIMALS')::integer;  
    v\_round\_pct\_dec      := COALESCE((v\_constants-\>\>'ROUND\_MASTERY\_PCT\_DECIMALS')::integer, 2);  
    v\_round\_acc\_dec      := (v\_constants-\>\>'ROUND\_ACCURACY\_DECIMALS')::integer;

    \-- Defensive: any missing key in the canonical hash list is a setup failure.  
    IF v\_position\_half\_life IS NULL OR v\_min\_events IS NULL  
       OR v\_w\_test IS NULL OR v\_w\_practice IS NULL OR v\_w\_review IS NULL  
       OR v\_d\_easy IS NULL OR v\_d\_medium IS NULL OR v\_d\_hard IS NULL  
       OR v\_mastery\_min IS NULL OR v\_mastery\_max IS NULL  
       OR v\_round\_score\_dec IS NULL OR v\_round\_acc\_dec IS NULL THEN  
        RAISE EXCEPTION 'MASTERY\_CONSTANTS\_MISSING: one or more required constants are absent from mastery\_constants';  
    END IF;

    \-- Step 2: assemble the entity-filtered event view and compute per-source accuracies  
    \-- in a single CTE chain. See §8 for the position-assignment SQL pattern.  
    \-- Validation counters are computed in the same chain (RB-05A-V1-18) so they  
    \-- can be captured by the same SELECT INTO; otherwise the prior PERFORM/RAISE  
    \-- block referenced \`positioned\` outside its CTE scope and would not compile.  
    WITH  
    canonical\_events AS (  
        \-- Pull all answer events for the entity, with metadata denormalized at event time.  
        \-- See Parent §11.2 (denormalization rule) and §11.4 (Doc 04 seam).  
        \-- This view is constructed from upstream canonical tables; see §6.2 for the full SQL.  
        SELECT \* FROM public.canonical\_mastery\_events(  
            p\_student\_id, p\_entity\_type, p\_section, p\_domain, p\_skill  
        )  
    ),  
    positioned AS (  
        SELECT  
            ce.\*,  
            ROW\_NUMBER() OVER (  
                ORDER BY ce.occurred\_at DESC, ce.event\_id DESC  
            ) AS pos                              \-- 1-based: pos=1 is most recent  
        FROM canonical\_events ce  
    ),  
    \-- Validation CTE: counts of rows violating each invariant. Used by the  
    \-- IF FOUND check after the SELECT INTO. (RB-05A-V1-17 \+ RB-05A-V1-18 \+ RB-05A-V1-22.)  
    \-- Bad-data conditions caught here:  
    \--   \- difficulty IS NULL or difficulty NOT IN (1,2,3): would produce NULL d\_w in weighted CTE  
    \--   \- source\_family IS NULL or NOT IN (test,practice,review): undefined source weight  
    \--   \- section IS NULL or NOT IN (M,RW): violates Parent §10.2 enumeration  
    \--   \- correct IS NULL: silently excluded from SUM but counted in total  
    \--   \- occurred\_at IS NULL: PG places NULLs first under DESC, corrupts position  
    \--   \- event\_id IS NULL: breaks position tiebreaker and dedup keying  
    \--  
    \-- IMPORTANT (RB-05A-V1-22): each enum check has an explicit \`IS NULL OR ...\`  
    \-- clause because in PostgreSQL \`NULL NOT IN (...)\` evaluates to NULL (not true),  
    \-- so a bare \`NOT IN\` would silently miss NULL values. The IS NULL disjunct  
    \-- ensures NULL difficulty/source\_family/section are caught and the function  
    \-- raises MASTERY\_HISTORICAL\_DATA\_INVALID rather than producing silent bad math.  
    validation AS (  
        SELECT  
            COUNT(\*) FILTER (  
                WHERE difficulty IS NULL OR difficulty NOT IN (1,2,3)  
            )                                                                      AS bad\_diff,  
            COUNT(\*) FILTER (  
                WHERE source\_family IS NULL  
                   OR source\_family NOT IN ('test','practice','review')  
            )                                                                      AS bad\_src,  
            COUNT(\*) FILTER (  
                WHERE section IS NULL OR section NOT IN ('M','RW')  
            )                                                                      AS bad\_section,  
            COUNT(\*) FILTER (WHERE correct IS NULL)                                AS bad\_correct,  
            COUNT(\*) FILTER (WHERE occurred\_at IS NULL)                            AS bad\_occurred\_at,  
            COUNT(\*) FILTER (WHERE event\_id IS NULL)                               AS bad\_event\_id  
        FROM positioned  
    ),  
    weighted AS (  
        SELECT  
            p.source\_family,  
            p.correct::int             AS correct\_int,  
            CASE p.difficulty  
                WHEN 1 THEN v\_d\_easy  
                WHEN 2 THEN v\_d\_medium  
                WHEN 3 THEN v\_d\_hard  
                ELSE NULL                  \-- defensive: caught by explicit validation block below  
            END                        AS d\_w,  
            POWER(0.5, (p.pos \- 1)::numeric / v\_position\_half\_life) AS pos\_w  
        FROM positioned p  
    ),  
    per\_source AS (  
        SELECT  
            w.source\_family,  
            LEAST(  
                1.0,  
                SUM(w.d\_w \* w.pos\_w \* w.correct\_int)  
                / NULLIF(SUM(w.pos\_w), 0\)  
            )                       AS acc\_source,  
            COUNT(\*)                AS events\_in\_source  
        FROM weighted w  
        GROUP BY w.source\_family  
    )  
    SELECT  
        (SELECT COUNT(\*) FROM weighted)                                            ,  
        (SELECT acc\_source FROM per\_source WHERE source\_family \= 'test')           ,  
        (SELECT acc\_source FROM per\_source WHERE source\_family \= 'practice')       ,  
        (SELECT acc\_source FROM per\_source WHERE source\_family \= 'review')         ,  
        v.bad\_diff, v.bad\_src, v.bad\_section, v.bad\_correct, v.bad\_occurred\_at, v.bad\_event\_id  
    INTO  
        v\_total, v\_acc\_test, v\_acc\_practice, v\_acc\_review,  
        v\_bad\_diff, v\_bad\_src, v\_bad\_section, v\_bad\_correct, v\_bad\_occurred\_at, v\_bad\_event\_id  
    FROM validation v;

    \-- Enforce historical data validation (RB-05A-V1-09 / HIGH2 \+ RB-05A-V1-17 \+ RB-05A-V1-18 \+ RB-05A-V1-22)  
    \-- The canonical event window may contain rows with NULL or out-of-enum values,  
    \-- NULL correctness, NULL timestamps, or NULL event\_ids if upstream Doc 02 / Doc 04  
    \-- writes ever bypassed their own validation. The formula CANNOT silently  
    \-- handle these: NULL difficulty/source/section produce NULL weights or undefined  
    \-- macro-average behavior; NULL correctness propagates through SUM (silently  
    \-- excluded from numerator while still counted in total\_events); NULL occurred\_at  
    \-- corrupts position assignment (PG puts NULLs first under DESC by default);  
    \-- NULL event\_id breaks the position tiebreaker. Every bad-data condition  
    \-- below is therefore a hard failure, not a silent skip.  
    IF v\_bad\_diff \> 0  
       OR v\_bad\_src \> 0  
       OR v\_bad\_section \> 0  
       OR v\_bad\_correct \> 0  
       OR v\_bad\_occurred\_at \> 0  
       OR v\_bad\_event\_id \> 0 THEN  
        RAISE EXCEPTION 'MASTERY\_HISTORICAL\_DATA\_INVALID: canonical event window contains rows violating one or more of: difficulty IS NULL or NOT IN (1,2,3); source\_family IS NULL or NOT IN (test,practice,review); section IS NULL or NOT IN (M,RW); correct IS NOT NULL; occurred\_at IS NOT NULL; event\_id IS NOT NULL (counts: diff=%, src=%, section=%, correct=%, occurred\_at=%, event\_id=%)',  
            v\_bad\_diff, v\_bad\_src, v\_bad\_section, v\_bad\_correct, v\_bad\_occurred\_at, v\_bad\_event\_id;  
    END IF;

    \-- Step 3: apply the 5-event threshold and cold-start rule per Parent §4.1 Step 5  
    IF v\_total IS NULL OR v\_total \< v\_min\_events THEN  
        total\_events  := COALESCE(v\_total, 0);  
        acc\_test      := NULL;  
        acc\_practice  := NULL;  
        acc\_review    := NULL;  
        mastery\_score := NULL;  
        mastery\_pct   := NULL;  
        mastery\_level := NULL;  
        RETURN NEXT;  
        RETURN;  
    END IF;

    \-- Step 4: macro-average across present sources with renormalization  
    \--         per Parent §4.1 Step 4  
    v\_mastery\_raw :=  
        (  
            COALESCE(v\_w\_test     \* v\_acc\_test,     0\)  
          \+ COALESCE(v\_w\_practice \* v\_acc\_practice, 0\)  
          \+ COALESCE(v\_w\_review   \* v\_acc\_review,   0\)  
        )  
        /  
        NULLIF(  
            (CASE WHEN v\_acc\_test     IS NOT NULL THEN v\_w\_test     ELSE 0 END)  
          \+ (CASE WHEN v\_acc\_practice IS NOT NULL THEN v\_w\_practice ELSE 0 END)  
          \+ (CASE WHEN v\_acc\_review   IS NOT NULL THEN v\_w\_review   ELSE 0 END),  
            0  
        );

    \-- Step 5: defensive clamp \+ rounding per Parent §10.1  
    \-- Bounds and rounding precisions read from constants (RB-05A-V1-05).  
    v\_mastery\_score := ROUND(GREATEST(v\_mastery\_min, LEAST(v\_mastery\_max, v\_mastery\_raw))::numeric, v\_round\_score\_dec);  
    v\_mastery\_pct   := ROUND(100.0 \* v\_mastery\_score, v\_round\_pct\_dec);  
    v\_mastery\_level := public.lookup\_mastery\_level(v\_mastery\_score, v\_constants);

    \-- Step 6: round per-source accuracies for storage  
    \-- Precision read from constants (RB-05A-V1-05).  
    v\_acc\_test     := ROUND(v\_acc\_test,     v\_round\_acc\_dec);  
    v\_acc\_practice := ROUND(v\_acc\_practice, v\_round\_acc\_dec);  
    v\_acc\_review   := ROUND(v\_acc\_review,   v\_round\_acc\_dec);

    \-- Return single result row  
    total\_events  := v\_total;  
    acc\_test      := v\_acc\_test;  
    acc\_practice  := v\_acc\_practice;  
    acc\_review    := v\_acc\_review;  
    mastery\_score := v\_mastery\_score;  
    mastery\_pct   := v\_mastery\_pct;  
    mastery\_level := v\_mastery\_level;  
    RETURN NEXT;  
END;  
$$;

REVOKE ALL ON FUNCTION public.compute\_mastery\_for\_entity FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.compute\_mastery\_for\_entity TO service\_role;

### **6.2 The `canonical_mastery_events` view-function**

`canonical_mastery_events` is the entity-filtered event view that pulls answer rows from the canonical upstream tables, normalizes them into a uniform shape, and returns them to `compute_mastery_for_entity`.

**Denormalization contract for full-length events (RB-05A-V1-04).** 05A requires that `test_session_answers` carry the canonical metadata `(section, domain, skill, difficulty, correct, answered_at, question_id)` **denormalized at section-finalization time**, populated by Doc 04's finalization path. This contract gives 05A:

* **Determinism.** Recompute reads the same row values regardless of whether `questions` or `test_form_items` metadata changes after finalization.  
* **Audit fidelity.** What was scored is what mastery sees, even if the canonical question metadata is later corrected.  
* **Simplicity.** No fragile multi-table JOIN to dereference question metadata at recompute time.

05A does NOT join `questions` or rely on `test_form_items.section/domain/skill/difficulty`. If the installed Doc 04 schema does not yet denormalize these columns into `test_session_answers`, the §10 pre-implementation verification gate flags it as a blocking schema gap. Doc 04A is the canonical owner of this finalization-time denormalization; 05A's role is to consume the contract and to require it via the verification gate.

CREATE OR REPLACE FUNCTION public.canonical\_mastery\_events(  
    p\_student\_id   uuid,  
    p\_entity\_type  text,  
    p\_section      text,  
    p\_domain       text,  
    p\_skill        text  
)  
RETURNS TABLE (  
    event\_id           uuid,  
    event\_source\_kind  text,  
    source\_family      text,  
    section            text,  
    domain             text,  
    skill              text,  
    difficulty         smallint,  
    correct            boolean,  
    occurred\_at        timestamptz,  
    question\_id        uuid  
)  
LANGUAGE sql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
    \-- Practice events (Doc 02B owns the canonical table)  
    SELECT  
        pa.id              AS event\_id,  
        'practice\_attempt'::text AS event\_source\_kind,  
        'practice'::text   AS source\_family,  
        pa.section, pa.domain, pa.skill, pa.difficulty,  
        pa.correct, pa.occurred\_at, pa.question\_id  
    FROM practice\_attempts\_v0 pa  
    WHERE pa.student\_id \= p\_student\_id  
      AND pa.section    \= p\_section  
      AND (p\_entity\_type \= 'domain' OR pa.skill \= p\_skill)  
      AND pa.domain     \= p\_domain  
    \-- NOTE (RB-05A-V1-17): no defensive filter on difficulty. Invalid historical  
    \-- rows MUST reach compute\_mastery\_for\_entity's validation block so the  
    \-- function raises MASTERY\_HISTORICAL\_DATA\_INVALID rather than silently  
    \-- excluding them. Filtering here would hide the bug.

    UNION ALL

    \-- Review events (Doc 02B owns)  
    SELECT  
        ra.id,  
        'review\_error\_attempt'::text,  
        'review'::text,  
        ra.section, ra.domain, ra.skill, ra.difficulty,  
        ra.correct, ra.occurred\_at, ra.question\_id  
    FROM review\_error\_attempts ra  
    WHERE ra.student\_id \= p\_student\_id  
      AND ra.section    \= p\_section  
      AND (p\_entity\_type \= 'domain' OR ra.skill \= p\_skill)  
      AND ra.domain     \= p\_domain  
    \-- (RB-05A-V1-17: no difficulty filter; see practice branch note above.)

    UNION ALL

    \-- Full-length events — Doc 04 seam per Parent §11.4 / RB-05P-V1-03 / RB-05P-V1-04  
    \-- Metadata read from DENORMALIZED columns on test\_session\_answers per  
    \-- RB-05A-V1-04. test\_session\_sections gates eligibility on submitted state.  
    SELECT  
        tsa.id,  
        'full\_length\_answer'::text,  
        'test'::text,  
        tsa.section, tsa.domain, tsa.skill, tsa.difficulty,  
        tsa.correct, tsa.answered\_at, tsa.question\_id  
    FROM test\_session\_answers tsa  
    JOIN test\_sessions          ts  ON ts.id \= tsa.test\_session\_id  
    JOIN test\_session\_sections  tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                     AND tss.section\_index \= tsa.section\_index  
    WHERE ts.student\_id \= p\_student\_id  
      AND tsa.section   \= p\_section  
      AND (p\_entity\_type \= 'domain' OR tsa.skill \= p\_skill)  
      AND tsa.domain    \= p\_domain  
      AND tss.state     \= 'submitted';     \-- post-finalization gate per RB-05P-V1-04  
      \-- (RB-05A-V1-17: no difficulty filter; bad-data detection lives in compute\_mastery\_for\_entity.)  
$$;

REVOKE ALL ON FUNCTION public.canonical\_mastery\_events FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.canonical\_mastery\_events TO service\_role;

Exact column names from upstream tables MUST be verified against the installed Supabase schema via the §10 pre-implementation verification gate. The structural shape — three UNIONed SELECTs producing a uniform event row, with full-length metadata read denormalized from `test_session_answers` — is locked at the 05A contract level.

### **6.3 The `lookup_mastery_level` helper**

CREATE OR REPLACE FUNCTION public.lookup\_mastery\_level(  
    p\_score      numeric,  
    p\_constants  jsonb  
)  
RETURNS smallint  
LANGUAGE sql  
IMMUTABLE  
AS $$  
    \-- Boundaries are read from the constants snapshot passed by the caller.  
    \-- The function remains IMMUTABLE because its output is fully determined by  
    \-- its arguments — the constants are an input, not a table read.  
    \-- Half-open intervals at the upper end: each level covers \[min, next\_min\[.  
    SELECT CASE  
        WHEN p\_score IS NULL THEN NULL::smallint  
        WHEN p\_score \< (p\_constants-\>\>'mastery\_level\_1\_min')::numeric THEN 0::smallint  
        WHEN p\_score \< (p\_constants-\>\>'mastery\_level\_2\_min')::numeric THEN 1::smallint  
        WHEN p\_score \< (p\_constants-\>\>'mastery\_level\_3\_min')::numeric THEN 2::smallint  
        WHEN p\_score \< (p\_constants-\>\>'mastery\_level\_4\_min')::numeric THEN 3::smallint  
        ELSE                                                                4::smallint  
    END;  
$$;

REVOKE ALL ON FUNCTION public.lookup\_mastery\_level FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.lookup\_mastery\_level TO service\_role;

The boundaries are read from the constants object passed by the caller. The caller (`compute_mastery_for_entity` or any future user of this helper) already reads `mastery_constants` once at the top of its body via `canonicalize_mastery_constants()`; that same JSONB object is passed here. No additional table reads. The function remains `IMMUTABLE` because the output is a pure function of its inputs.

This is a clarification of Parent §4.5's inclusive-both-ends notation: values like `0.7905` (which fall between Parent's stated `[0.60, 0.79]` and `[0.80, 1.00]` displayed boundaries) must map to a level. The half-open form `[0.60, 0.80)` maps these to Level 3, consistent with what the UI displays (e.g., `mastery_pct = 79.05%` shows as Level 3, not Level 4). This is **not a behavior change from Parent at displayed two-decimal precision**; it is the executable interpretation needed to cover all decimal values in the gaps between displayed boundaries. \<\!-- RB-05A-V1-05 / MED1 \--\>

Boundary verification table (with V1.0 constants: `level_1_min = 0.20`, `level_2_min = 0.40`, `level_3_min = 0.60`, `level_4_min = 0.80`):

| `mastery_score` | Level |
| ----- | ----- |
| 0.1900 | 0 |
| 0.2000 | 1 |
| 0.3900 | 1 |
| 0.4000 | 2 |
| 0.5900 | 2 |
| 0.6000 | 3 |
| 0.7900 | 3 |
| 0.7905 | 3 |
| 0.7999 | 3 |
| 0.8000 | 4 |
| 1.0000 | 4 |

### **6.4 Function purity guarantees**

`compute_mastery_for_entity` is marked `STABLE`. This means:

* The function does not modify the database.  
* Within a single SQL statement, the function returns the same value when called multiple times with the same arguments.  
* Across statements, the function may see committed changes (e.g., new events arriving).

`STABLE` (rather than `IMMUTABLE`) is correct because the function reads tables; if those tables change between invocations, the result legitimately changes.

`lookup_mastery_level` is marked `IMMUTABLE` because it takes a scalar input and depends on no table or session state.

### **6.5 Worked example: 5 medium practice events all correct**

To make the formula concrete, here's a hand-computed walkthrough that matches the SQL output:

Input events (occurred\_at DESC):  
  pos=1: medium, correct, occurred\_at \= now \- 1 day  
  pos=2: medium, correct, occurred\_at \= now \- 2 days  
  pos=3: medium, correct, occurred\_at \= now \- 3 days  
  pos=4: medium, correct, occurred\_at \= now \- 4 days  
  pos=5: medium, correct, occurred\_at \= now \- 5 days

Step 2 (per-source):  
  All 5 events are practice; no test or review events.  
  Position weights (POSITION\_HALF\_LIFE \= 30, rounded to 4 decimals):  
    pos=1: 0.5^(0/30)  \= 1.0000  
    pos=2: 0.5^(1/30)  \= 0.9772  
    pos=3: 0.5^(2/30)  \= 0.9548  
    pos=4: 0.5^(3/30)  \= 0.9330  
    pos=5: 0.5^(4/30)  \= 0.9117  
  Sum of pos\_w (denominator):   4.7768  
  Sum of d\_w × pos\_w × correct (numerator):  
    All correct, all medium (d\_w \= 1.0):  
    \= 1.0 × 4.7768  \= 4.7768  
  acc\_practice \= MIN(1.0, 4.7768 / 4.7768) \= MIN(1.0, 1.0000) \= 1.0000  
  acc\_test     \= NULL  
  acc\_review   \= NULL

Step 3 (threshold):  
  total\_events \= 5, MIN\_EVENTS\_FOR\_MASTERY \= 5  
  5 \< 5 is FALSE, so we proceed (not NULL).

Step 4 (macro-average):  
  mastery\_raw \= (0.50×NULL \+ 0.30×1.0 \+ 0.20×NULL) / (0+0.30+0)  
              \= 0.30 / 0.30  
              \= 1.0000

Step 5 (round \+ clamp):  
  mastery\_score \= ROUND(MIN(1.0, MAX(0.0, 1.0000)), 4\) \= 1.0000  
  mastery\_pct   \= ROUND(100 × 1.0000, 2\) \= 100.00  
  mastery\_level \= lookup\_mastery\_level(1.0000) \= 4

The SQL function produces `mastery_score = 1.0000, mastery_pct = 100.00, mastery_level = 4`. This matches the Parent stress test scenario for "5 medium practice correct" (§12 scenario B3).

Note: position weights are stored internally at higher precision in the SQL computation; the 4-decimal values shown above are display-rounded. The full-precision intermediate computation produces the same final mastery\_score.

---

## **7\. The `student_skill_mastery` Row Schema**

### **7.1 Table definition**

CREATE TABLE IF NOT EXISTS public.student\_skill\_mastery (  
    \-- Identity  
    student\_id              uuid          NOT NULL,  
    section                 text          NOT NULL CHECK (section IN ('M', 'RW')),  
    domain                  text          NOT NULL,  
    skill                   text          NOT NULL,

    \-- Mastery values (Parent §4 \+ Parent §10.1)  
    mastery\_score           numeric(5,4)  NULL,    \-- \[0.0000, 1.0000\]; NULL when below threshold  
    mastery\_pct             numeric(5,2)  NULL,    \-- \[0.00, 100.00\]  
    mastery\_level           smallint      NULL CHECK (mastery\_level IS NULL OR mastery\_level BETWEEN 0 AND 4),

    \-- Per-source accuracies (admin/internal visibility only)  
    acc\_test                numeric(7,6)  NULL,    \-- \[0.000000, 1.000000\]  
    acc\_practice            numeric(7,6)  NULL,  
    acc\_review              numeric(7,6)  NULL,

    \-- Evidence counters  
    event\_count\_total       integer       NOT NULL DEFAULT 0 CHECK (event\_count\_total \>= 0),

    \-- Versioning and audit anchors (Parent §9.5 / RB-05P-V1-08)  
    mastery\_model\_version   text          NOT NULL DEFAULT 'v1.0',  
    constants\_snapshot\_hash text          NOT NULL,  
    last\_event\_id           uuid          NULL,  
    last\_event\_occurred\_at  timestamptz   NULL,  
    computed\_at             timestamptz   NOT NULL DEFAULT now(),

    PRIMARY KEY (student\_id, section, domain, skill)  
);

CREATE INDEX IF NOT EXISTS idx\_student\_skill\_mastery\_student  
    ON public.student\_skill\_mastery (student\_id);

CREATE INDEX IF NOT EXISTS idx\_student\_skill\_mastery\_section\_domain  
    ON public.student\_skill\_mastery (student\_id, section, domain);

CREATE INDEX IF NOT EXISTS idx\_student\_skill\_mastery\_computed\_at  
    ON public.student\_skill\_mastery (computed\_at);

### **7.2 Column-level contracts**

| Column | Visibility | Notes |
| ----- | ----- | ----- |
| `student_id` | all roles | Identity |
| `section` | all roles | Identity |
| `domain` | all roles | Identity |
| `skill` | student-self \+ admin/service | **Intentionally exposed to the student so the student dashboard / hexagon can render skill-level proficiency bars per Parent §12. NOT exposed to guardian routes — guardian access is domain-level only (no skill rows). See RB-05A-V1-14 / MED2.** |
| `mastery_score` | service\_role, admin only | **NOT exposed to student or guardian per RB-05P-V1-14** |
| `mastery_pct` | service\_role, admin only | **NOT exposed to student or guardian per RB-05P-V1-14** |
| `mastery_level` | student-self \+ admin/service | The single mastery value exposed to student routes. Guardians do not access this table at all. |
| `acc_test` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `acc_practice` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `acc_review` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `event_count_total` | service\_role, admin only | May be exposed to admin tooling; never client |
| `mastery_model_version` | service\_role, admin only | Audit |
| `constants_snapshot_hash` | service\_role, admin only | Audit |
| `last_event_id` | service\_role, admin only | Audit |
| `last_event_occurred_at` | service\_role, admin only | Audit |
| `computed_at` | student-self \+ admin/service | Allows the UI to show "last updated 2 hours ago" |

### **7.3 RLS policies**

ALTER TABLE public.student\_skill\_mastery ENABLE ROW LEVEL SECURITY;

\-- WRITE policy: only service\_role may INSERT/UPDATE/DELETE.  
\-- (No policy granting write to authenticated; the absence of a permissive policy  
\--  for the authenticated role is the denial.)

\-- READ policy: students may read their own rows.  
\-- The route layer projects to mastery\_level only per INV-05A-12; column-level  
\-- grants in §7.4 enforce that at the database layer as defense-in-depth.  
CREATE POLICY student\_skill\_mastery\_student\_read  
    ON public.student\_skill\_mastery  
    FOR SELECT  
    TO authenticated  
    USING (  
        student\_id \= auth.uid()  
    );

\-- NOTE: No guardian read policy exists on student\_skill\_mastery. Per Parent  
\-- acceptance criterion \#19 (RB-05P-V1-12), guardians may read DOMAIN mastery  
\-- aggregates and section projection aggregates only. Per-skill mastery rows  
\-- are NEVER exposed to guardian routes — neither column-projected nor at all.  
\-- Guardian access surfaces are owned by 05B (domain) and 05C (projection)  
\-- and have their own RLS policies on their own tables.  
\-- \<\!-- RB-05A-V1-02: removed student\_skill\_mastery\_guardian\_read policy \--\>

### **7.4 Column-level grants for exposed-field enforcement**

Per INV-05A-12, the columns exposed to the authenticated role (students; guardians have no row policy here) are restricted at the column-grant level as defense-in-depth, not only at the route layer.

\-- Default: revoke all from public  
REVOKE ALL ON public.student\_skill\_mastery FROM PUBLIC;

\-- Service role: full access  
GRANT ALL ON public.student\_skill\_mastery TO service\_role;

\-- Authenticated role: SELECT only on the safe columns.  
\-- Combined with §7.3's student-only RLS policy (no guardian policy exists on  
\-- this table per RB-05A-V1-02), the effective access is:  
\--   \- students can SELECT their own rows, but only see safe columns  
\--   \- guardians get zero rows back from this table  
GRANT SELECT (  
    student\_id, section, domain, skill, mastery\_level, computed\_at  
) ON public.student\_skill\_mastery TO authenticated;

\-- Admin role: full SELECT for audit/support tooling  
GRANT SELECT ON public.student\_skill\_mastery TO admin\_role;

This is the defense-in-depth measure described in §2.4: even if a route layer bug constructs a SELECT against `mastery_score`, Postgres rejects it for the authenticated role. Combined with the absence of a guardian RLS policy in §7.3, this table is fully isolated from guardian queries.

### **7.5 Lifecycle**

| Trigger | Effect |
| ----- | ----- |
| First eligible event for a `(student, skill)` while `total_events < 5` | INSERT row with `mastery_score = NULL, mastery_pct = NULL, mastery_level = NULL, event_count_total = N`. The row exists but advertises insufficient evidence. |
| Threshold-crossing event (`total_events` transitions from 4 to 5\) | UPDATE row with computed `mastery_score`, `mastery_pct`, `mastery_level`. The row now advertises a real mastery value. |
| Subsequent events | UPDATE row with recomputed values |
| Recompute invocation | UPDATE row to current canonical values (NOT delete-and-reinsert; the PK stays) |
| Student account deletion | Per Parent §11.1, row is removed in the same transaction as the identity row. 05D owns the cascade definition. |

There is no DELETE path triggered by mastery semantics. Rows are only deleted as part of account deletion.

---

## **8\. Position Assignment SQL**

Position assignment turns a set of events into a deterministic 1-based sequence ordered by recency. The locked tiebreaker is `(occurred_at DESC, event_id DESC)`.

### **8.1 Why the tiebreaker matters**

Two answer events may share an `occurred_at` timestamp (millisecond resolution, simultaneous submissions, backfill batches). Without a stable secondary sort, two recompute runs over the same events could assign different positions, producing slightly different mastery values. The result is a determinism violation per Parent §8.

The locked tiebreaker is `event_id DESC` because:

* `event_id` is a UUID generated at insert time; it is unique across the relevant table.  
* DESC matches `occurred_at DESC` so the secondary sort doesn't introduce a "newer timestamp, older event\_id first" inversion.  
* UUIDs are random; the tiebreaker is effectively arbitrary BUT stable for the same inputs.

### **8.2 The canonical pattern**

SELECT  
    e.\*,  
    ROW\_NUMBER() OVER (  
        ORDER BY e.occurred\_at DESC, e.event\_id DESC  
    ) AS pos  
FROM canonical\_events e

For entity-filtered queries, the partitioning is implicit (the WHERE clause has already narrowed to one student-entity pair). No `PARTITION BY` is needed when the events come from a single entity's view.

For aggregate queries that span multiple students or skills, the partition becomes explicit:

ROW\_NUMBER() OVER (  
    PARTITION BY student\_id, section, domain, skill  
    ORDER BY occurred\_at DESC, event\_id DESC  
) AS pos

This pattern appears in both `compute_mastery_for_entity` (single-entity) and 05D's batch recompute jobs (multi-entity).

### **8.3 Position-weight computation**

After position assignment:

POWER(0.5, (pos \- 1)::numeric / v\_position\_half\_life) AS pos\_w

With `v_position_half_life = 30` (4-decimal rounded display):

| pos | pos\_w |
| ----- | ----- |
| 1 | 1.0000 |
| 5 | 0.9117 |
| 10 | 0.8123 |
| 31 | 0.5000 |
| 61 | 0.2500 |
| 100 | 0.1015 |

These values match Parent §4.1 Step 2 prose (corrected by RB-05P-V1-02 — the 31st-most-recent event has weight 0.5, equivalent to half a most-recent event). The SQL retains full precision internally; the 4-decimal values shown are for display only.

### **8.4 Determinism stress test**

The recompute equivalence test (§5.3) implicitly verifies position assignment determinism: if two runs produce different positions for the same events, the mastery values differ and the test fails.

In addition, 05A's CI suite includes `test_position_assignment_stable`:

Given a fixture of 50 events with some timestamp ties, run `ROW_NUMBER() OVER (...)` 100 times. Assert all 100 runs produce the same position-to-event mapping.

---

## **9\. Constants Snapshot Hash**

Per Parent §9.5 / RB-05P-V1-08, every mastery row carries a `constants_snapshot_hash` populated at write time. The hash makes "this row was computed under exactly these constants" reproducible.

### **9.1 What's in the hash**

The hash covers all `mastery_constants` keys that affect formula output. These are:

POSITION\_HALF\_LIFE  
MIN\_EVENTS\_FOR\_MASTERY  
weight\_source\_test  
weight\_source\_practice  
weight\_source\_review  
difficulty\_weight\_easy  
difficulty\_weight\_medium  
difficulty\_weight\_hard  
mastery\_min  
mastery\_max  
mastery\_level\_0\_max  
mastery\_level\_1\_min  
mastery\_level\_1\_max  
mastery\_level\_2\_min  
mastery\_level\_2\_max  
mastery\_level\_3\_min  
mastery\_level\_3\_max  
mastery\_level\_4\_min  
ROUND\_MASTERY\_SCORE\_DECIMALS  
ROUND\_MASTERY\_PCT\_DECIMALS  
ROUND\_ACCURACY\_DECIMALS  
ROUND\_EVIDENCE\_DECIMALS  
ROUNDING\_MODE  
mastery\_model\_version

Keys that do NOT affect formula output are excluded from the hash:

* `DIAGNOSTIC_TOTAL_QUESTIONS` (affects flow, not formula)  
* Any future operational/config keys

Note: `ROUND_MASTERY_PCT_DECIMALS` was added in V1.0 finalization to remove a hardcoded `2` literal in the formula function's percent rounding (RB-05A-V1-05). Its default value is `2`. Parent §10.1's constants table should be updated to reflect this; if absent at runtime, the formula function falls back to 2 via COALESCE for backward-compat during cutover.

### **9.2 Canonicalization**

The `canonicalize_mastery_constants()` function returns a JSONB object with constants for use by the formula. A sibling function `canonicalize_mastery_constants_serialized()` produces a deterministic text representation specifically for hashing, removing any dependency on PostgreSQL's JSONB text-rendering behavior.

\-- Returns a JSONB object of all constants (consumed by compute\_mastery\_for\_entity  
\-- and lookup\_mastery\_level). Convenient for in-SQL use.  
CREATE OR REPLACE FUNCTION public.canonicalize\_mastery\_constants()  
RETURNS jsonb  
LANGUAGE sql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
    SELECT jsonb\_object\_agg(key, value ORDER BY key)  
    FROM mastery\_constants  
    WHERE key IN (  
        'POSITION\_HALF\_LIFE',  
        'MIN\_EVENTS\_FOR\_MASTERY',  
        'weight\_source\_test',  
        'weight\_source\_practice',  
        'weight\_source\_review',  
        'difficulty\_weight\_easy',  
        'difficulty\_weight\_medium',  
        'difficulty\_weight\_hard',  
        'mastery\_min',  
        'mastery\_max',  
        'mastery\_level\_0\_max',  
        'mastery\_level\_1\_min',  
        'mastery\_level\_1\_max',  
        'mastery\_level\_2\_min',  
        'mastery\_level\_2\_max',  
        'mastery\_level\_3\_min',  
        'mastery\_level\_3\_max',  
        'mastery\_level\_4\_min',  
        'ROUND\_MASTERY\_SCORE\_DECIMALS',  
        'ROUND\_MASTERY\_PCT\_DECIMALS',  
        'ROUND\_ACCURACY\_DECIMALS',  
        'ROUND\_EVIDENCE\_DECIMALS',  
        'ROUNDING\_MODE',  
        'mastery\_model\_version'  
    );  
$$;

\-- Returns a deterministic text representation specifically for hashing.  
\-- Format: each line is "key=value" sorted by key, joined by newlines.  
\-- This format does NOT depend on JSONB text rendering, whitespace,  
\-- escape conventions, or PG version differences.  
\-- \<\!-- RB-05A-V1-12 / HIGH5: explicit serialization for hash stability \--\>  
CREATE OR REPLACE FUNCTION public.canonicalize\_mastery\_constants\_serialized()  
RETURNS text  
LANGUAGE sql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
    SELECT string\_agg(key || '=' || value::text, E'\\n' ORDER BY key)  
    FROM mastery\_constants  
    WHERE key IN (  
        'POSITION\_HALF\_LIFE',  
        'MIN\_EVENTS\_FOR\_MASTERY',  
        'weight\_source\_test',  
        'weight\_source\_practice',  
        'weight\_source\_review',  
        'difficulty\_weight\_easy',  
        'difficulty\_weight\_medium',  
        'difficulty\_weight\_hard',  
        'mastery\_min',  
        'mastery\_max',  
        'mastery\_level\_0\_max',  
        'mastery\_level\_1\_min',  
        'mastery\_level\_1\_max',  
        'mastery\_level\_2\_min',  
        'mastery\_level\_2\_max',  
        'mastery\_level\_3\_min',  
        'mastery\_level\_3\_max',  
        'mastery\_level\_4\_min',  
        'ROUND\_MASTERY\_SCORE\_DECIMALS',  
        'ROUND\_MASTERY\_PCT\_DECIMALS',  
        'ROUND\_ACCURACY\_DECIMALS',  
        'ROUND\_EVIDENCE\_DECIMALS',  
        'ROUNDING\_MODE',  
        'mastery\_model\_version'  
    );  
$$;

The serialized form is a deterministic newline-delimited `key=value` text representation. It is invariant under PG version, JSONB compaction choices, or any future implementation detail of `to_jsonb` / `::text`. It is the input to the SHA-256 hash.

### **9.3 Hash algorithm**

encode(digest(canonicalize\_mastery\_constants\_serialized(), 'sha256'), 'hex')

SHA-256 in hex form. 64 characters. The input is the deterministic `key=value\nkey=value\n...` text from §9.2's serialized function, NOT the JSONB form cast to text. This removes any dependency on JSONB rendering choices. \<\!-- RB-05A-V1-12 / HIGH5 \--\>

### **9.4 Hash stability test**

CI test `test_constants_snapshot_hash_stable`:

Compute the hash 1000 times with the V1.0-locked constants. Assert all 1000 produce the same 64-character hex string. Then perturb one constant by 0.001. Assert the new hash differs from the original.

### **9.5 What 05D does with the hash**

Per Parent §9.4 / §9.5, when a constant changes:

* `constants_audit_log` records the change (old value, new value, actor, reason, timestamp).  
* Mastery rows written after the change carry the new hash.  
* Mastery rows written before the change retain the old hash.  
* Audit queries can answer "this row was written under hash X; the audit log shows hash X corresponds to constants snapshot Y at time T."

05D defines the audit table schema and the audit query patterns. 05A's contract is: every row write populates `constants_snapshot_hash`.

---

## **10\. Pre-Implementation Verification Gate**

Per Parent §19.5 / RB-05P-V1-11, 05A implementation MUST verify the installed Supabase state against this contract before production cutover. This section locks the verification scope, the script outputs, and the migration paths.

### **10.1 What MUST be verified**

The pre-implementation verification script runs against the target Supabase database and reports the state of three areas:

**A. Installed RPC signatures.** For each of the three RPC functions defined in this document:

public.apply\_mastery\_event  
public.recompute\_skill\_mastery  
public.compute\_mastery\_for\_entity

The script queries `information_schema.routines` and `information_schema.parameters` and compares the installed signature against the contract in §4.1, §5.1, and §6.1. If a function exists but its signature differs, the verification status is `INSTALLED_BUT_MISMATCHED`. If a function does not exist, the status is `MISSING`.

The script ALSO checks for legacy RPC names that 05A supersedes:

public.apply\_learning\_event\_to\_mastery   \-- legacy EMA shape  
public.upsert\_skill\_mastery              \-- legacy Bayesian shape

If these exist, the status is `LEGACY_PRESENT_REQUIRES_DEPRECATION`. They are not dropped automatically; 05D defines the deprecation cutover.

**B. `mastery_constants` table values.** The script reads `mastery_constants` and compares each key in §9.1's hash list against Parent §10.1's locked values. Any value mismatch is reported with both the installed value and the Parent V1.0 value.

A specific concern: the legacy seeded values include `difficulty_multiplier_easy/medium/hard` at `1.0 / 1.1 / 1.3`. The new V1.0 keys are `difficulty_weight_easy/medium/hard` at `0.79 / 1.0 / 1.20`. The script reports BOTH the absence of new keys AND the presence of legacy keys.

**C. `student_skill_mastery` row schema.** The script queries `information_schema.columns` and compares the installed columns against the schema in §7.1. It specifically checks for:

* Presence of `constants_snapshot_hash` (new in V1.0)  
* Presence of `mastery_model_version`  
* Column-level grants per §7.4 (queries `information_schema.role_column_grants`)  
* RLS policies per §7.3 (queries `pg_policies`)

**D. Upstream table contract for Doc 04 seam (RB-05A-V1-04).** The script checks `test_session_answers` for the columns required by §6.2's denormalized contract: `section`, `domain`, `skill`, `difficulty`, `correct`, `answered_at`, `question_id`, plus the section-index linkage column used to join `test_session_sections`. If any of these denormalized columns are missing, the script reports `BLOCKING_DOC04_SEAM_GAP` with the missing column list and a remediation hint: "Doc 04A must populate these columns at section-finalization time before 05A can recompute mastery from canonical event history." The script also verifies that `test_session_sections.state` includes `'submitted'` as a valid value.

**E. Audit log table contract (RB-05A-V1-10).** The script checks `mastery_event_audit_log` (owned by 05D) for the columns required by §4.8's audit insert, including `event_source_kind` and the unique constraint on `(event_source_kind, event_id)`. Missing columns or wrong constraint is reported as `BLOCKING_05D_CONTRACT_GAP`.

### **10.2 Script output contract**

The verification script returns a structured report:

{  
  "verification\_timestamp": "2026-05-13T12:34:56Z",  
  "database\_url\_hash": "\<sha256 of db url without credentials\>",  
  "summary": {  
    "ready\_to\_implement": false,  
    "blocking\_issues": 3,  
    "warnings": 5  
  },  
  "rpc\_checks": \[  
    {  
      "function\_name": "apply\_mastery\_event",  
      "status": "MISSING | INSTALLED\_MATCHED | INSTALLED\_BUT\_MISMATCHED | LEGACY\_PRESENT\_REQUIRES\_DEPRECATION",  
      "installed\_signature": "...",  
      "expected\_signature": "...",  
      "action\_required": "..."  
    }  
  \],  
  "constants\_checks": \[  
    {  
      "key": "POSITION\_HALF\_LIFE",  
      "status": "MATCH | VALUE\_MISMATCH | KEY\_MISSING",  
      "installed\_value": "30",  
      "expected\_value": "30"  
    }  
  \],  
  "schema\_checks": \[  
    {  
      "object\_name": "student\_skill\_mastery.constants\_snapshot\_hash",  
      "status": "MISSING | PRESENT\_CORRECT\_TYPE | PRESENT\_WRONG\_TYPE",  
      "action\_required": "..."  
    }  
  \],  
  "rls\_checks": \[  
    {  
      "policy\_name": "student\_skill\_mastery\_student\_read",  
      "status": "MISSING | INSTALLED\_MATCHED | INSTALLED\_DIFFERENT\_PREDICATE",  
      "action\_required": "..."  
    }  
  \]  
}

A `ready_to_implement: true` result is a prerequisite for production cutover. Any `false` requires the migration path below.

### **10.3 Migration paths**

If the verification reports mismatches, 05A's implementation MUST follow one of the documented migration paths.

**Path 1: Greenfield (no installed state).**

If `student_skill_mastery` does not exist, no legacy RPCs are installed, and `mastery_constants` is empty or missing V1.0 keys:

1. Run the schema migration to create `student_skill_mastery` per §7.  
2. Seed `mastery_constants` with the V1.0 values per Parent §10.1.  
3. Install the three RPC functions per §4.1, §5.1, §6.1.  
4. Install RLS policies per §7.3 and column grants per §7.4.  
5. Re-run verification. Expect `ready_to_implement: true`.

**Path 2: Legacy state present, no production mastery rows yet.**

If legacy RPCs are installed but `student_skill_mastery` is empty (no production rows):

1. DROP the legacy RPCs (`apply_learning_event_to_mastery`, `upsert_skill_mastery`).  
2. DROP and re-CREATE `mastery_constants` with V1.0 keys only.  
3. Proceed as Path 1, steps 3–5.

**Path 3: Legacy state present, with production mastery rows.**

This is the high-risk path. It requires 05D's batch recompute lifecycle.

1. Take 05A writes offline (route layer returns 503 for mastery write attempts).  
2. Snapshot `student_skill_mastery` to a backup table.  
3. DROP legacy RPCs.  
4. ALTER `student_skill_mastery` to add `constants_snapshot_hash` column (NULL initially).  
5. Update `mastery_constants` to V1.0 values, recording the change in `constants_audit_log`.  
6. Install the three V1.0 RPC functions.  
7. Run 05D's batch recompute job for every `(student_id, section, domain, skill)` row. Each row's `constants_snapshot_hash` is populated; mastery values are recomputed under V1.0 constants.  
8. ALTER `student_skill_mastery` to make `constants_snapshot_hash` NOT NULL.  
9. Bring 05A writes back online.  
10. Re-run verification. Expect `ready_to_implement: true`.

Path 3 is the most invasive. 05D defines the batch recompute job's exact contract. 05A's responsibility is to NOT begin event-time writes until verification reports ready.

### **10.4 What the gate does NOT do**

The verification gate is a pre-flight check, not an idempotent migration runner. It reports state; it does NOT mutate the database. The implementation engineer (or operator) chooses a migration path based on the report and executes it explicitly.

This is intentional: an automated migration that silently mutates production constants is exactly the silent-drift failure mode that the audit doctrine forbids.

---

## **11\. Diagnostic Seeding Contract**

Per Parent §10.1 (RB-05P-V1-13), `DIAGNOSTIC_TOTAL_QUESTIONS = 40 = 8 SAT domains × 5 events per domain`. The diagnostic is sized so a completed run clears the per-domain `MIN_EVENTS_FOR_MASTERY = 5` threshold for every SAT domain.

### **11.1 What 05A locks (vs. what 02B owns)**

05A's mastery write boundary does NOT distinguish diagnostic events from regular practice events. From the formula's perspective, a diagnostic question is a `source_family = 'practice'` event with a specific skill, domain, difficulty, and outcome.

What 02B (practice runtime) owns:

* The diagnostic flow UX (how the student is presented with the 40 questions).  
* The question selection logic (which 40 questions out of the canonical bank).  
* The session bookkeeping (a single `practice_session_v0` row of type `diagnostic`, or whatever 02B's locked shape is).  
* The per-section split (e.g., 20 RW questions \+ 20 Math questions, or all interleaved).  
* The pacing and timing rules.

What 05A owns:

* The shape of the events that reach `apply_mastery_event` from a diagnostic session: `source_family = 'practice'`, with skill/domain/difficulty/correct/occurred\_at/event\_id/question\_id populated normally.  
* The implication that a completed diagnostic produces 5 practice events for each of the 8 SAT domains, which is sufficient to clear the per-domain mastery threshold.

### **11.2 Per-domain coverage requirement**

For the diagnostic to fulfill its purpose (every domain has computable mastery after completion), 02B's question selection MUST emit at least 5 questions per SAT domain in the diagnostic. The 8 domains are:

| Section | Domain |
| ----- | ----- |
| M | Algebra |
| M | Advanced Math |
| M | Problem Solving and Data Analysis |
| M | Geometry and Trigonometry |
| RW | Information and Ideas |
| RW | Craft and Structure |
| RW | Expression of Ideas |
| RW | Standard English Conventions |

If 02B chooses to allocate 5 questions per domain × 8 domains \= 40, the entire diagnostic exactly fills the per-domain threshold. If 02B chooses an unequal allocation (e.g., 6/6/4/4 within Math), some domains end up below threshold after the diagnostic, and the student needs additional practice to clear those.

05A's recommendation to 02B is **equal allocation: 5 questions per domain**. This produces predictable post-diagnostic mastery state (every domain shows a non-NULL mastery level after the diagnostic completes).

### **11.3 Per-skill coverage is NOT guaranteed**

5 questions per domain spread across all skills in that domain means individual skills may have 0, 1, or 2 events post-diagnostic. Skills with fewer than 5 events have `skill_mastery = NULL`. This is correct V1.0 behavior: the diagnostic establishes domain-level mastery; skill-level mastery accrues via ongoing practice.

The student-facing dashboard MUST handle this gracefully: domain mastery may show "Level 2" while individual skills within the domain show "Practice more to see your mastery here."

### **11.4 No special source type**

Doc 02B's diagnostic events use `source_family = 'practice'`. There is no `'diagnostic'` source enum value. The diagnostic is product flow built on practice infrastructure; mastery sees no distinction.

If 02B's KPI surfaces want to track diagnostic-specific metrics (e.g., "% of new accounts who completed the diagnostic"), 02B's KPI tables MAY carry a `is_diagnostic` flag on the practice session row. The flag is upstream of Doc 05; 05A does not see it.

### **11.5 Re-taking the diagnostic**

A student MAY re-take the diagnostic. The second run produces another 40 events; these are normal practice events that extend the existing event history.

The re-take has the expected effect on mastery:

* Recent events get higher position weight.  
* If the student has improved, mastery rises.  
* If the student has declined, mastery drops.  
* The re-take's events are NOT special in any way.

05A locks this: there is no flag, no reset, no "re-diagnostic" mode. A re-take is 40 more practice events.

---

## **12\. Stress Test Fixture (Permanent Test Suite)**

This section locks the canonical stress test fixture for the V1.0 mastery formula. The 23 baseline scenarios (B1–B23) and 8 sparse-test scenarios (S1–S8) MUST be encoded as automated tests in the 05A implementation. Every scenario carries an exact expected output to 6 decimals on per-source accuracies, 4 decimals on `mastery_score`, 2 decimals on `mastery_pct`, and an integer `mastery_level`. Any deviation in implementation output from these values is a violation of the formula contract and a hard CI gate failure.

### **12.1 Baseline scenarios (B1–B23)**

Every event uses `occurred_at` set so that the events for the entity occupy positions 1..N in the recency order (most recent at position 1). Difficulty is annotated as E/M/H. The event-set column describes the events from most-recent to least-recent.

| ID | Description | Event set | `total` | `acc_test` | `acc_practice` | `acc_review` | `score` | `pct` | `level` |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| **B1** | Cold start (zero events) | (none) | 0 | NULL | NULL | NULL | NULL | NULL | NULL |
| **B2** | Below threshold: 4 medium practice correct | 4×(prac, M, ✓) | 4 | NULL | NULL | NULL | NULL | NULL | NULL |
| **B3** | At threshold: 5 medium practice correct | 5×(prac, M, ✓) | 5 | NULL | 1.000000 | NULL | 1.0000 | 100.00 | 4 |
| **B4** | 5 hard test correct (only source) | 5×(test, H, ✓) | 5 | 1.000000 | NULL | NULL | 1.0000 | 100.00 | 4 |
| **B5** | 5 easy practice correct (easy cap) | 5×(prac, E, ✓) | 5 | NULL | 0.790000 | NULL | 0.7900 | 79.00 | 3 |
| **B6** | 5 easy practice wrong | 5×(prac, E, ✗) | 5 | NULL | 0.000000 | NULL | 0.0000 | 0.00 | 0 |
| **B7** | 10 medium practice all correct | 10×(prac, M, ✓) | 10 | NULL | 1.000000 | NULL | 1.0000 | 100.00 | 4 |
| **B8** | 10 easy practice all correct (easy cap with volume) | 10×(prac, E, ✓) | 10 | NULL | 0.790000 | NULL | 0.7900 | 79.00 | 3 |
| **B9** | 10 hard practice all correct | 10×(prac, H, ✓) | 10 | NULL | 1.000000 | NULL | 1.0000 | 100.00 | 4 |
| **B10** | 10 medium practice 50% alternating | (prac, M, ✓), (prac, M, ✗), … 10 total alternating | 10 | NULL | 0.505776 | NULL | 0.5058 | 50.58 | 2 |
| **B11** | 10 medium, recent 5 correct, old 5 wrong | 5×(prac, M, ✓) pos 1-5, 5×(prac, M, ✗) pos 6-10 | 10 | NULL | 0.528849 | NULL | 0.5288 | 52.88 | 2 |
| **B12** | 10 medium, recent 5 wrong, old 5 correct | 5×(prac, M, ✗) pos 1-5, 5×(prac, M, ✓) pos 6-10 | 10 | NULL | 0.471151 | NULL | 0.4712 | 47.12 | 2 |
| **B13** | 100 medium, recent 50 correct, old 50 wrong | 50×(prac, M, ✓) pos 1-50, 50×(prac, M, ✗) pos 51-100 | 100 | NULL | 0.760468 | NULL | 0.7605 | 76.05 | 3 |
| **B14** | 100 medium, recent 50 wrong, old 50 correct | 50×(prac, M, ✗) pos 1-50, 50×(prac, M, ✓) pos 51-100 | 100 | NULL | 0.239532 | NULL | 0.2395 | 23.95 | 1 |
| **B15** | Inactivity: 5 hard test correct months ago | 5×(test, H, ✓) — positions 1-5 (no newer events ever added) | 5 | 1.000000 | NULL | NULL | 1.0000 | 100.00 | 4 |
| **B16** | Realistic mixed | 3×(test, H, ✓) \+ 2×(test, H, ✗) ; 7×(prac, M, ✓) \+ 3×(prac, M, ✗) ; 2×(rev, E, ✓) \+ 1×(rev, E, ✗) — all with recent-correct ordering | 18 | 0.736567 | 0.723864 | 0.532727 | 0.6920 | 69.20 | 3 |
| **B17** | 10 hard test 80% (only source) | 8×(test, H, ✓) pos 1-8, 2×(test, H, ✗) pos 9-10 | 10 | 0.981653 | NULL | NULL | 0.9817 | 98.17 | 4 |
| **B18** | Volume invariance baseline: 10 medium correct | 10×(prac, M, ✓) | 10 | NULL | 1.000000 | NULL | 1.0000 | 100.00 | 4 |
| **B19** | Volume invariance check: 500 medium correct | 500×(prac, M, ✓) | 500 | NULL | 1.000000 | NULL | 1.0000 | 100.00 | 4 |
| **B20** | All perfect hard: 5 test \+ 20 practice \+ 10 review | 5×(test, H, ✓), 20×(prac, H, ✓), 10×(rev, H, ✓) | 35 | 1.000000 | 1.000000 | 1.000000 | 1.0000 | 100.00 | 4 |
| **B21** | 70% on hard practice | 7×(prac, H, ✓) pos 1-7, 3×(prac, H, ✗) pos 8-10 | 10 | NULL | 0.868637 | NULL | 0.8686 | 86.86 | 4 |
| **B22** | 70% on easy practice (easy cap with mixed accuracy) | 7×(prac, E, ✓) pos 1-7, 3×(prac, E, ✗) pos 8-10 | 10 | NULL | 0.571853 | NULL | 0.5719 | 57.19 | 2 |
| **B23** | All wrong: 10 medium practice | 10×(prac, M, ✗) | 10 | NULL | 0.000000 | NULL | 0.0000 | 0.00 | 0 |

### **12.2 Sparse-test scenarios (S1–S8) per RB-05P-V1-07**

These scenarios specifically exercise the macro-average truth-anchor doctrine: low-count test evidence has high leverage. The fixture documents the intended values so that future implementations don't accidentally "fix" the property.

| ID | Description | Event set | `total` | `acc_test` | `acc_practice` | `acc_review` | `score` | `pct` | `level` |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| **S1** | 5 test correct \+ 5 practice wrong — test dominates positive | 5×(test, M, ✓) ; 5×(prac, M, ✗) | 10 | 1.000000 | 0.000000 | NULL | 0.6250 | 62.50 | 3 |
| **S2** | 5 test wrong \+ 5 practice correct — test penalty visible | 5×(test, M, ✗) ; 5×(prac, M, ✓) | 10 | 0.000000 | 1.000000 | NULL | 0.3750 | 37.50 | 1 |
| **S3** | Sparse-dominance key case: 5 hard test correct \+ 50 medium practice 50% | 5×(test, H, ✓) ; 25×(prac, M, ✓) pos 1-25 \+ 25×(prac, M, ✗) pos 26-50 | 55 | 1.000000 | 0.640520 | NULL | 0.8652 | 86.52 | 4 |
| **S4** | Sparse mixed: 5 hard test 60% \+ 50 medium practice 80% | 3×(test, H, ✓) \+ 2×(test, H, ✗) ; 40×(prac, M, ✓) pos 1-40 \+ 10×(prac, M, ✗) pos 41-50 | 55 | 0.736567 | 0.880485 | NULL | 0.7905 | 79.05 | 3 |
| **S5** | Mixed perfect: 5 hard test \+ 5 easy practice \+ 5 medium review (all correct) | 5×(test, H, ✓), 5×(prac, E, ✓), 5×(rev, M, ✓) | 15 | 1.000000 | 0.790000 | 1.000000 | 0.9370 | 93.70 | 4 |
| **S6** | Single-source test: 5 medium test correct | 5×(test, M, ✓) | 5 | 1.000000 | NULL | NULL | 1.0000 | 100.00 | 4 |
| **S7** | Single-source review: 5 medium review correct | 5×(rev, M, ✓) | 5 | NULL | NULL | 1.000000 | 1.0000 | 100.00 | 4 |
| **S8** | Sparse multi-source low-volume: 1 test \+ 1 practice \+ 3 review (all correct, total \= 5\) | 1×(test, M, ✓), 1×(prac, M, ✓), 3×(rev, M, ✓) | 5 | 1.000000 | 1.000000 | 1.000000 | 1.0000 | 100.00 | 4 |

### **12.3 What each scenario tests**

| Scenario | Property under test |
| ----- | ----- |
| B1, B2 | Cold start and below-threshold → NULL |
| B3, B4 | At-threshold transition produces real mastery |
| B5, B6, B8, B22 | Easy cap at 0.79; easy-only never reaches Level 4 |
| B7, B9, B18, B19, B20 | All-correct paths saturate at 1.0; volume doesn't matter |
| B10, B11, B12 | Recency discrimination at moderate volume |
| B13, B14 | Recency discrimination at high volume (52-point spread) |
| B15 | Inactivity does NOT drift mastery downward |
| B16 | Realistic multi-source student lands in mid-range |
| B17 | Single-source test student can saturate near 1.0 |
| B21 vs B22 | Difficulty discrimination at same accuracy (0.87 hard vs 0.57 easy) |
| B23 | All wrong → 0.0 |
| S1, S2 | Test source's symmetric leverage (positive AND negative) |
| S3 | Truth-anchor doctrine: 5 test correct outweighs 50 mediocre practice |
| S4 | Macro-average lands between sources weighted by source weights |
| S5 | Mixed-source perfect student where one source has easy cap |
| S6, S7 | Single-source non-test student also gets clean mastery |
| S8 | Edge case: 5 events distributed across all 3 sources, each source has 1-3 events |

### **12.4 Implementation requirements**

The 05A implementation MUST encode every scenario in §12.1 and §12.2 as an automated test. Each test:

1. Seeds the canonical event tables with the scenario's event set.  
2. Invokes `apply_mastery_event` (or the recompute path; see §12.5) to produce a `student_skill_mastery` row.  
3. Asserts the row's `mastery_score`, `mastery_pct`, `mastery_level`, `acc_test`, `acc_practice`, `acc_review`, and `event_count_total` match the expected values in the table.  
4. The acc fields tolerate up to ±1e-6 numeric difference (last decimal); mastery\_score tolerates ±1e-4; mastery\_pct tolerates ±0.01; mastery\_level must match exactly.

### **12.4a Fixture provenance (RB-05A-V1-13 / MED3)**

The expected output values in §12.1 and §12.2 were generated by an **independent Python reference implementation** of the V1.0 formula, not by the SQL function defined in §6. The reference implementation:

* Reads only the locked constants from Parent §10.1 (no DB dependency)  
* Implements the formula in plain Python: position weights via `0.5 ** ((pos-1)/30)`, per-source accuracy via `min(1.0, sum(d*pw*c)/sum(pw))`, macro-average with renormalization for missing sources, round-half-up to the locked precisions  
* Is committed under version control as the canonical fixture generator

This separation is intentional: the SQL function MUST be tested against an independently-computed source of truth, never against its own output. If the SQL implementation produces different values than this fixture, the SQL is wrong — not the fixture. If the formula changes (which requires a Parent version bump), the Python reference implementation is updated first, the new fixture values are regenerated, and the SQL is then required to match.

The reference implementation is also used to validate hand-spot-checks (e.g., the §6.5 worked example: 5 medium practice correct → `mastery_score = 1.0000`, sum of position weights \= 4.7768).

### **12.5 Determinism stress test**

In addition to the value tests, the fixture is used for the recompute equivalence test (§5.3). For each scenario:

1. Apply events one-at-a-time via `apply_mastery_event` (event-time path). Capture `student_skill_mastery` row R\_event.  
2. Truncate. Call `recompute_skill_mastery` (recompute path). Capture R\_recompute.  
3. Assert R\_event \= R\_recompute on every column except `computed_at`, `last_event_id`, and `last_event_occurred_at`.

This test MUST be a CI hard gate.

---

## **13\. Acceptance Criteria**

Doc 05A V1.0 is acceptable when all of the following are true. This is the gate for "05A locked" status.

1. The mastery RPC contract `apply_mastery_event` is specified in §4 with input schema, validation order, write order, idempotency check, advisory locking, error handling, and downstream refresh trigger.  
2. The recompute function `recompute_skill_mastery` is specified in §5 with the equivalence guarantee per Parent §8.2.  
3. The generic formula function `compute_mastery_for_entity` is specified in §6 with the full SQL implementation. This is the single implementation of the formula per INV-05A-11.  
4. The `canonical_mastery_events` view-function is specified in §6.2, including the Doc 04 seam join chain (`test_session_answers JOIN test_sessions JOIN test_session_sections`), with full-length metadata read from denormalized `test_session_answers` columns and `tss.state = 'submitted'` as the post-finalization gate per Parent §11.4. It MUST NOT join `questions` or rely on `test_form_items` metadata for mastery recompute. \<\!-- RB-05A-V1-15 \--\>  
5. The `lookup_mastery_level` helper is specified in §6.3 using half-open intervals at the upper end, with the boundary verification table.  
6. The `student_skill_mastery` table schema is specified in §7.1 with all column types, constraints, and indexes.  
7. Column-level visibility contract is specified in §7.2 mapping each column to its allowed roles. `mastery_score`, `mastery_pct`, and per-source accuracies are admin/internal-only per RB-05P-V1-14 (INV-05A-12).  
8. RLS policies in §7.3 enforce student-self read only on `student_skill_mastery`. No guardian SELECT policy exists on this table; guardian aggregate access is owned by 05B (domain mastery) and 05C (section projection). \<\!-- RB-05A-V1-16 \--\>  
9. Column-level GRANTs in §7.4 implement INV-05A-12 at the database layer (defense-in-depth, not only at route layer).  
10. Position assignment SQL pattern is locked in §8 with `(occurred_at DESC, event_id DESC)` tiebreaker. Determinism test `test_position_assignment_stable` is defined.  
11. Constants snapshot hash computation is locked in §9 with SHA-256 of deterministic `key=value\n...` serialized text (NOT JSONB cast to text), explicit key list, and both `canonicalize_mastery_constants()` (returns JSONB for in-SQL use) and `canonicalize_mastery_constants_serialized()` (returns deterministic text for hashing) function definitions. \<\!-- RB-05A-V1-21 \--\>  
12. Pre-implementation verification gate is specified in §10 with the structured report contract and three migration paths (greenfield, legacy-no-rows, legacy-with-rows).  
13. Diagnostic seeding contract is specified in §11 affirming regular-practice-event semantics, 5-per-domain × 8-domain \= 40 total, and re-take rules.  
14. The full stress test fixture is specified in §12 with 23 baseline (B1–B23) and 8 sparse-test (S1–S8) scenarios. Each has exact expected outputs at the locked precisions.  
15. The recompute equivalence test (§12.5) is required as a CI hard gate.  
16. All 12 hard invariants (§3) are documented with enforcement mechanism (RLS policy, CI grep guard, test, or audit trigger).  
17. No item in Doc 05A contradicts Doc 05 Parent V1.0 or any locked Doc 02 / Doc 04 sub-doc.  
18. No item in Doc 05A references repo cleanup, migration remediation, or audit findings outside of §10's verification gate — 05A is a clean-slate canonical spec for the V1.0 implementation contract.

---

## **14\. Cross-Doc References**

### **14.1 Parent V1.0 sections implemented by 05A**

| Parent reference | 05A implementation |
| ----- | ----- |
| §4 Canonical formula | §6 `compute_mastery_for_entity` |
| §4.1 Step 5 (cold start \+ threshold) | §6 Step 3 (NULL gate) |
| §4.5 Level boundaries | §6.3 `lookup_mastery_level` (half-open clarification) |
| §6.1 Service-role-only writes | §3.1 INV-1 enforcement |
| §6.2 Single canonical write path | §3.1 INV-2 enforcement, plus INV-05A-11 (single formula implementation) |
| §6.3 Deterministic recompute | §5 recompute function, §12.5 equivalence test |
| §6.4 Tutor never writes mastery | §3.1 INV-4 enforcement |
| §6.5 Full-length post-finalization only | §4.2 Step 3, §6.2 `tss.state = 'submitted'` gate |
| §6.6 NULL for absent/insufficient evidence | §6 Step 3 |
| §6.7 Versioned constants, never silent | §9 `constants_snapshot_hash` |
| §6.8 No predicted scores | §3.1 INV-8 enforcement |
| §6.9 Audit separation from Doc 04D | §3.1 INV-9, §4.8 audit log writes to 05D-owned tables only |
| §7 Bottom-up derivation | §4.9 downstream refresh trigger |
| §8 Determinism contract | §5.3 \+ §8.4 \+ §12.5 |
| §9.5 Constants version pinning | §9 hash population |
| §10.1 Canonical parameter values | §9.1 hash inclusion list |
| §11.1 Doc 01 seam (guardian, entitlement) | §7.3 RLS policies |
| §11.2 Doc 02 seam (denormalization, 1-3 difficulty) | §4.2 Step 2 enum validation; §6.2 view-function |
| §11.4 Doc 04 seam (post-finalization, submitted-section-only) | §6.2 `canonical_mastery_events`, `tss.state = 'submitted'` |
| §11.4 Macro-average truth-anchor design note | §12.2 sparse-test fixture |
| §12 Anti-leak | §7.2 column visibility, §7.4 column grants |
| §13 Tutor exclusion | §3.1 INV-4 |
| §18 Acceptance criterion \#20 (level-only exposure) | §3.1 INV-12, §7.2 column visibility, §7.4 column grants |
| §19.5 Pre-impl verification gate | §10 |

### **14.2 Doc 02 / Doc 04 dependencies**

| Upstream doc | 05A dependency |
| ----- | ----- |
| Doc 02 Preamble V3.0 INV-02-01..10 | 05A respects all cross-cutting invariants (no answer leak in mastery surfaces; mastery doesn't write generation tables) |
| Doc 02A V6 §17 (3-tier difficulty) | §4.2 Step 2 enum validation; §6.2 difficulty join |
| Doc 02B V4 (practice/review runtime) | §6.2 reads `practice_attempts_v0`, `review_error_attempts` (exact column names verified via §10 gate) |
| Doc 04 Parent V3.0 (no mastery events) | §6.2 reads canonical answer state, NOT mastery events |
| Doc 04A V2.2 (section state, submitted) | §6.2 `tss.state = 'submitted'` filter |
| Doc 04B V4.3 (score\_runs) | Referenced for traceability only; NOT a gate on mastery eligibility (per Parent §11.4) |

### **14.3 Doc 05 family seams**

| Sibling doc | 05A interaction |
| ----- | ----- |
| 05B (Domain mastery, KPI rollups) | 05A's `apply_mastery_event` calls `refresh_domain_mastery` in the same transaction (§4.9). 05B reuses `compute_mastery_for_entity` with `p_entity_type = 'domain'`. |
| 05C (Projections, snapshots) | 05B's domain refresh triggers 05C's projection refresh; 05A does not call 05C directly. |
| 05D (Audit, recompute, constants) | 05A writes to 05D-owned `mastery_event_audit_log` (§4.8). 05D defines the audit table schema, the recompute orchestration that invokes `recompute_skill_mastery` (§5), and the constants governance lifecycle (§9.5). |

---

## **15\. Governance & Lock Process**

### **15.1 Owner**

Primary owner: Product \+ Engineering joint ownership, matching the Doc 04 family and Doc 05 Parent precedent.

Operational source-of-truth owner: Engineering maintains RPC signature and table schema alignment with this document.

### **15.2 Review trigger**

Doc 05A MUST be reviewed when any of the following occur:

* The mastery formula's shape changes at the Parent level (requires Parent change first, then 05A re-derivation).  
* A mastery constant in §9.1's hash list changes (constants change requires either model version bump or per-row hash population per Parent §9.5).  
* The RPC signature for `apply_mastery_event`, `recompute_skill_mastery`, or `compute_mastery_for_entity` changes.  
* The `student_skill_mastery` schema changes.  
* The Doc 04 seam tables or columns change (would require updating the §6.2 view-function).  
* The Doc 02 difficulty enum changes (currently locked at 1-3).  
* The pre-implementation verification gate (§10) needs updating because the installed Supabase state has evolved past the documented migration paths.

### **15.3 Lock meaning**

"Locked" means:

* Doc 05A is the authoritative source for the RPC contracts, the formula's executable form, the row schema, and the stress test fixture.  
* Implementations MUST conform to 05A's locks.  
* Changes to 05A require an explicit version bump and review.  
* Silent drift between 05A and implementation is not allowed.

Post-lock, additive clarifications MAY be applied within the lock cycle without a version bump, following the Doc 04 family precedent.

### **15.4 Parent dependency**

Doc 05A V1.0 depends on Doc 05 Parent V1.0 (Locked 2026-05-13 with in-lock-cycle cleanup RB-05P-V1-01..14). Any Parent change that affects the formula, the level boundaries, the constants list, the seam contracts, or the acceptance criteria propagates to 05A immediately.

### **15.5 Implementation gate**

Doc 05A locking is a prerequisite for any production implementation of the V1.0 mastery RPC. The pre-implementation verification gate (§10) MUST report `ready_to_implement: true` before production cutover. Implementations that proceed before the gate passes do so at their own risk and may require rework or batch recompute under Path 3\.

---

## **16\. Change Records**

| Version | Date | Author | Summary |
| ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-13 | Claude (draft) | Initial draft for review. Locks: `apply_mastery_event` RPC contract; `recompute_skill_mastery` sibling function; generic formula function `compute_mastery_for_entity` reused by 05A and 05B per Parent Q5/Option A; `canonical_mastery_events` view-function with Doc 04 seam (`test_session_answers JOIN test_sessions JOIN test_session_sections`, `tss.state = 'submitted'` gate); `lookup_mastery_level` with half-open interval clarification of Parent §4.5; `student_skill_mastery` schema with column-level visibility contract per Parent \#20 / RB-05P-V1-14; RLS policies; column GRANTs; position assignment SQL with `(occurred_at DESC, event_id DESC)` tiebreaker; SHA-256 `constants_snapshot_hash` over 24-key canonical list; pre-implementation verification gate with three migration paths per Parent §19.5 / RB-05P-V1-11; diagnostic seeding contract (40 questions \= 8 domains × 5, regular practice events, no special source); permanent stress test fixture (23 baseline B1–B23 \+ 8 sparse-test S1–S8 scenarios) with exact expected values at locked precisions; recompute equivalence test as CI hard gate; 12 hard invariants (9 inherited from Parent \+ 3 sub-doc-specific: idempotency at upstream event identity, single formula implementation, exposed-field contract at row layer); 18 acceptance criteria. Idempotency strategy: trust upstream event identity as dedup key (Q1/Option A default), with `(event_source_kind, event_id)` as the narrowed dedup key. |
| V1.0 | 2026-05-13 | Claude (in-lock-cycle cleanup) | **In-lock-cycle cleanup applied** (no version bump per Doc 04 family precedent): 6 reviewer blockers accepted (RB-05A-V1-01 idempotency check moved inside event-level advisory lock \+ unique-violation on audit insert handled as idempotent re-entry; RB-05A-V1-02 guardian RLS policy removed from `student_skill_mastery` to honor Parent acceptance \#19; RB-05A-V1-04 `canonical_mastery_events` full-length SQL locked to denormalized contract — metadata read from `test_session_answers` columns, no `questions` JOIN, no reliance on `test_form_items` metadata — with §10 verification gate updated to check for the denormalized columns; RB-05A-V1-05 all hardcoded formula constants removed — rounding decimals, min/max bounds, and level boundaries now read from `mastery_constants`; `lookup_mastery_level` takes constants jsonb parameter, stays IMMUTABLE; `ROUND_MASTERY_PCT_DECIMALS` added to canonical constants list; RB-05A-V1-06 audit `mastery_score_before` / `mastery_level_before` populated by reading existing row under §4.4 advisory lock; RB-05A-V1-07 `SET LOCAL lock_timeout = '5s'` enforces bounded lock acquisition wrapped in exception handler for `lock_not_available` / `query_canceled`) \+ 1 reviewer blocker rejected (RB-05A-V1-03 "after test has been scored" — reviewer hallucination, doc never contained this language; only `score_runs` cross-doc reference exists with correct "NOT a gate" annotation) \+ 5 reviewer highs (RB-05A-V1-08 upstream insert ordering precondition added to §4.1; RB-05A-V1-09 defensive validation in `compute_mastery_for_entity` raises `MASTERY_HISTORICAL_DATA_INVALID` when canonical events contain out-of-enum difficulty or unknown source; RB-05A-V1-10 dedup key narrowed from `(source_family, event_id)` to `(event_source_kind, event_id)` — added `p_event_source_kind` parameter with enum `{practice_attempt, diagnostic_attempt, review_error_attempt, full_length_answer}` and mapping table to `source_family`; RB-05A-V1-11 recompute zero-event behavior table added — explicit return contract for all event-count × row-existence combinations; RB-05A-V1-12 hash stability — added `canonicalize_mastery_constants_serialized()` returning deterministic `key=value\n...` text via `string_agg`, replacing JSONB-text-cast input to SHA-256) \+ 2 reviewer mediums (RB-05A-V1-13 fixture provenance — §12.4a explicitly documents independent Python reference implementation as fixture source, not SQL self-generation; RB-05A-V1-14 student skill-name visibility intentional per Parent §12 hexagon — column visibility table affirms student-self access to `skill` column, guardian access remains forbidden by absent RLS policy). 14 cleanup tags RB-05A-V1-01..14, all grep-traceable in the document. |
| V1.0 | 2026-05-13 | Claude (in-lock-cycle cleanup, round 2\) | **Round-2 in-lock-cycle cleanup applied** (status stays Locked per Doc 04 family precedent — no Draft bounce despite reviewer recommendation to flip; the established pattern across Doc 04C, Doc 04D, and Doc 05 Parent has been: stay at Locked with cleanup register grown). 2 reviewer blockers accepted (RB-05A-V1-15 Acceptance Criteria \#4 updated to drop stale `JOIN test_form_items JOIN questions` chain that contradicted §6.2's denormalized-contract lock — AC \#4 now reads "test\_session\_answers JOIN test\_sessions JOIN test\_session\_sections, with full-length metadata read from denormalized test\_session\_answers columns" matching §6.2; RB-05A-V1-16 Acceptance Criteria \#8 updated to drop stale "implements Parent §11.1's guardian access contract" wording — AC \#8 now correctly reflects §7.3's actual contents: student-self read only, no guardian SELECT policy, guardian aggregate access owned by 05B/05C) \+ 1 reviewer high accepted with scope expansion (RB-05A-V1-17 dead `validation` CTE removed from `compute_mastery_for_entity`; three `difficulty IN (1,2,3)` filters removed from all branches of `canonical_mastery_events` so invalid historical rows reach the validation block rather than being silently excluded; the explicit `PERFORM 1 / IF FOUND / RAISE` block expanded from 2 fields to 6 fields per Karl's Q2 answer — now raises `MASTERY_HISTORICAL_DATA_INVALID` on any of: `difficulty NOT IN (1,2,3)`, `source_family NOT IN (test,practice,review)`, `section NOT IN (M,RW)`, `correct IS NULL`, `occurred_at IS NULL`, `event_id IS NULL`. The expansion specifically catches the silent-failure modes flagged in Q2: NULL correct propagating through SUM (silently excluded from numerator while still counted in total\_events), and NULL occurred\_at corrupting position assignment (PG places NULLs first under DESC by default). 17 cleanup tags total RB-05A-V1-01..17, all grep-traceable. |
| V1.0 | 2026-05-13 | Claude (in-lock-cycle cleanup, round 3\) | **Round-3 in-lock-cycle cleanup applied** (status stays Locked per Doc 04 family precedent). 1 reviewer blocker accepted (RB-05A-V1-18 fix CTE scope bug in compute\_mastery\_for\_entity — the validation block at the end of round-2 referenced `positioned` outside its CTE scope, making the function non-compilable; moved validation into the same CTE chain as the totals computation, capturing all 6 bad-data counters via the same SELECT INTO using CROSS JOIN-equivalent FROM validation v pattern, then checking the captured PL/pgSQL variables in IF; v\_bad\_diff/v\_bad\_src/v\_bad\_section/v\_bad\_correct/v\_bad\_occurred\_at/v\_bad\_event\_id added to DECLARE block; RAISE EXCEPTION now also reports per-field counts to aid debugging) \+ 3 reviewer spec-consistency cleanups (RB-05A-V1-19 §2.4 stale guardian RLS wording removed — now correctly distinguishes student-self route protection (RLS \+ column GRANT \+ route projection) from guardian access (no SELECT policy at all on this table); RB-05A-V1-20 three prose references in §4.3 and §4.8 updated from `(source_family, event_id)` to `(event_source_kind, event_id)` to match the SQL implementation and INV-05A-10 — narrows 05D audit table's unique constraint contract; RB-05A-V1-21 Acceptance Criterion \#11 hash wording updated from "SHA-256 of canonicalized JSON" to "SHA-256 of deterministic key=value serialized text" matching the §9.3 implementation, references both canonicalize\_mastery\_constants() (JSONB for in-SQL use) and canonicalize\_mastery\_constants\_serialized() (deterministic text for hashing)) \+ 1 minor ("22 baseline" → "23 baseline" in §1 Purpose since fixture is B1..B23). 21 cleanup tags total RB-05A-V1-01..21, all grep-traceable. |
| V1.0 | 2026-05-13 | Claude (in-lock-cycle cleanup, round 4\) | **Round-4 in-lock-cycle cleanup applied** (status stays Locked per Doc 04 family precedent). 1 reviewer blocker accepted (RB-05A-V1-22 validation CTE NULL enum check — the round-3 validation used `COUNT(*) FILTER (WHERE difficulty NOT IN (1,2,3))` and similar for source\_family/section; in PostgreSQL `NULL NOT IN (...)` evaluates to NULL (not true), so these checks silently missed NULL difficulty/source\_family/section values which would propagate NULL through downstream CASE/weight computations and produce silent bad math instead of raising MASTERY\_HISTORICAL\_DATA\_INVALID; rewrote all three enum-validation filters with explicit `IS NULL OR ... NOT IN (...)` disjuncts; updated RAISE EXCEPTION message to read "IS NULL or NOT IN" for each enum field; documented the PostgreSQL three-valued-logic rationale inline so future maintainers don't recreate the bug) \+ 1 minor (RB-05A-V1-23 §4.4 prose updated from "acquires a row-level lock" / "Acquire row lock" header to "acquires a student-skill advisory transaction lock" / "Acquire student-skill advisory transaction lock" header — the implementation uses pg\_advisory\_xact\_lock not SELECT FOR UPDATE; behavior unchanged, wording now matches SQL). 23 cleanup tags total RB-05A-V1-01..23, all grep-traceable. |

---

*End of Doc 05A V1.0.*

