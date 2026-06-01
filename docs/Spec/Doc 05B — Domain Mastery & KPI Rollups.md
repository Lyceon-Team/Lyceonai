# **Doc 05B — Domain Mastery & KPI Rollups**

| Field | Value |
| ----- | ----- |
| **Document** | Doc 05B — Domain Mastery & KPI Rollups |
| **Version** | V1.0 |
| **Status** | Locked 2026-05-13 (in-lock-cycle cleanup applied, RB-05B-V1-01..08; no version bump per Doc 04 family precedent) |
| **Scope** | The `student_domain_mastery` row schema and refresh contract; the KPI rollup tables (`student_section_kpi`, `student_domain_kpi`, `student_skill_kpi`, `student_overall_kpi`); the KPI refresh functions invoked synchronously from `apply_mastery_event`; the recency-window constants contract; the guardian aggregate read surface (RLS policies on domain mastery and KPI tables); the pre-implementation verification gate for 05B-owned objects; the domain mastery stress-test fixture mirroring 05A's 31 scenarios at domain grain; the KPI stress-test fixture covering streak-window and edge-case computation. |
| **Audience** | Engineering, AI, Product, Data, Security, QA, Ops |
| **Governed by** | Doc 05 Parent V1.0 (Locked 2026-05-13, RB-05P-V1-01..15) |
| **Depends on** | Doc 00 · Doc 01 · Doc 02 Preamble V3.0 · Doc 02A V6 · Doc 02B V4 · Doc 04 Parent V3.0 · Doc 04A V2.2 · Doc 04C V1.0 · Doc 05A V1.0 |
| **Sibling sub-docs** | 05A (Mastery Formula & Skill Mastery), 05C (Score Projections & Snapshots), 05D (Mastery Audit, Recompute & Constants Governance) |
| **Superseded** | None at the V1 boundary — 05B is a clean-slate sub-doc of the locked Parent. |

---

## **1\. Purpose**

Doc 05B is the implementation contract for **domain-level mastery** and **KPI rollups**. It sits between 05A (skill mastery formula and RPC) and 05C (section projections), and it is the home of guardian-accessible mastery aggregates per Parent acceptance criterion \#19 (RB-05P-V1-12).

This document defines:

* **The domain mastery refresh RPC** `refresh_domain_mastery(student_id, section, domain)`. Invoked by 05A's `apply_mastery_event` in the same database transaction, this function recomputes the per-`(student, section, domain)` mastery row by calling 05A's generic formula function with `p_entity_type = 'domain'`. Per Parent §4.2 and Q1, domain mastery is an **independent event aggregation** at the domain grain — NOT a roll-up of skill mastery values. Same formula, different entity filter, no skill reference.  
* **The `student_domain_mastery` row schema**. Mirrors 05A's `student_skill_mastery` at the domain grain: same columns, same column-level visibility contract, same `constants_snapshot_hash` discipline, but keyed by `(student_id, section, domain)`. The crucial difference is the RLS policy: this table is **guardian-accessible** because per Parent acceptance \#19, guardians may read domain-level mastery (but never skill-level).  
* **Four KPI rollup tables**: `student_section_kpi`, `student_domain_kpi`, `student_skill_kpi`, `student_overall_kpi`. Per Parent §9 and Q2(c), these are *materialized derivatives* of the canonical event history and the mastery rows — never sources of truth.  
* **Four KPI refresh functions**: `refresh_section_kpi`, `refresh_domain_kpi`, `refresh_skill_kpi`, `refresh_overall_kpi`. Per Q3, all four refresh **synchronously** within the same transaction as the upstream `apply_mastery_event` call.  
* **The recency window constants contract**. Per Q4 and RB-05P-V1-15, the windows `KPI_RECENCY_WINDOW_SHORT_DAYS = 7` and `KPI_RECENCY_WINDOW_LONG_DAYS = 30` live in `mastery_constants` and are read by every KPI refresh function. No hardcoded `7` or `30` literals in 05B SQL.  
* **The guardian aggregate read surface**. RLS policies on `student_domain_mastery`, `student_section_kpi`, `student_domain_kpi`, and `student_overall_kpi` grant guardians SELECT access for their linked students subject to active link AND active student entitlement, per Parent §11.1. Guardians explicitly DO NOT get access to `student_skill_kpi`.  
* **The pre-implementation verification gate**. Mirrors 05A §10's structured-report pattern.  
* **The diagnostic post-completion expected state**. After a student completes the 40-question diagnostic (8 SAT domains × 5 events each), all 8 `student_domain_mastery` rows MUST have non-NULL mastery values.  
* **The domain mastery stress-test fixture**. Per Q6, mirrors 05A's 31 baseline+sparse scenarios at the domain grain. Same event sets, same expected mastery values — since domain mastery uses the same formula function as skill mastery, the values MUST match byte-for-byte.  
* **The KPI stress-test fixture**. Per Q7, \~6-8 scenarios covering streak computation, recency window edges, single-event students, and zero-event students.

Doc 05B does NOT define:

* The skill mastery row schema, RPC, or formula function — owned by 05A.  
* The score projection schema or formula — owned by 05C.  
* The audit log table schemas, recompute orchestration, or constants governance lifecycle — owned by 05D.  
* The diagnostic flow UX or question selection logic — owned by Doc 02B.  
* HTTP route handler implementations, request/response payload shapes, error envelope formatting, or pagination — owned by future API surface docs. 05B locks the single-route \+ RLS-gating *contract* (one route per resource, served to both student and guardian; RLS does per-row filtering) and the underlying tables; the route layer above is downstream.

---

## **2\. Doctrine (Sub-Doc Level)**

Doc 05B inherits Parent V1.0's 6 doctrinal principles in full and 05A's 4 sub-doc principles by extension.

In addition, 05B locks five sub-doc-level principles specific to domain mastery and KPI rollups:

### **2.1 Domain mastery is an independent event aggregation, not a roll-up**

Per Parent §4.2 and Q1, `student_domain_mastery` is computed by running the macro-average formula over the union of all events tagged to skills within the target domain. It is NOT computed as a weighted average of `student_skill_mastery` rows. The implementation enforces this by calling `compute_mastery_for_entity(p_entity_type => 'domain', p_skill => NULL, ...)` — the same formula function 05A uses for skills, but with the domain-level entity filter.

The practical consequence: a domain with 5 events spread across 5 skills (one event each, all skills below threshold) STILL has a computed `student_domain_mastery` value, because the domain aggregation crosses the 5-event threshold even though no individual skill does. The student dashboard shows "Domain: Level 2" alongside "Each skill: practice more to see your mastery." Per 05A §11.3, this is correct V1.0 behavior.

### **2.2 KPI tables are materialized derivatives, never sources of truth**

Per Parent §9 and the locked Q2(c) scope, the four KPI tables exist to keep dashboard queries cheap. They MUST be:

* **Reproducible from canonical sources.** A truncate-and-rebuild from `practice_attempts_v0`, `review_error_attempts`, `test_session_answers`, and `mastery_constants` (with a known `T_now`) MUST produce byte-identical row state.  
* **Never the read path for mastery decisions.** Any code path that needs to know "is this student's mastery above threshold" reads `student_skill_mastery` or `student_domain_mastery`, NOT the KPI tables.  
* **Refreshed deterministically up to `T_now`.** The only `now()` dependency is the bounded `T_now` used to evaluate recency-window cutoffs. For determinism testing, `T_now` is injected as a parameter rather than read from `now()`. See §8.3 for the determinism caveat.

### **2.3 KPI refresh is synchronous with mastery refresh**

Per Q3, every `apply_mastery_event` call triggers `refresh_domain_mastery` → `refresh_section_kpi` \+ `refresh_domain_kpi` \+ `refresh_skill_kpi` \+ `refresh_overall_kpi` in the same transaction. If any KPI refresh fails, the transaction rolls back and the original `apply_mastery_event` call fails. The latency cost (\~15-40ms for typical student histories) is accepted in exchange for read-after-write consistency on the dashboard.

If KPI latency becomes a product problem, the migration path is to split the synchronous refreshes into "directly affected entity" (sync) \+ "global aggregates" (async via 05D job). 05B V1.0 does not implement this split; it is a deferred optimization.

### **2.4 Guardian reads are aggregate-only, never per-skill**

Per Parent acceptance criterion \#19 and Q5, guardians MAY SELECT from `student_domain_mastery`, `student_section_kpi`, `student_domain_kpi`, `student_overall_kpi`, and (future) `student_section_projection` rows owned by 05C. Guardians MUST NOT SELECT from `student_skill_mastery` (owned by 05A; no guardian RLS policy), `student_skill_kpi` (per-skill granularity is student-self-only), or the audit tables owned by 05D.

Enforcement: every 05B-owned guardian-accessible table has an explicit `*_guardian_read` RLS policy gated on `(active link, active entitlement)` per Parent §11.1. `student_skill_kpi` has NO guardian policy — denial by absence, matching 05A's `student_skill_mastery` pattern.

### **2.5 Recency windows are constants, not literals**

Per Q4 and RB-05P-V1-15, every recency-window reference in 05B SQL reads from `mastery_constants` rather than hardcoding `7` or `30`. The KPI refresh functions take a `v_constants` jsonb input (same pattern as 05A's `compute_mastery_for_entity`) and extract `KPI_RECENCY_WINDOW_SHORT_DAYS` / `KPI_RECENCY_WINDOW_LONG_DAYS`. This keeps 05B consistent with 05A's no-hardcoded-literals doctrine and enables future window adjustments via a single constants change (governed by 05D).

These two keys are excluded from `constants_snapshot_hash` per Parent §9.1 because they affect KPI rollup output but NOT the mastery formula output. Changing them does not invalidate existing mastery rows.

---

## **3\. Hard Invariants**

Doc 05B enforces 15 hard invariants. Invariants 1–9 are inherited from Parent §6 and apply to all Doc 05 sub-docs; 10–12 are inherited from 05A and re-apply at the 05B grain; 13–15 are 05B-specific.

### **3.1 Invariants inherited from Parent §6**

| \# | Invariant | Parent ref | 05B enforcement |
| ----- | ----- | ----- | ----- |
| 1 | Service-role-only writes on derived tables | Parent §6.1 | RLS policy `student_domain_mastery_service_only_write` and equivalent on all four KPI tables; CI test enforces denial for `authenticated` and `admin_role` writes |
| 2 | Single canonical write path per surface | Parent §6.2 | CI grep guard: only `refresh_domain_mastery` may write `student_domain_mastery`; only the four `refresh_*_kpi` functions may write their corresponding KPI tables |
| 3 | Deterministic recompute | Parent §6.3 | Mastery columns reproducible by truncate-and-rebuild from canonical event history \+ `mastery_constants`. KPI columns reproducible up to the recency-window `T_now` cutoff per §8.3. |
| 4 | Tutor never writes mastery | Parent §6.4 | CI grep guard: no path under `apps/tutor/**` may import 05B's refresh functions |
| 5 | Full-length post-finalization only | Parent §6.5 | `student_domain_mastery` reads canonical events via 05A's `canonical_mastery_events` view-function, which already gates `tss.state = 'submitted'`; KPI refresh inherits the same filter |
| 6 | NULL for cold start / below threshold | Parent §6.6 | `student_domain_mastery.mastery_score IS NULL` when `event_count_total < MIN_EVENTS_FOR_MASTERY` for the domain |
| 7 | Versioned constants, never silent | Parent §6.7 | Every `student_domain_mastery` row write includes `constants_snapshot_hash`; KPI tables include `kpi_refresh_version` |
| 8 | No predicted scores, no AI confidence | Parent §6.8 | KPI tables have no `predicted_*`, `confidence`, or `probability` columns. CI grep against forbidden names. |
| 9 | Audit lifecycle separation from Doc 04D | Parent §6.9 | 05B writes to 05D-owned audit tables only, never to Doc 04D audit tables |

### **3.2 Invariants inherited from 05A and re-applied at 05B grain**

| \# | Invariant | 05A ref | 05B enforcement |
| ----- | ----- | ----- | ----- |
| 10 | Idempotency at the upstream event identity | INV-05A-10 | `refresh_domain_mastery` is idempotent under same canonical event history; KPI refresh functions are idempotent under same source state at same `T_now` |
| 11 | The formula function has a single implementation | INV-05A-11 | `refresh_domain_mastery` MUST call `compute_mastery_for_entity(p_entity_type => 'domain', ...)`. No alternate formula path in 05B. CI grep guard: 05B SQL files MUST NOT contain `weight_source_test`, `position_weight`, or other formula-hallmark expressions outside the canonical function call site. |
| 12 | The exposed-field contract is enforced at the row layer | INV-05A-12 | `student_domain_mastery` exposes `mastery_level` to student-self AND linked-guardian; `mastery_score` / `mastery_pct` / per-source accuracies are admin/internal only via column-level grants. Identical pattern on KPI tables for any future score-like fields. |

### **3.3 05B-specific invariants**

### **INV-05B-13 — Domain mastery is event-aggregated, not skill-rolled-up**

`refresh_domain_mastery` MUST compute domain mastery by invoking `compute_mastery_for_entity` with `p_entity_type = 'domain'`, NOT by aggregating `student_skill_mastery` rows. Enforced via: (a) the function body explicitly calls the entity-typed path; (b) CI test `test_domain_mastery_equals_event_aggregation` constructs a fixture where a domain has N events across multiple skills and asserts the domain mastery matches a from-scratch event-history computation, NOT a skill roll-up.

### **INV-05B-14 — KPI tables are materialized derivatives only**

No code path may treat a KPI table as a source of truth for mastery, entitlement, or eligibility decisions. KPI tables are read-only for product/dashboard consumers; mastery decisions read from `student_skill_mastery` or `student_domain_mastery`. Enforced via CI grep guard: route handlers under `apps/api/**` that read `student_*_kpi` MUST NOT also write `student_*_mastery` based on KPI-table values; the truncate-and-rebuild equivalence test detects silent drift.

### **INV-05B-15 — Recency windows read from constants**

Every recency-window reference in 05B SQL reads from `mastery_constants` via the JSONB constants object — no `INTERVAL '7 days'` or `INTERVAL '30 days'` literals in 05B function bodies. Enforced via CI grep guard against `INTERVAL '\d+ days'` patterns in 05B SQL files.

---

## **4\. `refresh_domain_mastery` RPC Contract**

`refresh_domain_mastery` is the entry point for recomputing per-domain mastery state. It is invoked by 05A's `apply_mastery_event` in the same database transaction as the upstream event commit (per Parent §7.8 / 05A §4.9), and by 05D's batch recompute job during audit-driven recomputes.

### **4.1 Function signature**

CREATE OR REPLACE FUNCTION public.refresh\_domain\_mastery(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_domain      text  
)  
RETURNS public.student\_domain\_mastery  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_constants            jsonb;  
    v\_constants\_hash       text;  
    v\_active\_version       text;  
    v\_before\_score         numeric;  
    v\_before\_level         smallint;  
    v\_total\_events         integer;  
    v\_acc\_test             numeric;  
    v\_acc\_practice         numeric;  
    v\_acc\_review           numeric;  
    v\_mastery\_score        numeric;  
    v\_mastery\_pct          numeric;  
    v\_mastery\_level        smallint;  
    v\_last\_event\_id        uuid;          \-- RB-05B-V1-08  
    v\_last\_event\_occurred\_at timestamptz; \-- RB-05B-V1-08  
    v\_result\_row           public.student\_domain\_mastery;  
BEGIN  
    \-- Body specified in §4.2 through §4.9.  
    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.refresh\_domain\_mastery FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.refresh\_domain\_mastery TO service\_role;

The function is `SECURITY DEFINER` because it writes `student_domain_mastery` rows that no role other than `service_role` may write. `search_path` is locked to prevent search-path injection. Execute permission is restricted to `service_role`.

### **4.2 Input validation**

Step 1: Required-field check  
  \- p\_student\_id IS NOT NULL  
  \- p\_section IS NOT NULL  
  \- p\_domain IS NOT NULL

Step 2: Enum validation  
  \- p\_section ∈ {'M', 'RW'}  
  \- p\_domain MUST be one of the 8 canonical SAT domains per Parent §10.2  
    (canonicality check is BLOCKING in 05B, unlike 05A §4.2 Step 4 which is  
     consultative; 05B's caller is server-internal and should always pass a  
     canonical domain string, so a mismatch is an integration bug)

Step 3: Cross-doc consistency  
  \- The (p\_section, p\_domain) pair MUST be valid per Parent §10.2:  
      M  → {Algebra, Advanced Math, Problem Solving and Data Analysis, Geometry and Trigonometry}  
      RW → {Information and Ideas, Craft and Structure, Expression of Ideas, Standard English Conventions}  
    Cross-section domains (e.g., section='M' AND domain='Information and Ideas') raise  
    DOMAIN\_SECTION\_MISMATCH.

Validation failures raise structured exceptions with error codes per §4.10.

### **4.3 Acquire student-domain advisory transaction lock**

Mirrors 05A §4.4's pattern at the domain grain. `pg_advisory_xact_lock` keyed by `hashtext(student_id || section || domain)`, bounded by `SET LOCAL lock_timeout = '5s'`.

SET LOCAL lock\_timeout \= '5s';

BEGIN  
    PERFORM pg\_advisory\_xact\_lock(  
        hashtext('mastery\_domain|' || p\_student\_id::text || '|' || p\_section || '|' || p\_domain)  
    );  
EXCEPTION  
    WHEN lock\_not\_available OR query\_canceled THEN  
        RAISE EXCEPTION 'MASTERY\_LOCK\_TIMEOUT: could not acquire student-domain advisory lock for (%, %, %) within 5 seconds',  
            p\_student\_id, p\_section, p\_domain;  
END;

The lock keying prefix `'mastery_domain|'` distinguishes this lock from 05A's `'mastery_event|'` and student-skill locks, so they cannot collide on hashtext output.

### **4.4 Read constants and compute snapshot hash**

Identical pattern to 05A §4.5. Reads the canonical constants JSONB and computes the SHA-256 hash of the serialized form.

v\_constants := public.canonicalize\_mastery\_constants();  
v\_constants\_hash := encode(  
    digest(public.canonicalize\_mastery\_constants\_serialized(), 'sha256'),  
    'hex'  
);  
v\_active\_version := v\_constants-\>\>'mastery\_model\_version';

### **4.5 Compute domain mastery via the shared formula function**

Per INV-05B-13 and INV-05A-11, this is the ONLY way 05B computes mastery values: call `compute_mastery_for_entity` with the entity-typed path set to `'domain'` and `p_skill = NULL`.

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
    p\_entity\_type   \=\> 'domain',  
    p\_section       \=\> p\_section,  
    p\_domain        \=\> p\_domain,  
    p\_skill         \=\> NULL  
);

`compute_mastery_for_entity` runs the macro-average formula over the union of events tagged to ANY skill within the domain. Per 05A §6, the function:

* Pulls events from `canonical_mastery_events` (which already gates `tss.state = 'submitted'` for full-length events)  
* Validates the canonical event window via the 6-field NULL-aware check (RB-05A-V1-22)  
* Computes per-source accuracies with position-based recency weighting  
* Returns NULL mastery values when `total_events < MIN_EVENTS_FOR_MASTERY`

Failure modes propagate from the formula function: `MASTERY_HISTORICAL_DATA_INVALID`, `MASTERY_CONSTANTS_MISSING`, `MASTERY_INVALID_ENTITY_TYPE` all originate in `compute_mastery_for_entity` and bubble up.

### **4.6 Capture before-state for audit**

Identical pattern to 05A §4.7 (RB-05A-V1-06). Reads the existing row state under the advisory lock so the audit log can capture the transition.

SELECT mastery\_score, mastery\_level  
INTO   v\_before\_score, v\_before\_level  
FROM   student\_domain\_mastery  
WHERE  student\_id \= p\_student\_id  
  AND  section    \= p\_section  
  AND  domain     \= p\_domain;

If no row exists, `v_before_score` and `v_before_level` are NULL — the correct audit representation of "first refresh for this entity."

### **4.7 Upsert the domain mastery row**

Per RB-05B-V1-08, the upsert captures the most recent canonical event in the domain (audit anchor for incident investigation and 05D recompute traceability). The "most recent" is `argmax(occurred_at)` over the canonical event set, with `event_id` as the tiebreaker. This is the same `(occurred_at DESC, event_id DESC)` ordering used by the formula function's position assignment, so the captured event is always position 1 in the formula computation.

\-- RB-05B-V1-08: capture argmax(occurred\_at) event in this domain for audit parity with 05A  
SELECT cme.event\_id, cme.occurred\_at  
INTO   v\_last\_event\_id, v\_last\_event\_occurred\_at  
FROM   public.canonical\_mastery\_events(p\_student\_id, 'domain', p\_section, p\_domain, NULL) cme  
ORDER BY cme.occurred\_at DESC, cme.event\_id DESC  
LIMIT 1;

\-- v\_last\_event\_id and v\_last\_event\_occurred\_at are NULL if no events exist (cold start) — that is the correct representation.

INSERT INTO student\_domain\_mastery (  
    student\_id, section, domain,  
    mastery\_score, mastery\_pct, mastery\_level,  
    acc\_test, acc\_practice, acc\_review,  
    event\_count\_total,  
    mastery\_model\_version,  
    constants\_snapshot\_hash,  
    computed\_at,  
    last\_event\_id, last\_event\_occurred\_at  
) VALUES (  
    p\_student\_id, p\_section, p\_domain,  
    v\_mastery\_score, v\_mastery\_pct, v\_mastery\_level,  
    v\_acc\_test, v\_acc\_practice, v\_acc\_review,  
    v\_total\_events,  
    v\_active\_version,  
    v\_constants\_hash,  
    now(),  
    v\_last\_event\_id, v\_last\_event\_occurred\_at  
)  
ON CONFLICT (student\_id, section, domain)  
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
    computed\_at               \= EXCLUDED.computed\_at,  
    last\_event\_id             \= EXCLUDED.last\_event\_id,  
    last\_event\_occurred\_at    \= EXCLUDED.last\_event\_occurred\_at  
RETURNING \* INTO v\_result\_row;

`v_last_event_id uuid` and `v_last_event_occurred_at timestamptz` must be added to the `DECLARE` block of `refresh_domain_mastery` alongside the other locals.

The captured anchor is **purely derived** from canonical events at refresh time — it is NOT preserved across refreshes via `GREATEST` or similar. A recompute over the same canonical event set produces a byte-identical `(last_event_id, last_event_occurred_at)` pair, matching the §2.2 truncate-and-rebuild equivalence contract. This is the same discipline applied to `longest_streak_days` per RB-05B-V1-04.

### **4.8 Write audit log entry**

05B writes to the 05D-owned `mastery_domain_refresh_audit_log` (separate table from 05A's `mastery_event_audit_log` because the events are different — 05A logs per-event applications, 05B logs per-domain refreshes).

INSERT INTO mastery\_domain\_refresh\_audit\_log (  
    audit\_row\_id,  
    student\_id, section, domain,  
    mastery\_score\_before, mastery\_score\_after,  
    mastery\_level\_before, mastery\_level\_after,  
    event\_count\_after,  
    constants\_snapshot\_hash,  
    mastery\_model\_version,  
    triggered\_by,  
    applied\_at  
) VALUES (  
    gen\_random\_uuid(),  
    p\_student\_id, p\_section, p\_domain,  
    v\_before\_score, v\_mastery\_score,  
    v\_before\_level, v\_mastery\_level,  
    v\_total\_events,  
    v\_constants\_hash,  
    v\_active\_version,  
    current\_setting('app.mastery\_refresh\_trigger', true),  
    now()  
);

05D defines the audit table schema and the `triggered_by` enum. 05B's contract is: every domain refresh writes one audit row.

### **4.9 Trigger downstream KPI refreshes**

After the domain mastery row is written, `refresh_domain_mastery` calls all four KPI refresh functions in the same transaction per §2.3.

PERFORM public.refresh\_section\_kpi(p\_student\_id, p\_section);  
PERFORM public.refresh\_domain\_kpi(p\_student\_id, p\_section, p\_domain);  
PERFORM public.refresh\_skill\_kpi(p\_student\_id, p\_section, p\_domain);  
PERFORM public.refresh\_overall\_kpi(p\_student\_id);

The skill-KPI refresh covers all skills in the affected domain because a new event in a domain affects per-skill event counts and accuracies; refreshing only the directly-touched skill would leave the domain's other skills with stale KPIs.

If KPI latency proves problematic, the documented migration path is to split this into "directly affected entity" (sync) plus "global rollups" (async via 05D job).

### **4.10 Error handling**

| Error code | When raised | HTTP equivalent |
| ----- | ----- | ----- |
| `MASTERY_VALIDATION_FAILED` | §4.2 input validation failure | 400 |
| `DOMAIN_SECTION_MISMATCH` | §4.2 Step 3 cross-section domain | 400 |
| `MASTERY_LOCK_TIMEOUT` | §4.3 advisory lock acquisition exceeds 5 seconds | 503 |
| `MASTERY_CONSTANTS_MISSING` | §4.4 cannot read required constants | 500 |
| `MASTERY_COMPUTE_FAILED` | §4.5 `compute_mastery_for_entity` raises | 500 |
| `MASTERY_HISTORICAL_DATA_INVALID` | §4.5 propagated from formula function | 500 |
| `MASTERY_AUDIT_WRITE_FAILED` | §4.8 audit insert fails | 500 |
| `KPI_REFRESH_FAILED` | §4.9 any KPI refresh raises | 500 |

All errors cause transaction rollback. The caller (typically `apply_mastery_event`) sees no partial state.

---

## **5\. `student_domain_mastery` Row Schema**

### **5.1 Table definition**

CREATE TABLE IF NOT EXISTS public.student\_domain\_mastery (  
    \-- Identity  
    student\_id              uuid          NOT NULL,  
    section                 text          NOT NULL CHECK (section IN ('M', 'RW')),  
    domain                  text          NOT NULL,

    \-- Mastery values (Parent §4 \+ Parent §10.1)  
    mastery\_score           numeric(5,4)  NULL,  
    mastery\_pct             numeric(5,2)  NULL,  
    mastery\_level           smallint      NULL CHECK (mastery\_level IS NULL OR mastery\_level BETWEEN 0 AND 4),

    \-- Per-source accuracies (admin/internal visibility only)  
    acc\_test                numeric(7,6)  NULL,  
    acc\_practice            numeric(7,6)  NULL,  
    acc\_review              numeric(7,6)  NULL,

    \-- Evidence counter  
    event\_count\_total       integer       NOT NULL DEFAULT 0 CHECK (event\_count\_total \>= 0),

    \-- Versioning and audit anchors  
    mastery\_model\_version   text          NOT NULL DEFAULT 'v1.0',  
    constants\_snapshot\_hash text          NOT NULL,  
    computed\_at             timestamptz   NOT NULL DEFAULT now(),

    \-- Per RB-05B-V1-08: most recent canonical event in the domain (audit parity with 05A's student\_skill\_mastery)  
    last\_event\_id           uuid          NULL,  
    last\_event\_occurred\_at  timestamptz   NULL,

    PRIMARY KEY (student\_id, section, domain)  
);

CREATE INDEX IF NOT EXISTS idx\_student\_domain\_mastery\_student  
    ON public.student\_domain\_mastery (student\_id);

CREATE INDEX IF NOT EXISTS idx\_student\_domain\_mastery\_student\_section  
    ON public.student\_domain\_mastery (student\_id, section);

CREATE INDEX IF NOT EXISTS idx\_student\_domain\_mastery\_computed\_at  
    ON public.student\_domain\_mastery (computed\_at);

### **5.2 Column-level visibility contract**

| Column | Visibility | Notes |
| ----- | ----- | ----- |
| `student_id` | student-self \+ linked-guardian \+ admin/service | Identity |
| `section` | student-self \+ linked-guardian \+ admin/service | Identity |
| `domain` | student-self \+ linked-guardian \+ admin/service | Identity |
| `mastery_score` | service\_role, admin only | **NOT exposed to student or guardian per RB-05P-V1-14** |
| `mastery_pct` | service\_role, admin only | **NOT exposed to student or guardian per RB-05P-V1-14** |
| `mastery_level` | student-self \+ linked-guardian \+ admin/service | **The single mastery value exposed to student AND guardian routes. This is the guardian-facing domain mastery indicator.** |
| `acc_test` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `acc_practice` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `acc_review` | service\_role, admin only | Per-source diagnostic; never client-exposed |
| `event_count_total` | service\_role, admin only | May be exposed to admin tooling; never client |
| `mastery_model_version` | service\_role, admin only | Audit |
| `constants_snapshot_hash` | service\_role, admin only | Audit |
| `computed_at` | student-self \+ linked-guardian \+ admin/service | Allows the UI to show "last updated 2 hours ago" |
| `last_event_id` | service\_role, admin only | Audit anchor; not exposed to client routes |
| `last_event_occurred_at` | service\_role, admin only | Audit anchor; identifies the event that triggered the most recent refresh |

### **5.3 RLS policies**

ALTER TABLE public.student\_domain\_mastery ENABLE ROW LEVEL SECURITY;

\-- WRITE policy: only service\_role may INSERT/UPDATE/DELETE.  
\-- (No policy granting write to authenticated; absence is the denial.)

\-- READ policy: students may read their own rows.  
CREATE POLICY student\_domain\_mastery\_student\_read  
    ON public.student\_domain\_mastery  
    FOR SELECT  
    TO authenticated  
    USING (  
        student\_id \= auth.uid()  
    );

\-- READ policy: guardians may read rows for their linked students,  
\-- provided BOTH (a) the guardian link is active AND (b) the student  
\-- has an active entitlement. Per Parent §11.1.  
CREATE POLICY student\_domain\_mastery\_guardian\_read  
    ON public.student\_domain\_mastery  
    FOR SELECT  
    TO authenticated  
    USING (  
        student\_id IN (  
            SELECT linked\_student\_id  
            FROM   public.guardian\_student\_links gsl  
            WHERE  gsl.guardian\_id \= auth.uid()  
              AND  gsl.link\_active \= true  
              AND  EXISTS (  
                  SELECT 1 FROM public.student\_entitlements se  
                  WHERE  se.student\_id \= gsl.linked\_student\_id  
                    AND  se.active     \= true  
              )  
        )  
    );

The guardian policy is the **critical difference from 05A's `student_skill_mastery`**: 05A has no guardian policy at all (per Parent acceptance \#19, guardians never see skill-level mastery). 05B's `student_domain_mastery` is where guardian aggregate mastery access lives.

### **5.4 Column-level grants**

REVOKE ALL ON public.student\_domain\_mastery FROM PUBLIC;

GRANT ALL ON public.student\_domain\_mastery TO service\_role;

GRANT SELECT (  
    student\_id, section, domain, mastery\_level, computed\_at  
) ON public.student\_domain\_mastery TO authenticated;

GRANT SELECT ON public.student\_domain\_mastery TO admin\_role;

The combination of RLS policies (which row visibility) and column GRANTs (which column visibility) provides defense-in-depth identical to 05A's pattern.

### **5.5 Lifecycle**

| Trigger | Effect |
| ----- | ----- |
| First eligible event in a `(student, domain)` while `event_count_total < 5` | INSERT row with `mastery_score = NULL, mastery_pct = NULL, mastery_level = NULL, event_count_total = N`. |
| Threshold-crossing event (`event_count_total` transitions from 4 to 5\) | UPDATE row with computed `mastery_score`, `mastery_pct`, `mastery_level`. |
| Subsequent events | UPDATE row with recomputed values |
| Recompute invocation (from 05D batch job) | UPDATE row to current canonical values |
| Student account deletion | Per Parent §11.1, row is removed in the same transaction as the identity row. 05D owns the cascade definition. |

---

## **6\. KPI Rollup Tables**

Per Q2(c), 05B locks four KPI rollup tables. All four are materialized derivatives per §2.2 — reproducible from canonical sources, never used as the read path for mastery decisions.

### **6.1 `student_section_kpi`**

Per-section engagement and accuracy aggregates. One row per `(student_id, section)`.

CREATE TABLE IF NOT EXISTS public.student\_section\_kpi (  
    student\_id            uuid          NOT NULL,  
    section               text          NOT NULL CHECK (section IN ('M', 'RW')),

    \-- Event counts  
    events\_total          integer       NOT NULL DEFAULT 0 CHECK (events\_total \>= 0),  
    events\_last\_7d        integer       NOT NULL DEFAULT 0 CHECK (events\_last\_7d \>= 0),  
    events\_last\_30d       integer       NOT NULL DEFAULT 0 CHECK (events\_last\_30d \>= 0),

    \-- Accuracy (raw correct/total, NOT formula-weighted)  
    accuracy\_overall      numeric(5,4)  NULL,  
    accuracy\_last\_7d      numeric(5,4)  NULL,  
    accuracy\_last\_30d     numeric(5,4)  NULL,

    \-- Engagement  
    current\_streak\_days   integer       NOT NULL DEFAULT 0 CHECK (current\_streak\_days \>= 0),  
    last\_active\_at        timestamptz   NULL,

    \-- Audit  
    kpi\_refresh\_version   text          NOT NULL DEFAULT 'v1.0',  
    refreshed\_at          timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now    timestamptz   NOT NULL,

    PRIMARY KEY (student\_id, section)  
);

CREATE INDEX IF NOT EXISTS idx\_student\_section\_kpi\_student  
    ON public.student\_section\_kpi (student\_id);

**Accuracy definition.** `accuracy_overall = correct_events / total_events`. This is NOT the formula-weighted accuracy (no difficulty weights, no recency weighting). KPI accuracy is "what fraction did you get right" — a simpler engagement signal. The formula-weighted accuracy lives in `student_skill_mastery.acc_*` and `student_domain_mastery.acc_*` for admin/audit use only.

### **6.2 `student_domain_kpi`**

Per-domain engagement and accuracy aggregates. One row per `(student_id, section, domain)`.

CREATE TABLE IF NOT EXISTS public.student\_domain\_kpi (  
    student\_id            uuid          NOT NULL,  
    section               text          NOT NULL CHECK (section IN ('M', 'RW')),  
    domain                text          NOT NULL,

    events\_total          integer       NOT NULL DEFAULT 0 CHECK (events\_total \>= 0),  
    events\_last\_7d        integer       NOT NULL DEFAULT 0 CHECK (events\_last\_7d \>= 0),  
    events\_last\_30d       integer       NOT NULL DEFAULT 0 CHECK (events\_last\_30d \>= 0),

    accuracy\_overall      numeric(5,4)  NULL,  
    accuracy\_last\_7d      numeric(5,4)  NULL,  
    accuracy\_last\_30d     numeric(5,4)  NULL,

    last\_active\_at        timestamptz   NULL,

    kpi\_refresh\_version   text          NOT NULL DEFAULT 'v1.0',  
    refreshed\_at          timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now    timestamptz   NOT NULL,

    PRIMARY KEY (student\_id, section, domain)  
);

CREATE INDEX IF NOT EXISTS idx\_student\_domain\_kpi\_student  
    ON public.student\_domain\_kpi (student\_id);

CREATE INDEX IF NOT EXISTS idx\_student\_domain\_kpi\_student\_section  
    ON public.student\_domain\_kpi (student\_id, section);

Note: `student_domain_kpi` does NOT carry `current_streak_days` — streaks are a student-wide concept, not a domain-wide one. Streak lives on `student_section_kpi` (per-section streak interpretation) and `student_overall_kpi` (overall streak).

### **6.3 `student_skill_kpi`**

Per-skill engagement aggregates. One row per `(student_id, section, domain, skill)`. **Student-self-only access** — guardians cannot read this table per §2.4.

CREATE TABLE IF NOT EXISTS public.student\_skill\_kpi (  
    student\_id            uuid          NOT NULL,  
    section               text          NOT NULL CHECK (section IN ('M', 'RW')),  
    domain                text          NOT NULL,  
    skill                 text          NOT NULL,

    events\_total          integer       NOT NULL DEFAULT 0 CHECK (events\_total \>= 0),  
    events\_last\_7d        integer       NOT NULL DEFAULT 0 CHECK (events\_last\_7d \>= 0),  
    events\_last\_30d       integer       NOT NULL DEFAULT 0 CHECK (events\_last\_30d \>= 0),

    accuracy\_overall      numeric(5,4)  NULL,  
    accuracy\_last\_7d      numeric(5,4)  NULL,  
    accuracy\_last\_30d     numeric(5,4)  NULL,

    last\_active\_at        timestamptz   NULL,

    kpi\_refresh\_version   text          NOT NULL DEFAULT 'v1.0',  
    refreshed\_at          timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now    timestamptz   NOT NULL,

    PRIMARY KEY (student\_id, section, domain, skill)  
);

CREATE INDEX IF NOT EXISTS idx\_student\_skill\_kpi\_student  
    ON public.student\_skill\_kpi (student\_id);

CREATE INDEX IF NOT EXISTS idx\_student\_skill\_kpi\_student\_section\_domain  
    ON public.student\_skill\_kpi (student\_id, section, domain);

### **6.4 `student_overall_kpi`**

Per-student-wide aggregates. One row per student.

CREATE TABLE IF NOT EXISTS public.student\_overall\_kpi (  
    student\_id            uuid          NOT NULL,

    events\_total          integer       NOT NULL DEFAULT 0 CHECK (events\_total \>= 0),  
    events\_last\_7d        integer       NOT NULL DEFAULT 0 CHECK (events\_last\_7d \>= 0),  
    events\_last\_30d       integer       NOT NULL DEFAULT 0 CHECK (events\_last\_30d \>= 0),

    accuracy\_overall      numeric(5,4)  NULL,  
    accuracy\_last\_7d      numeric(5,4)  NULL,  
    accuracy\_last\_30d     numeric(5,4)  NULL,

    sections\_active       smallint      NOT NULL DEFAULT 0 CHECK (sections\_active BETWEEN 0 AND 2),

    current\_streak\_days   integer       NOT NULL DEFAULT 0 CHECK (current\_streak\_days \>= 0),  
    longest\_streak\_days   integer       NOT NULL DEFAULT 0 CHECK (longest\_streak\_days \>= 0),  
    last\_active\_at        timestamptz   NULL,

    kpi\_refresh\_version   text          NOT NULL DEFAULT 'v1.0',  
    refreshed\_at          timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now    timestamptz   NOT NULL,

    PRIMARY KEY (student\_id)  
);

### **6.5 Column-level visibility contract**

KPI tables expose engagement metrics, NOT mastery scores. Accuracy columns are exposed (they're "what fraction did you get right" — a simpler signal than mastery).

| Column type | Visibility | Notes |
| ----- | ----- | ----- |
| Identity (`student_id`, `section`, `domain`, `skill`) | all roles | Identity |
| Event counts (`events_total`, `events_last_7d`, `events_last_30d`) | student-self \+ linked-guardian (where applicable) \+ admin/service | Engagement metric |
| Accuracy (`accuracy_overall`, `accuracy_last_*d`) | student-self \+ linked-guardian (where applicable) \+ admin/service | Raw correct/total fraction |
| Engagement (`current_streak_days`, `last_active_at`) | student-self \+ linked-guardian (where applicable) \+ admin/service | Engagement metric |
| `longest_streak_days` (overall only) | student-self \+ linked-guardian \+ admin/service | Engagement metric |
| `sections_active` (overall only) | student-self \+ linked-guardian \+ admin/service | Engagement breadth |
| Audit (`kpi_refresh_version`, `refreshed_at`, `refreshed_at_t_now`) | service\_role, admin only | Audit |

`student_skill_kpi` exposes the same fields to student-self only — no guardian access at all per §2.4.

### **6.6 RLS policies (table-by-table)**

\-- \============================================================  
\-- student\_section\_kpi: student-self read \+ linked-guardian read  
\-- \============================================================  
ALTER TABLE public.student\_section\_kpi ENABLE ROW LEVEL SECURITY;

CREATE POLICY student\_section\_kpi\_student\_read  
    ON public.student\_section\_kpi FOR SELECT TO authenticated  
    USING (student\_id \= auth.uid());

CREATE POLICY student\_section\_kpi\_guardian\_read  
    ON public.student\_section\_kpi FOR SELECT TO authenticated  
    USING (  
        student\_id IN (  
            SELECT linked\_student\_id FROM public.guardian\_student\_links gsl  
            WHERE gsl.guardian\_id \= auth.uid() AND gsl.link\_active \= true  
              AND EXISTS (  
                  SELECT 1 FROM public.student\_entitlements se  
                  WHERE se.student\_id \= gsl.linked\_student\_id AND se.active \= true  
              )  
        )  
    );

\-- \============================================================  
\-- student\_domain\_kpi: same dual-policy pattern as section\_kpi  
\-- \============================================================  
ALTER TABLE public.student\_domain\_kpi ENABLE ROW LEVEL SECURITY;

CREATE POLICY student\_domain\_kpi\_student\_read  
    ON public.student\_domain\_kpi FOR SELECT TO authenticated  
    USING (student\_id \= auth.uid());

CREATE POLICY student\_domain\_kpi\_guardian\_read  
    ON public.student\_domain\_kpi FOR SELECT TO authenticated  
    USING (  
        student\_id IN (  
            SELECT linked\_student\_id FROM public.guardian\_student\_links gsl  
            WHERE gsl.guardian\_id \= auth.uid() AND gsl.link\_active \= true  
              AND EXISTS (  
                  SELECT 1 FROM public.student\_entitlements se  
                  WHERE se.student\_id \= gsl.linked\_student\_id AND se.active \= true  
              )  
        )  
    );

\-- \============================================================  
\-- student\_skill\_kpi: STUDENT-SELF ONLY — no guardian policy per §2.4  
\-- \============================================================  
ALTER TABLE public.student\_skill\_kpi ENABLE ROW LEVEL SECURITY;

CREATE POLICY student\_skill\_kpi\_student\_read  
    ON public.student\_skill\_kpi FOR SELECT TO authenticated  
    USING (student\_id \= auth.uid());

\-- NO student\_skill\_kpi\_guardian\_read policy. Per §2.4, guardians do not see  
\-- per-skill granularity. Denial by absence, matching 05A's pattern for  
\-- student\_skill\_mastery.

\-- \============================================================  
\-- student\_overall\_kpi: same dual-policy pattern  
\-- \============================================================  
ALTER TABLE public.student\_overall\_kpi ENABLE ROW LEVEL SECURITY;

CREATE POLICY student\_overall\_kpi\_student\_read  
    ON public.student\_overall\_kpi FOR SELECT TO authenticated  
    USING (student\_id \= auth.uid());

CREATE POLICY student\_overall\_kpi\_guardian\_read  
    ON public.student\_overall\_kpi FOR SELECT TO authenticated  
    USING (  
        student\_id IN (  
            SELECT linked\_student\_id FROM public.guardian\_student\_links gsl  
            WHERE gsl.guardian\_id \= auth.uid() AND gsl.link\_active \= true  
              AND EXISTS (  
                  SELECT 1 FROM public.student\_entitlements se  
                  WHERE se.student\_id \= gsl.linked\_student\_id AND se.active \= true  
              )  
        )  
    );

### **6.7 Column-level grants (table-by-table)**

REVOKE ALL ON public.student\_section\_kpi  FROM PUBLIC;  
REVOKE ALL ON public.student\_domain\_kpi   FROM PUBLIC;  
REVOKE ALL ON public.student\_skill\_kpi    FROM PUBLIC;  
REVOKE ALL ON public.student\_overall\_kpi  FROM PUBLIC;

GRANT ALL ON public.student\_section\_kpi   TO service\_role;  
GRANT ALL ON public.student\_domain\_kpi    TO service\_role;  
GRANT ALL ON public.student\_skill\_kpi     TO service\_role;  
GRANT ALL ON public.student\_overall\_kpi   TO service\_role;

GRANT SELECT (  
    student\_id, section,  
    events\_total, events\_last\_7d, events\_last\_30d,  
    accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
    current\_streak\_days, last\_active\_at  
) ON public.student\_section\_kpi TO authenticated;

GRANT SELECT (  
    student\_id, section, domain,  
    events\_total, events\_last\_7d, events\_last\_30d,  
    accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
    last\_active\_at  
) ON public.student\_domain\_kpi TO authenticated;

GRANT SELECT (  
    student\_id, section, domain, skill,  
    events\_total, events\_last\_7d, events\_last\_30d,  
    accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
    last\_active\_at  
) ON public.student\_skill\_kpi TO authenticated;

GRANT SELECT (  
    student\_id,  
    events\_total, events\_last\_7d, events\_last\_30d,  
    accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
    sections\_active,  
    current\_streak\_days, longest\_streak\_days, last\_active\_at  
) ON public.student\_overall\_kpi TO authenticated;

GRANT SELECT ON public.student\_section\_kpi  TO admin\_role;  
GRANT SELECT ON public.student\_domain\_kpi   TO admin\_role;  
GRANT SELECT ON public.student\_skill\_kpi    TO admin\_role;  
GRANT SELECT ON public.student\_overall\_kpi  TO admin\_role;

The audit columns (`kpi_refresh_version`, `refreshed_at`, `refreshed_at_t_now`) are omitted from authenticated grants — admin/service only.

---

## **7\. KPI Refresh Functions**

The four KPI refresh functions are pure-derivation functions: they read canonical event tables and `mastery_constants`, compute KPI values, and upsert into the corresponding KPI table. They are invoked synchronously from `refresh_domain_mastery` §4.9.

### **7.1 Shared pattern**

All four functions share the same structural pattern:

1\. Acquire student-scoped advisory transaction lock  
2\. Read KPI recency windows via \`read\_kpi\_recency\_constants()\` (§9.1, RB-05B-V1-01)  
3\. Compute T\_now := now()  (or read from optional parameter for determinism testing)  
4\. Validate canonical data integrity — raise KPI\_HISTORICAL\_DATA\_INVALID on any NULL \`correct\`/\`occurred\_at\` (RB-05B-V1-02)  
5\. Build canonical event view filtered to the entity grain  
6\. Compute counts, accuracies, streak (where applicable), last\_active\_at  
7\. Upsert into the KPI table with refreshed\_at\_t\_now populated

The `T_now` parameter (`p_t_now timestamptz DEFAULT now()`) exists for two reasons:

* **Determinism testing.** CI fixtures inject a fixed `T_now` so the test asserts against deterministic expected output.  
* **Truncate-and-rebuild equivalence.** 05D's batch recompute passes `T_now` to ensure two recompute runs of the same canonical history produce identical KPI values.

In production, `apply_mastery_event` does NOT pass `T_now`; the default `now()` is used. This means in production, two `apply_mastery_event` calls for the same event seconds apart could produce slightly different KPI rows (the recency-window cutoff shifts). The KPI tables are explicitly NOT pure-deterministic under wall-clock variation — only deterministic-up-to-`T_now` (§2.2 \+ §8.3).

### **7.1.1 Canonical event source taxonomy (RB-05B-V1-07)**

Per RB-05B-V1-07, each KPI refresh function reimplements the 3-branch UNION (`practice_attempts_v0` \+ `review_error_attempts` \+ `test_session_answers` JOIN `test_session_sections` WHERE `tss.state = 'submitted'`). This duplication is a known drift risk: if Doc 04 or Doc 02 changes the canonical event source taxonomy — adds a fourth source, renames a column, changes the test-finalization seam — the 4 refresh fns plus `compute_streak_days` MUST all be updated in lockstep, or KPI values silently diverge from 05A's `canonical_mastery_events`.

The mitigation is a **CI grep-equivalence guard**, enforced by tests that fail loudly on drift:

| Guard | Pattern checked | Fails on |
| ----- | ----- | ----- |
| `canonical_sources_kpi_vs_05a` | `practice_attempts_v0`, `review_error_attempts`, `test_session_answers` source-table references count and shape in 05B refresh fns | Source table added/removed in 05A but not propagated to 05B |
| `tss_submitted_gate_kpi` | Every `test_session_answers` JOIN in 05B includes `tss.state = 'submitted'` | A KPI fn drops the Doc 04A seam |
| `kpi_event_column_taxonomy` | KPI fns project `correct`, `occurred_at` (or `answered_at` aliased to `occurred_at`), `section`, `domain`, `skill` — matching 05A's canonical event columns | A column is renamed in canonical sources but not in 05B |

These guards run in CI alongside the §13/§14 fixture tests. They are documented as part of the 05B release gate, not enforced at runtime. If a future change splits canonical events into a 05A-owned function returning a query-able set, the 4 refresh fns SHOULD migrate to consuming that function; for V1.0 the duplication is accepted with the guards above as the safety net.

### **7.2 `refresh_section_kpi`**

CREATE OR REPLACE FUNCTION public.refresh\_section\_kpi(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS public.student\_section\_kpi  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_short\_days           integer;  
    v\_long\_days            integer;  
    v\_bad\_count            integer;  
    v\_t\_short\_cutoff       timestamptz;  
    v\_t\_long\_cutoff        timestamptz;  
    v\_result\_row           public.student\_section\_kpi;  
BEGIN  
    SET LOCAL lock\_timeout \= '5s';  
    BEGIN  
        PERFORM pg\_advisory\_xact\_lock(  
            hashtext('kpi\_section|' || p\_student\_id::text || '|' || p\_section)  
        );  
    EXCEPTION  
        WHEN lock\_not\_available OR query\_canceled THEN  
            RAISE EXCEPTION 'KPI\_LOCK\_TIMEOUT: section KPI lock (%, %)', p\_student\_id, p\_section;  
    END;

    \-- Per RB-05B-V1-01: KPI windows read via dedicated helper, NOT canonicalize\_mastery\_constants()  
    SELECT short\_days, long\_days  
    INTO   v\_short\_days, v\_long\_days  
    FROM   public.read\_kpi\_recency\_constants();  
    v\_t\_short\_cutoff := p\_t\_now \- make\_interval(days \=\> v\_short\_days);  
    v\_t\_long\_cutoff  := p\_t\_now \- make\_interval(days \=\> v\_long\_days);

    \-- Per RB-05B-V1-02: validate canonical data integrity (NO silent NULL filter)  
    SELECT count(\*) INTO v\_bad\_count  
    FROM (  
        SELECT pa.correct, pa.occurred\_at FROM practice\_attempts\_v0 pa  
        WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section  
        UNION ALL  
        SELECT ra.correct, ra.occurred\_at FROM review\_error\_attempts ra  
        WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section  
        UNION ALL  
        SELECT tsa.correct, tsa.answered\_at FROM test\_session\_answers tsa  
        JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
        JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                        AND tss.section\_index \= tsa.section\_index  
        WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section  
          AND tss.state \= 'submitted'  
    ) e  
    WHERE e.correct IS NULL OR e.occurred\_at IS NULL;

    IF v\_bad\_count \> 0 THEN  
        RAISE EXCEPTION 'KPI\_HISTORICAL\_DATA\_INVALID: % canonical rows have NULL correct/occurred\_at for student %, section % (refresh\_section\_kpi)', v\_bad\_count, p\_student\_id, p\_section;  
    END IF;

    WITH section\_events AS (  
        SELECT \*  
        FROM (  
            SELECT pa.section, pa.correct, pa.occurred\_at  
            FROM practice\_attempts\_v0 pa  
            WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section  
            UNION ALL  
            SELECT ra.section, ra.correct, ra.occurred\_at  
            FROM review\_error\_attempts ra  
            WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section  
            UNION ALL  
            SELECT tsa.section, tsa.correct, tsa.answered\_at AS occurred\_at  
            FROM test\_session\_answers tsa  
            JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
            JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                            AND tss.section\_index \= tsa.section\_index  
            WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section  
              AND tss.state \= 'submitted'  
        ) e  
    ),  
    aggregates AS (  
        SELECT  
            COUNT(\*)                                                    AS evt\_total,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff)     AS evt\_7d,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff)      AS evt\_30d,  
            CASE WHEN COUNT(\*) \> 0  
                 THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(\*)  
                 ELSE NULL  
            END AS acc\_overall,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) \> 0  
                 THEN SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_short\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff)  
                 ELSE NULL  
            END AS acc\_7d,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff) \> 0  
                 THEN SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_long\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff)  
                 ELSE NULL  
            END AS acc\_30d,  
            MAX(occurred\_at) AS last\_active  
        FROM section\_events  
    ),  
    streak AS (  
        SELECT public.compute\_streak\_days(  
            p\_student\_id, p\_section, NULL::text, NULL::text, p\_t\_now  
        ) AS current\_streak  
    )  
    INSERT INTO student\_section\_kpi (  
        student\_id, section,  
        events\_total, events\_last\_7d, events\_last\_30d,  
        accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
        current\_streak\_days, last\_active\_at,  
        kpi\_refresh\_version, refreshed\_at, refreshed\_at\_t\_now  
    )  
    SELECT  
        p\_student\_id, p\_section,  
        a.evt\_total, a.evt\_7d, a.evt\_30d,  
        ROUND(a.acc\_overall, 4), ROUND(a.acc\_7d, 4), ROUND(a.acc\_30d, 4),  
        s.current\_streak, a.last\_active,  
        'v1.0', now(), p\_t\_now  
    FROM aggregates a CROSS JOIN streak s  
    ON CONFLICT (student\_id, section) DO UPDATE SET  
        events\_total          \= EXCLUDED.events\_total,  
        events\_last\_7d        \= EXCLUDED.events\_last\_7d,  
        events\_last\_30d       \= EXCLUDED.events\_last\_30d,  
        accuracy\_overall      \= EXCLUDED.accuracy\_overall,  
        accuracy\_last\_7d      \= EXCLUDED.accuracy\_last\_7d,  
        accuracy\_last\_30d     \= EXCLUDED.accuracy\_last\_30d,  
        current\_streak\_days   \= EXCLUDED.current\_streak\_days,  
        last\_active\_at        \= EXCLUDED.last\_active\_at,  
        kpi\_refresh\_version   \= EXCLUDED.kpi\_refresh\_version,  
        refreshed\_at          \= EXCLUDED.refreshed\_at,  
        refreshed\_at\_t\_now    \= EXCLUDED.refreshed\_at\_t\_now  
    RETURNING \* INTO v\_result\_row;

    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.refresh\_section\_kpi FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.refresh\_section\_kpi TO service\_role;

### **7.3 `refresh_domain_kpi`**

Same structural shape as §7.2, with two differences:

* Lock key includes `domain` in the hash  
* Event view filters by `domain` as well as section  
* No streak column (per §6.2)

CREATE OR REPLACE FUNCTION public.refresh\_domain\_kpi(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_domain      text,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS public.student\_domain\_kpi  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_short\_days           integer;  
    v\_long\_days            integer;  
    v\_bad\_count            integer;  
    v\_t\_short\_cutoff       timestamptz;  
    v\_t\_long\_cutoff        timestamptz;  
    v\_result\_row           public.student\_domain\_kpi;  
BEGIN  
    SET LOCAL lock\_timeout \= '5s';  
    BEGIN  
        PERFORM pg\_advisory\_xact\_lock(  
            hashtext('kpi\_domain|' || p\_student\_id::text || '|' || p\_section || '|' || p\_domain)  
        );  
    EXCEPTION  
        WHEN lock\_not\_available OR query\_canceled THEN  
            RAISE EXCEPTION 'KPI\_LOCK\_TIMEOUT: domain KPI lock (%, %, %)',  
                p\_student\_id, p\_section, p\_domain;  
    END;

    \-- Per RB-05B-V1-01: KPI windows read via dedicated helper, NOT canonicalize\_mastery\_constants()  
    SELECT short\_days, long\_days  
    INTO   v\_short\_days, v\_long\_days  
    FROM   public.read\_kpi\_recency\_constants();  
    v\_t\_short\_cutoff := p\_t\_now \- make\_interval(days \=\> v\_short\_days);  
    v\_t\_long\_cutoff  := p\_t\_now \- make\_interval(days \=\> v\_long\_days);

    \-- Per RB-05B-V1-02: validate canonical data integrity (NO silent NULL filter)  
    SELECT count(\*) INTO v\_bad\_count  
    FROM (  
        SELECT pa.correct, pa.occurred\_at FROM practice\_attempts\_v0 pa  
        WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section AND pa.domain \= p\_domain  
        UNION ALL  
        SELECT ra.correct, ra.occurred\_at FROM review\_error\_attempts ra  
        WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section AND ra.domain \= p\_domain  
        UNION ALL  
        SELECT tsa.correct, tsa.answered\_at FROM test\_session\_answers tsa  
        JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
        JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                        AND tss.section\_index \= tsa.section\_index  
        WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section AND tsa.domain \= p\_domain  
          AND tss.state \= 'submitted'  
    ) e  
    WHERE e.correct IS NULL OR e.occurred\_at IS NULL;

    IF v\_bad\_count \> 0 THEN  
        RAISE EXCEPTION 'KPI\_HISTORICAL\_DATA\_INVALID: % canonical rows have NULL correct/occurred\_at for student %, section %, domain % (refresh\_domain\_kpi)', v\_bad\_count, p\_student\_id, p\_section, p\_domain;  
    END IF;

    WITH domain\_events AS (  
        SELECT correct, occurred\_at FROM (  
            SELECT pa.correct, pa.occurred\_at  
            FROM practice\_attempts\_v0 pa  
            WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section AND pa.domain \= p\_domain  
            UNION ALL  
            SELECT ra.correct, ra.occurred\_at  
            FROM review\_error\_attempts ra  
            WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section AND ra.domain \= p\_domain  
            UNION ALL  
            SELECT tsa.correct, tsa.answered\_at  
            FROM test\_session\_answers tsa  
            JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
            JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                            AND tss.section\_index \= tsa.section\_index  
            WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section AND tsa.domain \= p\_domain  
              AND tss.state \= 'submitted'  
        ) e  
    ),  
    aggregates AS (  
        SELECT  
            COUNT(\*) AS evt\_total,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) AS evt\_7d,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff)  AS evt\_30d,  
            CASE WHEN COUNT(\*) \> 0  
                 THEN SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(\*)  
                 ELSE NULL END AS acc\_overall,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) \> 0  
                 THEN SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_short\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff)  
                 ELSE NULL END AS acc\_7d,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff) \> 0  
                 THEN SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_long\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff)  
                 ELSE NULL END AS acc\_30d,  
            MAX(occurred\_at) AS last\_active  
        FROM domain\_events  
    )  
    INSERT INTO student\_domain\_kpi (  
        student\_id, section, domain,  
        events\_total, events\_last\_7d, events\_last\_30d,  
        accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
        last\_active\_at,  
        kpi\_refresh\_version, refreshed\_at, refreshed\_at\_t\_now  
    )  
    SELECT  
        p\_student\_id, p\_section, p\_domain,  
        a.evt\_total, a.evt\_7d, a.evt\_30d,  
        ROUND(a.acc\_overall, 4), ROUND(a.acc\_7d, 4), ROUND(a.acc\_30d, 4),  
        a.last\_active,  
        'v1.0', now(), p\_t\_now  
    FROM aggregates a  
    ON CONFLICT (student\_id, section, domain) DO UPDATE SET  
        events\_total          \= EXCLUDED.events\_total,  
        events\_last\_7d        \= EXCLUDED.events\_last\_7d,  
        events\_last\_30d       \= EXCLUDED.events\_last\_30d,  
        accuracy\_overall      \= EXCLUDED.accuracy\_overall,  
        accuracy\_last\_7d      \= EXCLUDED.accuracy\_last\_7d,  
        accuracy\_last\_30d     \= EXCLUDED.accuracy\_last\_30d,  
        last\_active\_at        \= EXCLUDED.last\_active\_at,  
        kpi\_refresh\_version   \= EXCLUDED.kpi\_refresh\_version,  
        refreshed\_at          \= EXCLUDED.refreshed\_at,  
        refreshed\_at\_t\_now    \= EXCLUDED.refreshed\_at\_t\_now  
    RETURNING \* INTO v\_result\_row;

    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.refresh\_domain\_kpi FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.refresh\_domain\_kpi TO service\_role;

### **7.4 `refresh_skill_kpi`**

Iterates over every skill within the affected `(section, domain)` and refreshes one row per skill. The caller passes the affected `(section, domain)`; the function refreshes all skills in that domain (per §4.9 rationale).

CREATE OR REPLACE FUNCTION public.refresh\_skill\_kpi(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_domain      text,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS void  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_short\_days           integer;  
    v\_long\_days            integer;  
    v\_bad\_count            integer;  
    v\_t\_short\_cutoff       timestamptz;  
    v\_t\_long\_cutoff        timestamptz;  
BEGIN  
    SET LOCAL lock\_timeout \= '5s';  
    BEGIN  
        PERFORM pg\_advisory\_xact\_lock(  
            hashtext('kpi\_skill\_batch|' || p\_student\_id::text || '|' || p\_section || '|' || p\_domain)  
        );  
    EXCEPTION  
        WHEN lock\_not\_available OR query\_canceled THEN  
            RAISE EXCEPTION 'KPI\_LOCK\_TIMEOUT: skill KPI batch lock (%, %, %)',  
                p\_student\_id, p\_section, p\_domain;  
    END;

    \-- Per RB-05B-V1-01: KPI windows read via dedicated helper, NOT canonicalize\_mastery\_constants()  
    SELECT short\_days, long\_days  
    INTO   v\_short\_days, v\_long\_days  
    FROM   public.read\_kpi\_recency\_constants();  
    v\_t\_short\_cutoff := p\_t\_now \- make\_interval(days \=\> v\_short\_days);  
    v\_t\_long\_cutoff  := p\_t\_now \- make\_interval(days \=\> v\_long\_days);

    \-- Per RB-05B-V1-02: validate canonical data integrity (NO silent NULL filter; skill grain adds NOT NULL skill check)  
    SELECT count(\*) INTO v\_bad\_count  
    FROM (  
        SELECT pa.skill, pa.correct, pa.occurred\_at FROM practice\_attempts\_v0 pa  
        WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section AND pa.domain \= p\_domain  
        UNION ALL  
        SELECT ra.skill, ra.correct, ra.occurred\_at FROM review\_error\_attempts ra  
        WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section AND ra.domain \= p\_domain  
        UNION ALL  
        SELECT tsa.skill, tsa.correct, tsa.answered\_at FROM test\_session\_answers tsa  
        JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
        JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                        AND tss.section\_index \= tsa.section\_index  
        WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section AND tsa.domain \= p\_domain  
          AND tss.state \= 'submitted'  
    ) e  
    WHERE e.correct IS NULL OR e.occurred\_at IS NULL OR e.skill IS NULL;

    IF v\_bad\_count \> 0 THEN  
        RAISE EXCEPTION 'KPI\_HISTORICAL\_DATA\_INVALID: % canonical rows have NULL correct/occurred\_at/skill for student %, section %, domain % (refresh\_skill\_kpi)', v\_bad\_count, p\_student\_id, p\_section, p\_domain;  
    END IF;

    WITH skill\_events AS (  
        SELECT skill, correct, occurred\_at FROM (  
            SELECT pa.skill, pa.correct, pa.occurred\_at  
            FROM practice\_attempts\_v0 pa  
            WHERE pa.student\_id \= p\_student\_id AND pa.section \= p\_section AND pa.domain \= p\_domain  
            UNION ALL  
            SELECT ra.skill, ra.correct, ra.occurred\_at  
            FROM review\_error\_attempts ra  
            WHERE ra.student\_id \= p\_student\_id AND ra.section \= p\_section AND ra.domain \= p\_domain  
            UNION ALL  
            SELECT tsa.skill, tsa.correct, tsa.answered\_at  
            FROM test\_session\_answers tsa  
            JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
            JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                            AND tss.section\_index \= tsa.section\_index  
            WHERE ts.student\_id \= p\_student\_id AND tsa.section \= p\_section AND tsa.domain \= p\_domain  
              AND tss.state \= 'submitted'  
        ) e  
    )  
    INSERT INTO student\_skill\_kpi (  
        student\_id, section, domain, skill,  
        events\_total, events\_last\_7d, events\_last\_30d,  
        accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
        last\_active\_at,  
        kpi\_refresh\_version, refreshed\_at, refreshed\_at\_t\_now  
    )  
    SELECT  
        p\_student\_id, p\_section, p\_domain, se.skill,  
        COUNT(\*),  
        COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff),  
        COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff),  
        ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(\*), 4),  
        CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) \> 0  
             THEN ROUND(SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_short\_cutoff THEN 1 ELSE 0 END)::numeric  
                  / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff), 4\)  
             ELSE NULL END,  
        CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff) \> 0  
             THEN ROUND(SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_long\_cutoff THEN 1 ELSE 0 END)::numeric  
                  / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff), 4\)  
             ELSE NULL END,  
        MAX(occurred\_at),  
        'v1.0', now(), p\_t\_now  
    FROM skill\_events se  
    GROUP BY se.skill  
    ON CONFLICT (student\_id, section, domain, skill) DO UPDATE SET  
        events\_total          \= EXCLUDED.events\_total,  
        events\_last\_7d        \= EXCLUDED.events\_last\_7d,  
        events\_last\_30d       \= EXCLUDED.events\_last\_30d,  
        accuracy\_overall      \= EXCLUDED.accuracy\_overall,  
        accuracy\_last\_7d      \= EXCLUDED.accuracy\_last\_7d,  
        accuracy\_last\_30d     \= EXCLUDED.accuracy\_last\_30d,  
        last\_active\_at        \= EXCLUDED.last\_active\_at,  
        kpi\_refresh\_version   \= EXCLUDED.kpi\_refresh\_version,  
        refreshed\_at          \= EXCLUDED.refreshed\_at,  
        refreshed\_at\_t\_now    \= EXCLUDED.refreshed\_at\_t\_now;  
END;  
$$;

REVOKE ALL ON FUNCTION public.refresh\_skill\_kpi FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.refresh\_skill\_kpi TO service\_role;

Note: `refresh_skill_kpi` returns `void` rather than a single row because it touches multiple skill rows in one call.

### **7.5 `refresh_overall_kpi`**

Operates across all sections, computes streak (using overall student activity, not per-section), and refreshes one row.

CREATE OR REPLACE FUNCTION public.refresh\_overall\_kpi(  
    p\_student\_id  uuid,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS public.student\_overall\_kpi  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_short\_days           integer;  
    v\_long\_days            integer;  
    v\_bad\_count            integer;  
    v\_t\_short\_cutoff       timestamptz;  
    v\_t\_long\_cutoff        timestamptz;  
    v\_result\_row           public.student\_overall\_kpi;  
BEGIN  
    SET LOCAL lock\_timeout \= '5s';  
    BEGIN  
        PERFORM pg\_advisory\_xact\_lock(  
            hashtext('kpi\_overall|' || p\_student\_id::text)  
        );  
    EXCEPTION  
        WHEN lock\_not\_available OR query\_canceled THEN  
            RAISE EXCEPTION 'KPI\_LOCK\_TIMEOUT: overall KPI lock (%)', p\_student\_id;  
    END;

    \-- Per RB-05B-V1-01: KPI windows read via dedicated helper, NOT canonicalize\_mastery\_constants()  
    SELECT short\_days, long\_days  
    INTO   v\_short\_days, v\_long\_days  
    FROM   public.read\_kpi\_recency\_constants();  
    v\_t\_short\_cutoff := p\_t\_now \- make\_interval(days \=\> v\_short\_days);  
    v\_t\_long\_cutoff  := p\_t\_now \- make\_interval(days \=\> v\_long\_days);

    \-- Per RB-05B-V1-02: validate canonical data integrity (NO silent NULL filter)  
    SELECT count(\*) INTO v\_bad\_count  
    FROM (  
        SELECT pa.correct, pa.occurred\_at FROM practice\_attempts\_v0 pa  
        WHERE pa.student\_id \= p\_student\_id  
        UNION ALL  
        SELECT ra.correct, ra.occurred\_at FROM review\_error\_attempts ra  
        WHERE ra.student\_id \= p\_student\_id  
        UNION ALL  
        SELECT tsa.correct, tsa.answered\_at FROM test\_session\_answers tsa  
        JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
        JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                        AND tss.section\_index \= tsa.section\_index  
        WHERE ts.student\_id \= p\_student\_id AND tss.state \= 'submitted'  
    ) e  
    WHERE e.correct IS NULL OR e.occurred\_at IS NULL;

    IF v\_bad\_count \> 0 THEN  
        RAISE EXCEPTION 'KPI\_HISTORICAL\_DATA\_INVALID: % canonical rows have NULL correct/occurred\_at for student % (refresh\_overall\_kpi)', v\_bad\_count, p\_student\_id;  
    END IF;

    WITH all\_events AS (  
        SELECT section, correct, occurred\_at FROM (  
            SELECT pa.section, pa.correct, pa.occurred\_at  
            FROM practice\_attempts\_v0 pa WHERE pa.student\_id \= p\_student\_id  
            UNION ALL  
            SELECT ra.section, ra.correct, ra.occurred\_at  
            FROM review\_error\_attempts ra WHERE ra.student\_id \= p\_student\_id  
            UNION ALL  
            SELECT tsa.section, tsa.correct, tsa.answered\_at  
            FROM test\_session\_answers tsa  
            JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
            JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                            AND tss.section\_index \= tsa.section\_index  
            WHERE ts.student\_id \= p\_student\_id AND tss.state \= 'submitted'  
        ) e  
    ),  
    aggregates AS (  
        SELECT  
            COUNT(\*) AS evt\_total,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) AS evt\_7d,  
            COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff)  AS evt\_30d,  
            CASE WHEN COUNT(\*) \> 0 THEN ROUND(SUM(CASE WHEN correct THEN 1 ELSE 0 END)::numeric / COUNT(\*), 4\) ELSE NULL END AS acc\_overall,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff) \> 0  
                 THEN ROUND(SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_short\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_short\_cutoff), 4\) ELSE NULL END AS acc\_7d,  
            CASE WHEN COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff) \> 0  
                 THEN ROUND(SUM(CASE WHEN correct AND occurred\_at \>= v\_t\_long\_cutoff THEN 1 ELSE 0 END)::numeric  
                      / COUNT(\*) FILTER (WHERE occurred\_at \>= v\_t\_long\_cutoff), 4\) ELSE NULL END AS acc\_30d,  
            COUNT(DISTINCT section)::smallint AS sec\_active,  
            MAX(occurred\_at) AS last\_active  
        FROM all\_events  
    ),  
    streak AS (  
        SELECT  
            public.compute\_streak\_days(p\_student\_id, NULL::text, NULL::text, NULL::text, p\_t\_now) AS current\_streak,  
            public.compute\_longest\_streak\_days(p\_student\_id, p\_t\_now) AS longest\_streak  
    )  
    INSERT INTO student\_overall\_kpi (  
        student\_id,  
        events\_total, events\_last\_7d, events\_last\_30d,  
        accuracy\_overall, accuracy\_last\_7d, accuracy\_last\_30d,  
        sections\_active,  
        current\_streak\_days, longest\_streak\_days, last\_active\_at,  
        kpi\_refresh\_version, refreshed\_at, refreshed\_at\_t\_now  
    )  
    SELECT  
        p\_student\_id,  
        a.evt\_total, a.evt\_7d, a.evt\_30d,  
        a.acc\_overall, a.acc\_7d, a.acc\_30d,  
        a.sec\_active,  
        s.current\_streak, s.longest\_streak, a.last\_active,  
        'v1.0', now(), p\_t\_now  
    FROM aggregates a CROSS JOIN streak s  
    ON CONFLICT (student\_id) DO UPDATE SET  
        events\_total          \= EXCLUDED.events\_total,  
        events\_last\_7d        \= EXCLUDED.events\_last\_7d,  
        events\_last\_30d       \= EXCLUDED.events\_last\_30d,  
        accuracy\_overall      \= EXCLUDED.accuracy\_overall,  
        accuracy\_last\_7d      \= EXCLUDED.accuracy\_last\_7d,  
        accuracy\_last\_30d     \= EXCLUDED.accuracy\_last\_30d,  
        sections\_active       \= EXCLUDED.sections\_active,  
        current\_streak\_days   \= EXCLUDED.current\_streak\_days,  
        longest\_streak\_days   \= EXCLUDED.longest\_streak\_days,  
        last\_active\_at        \= EXCLUDED.last\_active\_at,  
        kpi\_refresh\_version   \= EXCLUDED.kpi\_refresh\_version,  
        refreshed\_at          \= EXCLUDED.refreshed\_at,  
        refreshed\_at\_t\_now    \= EXCLUDED.refreshed\_at\_t\_now  
    RETURNING \* INTO v\_result\_row;

    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.refresh\_overall\_kpi FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.refresh\_overall\_kpi TO service\_role;

Note the `longest_streak_days` clause (RB-05B-V1-04): `EXCLUDED.longest_streak_days`. Pure derivation from canonical history — every refresh recomputes the true historical maximum via `compute_longest_streak_days`, which walks the student's entire event history. This preserves the §2.2 truncate-and-rebuild equivalence: a recompute over the same canonical events produces byte-identical KPI rows. The earlier "monotonic-non-decreasing via `GREATEST(existing, new)`" pattern was rejected per RB-05B-V1-04 because it preserved prior state across recompute boundaries — useful for an "ever observed by app" semantic, but incompatible with materialized-derivative determinism. If product later wants an "ever observed" metric distinct from the canonical maximum, it belongs in an audit/event-history table, not a materialized derivative.

### **7.6 Streak computation helper**

Both `refresh_section_kpi` and `refresh_overall_kpi` call `compute_streak_days`. This helper is shared:

CREATE OR REPLACE FUNCTION public.compute\_streak\_days(  
    p\_student\_id  uuid,  
    p\_section     text DEFAULT NULL,  
    p\_domain      text DEFAULT NULL,  
    p\_skill       text DEFAULT NULL,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS integer  
LANGUAGE plpgsql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_streak integer := 0;  
    v\_today  date := (p\_t\_now AT TIME ZONE 'UTC')::date;  
    v\_check\_date date;  
    v\_has\_event boolean;  
BEGIN  
    v\_check\_date := v\_today;  
    LOOP  
        SELECT EXISTS (  
            SELECT 1 FROM (  
                SELECT (occurred\_at AT TIME ZONE 'UTC')::date AS event\_date, section, domain, skill  
                FROM (  
                    SELECT pa.occurred\_at, pa.section, pa.domain, pa.skill  
                    FROM practice\_attempts\_v0 pa  
                    WHERE pa.student\_id \= p\_student\_id  
                    UNION ALL  
                    SELECT ra.occurred\_at, ra.section, ra.domain, ra.skill  
                    FROM review\_error\_attempts ra  
                    WHERE ra.student\_id \= p\_student\_id  
                    UNION ALL  
                    SELECT tsa.answered\_at, tsa.section, tsa.domain, tsa.skill  
                    FROM test\_session\_answers tsa  
                    JOIN test\_sessions ts ON ts.id \= tsa.test\_session\_id  
                    JOIN test\_session\_sections tss ON tss.test\_session\_id \= tsa.test\_session\_id  
                                                    AND tss.section\_index \= tsa.section\_index  
                    WHERE ts.student\_id \= p\_student\_id AND tss.state \= 'submitted'  
                ) e  
            ) ev  
            WHERE ev.event\_date \= v\_check\_date  
              AND (p\_section IS NULL OR ev.section \= p\_section)  
              AND (p\_domain  IS NULL OR ev.domain  \= p\_domain)  
              AND (p\_skill   IS NULL OR ev.skill   \= p\_skill)  
        ) INTO v\_has\_event;

        IF v\_has\_event THEN  
            v\_streak := v\_streak \+ 1;  
            v\_check\_date := v\_check\_date \- 1;  
        ELSE  
            EXIT;  
        END IF;

        IF v\_streak \>= 730 THEN  
            EXIT;  
        END IF;  
    END LOOP;

    RETURN v\_streak;  
END;  
$$;

REVOKE ALL ON FUNCTION public.compute\_streak\_days FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.compute\_streak\_days TO service\_role;

The `compute_longest_streak_days` helper has a similar shape but iterates over the student's entire history finding the maximum consecutive-day run.

**Streak timezone caveat.** V1.0 evaluates streaks in UTC. A student in PST who studies at 11pm local time generates an event with `occurred_at = 7am UTC the next day` — that event counts toward the UTC-day streak, not the PST-day streak. This is a known limitation; a future V1.1 may introduce per-student timezone for streak computation. Documented here so the dashboard doesn't claim wrong streak values.

---

## **8\. KPI Refresh Trigger Contract**

### **8.1 Synchronous invocation chain**

Per Q3 and §2.3, the full transaction chain triggered by an upstream answer commit is:

upstream caller (Doc 02 / Doc 04 in same transaction)  
  └─ apply\_mastery\_event(student, section, domain, skill, ...)         \[05A §4\]  
       ├─ student\_skill\_mastery upsert \+ audit                          \[05A §4.7-4.8\]  
       └─ refresh\_domain\_mastery(student, section, domain)              \[05B §4\]  
            ├─ student\_domain\_mastery upsert \+ audit                    \[05B §4.7-4.8\]  
            ├─ refresh\_section\_kpi(student, section)                    \[05B §7.2\]  
            ├─ refresh\_domain\_kpi(student, section, domain)             \[05B §7.3\]  
            ├─ refresh\_skill\_kpi(student, section, domain)              \[05B §7.4\]  
            └─ refresh\_overall\_kpi(student)                             \[05B §7.5\]

All steps execute in the SAME database transaction. If any step raises, the entire transaction rolls back — no partial state. The caller's HTTP response is 5xx for any 05B failure, identical to the 05A failure case.

### **8.2 Latency budget**

Approximate worst-case latency per `apply_mastery_event` call at production scale (rough estimates; actual numbers measured in CI/load tests):

| Step | Typical | Worst case |
| ----- | ----- | ----- |
| 05A skill mastery refresh | 5-10 ms | 25 ms |
| `refresh_domain_mastery` | 5-10 ms | 25 ms |
| `refresh_section_kpi` | 3-6 ms | 15 ms |
| `refresh_domain_kpi` | 3-6 ms | 15 ms |
| `refresh_skill_kpi` (per skill in domain × N skills) | 5-15 ms | 40 ms |
| `refresh_overall_kpi` (incl. streak) | 5-10 ms | 30 ms |
| **Total** | **\~25-60 ms** | **\~150 ms** |

The streak computation is the largest variable component. A student with no events for a long time will iterate the loop once and exit; a student with a long active streak will iterate proportionally. The 730-day safety cap (§7.6) bounds worst case.

### **8.3 Determinism caveat for KPI**

Per §2.2 and §3.1 INV-3, KPI tables are **deterministic-up-to-`T_now`**, NOT pure-deterministic by event history alone. The recency-window columns (`events_last_7d`, `events_last_30d`, `accuracy_last_*d`) depend on `T_now` to evaluate `occurred_at >= T_now - INTERVAL ...`. Two refreshes of the same student with the same event history but different `T_now` values produce different rows.

The truncate-and-rebuild equivalence test (per INV-3 enforcement) MUST inject a fixed `T_now` parameter into every refresh function to assert deterministic output. CI fixtures (§13) use a fixed `T_now` for the same reason.

In production, `apply_mastery_event` does NOT pass `T_now`; the default `now()` is used. This is acceptable because the relative ordering and rough magnitude of `last_7d` / `last_30d` columns is more useful than bit-exact determinism for those columns. Mastery columns on `student_domain_mastery` remain pure-deterministic (no `T_now` dependence — the formula is position-based, not wall-clock-based).

---

## **9\. Recency Window Constants (Read Pattern)**

Per Q4 and RB-05P-V1-15, the two recency-window constants live in Parent's `mastery_constants` table:

| Key | Default value | Unit |
| ----- | ----- | ----- |
| `KPI_RECENCY_WINDOW_SHORT_DAYS` | 7 | days |
| `KPI_RECENCY_WINDOW_LONG_DAYS` | 30 | days |

### **9.1 `read_kpi_recency_constants()` helper (RB-05B-V1-01)**

Per RB-05B-V1-01, 05B owns a dedicated reader for KPI operational constants. This intentionally bypasses 05A's `canonicalize_mastery_constants()` (which is scoped to formula-affecting constants and reflected in `constants_snapshot_hash`) — KPI windows are operational, not formula-affecting, and must NOT be coupled to formula constants discipline. The helper reads `mastery_constants` directly:

CREATE OR REPLACE FUNCTION public.read\_kpi\_recency\_constants(  
    OUT short\_days integer,  
    OUT long\_days  integer  
)  
LANGUAGE plpgsql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_short jsonb;  
    v\_long  jsonb;  
BEGIN  
    SELECT value INTO v\_short  
    FROM   public.mastery\_constants  
    WHERE  key \= 'KPI\_RECENCY\_WINDOW\_SHORT\_DAYS'  
      AND  active \= true;

    SELECT value INTO v\_long  
    FROM   public.mastery\_constants  
    WHERE  key \= 'KPI\_RECENCY\_WINDOW\_LONG\_DAYS'  
      AND  active \= true;

    IF v\_short IS NULL OR v\_long IS NULL THEN  
        RAISE EXCEPTION 'KPI\_CONSTANTS\_MISSING: KPI\_RECENCY\_WINDOW\_SHORT\_DAYS or KPI\_RECENCY\_WINDOW\_LONG\_DAYS missing or inactive in mastery\_constants';  
    END IF;

    \-- value is stored as JSONB integer; \#\>\>'{}' extracts raw text regardless of jsonb shape  
    short\_days := (v\_short \#\>\> '{}')::integer;  
    long\_days  := (v\_long  \#\>\> '{}')::integer;

    IF short\_days \<= 0 OR long\_days \<= 0 OR short\_days \> 365 OR long\_days \> 365 THEN  
        RAISE EXCEPTION 'KPI\_CONSTANTS\_OUT\_OF\_RANGE: short\_days=% long\_days=% (expected 1..365)', short\_days, long\_days;  
    END IF;  
END;  
$func$;

REVOKE ALL ON FUNCTION public.read\_kpi\_recency\_constants FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.read\_kpi\_recency\_constants TO service\_role;

### **9.2 Call pattern across refresh functions**

Every KPI refresh function and `compute_streak_days` reads these constants via the helper above:

SELECT short\_days, long\_days  
INTO   v\_short\_days, v\_long\_days  
FROM   public.read\_kpi\_recency\_constants();

This pattern appears identically in §7.2–§7.5 and §7.6. The helper raises `KPI_CONSTANTS_MISSING` if either row is absent/inactive and `KPI_CONSTANTS_OUT_OF_RANGE` if values fall outside 1..365. Either error aborts the calling transaction.

### **9.3 Why a separate reader (not `canonicalize_mastery_constants()`)**

Per RB-05B-V1-01:

* `canonicalize_mastery_constants()` (05A-owned) returns formula-affecting constants only; its output is the basis of `constants_snapshot_hash` on mastery rows.  
* KPI recency windows are operational tuning parameters that do NOT affect mastery formula output and MUST NOT be folded into the formula hash (Parent RB-05P-V1-15).  
* Routing KPI constant reads through `canonicalize_mastery_constants()` would either (a) force operational keys into the formula function's surface area (architectural drift) or (b) silently miss them and raise `KPI_CONSTANTS_MISSING` on every KPI refresh.  
* The separate helper makes the formula/operational boundary explicit at the function-signature layer.

### **9.4 Exclusion from `constants_snapshot_hash`**

These two keys are **excluded from `constants_snapshot_hash`** per Parent §9.1 because:

1. They affect KPI rollup output (`events_last_7d`, `accuracy_last_7d`, etc.) but NOT the mastery formula output.  
2. Changing them does not invalidate existing `student_skill_mastery` or `student_domain_mastery` rows.  
3. They are operational tuning parameters; product can move from 7/30 to 5/28 (or any other window) without triggering a mastery model version bump.

If the windows change, 05D's batch-recompute job should re-run the four KPI refresh functions for all affected students, but `student_*_mastery` rows do NOT need recomputation.

---

## **10\. Guardian Aggregate Read Contract**

Summary of the 05B-owned guardian-readable surface:

| Table | Guardian access | Predicate |
| ----- | ----- | ----- |
| `student_domain_mastery` | YES — domain-level mastery values | active link \+ active entitlement |
| `student_section_kpi` | YES — section engagement aggregates | active link \+ active entitlement |
| `student_domain_kpi` | YES — domain engagement aggregates | active link \+ active entitlement |
| `student_overall_kpi` | YES — overall engagement aggregates | active link \+ active entitlement |
| `student_skill_kpi` | **NO** — per-skill granularity is student-self-only | n/a (no policy) |

This is the architectural complement of 05A's surface (where `student_skill_mastery` is student-self-only). Together, 05A and 05B implement Parent acceptance criterion \#19: "Guardian-accessible routes expose only domain mastery values and section projection aggregates" (with section projection aggregates coming from 05C).

For guardian dashboards, the typical query path is:

\-- "What's my child's mastery state?" (guardian-side)  
SELECT section, domain, mastery\_level, computed\_at  
FROM   student\_domain\_mastery  
WHERE  student\_id \= $1;  
\-- Guarded by student\_domain\_mastery\_guardian\_read policy \+ column GRANTs.  
\-- Guardian sees: 8 rows (one per SAT domain), level 0-4, last-updated timestamp.  
\-- Guardian does NOT see: mastery\_score, mastery\_pct, per-source accuracies.

\-- "How active is my child?" (guardian-side)  
SELECT events\_total, events\_last\_7d, accuracy\_last\_7d, current\_streak\_days, last\_active\_at  
FROM   student\_overall\_kpi  
WHERE  student\_id \= $1;  
\-- Guarded by student\_overall\_kpi\_guardian\_read policy \+ column GRANTs.

### **10.3 Single-route contract (Q5=b)**

Per Q5=b, each 05B resource is served by ONE route. The same route handler runs whether the caller is the student or a linked guardian; RLS does the per-row filtering.

Per RB-05B-V1-05, the rule is: **route handlers MUST NOT branch into different SQL predicates or projections by caller role.** A single path-layer authorization check that accepts either student-self or active linked guardian is REQUIRED — that check inherently inspects the caller-to-student relationship and is the only permitted role-aware branch. After it passes, the handler issues the same SELECT shape and relies on RLS plus column GRANTs for actual filtering.

GET /api/students/{student\_id}/mastery/domains  
GET /api/students/{student\_id}/mastery/skills              ← guardian queries return 0 rows  
GET /api/students/{student\_id}/kpi/sections  
GET /api/students/{student\_id}/kpi/domains  
GET /api/students/{student\_id}/kpi/skills                  ← guardian queries return 0 rows  
GET /api/students/{student\_id}/kpi/overall

Route handler responsibilities, in order:

1. **Authenticate** the caller (Doc 01 owns).  
2. **Path-layer authorization**: the authenticated caller must be either the student themselves OR a guardian linked to that student. Unrelated authenticated users get **404, not 403** — this avoids leaking whether the `student_id` exists. Path-layer authz is broader than RLS; RLS narrows within rows the caller is structurally allowed to query at all.  
3. **Issue the SELECT** against the relevant table. RLS naturally returns:  
   * Student self: their own rows.  
   * Guardian on domain/section/overall: rows for linked \+ entitled student.  
   * Guardian on `student_skill_mastery` or `student_skill_kpi`: zero rows (no `guardian_read` policy — absence-of-policy denial per §10.1).  
4. **Column-project** the response payload to only the publicly-granted columns from §5.4 and §6.7. Never `SELECT *` and serialize raw; never expose `refreshed_at_*`, `mastery_score`, `mastery_pct`, `kpi_refresh_version`, or any other admin-only column.

### **10.4 Empty-list vs 403 semantics**

Per RB-05B-V1-06, this section describes behavior **after path-layer authorization (§10.3 step 2\) has succeeded** — i.e., the caller is confirmed to be either the student themselves or a guardian with an active link \+ active entitlement to that student. Unrelated authenticated callers are rejected at step 2 with **HTTP 404 before any SELECT is issued** (per §10.3); they never reach this case.

For callers who pass path-layer authz, a guardian calling `GET /api/students/{student_id}/mastery/skills` receives HTTP 200 with `[]`, not 403\. This is INTENTIONAL:

* 403 would imply the resource exists but is forbidden — leaking that skill mastery rows exist for that student.  
* Empty 200 is the same response a student would get if they had no skill mastery rows yet — no information leak.

If product later wants to distinguish "you're not authorized to see this" from "no data yet" for the guardian UI, the recommended pattern is a separate `GET /api/students/{student_id}/access-summary` route that explicitly lists the resource categories the caller is allowed to read. That route is downstream of 05B and is not specified here.

### **10.5 Column projection enforcement (mastery\_level only)**

Parent acceptance \#20 (RB-05P-V1-14) locks: student and guardian read surfaces expose **`mastery_level` only**. Raw `mastery_score` and `mastery_pct` are admin-only.

Defense-in-depth:

* Column GRANT on `authenticated` (§5.4) restricts SELECT to `mastery_level` (already enforced at the database layer).  
* The route handler additionally projects only the allowed columns in its response payload — never relying on GRANT alone, and never `SELECT *` then serialize.

The same column-projection rule applies to KPI routes: only the columns granted to `authenticated` in §6.7 appear in response payloads; `refreshed_at`, `refreshed_at_t_now`, and `kpi_refresh_version` are admin-only and MUST NOT leak through response serialization.

### **10.6 No write routes**

05B exposes NO write routes for any of its tables. All writes flow through:

apply\_mastery\_event (05A) → refresh\_domain\_mastery (§4) → refresh\_\*\_kpi (§7)

The mastery and KPI tables have no `INSERT`, `UPDATE`, or `DELETE` RLS policies; only `service_role` (which bypasses RLS) can write, and only through the SECURITY DEFINER refresh functions called from the canonical event-application path.

### **10.7 Pagination (none required)**

The 05B data set is bounded by the SAT taxonomy (Parent §10.2 — 8 College Board domains, ≤\~80 skills, 2 sections). Per-student row counts:

| Resource | Max rows per student |
| ----- | ----- |
| `/mastery/domains` | ≤16 (8 domains × 2 sections, but only 8 unique pairs) |
| `/mastery/skills` | ≤\~80 |
| `/kpi/sections` | ≤2 |
| `/kpi/domains` | ≤16 |
| `/kpi/skills` | ≤\~80 |
| `/kpi/overall` | ≤1 |

No 05B route requires server-side pagination. If a future enhancement multiplies row counts (e.g., per-skill subskills), the API surface doc that wraps these routes adds pagination there — not in 05B's table contract.

---

## **11\. Pre-Implementation Verification Gate**

Mirrors 05A §10's structured-report pattern, covering 05B-owned objects.

### **11.1 What MUST be verified**

**A. Installed RPC signatures.** For each of the seven 05B-owned functions:

public.refresh\_domain\_mastery  
public.refresh\_section\_kpi  
public.refresh\_domain\_kpi  
public.refresh\_skill\_kpi  
public.refresh\_overall\_kpi  
public.compute\_streak\_days  
public.compute\_longest\_streak\_days  
public.read\_kpi\_recency\_constants     \-- RB-05B-V1-01

Compare installed signature against the contract in §4.1, §7.2, §7.3, §7.4, §7.5, §7.6, §9.1. Statuses: `MISSING | INSTALLED_MATCHED | INSTALLED_BUT_MISMATCHED | LEGACY_PRESENT_REQUIRES_DEPRECATION`.

`compute_streak_days` MUST filter by `p_section`, `p_domain`, AND `p_skill` (RB-05B-V1-03) — if installed body filters only by `p_section`, status is `INSTALLED_BUT_MISMATCHED`.

`read_kpi_recency_constants` MUST read directly from `public.mastery_constants` (NOT from `canonicalize_mastery_constants()`) and raise `KPI_CONSTANTS_MISSING` if either window key is missing/inactive, `KPI_CONSTANTS_OUT_OF_RANGE` if values fall outside 1..365.

Each KPI refresh fn MUST raise `KPI_HISTORICAL_DATA_INVALID` on NULL `correct`/`occurred_at` in its canonical window (RB-05B-V1-02). Verify by grepping for `KPI_HISTORICAL_DATA_INVALID` in installed function bodies — must appear in all 4 refresh fns.

`refresh_overall_kpi` MUST set `longest_streak_days = EXCLUDED.longest_streak_days` (NOT `GREATEST(...)` — RB-05B-V1-04). Verify by grepping the installed UPDATE clause; presence of `GREATEST` is a regression.

**B. `mastery_constants` table values.** Verify presence and values of the two new keys (RB-05P-V1-15):

* `KPI_RECENCY_WINDOW_SHORT_DAYS = 7`  
* `KPI_RECENCY_WINDOW_LONG_DAYS = 30`

Both rows MUST have `active = true`. The `value` column shape (jsonb storage convention) MUST be compatible with the `#>>'{}'` cast pattern used by `read_kpi_recency_constants()` — if storage shape differs (e.g., `{"int_value": 7}` instead of `7`), the helper body MUST be reconciled with the actual schema before deploy.

**C. Table schemas.** Compare installed columns against:

* `student_domain_mastery` per §5.1 — **MUST include `last_event_id uuid NULL` and `last_event_occurred_at timestamptz NULL` (RB-05B-V1-08).** If absent, migration is required.  
* `student_section_kpi` per §6.1  
* `student_domain_kpi` per §6.2  
* `student_skill_kpi` per §6.3  
* `student_overall_kpi` per §6.4

**D. RLS policies.** Verify presence/predicate of:

* `student_domain_mastery_student_read` and `student_domain_mastery_guardian_read`  
* `student_section_kpi_student_read` and `student_section_kpi_guardian_read`  
* `student_domain_kpi_student_read` and `student_domain_kpi_guardian_read`  
* `student_skill_kpi_student_read` (NO guardian policy expected)  
* `student_overall_kpi_student_read` and `student_overall_kpi_guardian_read`

**E. Column GRANTs.** Per §5.4 and §6.7, verify the column-level GRANTs match the contract. Specifically, `last_event_id` and `last_event_occurred_at` MUST NOT be in the `authenticated` GRANT for `student_domain_mastery` — they are admin/service-role only.

**F. 05D audit table contract.** Per §4.8, `mastery_domain_refresh_audit_log` MUST exist with the expected columns (`triggered_by` enum, `mastery_score_before`/`_after`, etc.). Missing columns reported as `BLOCKING_05D_CONTRACT_GAP`.

**G. Canonical event source taxonomy guard (RB-05B-V1-07).** CI grep-equivalence checks MUST be present and passing:

* `canonical_sources_kpi_vs_05a`: 05B refresh fns reference the same 3 source tables as 05A's `canonical_mastery_events`.  
* `tss_submitted_gate_kpi`: every `test_session_answers` JOIN in 05B includes `tss.state = 'submitted'`.  
* `kpi_event_column_taxonomy`: KPI fns project `correct`, `occurred_at` (or `answered_at`), `section`, `domain`, `skill` matching 05A's canonical event column set.

### **11.2 Migration paths**

Three documented paths mirroring 05A §10.3:

* **Path 1 (greenfield):** None of the 05B tables exist. Create everything, seed constants, install RPCs, install RLS+grants.  
* **Path 2 (legacy state present, no production rows):** Legacy tables/RPCs exist but are empty. Drop legacy, follow Path 1\.  
* **Path 3 (legacy state with production rows):** Backup, schema-migrate, recompute via 05D batch job, bring online.

Path 3 is the high-risk path. Production 05B cutover MUST follow 05D's batch recompute lifecycle.

---

## **12\. Diagnostic Post-Completion Expected State**

After a student completes the 40-question diagnostic (8 SAT domains × 5 events per Parent RB-05P-V1-13), the expected post-state is:

| Table | Expected rows |
| ----- | ----- |
| `student_skill_mastery` | One row per skill that has ≥1 event. Most rows have `event_count_total = 1` and `mastery_score IS NULL` (below 5-event threshold). |
| `student_domain_mastery` | 8 rows (one per SAT domain). All have `event_count_total = 5` and `mastery_score IS NOT NULL` (at threshold). |
| `student_section_kpi` | 2 rows (one for M, one for RW). `events_total = 20` for each section. `current_streak_days ≥ 1`. |
| `student_domain_kpi` | 8 rows. `events_total = 5` for each domain. |
| `student_skill_kpi` | One row per skill that received an event. Variable count depending on how 02B's question selection allocates the 5 questions per domain. |
| `student_overall_kpi` | 1 row. `events_total = 40`. `sections_active = 2`. `current_streak_days = 1` (assuming diagnostic completed in single day). |

CI test `test_diagnostic_post_completion_state` constructs a 40-event fixture, calls `apply_mastery_event` for each, and asserts the expected row counts and values.

---

## **13\. Domain Mastery Stress-Test Fixture**

Per Q6 ("domain is a separate event aggregation; no need to reference skill"), the 05B domain fixture mirrors 05A's 31 baseline+sparse scenarios at the domain grain. The event sets are identical; the only difference is that all events are tagged to a single domain (rather than a single skill), and the entity filter is `p_entity_type = 'domain'`.

### **13.1 The 31 scenarios**

The full B1–B23 baseline and S1–S8 sparse fixtures from 05A §12.1 / §12.2 are reused verbatim at the domain grain. Each scenario's expected `mastery_score`, `mastery_pct`, `mastery_level`, and per-source accuracies MUST match 05A's expected values byte-for-byte. This is the **cross-grain consistency guarantee**: since `compute_mastery_for_entity` is the single formula implementation per INV-05A-11, identical event histories MUST produce identical mastery values regardless of whether the entity filter is `'skill'` or `'domain'`.

Worked example: 05A scenario B16 ("Mixed realistic: 3/5 hard test \+ 7/10 med prac \+ 2/3 easy review") produces `mastery_score = 0.6920, mastery_pct = 69.20, mastery_level = 3` at the skill grain. The 05B domain-grain version uses the same 18 events with `domain = 'Algebra'` and asserts the same `mastery_score = 0.6920, mastery_pct = 69.20, mastery_level = 3` on the `student_domain_mastery` row.

### **13.2 Cross-skill aggregation invariant test**

Beyond the 31-scenario fixture reuse, 05B adds one critical invariant test per INV-05B-13: **domain mastery MUST equal event-aggregation, NOT skill-roll-up**.

Test `test_domain_mastery_equals_event_aggregation`:

Fixture A: 5 medium practice correct, all on skill "Linear Functions" in domain "Algebra"  
Fixture B: 5 medium practice correct, distributed 1-per-skill across 5 different skills in domain "Algebra"

Expected: both fixtures produce student\_domain\_mastery rows with identical mastery\_score \= 1.0000.

Why this matters: under a skill-roll-up implementation, Fixture A would produce  
mastery\_score \= 1.0 (skill at saturation) and Fixture B would produce mastery\_score  
\~ 0.something (no skill above threshold, so the roll-up math would either NULL out  
or produce wrong values). Under the event-aggregation implementation locked by  
Parent §4.2, both fixtures produce identical output because the domain sees 5 events  
regardless of skill distribution.

This is the test that would catch any future "optimization" attempting to compute domain mastery from skill mastery rows instead of from canonical events.

---

## **14\. KPI Stress-Test Fixture**

Per Q7, KPIs need a small fixture for streak and recency-window edge cases.

### **14.1 KPI scenarios (K1-K7)**

| ID | Description | Setup | Expected |
| ----- | ----- | ----- | ----- |
| K1 | Zero events | No events for student | `events_total = 0`, accuracy NULL, streak 0 |
| K2 | Single event today | 1 practice event at `T_now - 5 minutes` | `events_total = 1`, `events_last_7d = 1`, `events_last_30d = 1`, accuracy 1.0 or 0.0, streak 1 |
| K3 | Event exactly 7 days old (boundary) | 1 event at `T_now - 7d` | `events_last_7d = 1` (the predicate `>= T_now - 7d` is inclusive at the boundary) |
| K4 | Event 7 days \+ 1 second old | 1 event at `T_now - 7d - 1s` | `events_last_7d = 0` (excluded) |
| K5 | Streak across 5 consecutive days, then gap | 5 events one per day at `T_now-4d..T_now`, then 3 events at `T_now-7d..T_now-9d` with `T_now-5d` and `T_now-6d` empty | streak \= 5 (gap between day-5 and day-6 breaks the older streak), `longest_streak_days = 5` |
| K6 | Streak that ended yesterday | Events on `T_now-1d, T_now-2d, T_now-3d`, none today | streak \= 0 (today has no event, so trailing streak is 0); `longest_streak_days ≥ 3` |
| K7 | Streak overall vs per-section | Events: M on days T\_now-2 and T\_now-1; RW on days T\_now-1 and T\_now | overall streak \= 3 (any event each day for 3 days); section M streak \= 0 (no M event today); section RW streak \= 2 |

All scenarios use injected `T_now` for determinism per §7.1 and §8.3.

### **14.2 What each scenario tests**

| Scenario | Property under test |
| ----- | ----- |
| K1 | Zero-event state produces clean NULLs, no division-by-zero |
| K2 | Single recent event populates all counters correctly |
| K3, K4 | Recency-window boundary is inclusive at exactly N days, exclusive at N days \+ 1 second |
| K5 | Trailing streak is computed correctly when an earlier streak exists with a gap |
| K6 | "Yesterday" streak does not count toward "today's" streak |
| K7 | Section-scoped vs overall streak diverge correctly when activity is distributed across sections |

---

## **15\. Acceptance Criteria**

Doc 05B V1.0 is acceptable when all of the following are true:

1. `refresh_domain_mastery` RPC is specified in §4 with signature, validation, advisory lock, formula function invocation (entity\_type='domain'), before-state capture, `argmax(occurred_at)` audit-anchor capture (RB-05B-V1-08), upsert, audit write, and downstream KPI refresh trigger.  
2. `student_domain_mastery` table schema is specified in §5 with all columns including `last_event_id` / `last_event_occurred_at` per RB-05B-V1-08, constraints, indexes, RLS policies (student-self AND linked-guardian), and column-level GRANTs.  
3. INV-05A-12 exposed-field contract is enforced at the row layer on `student_domain_mastery`: `mastery_score` and `mastery_pct` are admin/internal-only; `mastery_level` is the single mastery value exposed to student AND linked-guardian routes. `last_event_id` / `last_event_occurred_at` are admin-only.  
4. Four KPI rollup tables (`student_section_kpi`, `student_domain_kpi`, `student_skill_kpi`, `student_overall_kpi`) are specified in §6 with full schemas, RLS policies, and column GRANTs.  
5. `student_skill_kpi` has NO guardian RLS policy per §2.4 and Parent acceptance \#19; denial by absence matches 05A `student_skill_mastery` pattern.  
6. Four KPI refresh functions are specified in §7 with shared structural pattern: lock, read constants via `read_kpi_recency_constants()` (RB-05B-V1-01), validate canonical data integrity raising `KPI_HISTORICAL_DATA_INVALID` (RB-05B-V1-02), compute, upsert. All four are `SECURITY DEFINER`, `service_role`\-only execute.  
7. `compute_streak_days` and `compute_longest_streak_days` helpers are specified in §7.6 with UTC-day interpretation and 730-day safety cap. `compute_streak_days` filters by `p_section`, `p_domain`, AND `p_skill` per RB-05B-V1-03. Streak timezone caveat is documented.  
8. KPI refresh is synchronous within `apply_mastery_event` transaction per §8.1; all five 05B-touching tables (1 mastery \+ 4 KPI) are written in one atomic operation; any failure rolls back the whole chain.  
9. Recency window constants `KPI_RECENCY_WINDOW_SHORT_DAYS` and `KPI_RECENCY_WINDOW_LONG_DAYS` live in `mastery_constants` per RB-05P-V1-15, read by `read_kpi_recency_constants()` (RB-05B-V1-01) which is the SOLE constants reader used by KPI refresh functions and `compute_streak_days`. Both keys are excluded from `constants_snapshot_hash`.  
10. Guardian aggregate read contract is specified in §10 enumerating which tables guardians may read (4) and which they may not (1: `student_skill_kpi`); all 4 guardian policies use the active-link-AND-active-entitlement predicate from Parent §11.1.  
11. Single-route contract is specified in §10.3 per Q5=b: one route per resource served to both student and guardian; RLS does per-row filtering; route handlers MUST NOT branch into different SQL predicates or projections by caller role (RB-05B-V1-05), but a single path-layer authorization check accepting student-self or active linked guardian is REQUIRED and is the only permitted role-aware branch. Path-layer authz returns 404 (not 403\) for unrelated authenticated callers per §10.3 step 2; empty-list semantics in §10.4 apply only AFTER path-layer authz has succeeded (RB-05B-V1-06).  
12. Column projection enforcement is specified in §10.5: response payloads expose `mastery_level` only (never `mastery_score`/`mastery_pct`) at the route layer in addition to database GRANT restrictions; `refreshed_at_*`, `kpi_refresh_version`, `last_event_id`, and `last_event_occurred_at` are admin-only.  
13. No write routes for any 05B-owned table per §10.6; all writes flow through `apply_mastery_event` → `refresh_domain_mastery` → `refresh_*_kpi`.  
14. Pre-implementation verification gate is specified in §11 covering RPCs (including `read_kpi_recency_constants`), constants, schemas (including `last_event_*` columns), RLS, GRANTs, and 05D audit table contract.  
15. Diagnostic post-completion expected state is specified in §12 covering all 5 KPI tables and 2 mastery tables.  
16. Domain mastery stress-test fixture reuses 05A's 31 scenarios at domain grain per §13.1; cross-grain equivalence test asserts identical event histories produce identical mastery values regardless of skill/domain entity filter.  
17. Cross-skill aggregation invariant test (§13.2) asserts `test_domain_mastery_equals_event_aggregation` enforces INV-05B-13 (event-aggregated, not skill-rolled-up).  
18. KPI stress-test fixture (K1-K7 per §14) covers zero-event, single-event, recency boundary, streak with gap, streak-ended-yesterday, and per-section vs overall streak divergence cases.  
19. `longest_streak_days` is purely derived from canonical history every refresh (`= EXCLUDED.longest_streak_days`, no `GREATEST` preservation per RB-05B-V1-04); §2.2 truncate-and-rebuild equivalence holds for all KPI columns under fixed `T_now`.  
20. Canonical event source taxonomy guard (§7.1.1, RB-05B-V1-07) is documented with CI grep-equivalence checks (`canonical_sources_kpi_vs_05a`, `tss_submitted_gate_kpi`, `kpi_event_column_taxonomy`) covering all 4 KPI refresh fns \+ `compute_streak_days`.  
21. All 15 hard invariants (§3) are documented with enforcement mechanism (RLS policy, CI grep guard, test, or audit trigger).  
22. No item in Doc 05B contradicts Doc 05 Parent V1.0 or Doc 05A V1.0.  
23. The cleanup register (§17.6) lists RB-05B-V1-01..08 with severity, source, and resolution; all items applied within the lock cycle of 2026-05-13; status remains "Locked" with no version bump per Doc 04 family precedent.

---

## **16\. Cross-Doc References**

### **16.1 Parent V1.0 sections implemented by 05B**

| Parent reference | 05B implementation |
| ----- | ----- |
| §4 Canonical formula | §4.5 calls `compute_mastery_for_entity` (owned by 05A); 05B does not reimplement |
| §4.2 Skill and domain mastery computed independently from events | §4.5 \+ INV-05B-13 enforcement test |
| §6.1 Service-role-only writes | RLS policies on all 5 05B-owned tables |
| §6.2 Single canonical write path | §3.1 INV-2 enforcement via grep guard |
| §6.3 Deterministic recompute | KPI columns deterministic-up-to-`T_now` per §8.3; mastery columns pure-deterministic |
| §6.5 Full-length post-finalization only | All canonical event reads include `tss.state = 'submitted'` filter |
| §6.6 NULL for cold start | `student_domain_mastery.mastery_score IS NULL` when `event_count_total < 5` |
| §6.7 Versioned constants | `constants_snapshot_hash` on `student_domain_mastery`; `kpi_refresh_version` on KPI tables |
| §7 Bottom-up derivation | §4.9 chain triggers all four KPI refreshes after domain mastery write |
| §9 KPI rollups as materialized derivatives | §2.2 \+ INV-05B-14 \+ truncate-rebuild equivalence test |
| §10.1 Canonical parameter values | §9 reads `KPI_RECENCY_WINDOW_*` from `mastery_constants` |
| §11.1 Doc 01 seam (guardian, entitlement) | §5.3 / §6.6 guardian RLS policies use `gsl.link_active = true AND se.active = true` |
| §11.4 Doc 04 seam | All canonical event reads inherit `tss.state = 'submitted'` via 05A's `canonical_mastery_events` |
| Acceptance criterion \#19 | §10 — guardians see domain/KPI aggregates, never per-skill |
| Acceptance criterion \#20 | §5.2 \+ §6.5 column visibility tables |
| RB-05P-V1-15 (KPI recency constants) | §9 read pattern |

### **16.2 Doc 05A references and dependencies**

| 05A reference | 05B dependency |
| ----- | ----- |
| `compute_mastery_for_entity` | §4.5 calls with `p_entity_type = 'domain'` |
| `canonical_mastery_events` | §7.2-7.5 KPI refresh functions read events via similar UNION patterns; full-length branch inherits `tss.state = 'submitted'` |
| `canonicalize_mastery_constants` (JSONB form) | §7 KPI refresh functions extract `KPI_RECENCY_WINDOW_*` keys |
| INV-05A-11 (single formula implementation) | INV-05B-13 enforces 05B does NOT reimplement formula |
| INV-05A-12 (exposed-field at row layer) | INV-05B-12 re-applies pattern on `student_domain_mastery` |

### **16.3 Doc 05 family seams**

| Sibling | Interaction |
| ----- | ----- |
| 05A | 05B's `refresh_domain_mastery` is called from 05A's `apply_mastery_event` §4.9 |
| 05C | 05C's projection refresh will be called from 05B's `refresh_domain_mastery` in the future (currently TBD by 05C; 05B's §4.9 documents this seam) |
| 05D | 05B writes to 05D-owned `mastery_domain_refresh_audit_log` (§4.8); 05D's batch recompute can invoke 05B refresh functions with injected `T_now` |

---

## **17\. Governance & Lock Process**

### **17.1 Owner**

Primary owner: Product \+ Engineering joint ownership, matching the Doc 04 family and Doc 05 Parent precedent.

Operational source-of-truth owner: Engineering maintains RPC signature and table schema alignment with this document.

### **17.2 Review trigger**

Doc 05B MUST be reviewed when any of the following occur:

* Domain mastery formula contract changes (would require Parent change first, then 05B propagation)  
* A KPI table column is added, removed, or changes type  
* KPI refresh trigger sequence changes (e.g., split into sync \+ async)  
* Recency window constants are added or removed from Parent §10.1  
* Guardian RLS predicate changes at the Parent §11.1 level  
* The Doc 04 seam columns on `test_session_answers` change  
* The pre-implementation verification gate (§11) needs updating because installed Supabase state has evolved past the documented migration paths

### **17.3 Lock meaning**

"Locked" means:

* Doc 05B is the authoritative source for the domain mastery RPC, KPI table schemas, refresh function contracts, and guardian aggregate read surface.  
* Implementations MUST conform to 05B's locks.  
* Changes to 05B require an explicit version bump and review.  
* Silent drift between 05B and implementation is not allowed.

Post-lock, additive clarifications MAY be applied within the lock cycle without a version bump, following the Doc 04 family precedent.

### **17.4 Parent dependency**

Doc 05B V1.0 depends on Doc 05 Parent V1.0 (Locked 2026-05-13 with cleanup register RB-05P-V1-01..15). Any Parent change that affects the formula, the level boundaries, the constants list (including the two new recency-window keys), the guardian access contract, or the acceptance criteria propagates to 05B immediately.

### **17.5 05A dependency**

Doc 05B V1.0 depends on Doc 05A V1.0 (Locked 2026-05-13 with cleanup register RB-05A-V1-01..23). Any 05A change that affects `compute_mastery_for_entity`, `canonical_mastery_events`, the constants snapshot hash, or `student_skill_mastery` schema propagates to 05B immediately.

### **17.6 Cleanup register (in-lock-cycle, no version bump)**

Per Doc 04 family precedent, in-lock-cycle cleanup items are applied without a version bump. The status field reflects the register count; the change record (§18) summarizes the deltas.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-05B-V1-01 | BLOCKER | SWE review (constants reader scoping) | Added §9.1 `read_kpi_recency_constants()` helper that reads `mastery_constants` directly, bypassing `canonicalize_mastery_constants()` (formula-only). All 4 KPI refresh fns \+ `compute_streak_days` refactored to use the helper. Architectural separation of formula vs operational constants locked. |
| RB-05B-V1-02 | BLOCKER | SWE review (silent NULL filtering) | Replaced `WHERE e.correct IS NOT NULL AND e.occurred_at IS NOT NULL` silent filters in 4 KPI refresh fns with explicit validation that raises `KPI_HISTORICAL_DATA_INVALID` on any NULL `correct`/`occurred_at` (and NULL `skill` for skill-grain). Lifts 05A's hard-fail discipline (RB-05A-V1-22) to KPI surface. |
| RB-05B-V1-03 | BLOCKER | SWE review (`compute_streak_days` signature mismatch) | Added `p_domain` and `p_skill` predicates to `compute_streak_days` body so the helper does what its signature says. V1.0 callers continue passing NULL for these args; helper is now correct if reused for domain/skill-scoped streaks later. |
| RB-05B-V1-04 | IMPORTANT | SWE review (`longest_streak_days = GREATEST(...)` breaks truncate-rebuild) | Removed `GREATEST(student_overall_kpi.longest_streak_days, EXCLUDED.longest_streak_days)` from `refresh_overall_kpi` upsert; replaced with pure `EXCLUDED.longest_streak_days`. `compute_longest_streak_days` walks full canonical history; pure derivation restores §2.2 truncate-and-rebuild equivalence. Prose updated to document the discipline; "ever observed by app" semantic explicitly deferred to a future audit/event-history table if product requests it. |
| RB-05B-V1-05 | IMPORTANT | SWE review (route-branch wording) | §10.3 reworded: "MUST NOT branch on caller role" clarified to mean "MUST NOT branch into different SQL predicates or projections by caller role." A single path-layer authorization check that accepts either student-self or active linked guardian is REQUIRED and is the only permitted role-aware branch. |
| RB-05B-V1-06 | IMPORTANT | SWE review (empty-list applies only after path-layer auth) | §10.4 reworded to explicitly state that empty-list (HTTP 200 `[]`) semantics apply only AFTER §10.3 step 2 path-layer authz has confirmed student-self or active linked guardian. Unrelated authenticated callers are rejected at step 2 with HTTP 404 BEFORE any SELECT is issued. |
| RB-05B-V1-07 | IMPORTANT | SWE review (KPI UNION duplicates canonical event source) | Added §7.1.1 documenting the canonical event source taxonomy drift risk \+ CI grep-equivalence guard requirements (`canonical_sources_kpi_vs_05a`, `tss_submitted_gate_kpi`, `kpi_event_column_taxonomy`). If a future 05A change exposes a query-able canonical event function, the 4 refresh fns SHOULD migrate to consuming it; for V1.0 the duplication is accepted with CI guards as the safety net. |
| RB-05B-V1-08 | IMPORTANT | SWE review (audit parity with `student_skill_mastery`) | Added `last_event_id uuid NULL` and `last_event_occurred_at timestamptz NULL` columns to `student_domain_mastery`. §4.7 upsert captures `argmax(occurred_at)` over the canonical event set (with `event_id` as tiebreaker) — same `(occurred_at DESC, event_id DESC)` ordering as the formula's position assignment, so the captured event is always position 1\. Columns are admin/service-role only (NOT in §5.4's `authenticated` GRANT). Audit anchor for incident investigation and 05D recompute traceability. Purely derived: no `GREATEST` preservation; recompute over same events produces byte-identical pair. |

All eight items applied within the lock cycle of 2026-05-13. Status remains "Locked"; no version bump.

---

## **18\. Change Record**

| Version | Date | Author | Summary |
| ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-13 | Claude (drafted), Karl (locked) | Initial draft. Locks: `refresh_domain_mastery` RPC contract calling 05A's `compute_mastery_for_entity` with `p_entity_type = 'domain'` per INV-05B-13 (independent event aggregation, not skill roll-up); `student_domain_mastery` schema mirroring 05A's `student_skill_mastery` at domain grain with guardian-readable RLS policy per Parent acceptance \#19; four KPI rollup tables (`student_section_kpi`, `student_domain_kpi`, `student_skill_kpi`, `student_overall_kpi`) as materialized derivatives per Parent §9; four KPI refresh functions invoked synchronously from `refresh_domain_mastery` §4.9 per Q3 sync answer; UTC-day streak computation with 730-day safety cap and documented timezone caveat; recency window constants `KPI_RECENCY_WINDOW_SHORT_DAYS = 7` / `LONG_DAYS = 30` consumed via `mastery_constants` per Q4 and RB-05P-V1-15 (excluded from `constants_snapshot_hash` since they don't affect formula output); guardian aggregate read surface — guardians see `student_domain_mastery` \+ 3 KPI tables, NOT `student_skill_kpi`; **single-route \+ RLS-gating contract per Q5=b (§10.3-§10.7): one route per resource served to both student and guardian, RLS handles per-row filtering, route handlers MUST NOT branch on caller role, path-layer authz returns 404 for unrelated callers, empty-list 200 for skill-grain guardian queries, column projection at route layer in addition to GRANTs, no write routes, no pagination needed for V1.0 row counts;** pre-implementation verification gate covering 05B-owned RPCs, tables, RLS, GRANTs, and 05D audit table contract; diagnostic post-completion expected state across all 5 KPI tables \+ 2 mastery tables; domain mastery stress-test fixture reusing 05A's 31 scenarios at domain grain with cross-grain equivalence guarantee plus INV-05B-13 cross-skill aggregation invariant test; KPI stress fixture (K1-K7) covering zero-event, single-event, recency-window boundary, streak-with-gap, streak-ended-yesterday, per-section vs overall streak divergence; 15 hard invariants (9 inherited from Parent \+ 3 inherited from 05A \+ 3 sub-doc-specific: INV-05B-13 event-aggregation/not-roll-up, INV-05B-14 KPI tables are materialized derivatives only, INV-05B-15 recency windows read from constants); 23 acceptance criteria. Determinism caveat documented: KPI columns are deterministic-up-to-`T_now`, NOT pure-deterministic by event history alone; production uses default `now()`, CI/recompute paths inject fixed `T_now`. Latency budget documented (\~25-60ms typical, \~150ms worst case) with deferred sync/async split as the migration path if KPI latency becomes a product problem. **In-lock-cycle cleanup applied 2026-05-13 (RB-05B-V1-01..08; no version bump per Doc 04 family precedent):** RB-01 added `read_kpi_recency_constants()` helper bypassing `canonicalize_mastery_constants()` to separate formula vs operational constants discipline; RB-02 replaced silent NULL filters in 4 KPI refresh fns with explicit `KPI_HISTORICAL_DATA_INVALID` validation matching 05A's hard-fail pattern (RB-05A-V1-22); RB-03 added `p_domain` and `p_skill` predicates to `compute_streak_days` so the helper does what its signature says; RB-04 replaced `GREATEST(existing, new)` on `longest_streak_days` with pure `EXCLUDED.longest_streak_days` to preserve §2.2 truncate-and-rebuild equivalence; RB-05 reworded §10.3 to clarify that a single path-layer authz check inspecting student-self vs linked-guardian relationship is REQUIRED and is the only permitted role-aware branch while SQL/projection branching remains forbidden; RB-06 reworded §10.4 to clarify empty-list 200 applies only after path-layer authz has succeeded, unrelated callers get 404 before SELECT; RB-07 added §7.1.1 canonical event source taxonomy guard with CI grep-equivalence checks against 05A's source set; RB-08 added `last_event_id`/`last_event_occurred_at` columns to `student_domain_mastery` with `argmax(occurred_at)` capture in §4.7 for audit parity with 05A's `student_skill_mastery`. Status: Locked. |

---

*End of Doc 05B V1.0.*

---

 