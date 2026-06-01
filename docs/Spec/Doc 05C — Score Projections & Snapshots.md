# **Doc 05C — Score Projections & Snapshots**

| Field | Value |
| ----- | ----- |
| **Document** | Doc 05C — Score Projections & Snapshots |
| **Version** | V1.0 |
| **Status** | Locked 2026-05-14 (in-lock-cycle cleanup applied, RB-05C-V1-01..08; no version bump per Doc 04/05 family precedent). `compute_section_projection` deploy gated on two `BLOCKING_UPSTREAM_GAP` items: Doc 04B naming the completed-full-length read surface, and 04B emitting the projection-refresh outbox row — the spec is locked; wiring deploys when 04B resolves these. |
| **Scope** | The `student_section_projections` row schema and refresh contract; the blended projection point-estimate formula (mastery-derived weighted section score blended with up to two most recent completed full-lengths); the bounded confidence-range logic (evidence-driven shrinking band); the projection-refresh throttle (event-count, time, and full-length-completion triggers); the projection constants contract; the guardian projection read surface (RLS, entitlement-gated, same-row read — no reroute, no recompute); the pre-implementation verification gate for 05C-owned objects; the projection stress-test fixture covering blend states, range-width edges, and the Q4 gate. |
| **Audience** | Engineering, AI, Product, Data, Security, QA, Ops |
| **Governed by** | Doc 05 Parent V1.0 (Locked 2026-05-13, RB-05P-V1-01..15) |
| **Depends on** | Doc 00 · Doc 01 · Doc 02 Preamble V3.0 · Doc 02A V6 · Doc 02B V4 · Doc 04 Parent V3.0 · Doc 04A V2.2 · Doc 04B V4.3 · Doc 04C V1.0 · Doc 05A V1.0 · Doc 05B V1.0 |
| **Sibling sub-docs** | 05A (Mastery Formula & Skill Mastery), 05B (Domain Mastery & KPI Rollups), 05D (Mastery Audit, Recompute & Constants Governance) |
| **Superseded** | None at the V1 boundary — 05C is a clean-slate sub-doc of the locked Parent. |

---

## **1\. Purpose**

Doc 05C is the implementation contract for **score projections** — the forward-looking estimate of what a student would score on a real SAT, and the bounded confidence range around that estimate. It consumes domain mastery (05B) and completed full-length scaled scores (04B), and it produces the per-section projection rows that both the student and the linked guardian see.

This document defines:

* **The blended projection point-estimate formula.** Per Q1, the projection midpoint is the mean of the mastery-derived weighted section score and up to the two most recent *completed* full-length section scaled scores. The denominator adapts (1, 2, or 3\) to how many full-lengths exist (blend States A/B/C). The mastery term maps the weighted mastery onto the legal SAT section scale: `SECTION_MIN_SCORE + (Σ_domains [ domain_mastery[0,1] × domain_weight ]) × (SECTION_MAX_SCORE − SECTION_MIN_SCORE)` \= `200 + weighted_mastery × 600` (RB-05C-V1-05 — the mastery term is itself a legal section-score-scaled value, semantically consistent with the full-length terms it is blended with). The full-length terms come from 04B's canonical scoring.  
* **The bounded confidence-range logic.** Per the locked range spec, the band is intentionally wide when section-relevant evidence is low and shrinks linearly toward a tight band as evidence approaches a per-section target. The midpoint is the blended projection; the half-width (`projection_delta`) is evidence-driven.  
* **The `student_section_projections` row schema.** One canonical row per `(student_id, section)` plus an append-only snapshot history (Q6: the snapshot table *is* the audit trail; no separate 05D projection audit log). Stores the displayed mid/low/high/width, the evidence count, and the full set of blend inputs so every projection is reconstructable.  
* **The projection-refresh throttle.** Per Q3, projection does NOT refresh on every event. It refreshes on whichever comes first: `PROJECTION_REFRESH_EVENT_THRESHOLD` answered events since last refresh, `PROJECTION_REFRESH_TIME_THRESHOLD_HOURS` since last refresh, OR a full-length completion (which bypasses the throttle and refreshes immediately).  
* **The projection constants contract.** All projection constants live in `mastery_constants` (05D-governed), read via a dedicated `read_projection_constants()` helper mirroring 05B's `read_kpi_recency_constants()` (RB-05B-V1-01 pattern). Projection constants are operational and are EXCLUDED from the formula `constants_snapshot_hash`.  
* **The Q4 hard gate.** Per Q4, projection is NULL for every column until ALL 8 SAT domains have ≥ `MIN_EVENTS_FOR_MASTERY` events (the diagnostic-completion threshold). Below the gate, the range logic does not run. The gate is an on/off switch; the range expresses residual uncertainty once it is on.  
* **The guardian projection read surface.** Per Q5, student and guardian see the *same* `student_section_projections` rows (same mid/low/high/width). The guardian reads the student's rows directly through an entitlement-gated RLS policy — same single-route \+ RLS-gating contract as 05B §10. No reroute, no recompute, no guardian-specific projection logic.  
* **The pre-implementation verification gate.** Mirrors 05B §11's structured-report pattern.  
* **The projection stress-test fixture.** Covers blend States A/B/C, the Q4 gate boundary, range-width at zero/partial/full evidence, the legal-SAT clamp, rounding, and the total-from-sections composition.

Doc 05C does NOT define:

* The skill mastery row schema, RPC, or formula function — owned by 05A.  
* The domain mastery row schema, KPI rollups, or their refresh functions — owned by 05B.  
* The canonical raw-to-scaled scoring formula for actual full-length tests — owned by Doc 04B. 05C consumes 04B's scored full-length output; it does not re-score tests.  
* The audit log table schemas (for mastery/domain refresh), recompute orchestration, or constants governance lifecycle — owned by 05D. 05C's snapshot table is its own audit trail per Q6, but the `mastery_constants` governance lifecycle (who may write constants, change-log) remains 05D.  
* The diagnostic flow UX or question selection — owned by Doc 02B.  
* HTTP route handler implementations, payload shapes, or pagination — owned by future API surface docs. 05C locks the single-route \+ RLS-gating *contract* (one route per resource, served to both student and guardian; RLS does per-row filtering) and the underlying tables.

---

## **2\. Doctrine (Sub-Doc Level)**

### **2.1 Projection is forward-looking; full-length is calibration**

The projection exists to answer "what could this student score if current learning holds" — it is mastery-derived and forward-looking. A completed full-length is backward-looking and SAT-adaptivity-capped. The blend (Q1) uses both: the mastery term keeps the projection forward-looking; the full-length terms calibrate it against real adaptive results. A bad full-length pulls the projection down and a strong one pulls it up — symmetric, expected, and explainable. The projection is NEVER hard-clamped to the last full-length (the rejected design); the full-length enters only as a blended term.

### **2.2 The projection is an estimate, never a guarantee**

Per the Lyceon claims-discipline pillar, the projection is diagnostic, not predictive-as-promise. The bounded range is the mechanism that enforces honesty: wide when evidence is thin, shrinking only as section-specific evidence accumulates. The system never displays a precise point estimate without its range. This is non-negotiable and is enforced structurally (the range columns are NOT NULL whenever the midpoint is non-NULL).

### **2.3 Projection rows are materialized derivatives**

`student_section_projections` is a materialized derivative of canonical mastery (05B) \+ canonical full-length scores (04B) \+ projection constants. It is never a source of truth for mastery, scoring, or entitlement. Given the same inputs and the same constants snapshot, a recompute MUST produce a byte-identical projection. The snapshot history is append-only and is the projection audit trail (Q6).

### **2.4 Throttled refresh, not per-event**

At volume, a single answered question moves a domain mastery decimal negligibly, so per-event projection refresh is wasteful write amplification against an append-only table. Projection refreshes on a bounded throttle (Q3). A full-length completion is the one event that materially changes the blend, so it bypasses the throttle and refreshes immediately.

### **2.5 Guardian reads the student's projection directly**

Per Q5, the guardian does not get a parallel projection computation. The guardian reads the *same* `student_section_projections` rows the student sees, through an entitlement-gated RLS policy (active link AND active student entitlement, per Parent §11.1). There is no guardian-specific projection table, no reroute, and no recompute. This mirrors 05B's guardian-aggregate read doctrine exactly.

### **2.6 Projection constants are operational, not formula constants**

The projection deltas, target counts, rounding steps, refresh thresholds, and domain weights are operational tuning parameters. They live in `mastery_constants` but are read through a dedicated `read_projection_constants()` helper and are EXCLUDED from the formula `constants_snapshot_hash` (same separation discipline as RB-05B-V1-01 for KPI recency windows). Changing a projection constant does NOT invalidate `student_skill_mastery` or `student_domain_mastery` rows; it only triggers a projection recompute.

---

## **3\. Hard Invariants**

### **3.1 Invariants inherited from Parent §6 (re-applied at projection grain)**

* **INV-05C-P1 (server-authoritative):** projection rows are written only by `service_role` through the projection RPC. No client write path exists.  
* **INV-05C-P2 (no client trust):** projection inputs (mastery, full-length scores, evidence counts) are resolved server-side from canonical tables. Client-supplied projection values are never trusted.  
* **INV-05C-P3 (entitlement-gated visibility):** guardian projection visibility is derived ONLY from an active guardian link AND an active student entitlement (Parent §11.1).  
* **INV-05C-P4 (deterministic up to inputs):** given the same canonical mastery rows, the same set of completed full-lengths, and the same projection constants snapshot, the projection RPC produces a byte-identical row.

### **3.2 Invariants inherited from 05A/05B and re-applied at 05C grain**

* **INV-05C-A1 (one formula path):** 05C never re-derives mastery. It reads `student_domain_mastery.mastery_score` produced by 05B's `refresh_domain_mastery`. It never calls `compute_mastery_for_entity` itself.  
* **INV-05C-A2 (one scoring path):** 05C never re-scores a full-length. It reads the canonical scaled section scores produced by Doc 04B. It never converts raw to scaled itself.  
* **INV-05C-A3 (operational-constants separation):** projection constants are read via `read_projection_constants()`, never folded into the formula `constants_snapshot_hash` (RB-05B-V1-01 precedent).

### **3.3 05C-specific invariants**

### **INV-05C-13 — Projection is a blend, never a clamp**

The projection point estimate is `mean({mastery_term} ∪ {≤2 most recent completed full-lengths})`. It is NEVER hard-clamped to the last full-length, NEVER replaced by the last full-length, and NEVER computed from the full-length alone. The mastery term is always present in the blend whenever a projection exists (the Q4 gate guarantees the mastery term is computable before any projection is emitted). Enforcement: §6 formula \+ the §13 fixture state-A/B/C tests \+ a CI guard that the blend numerator always includes the mastery term.

### **INV-05C-14 — No projection without the full evidence gate**

A projection row's `projected_score_mid`, `_low`, `_high`, and `range_width` are NULL unless ALL 8 SAT domains for the student have `event_count_total ≥ MIN_EVENTS_FOR_MASTERY`. The range logic does not run below this gate. There is no "partial" projection from a subset of domains. Enforcement: §6.2 gate check \+ §13 fixture gate-boundary test \+ the NOT-NULL-together constraint in §7.

### **INV-05C-15 — Range is never NULL when midpoint is non-NULL**

Whenever `projected_score_mid IS NOT NULL`, all of `projected_score_low`, `projected_score_high`, and `range_width` are also NOT NULL and satisfy `low ≤ mid ≤ high` and `range_width = high − low`. The system never displays a point estimate without its confidence band (§2.2). Enforcement: a table CHECK constraint (§7.2) plus the §13 fixture.

### **INV-05C-16 — Projection constants excluded from formula hash**

`read_projection_constants()` reads projection operational constants from `mastery_constants` and these keys are NEVER included in `canonicalize_mastery_constants_serialized()` (the formula hash basis). A CI guard asserts the projection constant keys do not appear in the formula-hash key list. Enforcement: §9.3 \+ CI guard `projection_constants_excluded_from_formula_hash`.

### **INV-05C-17 — Snapshot history is append-only and is the audit trail**

`student_section_projection_snapshots` is append-only. No UPDATE or DELETE policy exists for any role except the 05D retention/cascade path (account deletion). Per Q6, this table IS the projection audit trail; there is no separate 05D-owned projection audit log. Enforcement: §7.4 RLS (no UPDATE/DELETE policy) \+ §11 verification gate.

---

## **4\. Projection Constants Contract**

### **4.1 Constant keys**

Per Q2, all projection constants live in `public.mastery_constants` (05D-governed), read via the dedicated helper in §9. They are operational and excluded from the formula hash (INV-05C-16).

| Key | Locked V1.0 value | Unit | Meaning |
| ----- | ----- | ----- | ----- |
| `PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION` | 500 | questions | Section-relevant evidence count at which the band reaches its tightest width. |
| `PROJECTION_MIN_DELTA` | 25 | scaled points | Tightest half-width (at ≥ target evidence), per section. |
| `PROJECTION_MAX_DELTA` | 100 | scaled points | Widest half-width (at \~0 evidence, just past the Q4 gate), per section. |
| `PROJECTION_MIDPOINT_ROUND_TO` | 10 | scaled points | Rounding step for the blended midpoint (legal SAT increment). |
| `PROJECTION_BOUND_ROUND_TO` | 10 | scaled points | Rounding step for the low/high bounds (legal SAT increment). |
| `PROJECTION_SECTION_MAX_SCORE` | 800 | scaled points | Per-section ceiling. |
| `PROJECTION_SECTION_MIN_SCORE` | 200 | scaled points | Per-section floor (legal SAT range; the range spec's `0` lower clamp is overridden to 200 per §6.5). |
| `PROJECTION_REFRESH_EVENT_THRESHOLD` | 40 | events | Answered events since last refresh that trigger a throttled refresh. |
| `PROJECTION_REFRESH_TIME_THRESHOLD_HOURS` | 24 | hours | Hours since last refresh that trigger a throttled refresh (caught by the 05D daily sweep). |

### **4.2 Domain weights**

The mastery term weights each domain by its official College Board share of the section. Weights are stored as a JSONB object in `mastery_constants` under the key `PROJECTION_DOMAIN_WEIGHTS`, keyed by `(section, domain)`, and MUST sum to exactly `1.000000` per section.

{  
  "M": {  
    "Algebra":                          0.350000,  
    "Advanced Math":                    0.350000,  
    "Problem Solving and Data Analysis":0.150000,  
    "Geometry and Trigonometry":        0.150000  
  },  
  "RW": {  
    "Information and Ideas":            0.260000,  
    "Craft and Structure":              0.280000,  
    "Expression of Ideas":              0.200000,  
    "Standard English Conventions":     0.260000  
  }  
}

These V1.0 weights are the normalized midpoints of College Board's published Digital SAT domain question-count ranges (Math: Algebra \~13–15, Advanced Math \~13–15, Problem Solving and Data Analysis \~5–7, Geometry and Trigonometry \~5–7 of 44 operational questions; Reading & Writing: Craft and Structure \~13–15, Information and Ideas \~12–14, Standard English Conventions \~11–15, Expression of Ideas \~8–12 of 54 operational questions), normalized to sum to 1.000000 per section. The exact canonical domain strings are governed by Parent §10.2 / RB-05P-V1-13 and Doc 05B; 05C uses them byte-identically (no punctuation variance) in this weights object, the §4.3 set, and the §5.5 gate VALUES list (RB-05C-V1-04). The exact decimals are 05D-governed and may be revised without a doc change if College Board republishes blueprint weightings; a weight revision triggers a projection recompute (§9.4) but does NOT invalidate mastery rows.

**Validation rule (enforced by `read_projection_constants()`):** for each section, `ABS(SUM(weights) − 1.000000) ≤ 0.000001`. If a section's weights do not sum to 1, the helper raises `PROJECTION_DOMAIN_WEIGHTS_INVALID` and the projection RPC aborts. This prevents a silently mis-weighted projection.

### **4.3 The 8-domain canonical set**

The projection requires exactly the 8 College Board SAT domains (4 Math \+ 4 Reading & Writing) verified in Parent RB-05P-V1-13. The mastery term sums over exactly these 8 (4 per section). If `student_domain_mastery` is missing a row for any of the 8 domains, that is by definition a sub-gate state (the domain has \< `MIN_EVENTS_FOR_MASTERY` events, so its row is absent or NULL), and the Q4 gate (INV-05C-14) holds the entire projection at NULL. There is no "missing domain → treat as zero" fallback; missing evidence means NULL projection, not a low projection.

---

## **5\. `compute_section_projection` RPC Contract**

### **5.1 Function signature**

CREATE OR REPLACE FUNCTION public.compute\_section\_projection(  
    p\_student\_id  uuid,  
    p\_section     text,  
    p\_t\_now       timestamptz DEFAULT now()  
)  
RETURNS public.student\_section\_projections  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $$  
DECLARE  
    v\_constants            jsonb;  
    v\_weights              jsonb;  
    v\_min\_delta            numeric;  
    v\_max\_delta            numeric;  
    v\_target\_qcount        integer;  
    v\_mid\_round            integer;  
    v\_bound\_round          integer;  
    v\_section\_max          integer;  
    v\_section\_min          integer;  
    v\_gate\_passed          boolean;  
    v\_weighted\_mastery     numeric;  
    v\_mastery\_term         numeric;  
    v\_fl1\_score            integer;  
    v\_fl2\_score            integer;  
    v\_fl\_count\_used        integer;  
    v\_blend\_numerator      numeric;  
    v\_blend\_denominator    integer;  
    v\_blended\_raw          numeric;  
    v\_relevant\_qcount      integer;  
    v\_evidence\_ratio       numeric;  
    v\_projection\_delta     numeric;  
    v\_mid                  integer;  
    v\_low                  integer;  
    v\_high                 integer;  
    v\_range\_width          integer;  
    v\_constants\_hash       text;  
    v\_result\_row           public.student\_section\_projections;  
BEGIN  
    \-- Body specified in §5.2 through §5.9.  
    RETURN v\_result\_row;  
END;  
$$;

REVOKE ALL ON FUNCTION public.compute\_section\_projection FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.compute\_section\_projection TO service\_role;

`SECURITY DEFINER` because it writes `student_section_projections` rows that no role other than `service_role` may write. `search_path` is locked to prevent search-path injection. Execute restricted to `service_role`. The `p_t_now` parameter exists for deterministic testing and 05D recompute (same pattern as 05B refresh functions).

### **5.2 Input validation**

IF p\_section NOT IN ('M', 'RW') THEN  
    RAISE EXCEPTION 'PROJECTION\_INVALID\_SECTION: section must be M or RW, got %', p\_section;  
END IF;

IF p\_student\_id IS NULL THEN  
    RAISE EXCEPTION 'PROJECTION\_INVALID\_STUDENT: p\_student\_id is NULL';  
END IF;

### **5.3 Acquire student-section advisory transaction lock**

Mirrors 05B's advisory-lock pattern (RB-05A-V1-01 / 05B §4.3) so concurrent refreshes of the same `(student, section)` projection serialize.

SET LOCAL lock\_timeout \= '5s';  
BEGIN  
    PERFORM pg\_advisory\_xact\_lock(  
        hashtext('projection|' || p\_student\_id::text || '|' || p\_section)  
    );  
EXCEPTION  
    WHEN lock\_not\_available OR query\_canceled THEN  
        RAISE EXCEPTION 'PROJECTION\_LOCK\_TIMEOUT: projection lock (%, %)', p\_student\_id, p\_section;  
END;

### **5.4 Read and validate projection constants**

SELECT  
    target\_qcount, min\_delta, max\_delta,  
    mid\_round, bound\_round, section\_max, section\_min, weights  
INTO  
    v\_target\_qcount, v\_min\_delta, v\_max\_delta,  
    v\_mid\_round, v\_bound\_round, v\_section\_max, v\_section\_min, v\_weights  
FROM public.read\_projection\_constants();

\-- read\_projection\_constants() raises:  
\--   PROJECTION\_CONSTANTS\_MISSING            if any required key is absent/inactive  
\--   PROJECTION\_CONSTANTS\_OUT\_OF\_RANGE       if a value fails its bounds check  
\--   PROJECTION\_DOMAIN\_WEIGHTS\_INVALID       if a section's weights do not sum to 1.000000

### **5.5 Evaluate the Q4 evidence gate (INV-05C-14)**

\-- RB-05C-V1-01: the gate must validate the EXACT canonical 8-domain set,  
\-- not merely count qualifying rows. Counting rows would pass incorrectly  
\-- if duplicate rows, extra non-canonical domain rows, or punctuation-  
\-- variant domain strings existed. We anti-join the canonical set against  
\-- student\_domain\_mastery: the gate passes iff NO required (section,domain)  
\-- pair is missing or below MIN\_EVENTS\_FOR\_MASTERY.  
\--  
\-- The canonical strings below are byte-identical to Parent §10.2 /  
\-- RB-05P-V1-13 and Doc 05B (RB-05C-V1-04). They MUST match the keys in  
\-- PROJECTION\_DOMAIN\_WEIGHTS (§4.2) exactly.  
WITH required\_domains(section, domain) AS (  
    VALUES  
        ('M','Algebra'),  
        ('M','Advanced Math'),  
        ('M','Problem Solving and Data Analysis'),  
        ('M','Geometry and Trigonometry'),  
        ('RW','Information and Ideas'),  
        ('RW','Craft and Structure'),  
        ('RW','Expression of Ideas'),  
        ('RW','Standard English Conventions')  
)  
SELECT NOT EXISTS (  
    SELECT 1  
    FROM   required\_domains rd  
    LEFT JOIN public.student\_domain\_mastery sdm  
           ON sdm.student\_id \= p\_student\_id  
          AND sdm.section    \= rd.section  
          AND sdm.domain     \= rd.domain  
    WHERE COALESCE(sdm.event\_count\_total, 0\) \< public.mastery\_min\_events()  
)  
INTO v\_gate\_passed;

IF NOT v\_gate\_passed THEN  
    \-- Emit / upsert an explicit NULL projection row (so the UI can show  
    \-- "not enough evidence yet" rather than a missing row).  
    v\_weighted\_mastery  := NULL;  
    v\_mastery\_term      := NULL;  
    v\_blended\_raw       := NULL;  
    v\_mid               := NULL;  
    v\_low               := NULL;  
    v\_high              := NULL;  
    v\_range\_width       := NULL;  
    v\_relevant\_qcount   := NULL;  
    v\_fl\_count\_used     := 0;  
    \-- Jump to the upsert in §5.8 with all projection columns NULL.  
END IF;

`public.mastery_min_events()` is the 05A/Parent accessor for `MIN_EVENTS_FOR_MASTERY` (the same value used by `compute_mastery_for_entity`). 05C reads it rather than hardcoding `5`, so a Parent change to the threshold propagates. The anti-join (RB-05C-V1-01) makes the gate provably correct against the canonical taxonomy: the `LEFT JOIN ... WHERE COALESCE(event_count_total,0) < threshold` returns a row for any required `(section,domain)` that is *absent* (LEFT JOIN NULL → COALESCE 0 \< threshold) OR *under threshold*; `NOT EXISTS` over that set is true iff every one of the exactly-8 canonical domains is present and at/above threshold. Duplicate or non-canonical rows in `student_domain_mastery` cannot make the gate pass, because the gate is driven by the `required_domains` VALUES set, not by a row count. The 8-domain VALUES list is the one structural constant 05C asserts directly; it is covered by the §13 fixture (P6/P7/P8) and the §11 verification gate, and a CI guard asserts it is byte-identical to the `PROJECTION_DOMAIN_WEIGHTS` keys.

### **5.6 Compute the mastery term (only if gate passed)**

\-- Sum over exactly the 4 domains of THIS section, weighted by official  
\-- College Board domain weights, to get weighted\_mastery ∈ \[0,1\].  
\-- domain\_mastery is the \[0,1\] decimal score from 05B's  
\-- student\_domain\_mastery.mastery\_score (NEVER recomputed here).  
SELECT  
    SUM(  
        sdm.mastery\_score  
        \* ((v\_weights \-\> p\_section \-\>\> sdm.domain)::numeric)  
    )  
INTO v\_weighted\_mastery  
FROM public.student\_domain\_mastery sdm  
WHERE sdm.student\_id \= p\_student\_id  
  AND sdm.section    \= p\_section  
  AND sdm.mastery\_score IS NOT NULL;

\-- Defensive: if the gate passed, all 4 section domains must have non-NULL  
\-- mastery\_score and a weight entry. A NULL here means a domain/weight  
\-- mismatch (a domain name in student\_domain\_mastery not present in the  
\-- weights JSONB), which is a data-integrity fault, not a low score.  
IF v\_weighted\_mastery IS NULL THEN  
    RAISE EXCEPTION  
      'PROJECTION\_MASTERY\_TERM\_NULL: gate passed but weighted mastery is NULL for (%, %) — domain/weight key mismatch',  
      p\_student\_id, p\_section;  
END IF;

\-- RB-05C-V1-05: map weighted\_mastery \[0,1\] onto the legal SAT section  
\-- scale \[SECTION\_MIN\_SCORE, SECTION\_MAX\_SCORE\] so the mastery term is  
\-- itself a legal section-score-scaled value, semantically consistent  
\-- with the full-length terms it is blended with.  
v\_mastery\_term :=  
    v\_section\_min \+ (v\_weighted\_mastery \* (v\_section\_max \- v\_section\_min));

This is the INV-05C-A1 boundary: 05C reads `mastery_score`, it never calls `compute_mastery_for_entity`. The hard raise on a NULL weighted mastery (rather than a silent COALESCE to 0\) is the RB-05B-V1-02 discipline applied here — a missing weight key is a fault that must surface, not a silently low projection. Per RB-05C-V1-05, the affine map `SECTION_MIN + weighted_mastery × (SECTION_MAX − SECTION_MIN)` makes the mastery term a legal section-scale value in `[200, 800]` (because `weighted_mastery ∈ [0,1]`), so every blend input is on the same scale; `v_mastery_term` therefore cannot be sub-200 even before the post-blend clamp.

### **5.7 Resolve the full-length terms and compute the blend (INV-05C-13)**

\-- The two most recent COMPLETED full-lengths for this section.  
\-- "Completed" \= Doc 04B produced a final scaled section score from a  
\-- fully submitted full-length (both modules). Partial/abandoned tests  
\-- never appear here (04B does not emit a scaled score for them).  
SELECT fl.section\_scaled\_score  
INTO   v\_fl1\_score  
FROM   public.full\_length\_section\_scores fl  
WHERE  fl.student\_id \= p\_student\_id  
  AND  fl.section    \= p\_section  
  AND  fl.is\_complete \= true  
ORDER BY fl.completed\_at DESC, fl.id DESC  
LIMIT 1;

SELECT fl.section\_scaled\_score  
INTO   v\_fl2\_score  
FROM   public.full\_length\_section\_scores fl  
WHERE  fl.student\_id \= p\_student\_id  
  AND  fl.section    \= p\_section  
  AND  fl.is\_complete \= true  
ORDER BY fl.completed\_at DESC, fl.id DESC  
OFFSET 1 LIMIT 1;

\-- Blend numerator/denominator adapt to how many full-lengths exist  
\-- (Q1 States A/B/C). The mastery term is ALWAYS present (INV-05C-13).  
v\_blend\_numerator   := v\_mastery\_term;  
v\_blend\_denominator := 1;

IF v\_fl1\_score IS NOT NULL THEN  
    v\_blend\_numerator   := v\_blend\_numerator \+ v\_fl1\_score;  
    v\_blend\_denominator := v\_blend\_denominator \+ 1;  
END IF;

IF v\_fl2\_score IS NOT NULL THEN  
    v\_blend\_numerator   := v\_blend\_numerator \+ v\_fl2\_score;  
    v\_blend\_denominator := v\_blend\_denominator \+ 1;  
END IF;

v\_fl\_count\_used := v\_blend\_denominator \- 1;          \-- 0, 1, or 2  
v\_blended\_raw   := v\_blend\_numerator / v\_blend\_denominator;

Notes:

* `full_length_section_scores` is the 04B-owned canonical view/table of per-section scaled scores for completed full-lengths. 05C consumes it read-only (INV-05C-A2). **The exact 04B object name is NOT yet resolved.** Per review item \#10, this is an explicit blocking-deploy gate, not a soft reconciliation: 05C MAY lock as a specification, but `compute_section_projection` MUST NOT be deployed until Doc 04B names the canonical completed-full-length section-score read surface and the §11.C check records the resolved object (name, columns `student_id, section, section_scaled_score, is_complete, completed_at, id`, and the "completed \= both modules submitted and scored" semantics). Until then the §11 gate marks this `BLOCKING_UPSTREAM_GAP — 04B object unnamed`. The lock-vs-deploy distinction is deliberate: the projection contract is stable and reviewable now; its wiring to 04B is gated on a 04B follow-up.  
* State A (no full-lengths): `v_blend_denominator = 1`, projection \= mastery term alone.  
* State B (1 full-length): denominator 2\.  
* State C (≥2 full-lengths): denominator 3, the two most recent by `completed_at`.  
* No staleness rule for V1.0 (Q1 State D): the two most recent completed full-lengths count regardless of age. A V1.1 staleness window is noted in §16 but not enforced.

### **5.8 Compute the bounded range (locked range spec)**

\-- Relevant evidence \= count of canonical answered events for this section  
\-- (same population 05B aggregates: practice \+ review \+ submitted  
\-- full-length answers, filtered to this section). 05C reads 05B's  
\-- student\_section\_kpi.events\_total rather than recomputing the union.  
SELECT COALESCE(ssk.events\_total, 0\)  
INTO   v\_relevant\_qcount  
FROM   public.student\_section\_kpi ssk  
WHERE  ssk.student\_id \= p\_student\_id  
  AND  ssk.section    \= p\_section;

\-- evidence\_ratio in \[0,1\]: 0 at no evidence, 1 at \>= target.  
v\_evidence\_ratio := LEAST(  
    GREATEST(v\_relevant\_qcount::numeric / v\_target\_qcount::numeric, 0),  
    1  
);

\-- Shrinking delta: widest at ratio 0, tightest at ratio 1 (locked formula).  
v\_projection\_delta :=  
    v\_max\_delta \- ((v\_max\_delta \- v\_min\_delta) \* v\_evidence\_ratio);

\-- Midpoint \= rounded blended projection, clamped to legal SAT range.  
v\_mid := public.round\_to\_step(  
    LEAST(GREATEST(v\_blended\_raw, v\_section\_min), v\_section\_max),  
    v\_mid\_round  
);

\-- Bounds: clamp to legal SAT range \[section\_min, section\_max\] (the range  
\-- spec's lower clamp of 0 is overridden to PROJECTION\_SECTION\_MIN\_SCORE  
\-- per §6.5), then round.  
v\_low := public.round\_to\_step(  
    LEAST(GREATEST(v\_mid \- v\_projection\_delta, v\_section\_min), v\_section\_max),  
    v\_bound\_round  
);

v\_high := public.round\_to\_step(  
    LEAST(GREATEST(v\_mid \+ v\_projection\_delta, v\_section\_min), v\_section\_max),  
    v\_bound\_round  
);

v\_range\_width := v\_high \- v\_low;

`public.round_to_step(value numeric, step integer)` is a small deterministic helper (§6.4) that rounds to the nearest multiple of `step` (10 → legal SAT increments). It is defined in this doc because rounding is projection-specific; it is `IMMUTABLE`.

### **5.9 Capture constants hash and upsert \+ snapshot**

\-- Operational projection-constants hash (NOT the formula hash; INV-05C-16).  
\-- Used so a recompute can prove which projection-constant set produced  
\-- this row. RB-05C-V1-06: hash a CANONICAL serialization (sorted keys,  
\-- fixed numeric formatting) rather than raw jsonb::text, mirroring 05A's  
\-- canonicalize\_mastery\_constants\_serialized() discipline.  
v\_constants\_hash := encode(  
    digest(  
        convert\_to(  
            public.canonicalize\_projection\_constants\_serialized(),  
            'UTF8'  
        ),  
        'sha256'  
    ),  
    'hex'  
);

\-- Upsert the canonical current row, then append an immutable snapshot.  
INSERT INTO public.student\_section\_projections (  
    student\_id, section,  
    projected\_score\_mid, projected\_score\_low, projected\_score\_high,  
    range\_width, relevant\_question\_count,  
    mastery\_term, fl1\_score, fl2\_score, fl\_count\_used,  
    blend\_denominator,  
    projection\_constants\_hash, mastery\_model\_version,  
    computed\_at, refreshed\_at\_t\_now  
) VALUES (  
    p\_student\_id, p\_section,  
    v\_mid, v\_low, v\_high,  
    v\_range\_width, v\_relevant\_qcount,  
    v\_mastery\_term, v\_fl1\_score, v\_fl2\_score, v\_fl\_count\_used,  
    v\_blend\_denominator,  
    v\_constants\_hash, public.mastery\_model\_version(),  
    now(), p\_t\_now  
)  
ON CONFLICT (student\_id, section) DO UPDATE SET  
    projected\_score\_mid       \= EXCLUDED.projected\_score\_mid,  
    projected\_score\_low       \= EXCLUDED.projected\_score\_low,  
    projected\_score\_high      \= EXCLUDED.projected\_score\_high,  
    range\_width               \= EXCLUDED.range\_width,  
    relevant\_question\_count   \= EXCLUDED.relevant\_question\_count,  
    mastery\_term              \= EXCLUDED.mastery\_term,  
    fl1\_score                 \= EXCLUDED.fl1\_score,  
    fl2\_score                 \= EXCLUDED.fl2\_score,  
    fl\_count\_used             \= EXCLUDED.fl\_count\_used,  
    blend\_denominator         \= EXCLUDED.blend\_denominator,  
    projection\_constants\_hash \= EXCLUDED.projection\_constants\_hash,  
    mastery\_model\_version     \= EXCLUDED.mastery\_model\_version,  
    computed\_at               \= EXCLUDED.computed\_at,  
    refreshed\_at\_t\_now        \= EXCLUDED.refreshed\_at\_t\_now  
RETURNING \* INTO v\_result\_row;

\-- Append-only snapshot (Q6: this IS the projection audit trail).  
\-- RB-05C-V1-02: v\_result\_row is a PL/pgSQL record variable, NOT a  
\-- relation — \`FROM v\_result\_row\` is invalid SQL. Insert via a VALUES  
\-- list referencing the record's fields directly.  
INSERT INTO public.student\_section\_projection\_snapshots (  
    student\_id, section,  
    projected\_score\_mid, projected\_score\_low, projected\_score\_high,  
    range\_width, relevant\_question\_count,  
    mastery\_term, fl1\_score, fl2\_score, fl\_count\_used,  
    blend\_denominator,  
    projection\_constants\_hash, mastery\_model\_version,  
    snapshot\_at, refreshed\_at\_t\_now  
)  
VALUES (  
    v\_result\_row.student\_id,  
    v\_result\_row.section,  
    v\_result\_row.projected\_score\_mid,  
    v\_result\_row.projected\_score\_low,  
    v\_result\_row.projected\_score\_high,  
    v\_result\_row.range\_width,  
    v\_result\_row.relevant\_question\_count,  
    v\_result\_row.mastery\_term,  
    v\_result\_row.fl1\_score,  
    v\_result\_row.fl2\_score,  
    v\_result\_row.fl\_count\_used,  
    v\_result\_row.blend\_denominator,  
    v\_result\_row.projection\_constants\_hash,  
    v\_result\_row.mastery\_model\_version,  
    now(),  
    v\_result\_row.refreshed\_at\_t\_now  
);

RETURN v\_result\_row;

The upsert keeps one current row per `(student, section)`; the snapshot append is the audit history. Both happen in the same transaction so the current row and its snapshot can never disagree. `v_result_row` is the `RETURNING * INTO` record from the upsert; its field references in the `VALUES` list are valid PL/pgSQL (a record variable's fields, not a relation).

### **5.10 Error handling**

| Error code | Source | Effect |
| ----- | ----- | ----- |
| `PROJECTION_INVALID_SECTION` | §5.2 | Abort; bad caller input |
| `PROJECTION_INVALID_STUDENT` | §5.2 | Abort; bad caller input |
| `PROJECTION_LOCK_TIMEOUT` | §5.3 | Abort; serialize-and-retry upstream |
| `PROJECTION_CONSTANTS_MISSING` | §5.4 / §9 | Abort; 05D constants gap |
| `PROJECTION_CONSTANTS_OUT_OF_RANGE` | §5.4 / §9 | Abort; 05D constants fault |
| `PROJECTION_DOMAIN_WEIGHTS_INVALID` | §5.4 / §9 | Abort; weights do not sum to 1 |
| `PROJECTION_MASTERY_TERM_NULL` | §5.6 | Abort; domain/weight key mismatch (data-integrity fault) |

All failures abort the calling transaction (the throttled-refresh caller in §8). A failed projection refresh never produces a partial row; the prior current row remains and no snapshot is appended.

---

## **6\. Projection Formula (Authoritative Reference)**

This section is the human-readable authoritative statement of the formula the §5 RPC implements. If §5 SQL and this section ever disagree, this section is the source of truth and the SQL is the defect.

### **6.1 Mastery term (per section)**

weighted\_mastery(section) \=  
    Σ  over the 4 domains d in section:  
        domain\_mastery\[d\]            \-- \[0,1\] decimal from student\_domain\_mastery.mastery\_score (05B)  
        × domain\_weight\[section\]\[d\]  \-- official CB weight, Σ \= 1.000000 per section

mastery\_term(section) \=  
    SECTION\_MIN\_SCORE  
    \+ weighted\_mastery(section) × (SECTION\_MAX\_SCORE − SECTION\_MIN\_SCORE)  
    \-- \= 200 \+ weighted\_mastery × 600

Because `Σ domain_weight = 1` and each `domain_mastery ∈ [0,1]`, `weighted_mastery ∈ [0,1]` and therefore `mastery_term ∈ [200, 800]` (RB-05C-V1-05). The mastery term is itself a legal section-score-scaled value, on the same scale as the full-length terms it is blended with — a zero-mastery student maps to the SAT floor (200), a perfect-mastery student maps to the section ceiling (800). This makes every blend input semantically homogeneous; the post-blend clamp in §6.5 is then only a defensive guarantee, never the mechanism that produces a legal floor.

### **6.2 Evidence gate (Q4 / INV-05C-14)**

gate\_passed  ⇔  ( for ALL 8 SAT domains of the student :  
                     student\_domain\_mastery.event\_count\_total ≥ MIN\_EVENTS\_FOR\_MASTERY )

if NOT gate\_passed:  
    projected\_score\_mid   \= NULL  
    projected\_score\_low   \= NULL  
    projected\_score\_high  \= NULL  
    range\_width           \= NULL  
    relevant\_question\_count \= NULL  
    (row still upserted so the UI can show "not enough evidence yet")

The gate is whole-student (all 8 domains across both sections), matching the diagnostic design (40 questions \= 8 domains × 5). A per-section projection is emitted only when the whole-student gate passes. There is no partial projection.

### **6.3 Blended midpoint (Q1 / INV-05C-13)**

inputs        \= { mastery\_term }  
                ∪ { FL1\_section\_scaled | most recent completed full-length, if any }  
                ∪ { FL2\_section\_scaled | 2nd most recent completed full-length, if any }

blend\_denominator \= |inputs|            \-- 1 (State A), 2 (State B), or 3 (State C)  
blended\_raw       \= ( Σ inputs ) / blend\_denominator

* The mastery term is ALWAYS in `inputs` (the gate guarantees it is computable). INV-05C-13: the projection is never the full-length alone and never a clamp to the full-length.  
* "Completed full-length" \= Doc 04B emitted a final scaled section score for a fully submitted full-length (both modules). Abandoned/partial tests are excluded by construction (04B emits no scaled score for them).  
* Ordering: most recent two by `completed_at` (tiebreak `id` desc).  
* No staleness rule for V1.0 (Q1 State D).

### **6.4 Rounding helper**

CREATE OR REPLACE FUNCTION public.round\_to\_step(  
    p\_value numeric,  
    p\_step  integer  
)  
RETURNS integer  
LANGUAGE sql  
IMMUTABLE  
AS $$  
    SELECT (ROUND(p\_value / p\_step) \* p\_step)::integer;  
$$;

`round_to_step(742, 10) = 740`, `round_to_step(745, 10) = 750` (banker's rounding is NOT used; `ROUND` half-away-from-zero is the Postgres default for `numeric` and is the locked behavior — every output is a legal SAT 10-point increment). `IMMUTABLE` because it is pure arithmetic.

### **6.5 Bounded range (locked range spec, with the 200 floor)**

evidence\_ratio   \= clamp( relevant\_question\_count / TARGET\_QCOUNT\_PER\_SECTION , 0, 1 )

projection\_delta \= MAX\_DELTA − ( (MAX\_DELTA − MIN\_DELTA) × evidence\_ratio )

projected\_score\_mid  \= round\_to\_step(  
                           clamp( blended\_raw, SECTION\_MIN\_SCORE, SECTION\_MAX\_SCORE ),  
                           MIDPOINT\_ROUND\_TO )

projected\_score\_low  \= round\_to\_step(  
                           clamp( projected\_score\_mid − projection\_delta,  
                                  SECTION\_MIN\_SCORE, SECTION\_MAX\_SCORE ),  
                           BOUND\_ROUND\_TO )

projected\_score\_high \= round\_to\_step(  
                           clamp( projected\_score\_mid \+ projection\_delta,  
                                  SECTION\_MIN\_SCORE, SECTION\_MAX\_SCORE ),  
                           BOUND\_ROUND\_TO )

range\_width          \= projected\_score\_high − projected\_score\_low

The single deviation from the supplied range spec: the spec clamps to `[0, section_max_score]`; 05C clamps to `[PROJECTION_SECTION_MIN_SCORE, PROJECTION_SECTION_MAX_SCORE]` \= `[200, 800]`, because no real SAT section scores below 200 and the system must never compute, store, or display a sub-200 section number. This is documented here, in §4.1 (the `PROJECTION_SECTION_MIN_SCORE` row), and in the §16 change record so the deviation from the source spec is explicit and auditable.

**`range_width` is the post-round, post-clamp displayed width — NOT mathematically `2 × projection_delta`** (review item \#11). Because the low and high bounds are independently clamped to `[200, 800]` and then rounded to `BOUND_ROUND_TO`, the stored `range_width = projected_score_high − projected_score_low` can be narrower than `2 × projection_delta` (when a bound hits the 200 or 800 clamp) or differ by a rounding step (when low and high round in different directions). This is expected and correct: `range_width` is defined as the difference of the two *displayed* bounds, not as a function of `projection_delta`. Consumers MUST treat `range_width` as the authoritative displayed band width and MUST NOT reconstruct it from `projection_delta`. The `projection_range_coherent` CHECK (§7.2) enforces only `range_width = high − low` and `low ≤ mid ≤ high`; it deliberately does NOT assert any relationship to `projection_delta`.

### **6.6 Section vs. total composition (Pin-1 / Model 5-a)**

total\_projected\_mid  \= M.projected\_score\_mid  \+ RW.projected\_score\_mid  
total\_projected\_low  \= M.projected\_score\_low  \+ RW.projected\_score\_low  
total\_projected\_high \= M.projected\_score\_high \+ RW.projected\_score\_high  
total\_range\_width    \= total\_projected\_high − total\_projected\_low  
                     \= M.range\_width \+ RW.range\_width

Per the locked Pin-1 decision, the total is the **simple sum of the per-section bounds** (Model 5-a — no halving, no independence assumption). The per-section deltas are applied directly from the constants (`MIN_DELTA = 25`, `MAX_DELTA = 100`), NOT computed-then-halved. The earlier "halve the formula then sum" framing was reconciled to "the per-section-500 target IS the calibration; constants apply directly" — the constant equals the real displayed value (the RB-05B-V1-04 discipline: a constant must not be silently transformed before display).

Resulting band behavior:

| Evidence state | Per-section band | Total band |
| ----- | ----- | ----- |
| ≥ 500 section questions (tightest) | mid ± 25 (50-pt range) | total\_mid ± 50 (100-pt range) |
| \~0 section evidence (just past Q4 gate) | mid ± 100 (200-pt range) | total\_mid ± 200 (400-pt range) |

The total is **not stored** as its own row in V1.0 — it is derived at read time by summing the two `student_section_projections` rows. This keeps one write path and avoids a third row that could disagree with its sections. The read/route layer composes the total; §10 documents this. (A stored `student_total_projection` is noted in §16 as a possible V1.1 optimization if read-time composition becomes a hotspot.)

### **6.7 Worked examples**

**Example 1 — State C, high evidence.** Math: domain masteries {Algebra 0.82, Advanced Math 0.78, Problem Solving and Data Analysis 0.70, Geometry and Trigonometry 0.65}; weights {0.35, 0.35, 0.15, 0.15}. `weighted_mastery = 0.82·0.35 + 0.78·0.35 + 0.70·0.15 + 0.65·0.15 = 0.287 + 0.273 + 0.105 + 0.0975 = 0.7625`. `mastery_term = 200 + 0.7625·600 = 200 + 457.5 = 657.5`. FL1 \= 640, FL2 \= 600\. `blended_raw = (657.5 + 640 + 600) / 3 = 632.5`. `relevant_question_count = 540 ≥ 500` → `evidence_ratio = 1` → `projection_delta = 100 − (100−25)·1 = 25`. `mid = round_to_step(clamp(632.5, 200, 800), 10) = round_to_step(632.5,10) = 630`. `low = round_to_step(clamp(630−25,200,800),10) = round_to_step(605,10) = 610`. `high = round_to_step(clamp(630+25,200,800),10) = round_to_step(655,10) = 660`. `range_width = 660 − 610 = 50`. → Math projection **630 (610–660)**.

**Example 2 — State A, low evidence (just past Q4 gate).** All 8 domains have exactly 5 events (diagnostic just completed). No full-lengths. Math `weighted_mastery = 0.467` (worked from that student's domain masteries) → `mastery_term = 200 + 0.467·600 = 480.2`. `blended_raw = 480.2 / 1 = 480.2` (State A). `relevant_question_count = 20` (Math half of the 40-question diagnostic) → `evidence_ratio = 20/500 = 0.04` → `projection_delta = 100 − 75·0.04 = 100 − 3 = 97`. `mid = round_to_step(clamp(480.2,200,800),10) = round_to_step(480.2,10) = 480`. `low = round_to_step(clamp(480−97,200,800),10) = round_to_step(383,10) = 380`. `high = round_to_step(clamp(480+97,200,800),10) = round_to_step(577,10) = 580`. `range_width = 580 − 380 = 200`. → Math projection **480 (380–580)** — deliberately wide, honest about thin evidence.

**Example 3 — gate not passed.** Student has 7 of 8 domains at ≥5 events, 1 domain at 3 events. `gate_passed = false`. Row upserted with `projected_score_mid = NULL, low = NULL, high = NULL, range_width = NULL, relevant_question_count = NULL, fl_count_used = 0`. UI shows "not enough evidence yet."

---

## **7\. `student_section_projections` & Snapshot Schema**

### **7.1 Current-projection table**

One canonical row per `(student_id, section)`. Upserted by §5.9.

CREATE TABLE IF NOT EXISTS public.student\_section\_projections (  
    \-- Identity  
    student\_id                uuid          NOT NULL,  
    section                   text          NOT NULL CHECK (section IN ('M', 'RW')),

    \-- Displayed projection (NULL together below the Q4 gate; INV-05C-14/15)  
    projected\_score\_mid       integer       NULL  
        CHECK (projected\_score\_mid  IS NULL OR projected\_score\_mid  BETWEEN 200 AND 800),  
    projected\_score\_low       integer       NULL  
        CHECK (projected\_score\_low  IS NULL OR projected\_score\_low  BETWEEN 200 AND 800),  
    projected\_score\_high      integer       NULL  
        CHECK (projected\_score\_high IS NULL OR projected\_score\_high BETWEEN 200 AND 800),  
    range\_width               integer       NULL  
        CHECK (range\_width IS NULL OR range\_width \>= 0),  
    relevant\_question\_count   integer       NULL  
        CHECK (relevant\_question\_count IS NULL OR relevant\_question\_count \>= 0),

    \-- Blend audit anchors (reconstruct the blend exactly; admin-only)  
    mastery\_term              numeric(8,4)  NULL,  
    fl1\_score                 integer       NULL  
        CHECK (fl1\_score IS NULL OR fl1\_score BETWEEN 200 AND 800),  
    fl2\_score                 integer       NULL  
        CHECK (fl2\_score IS NULL OR fl2\_score BETWEEN 200 AND 800),  
    fl\_count\_used             smallint      NOT NULL DEFAULT 0  
        CHECK (fl\_count\_used BETWEEN 0 AND 2),  
    blend\_denominator         smallint      NOT NULL DEFAULT 1  
        CHECK (blend\_denominator BETWEEN 1 AND 3),

    \-- Versioning / audit  
    projection\_constants\_hash text          NULL,  
    mastery\_model\_version     text          NOT NULL DEFAULT 'v1.0',  
    computed\_at               timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now        timestamptz   NOT NULL DEFAULT now(),

    PRIMARY KEY (student\_id, section),

    \-- INV-05C-15: range columns are NULL together or present together,  
    \-- and when present satisfy low \<= mid \<= high and width \= high \- low.  
    CONSTRAINT projection\_range\_coherent CHECK (  
        (  
            projected\_score\_mid  IS NULL AND  
            projected\_score\_low  IS NULL AND  
            projected\_score\_high IS NULL AND  
            range\_width          IS NULL  
        )  
        OR  
        (  
            projected\_score\_mid  IS NOT NULL AND  
            projected\_score\_low  IS NOT NULL AND  
            projected\_score\_high IS NOT NULL AND  
            range\_width          IS NOT NULL AND  
            projected\_score\_low  \<= projected\_score\_mid AND  
            projected\_score\_mid  \<= projected\_score\_high AND  
            range\_width          \=  projected\_score\_high \- projected\_score\_low  
        )  
    ),

    \-- fl\_count\_used must be consistent with blend\_denominator  
    CONSTRAINT projection\_blend\_denominator\_coherent CHECK (  
        blend\_denominator \= fl\_count\_used \+ 1  
    )  
);

CREATE INDEX IF NOT EXISTS idx\_student\_section\_projections\_student  
    ON public.student\_section\_projections (student\_id);

The two CHECK constraints make INV-05C-15 and INV-05C-13's denominator arithmetic database-enforced, not just code-enforced — a reviewer's preferred defense-in-depth posture.

### **7.2 Append-only snapshot table**

CREATE TABLE IF NOT EXISTS public.student\_section\_projection\_snapshots (  
    snapshot\_id               bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  
    student\_id                uuid          NOT NULL,  
    section                   text          NOT NULL CHECK (section IN ('M', 'RW')),

    projected\_score\_mid       integer       NULL  
        CHECK (projected\_score\_mid  IS NULL OR projected\_score\_mid  BETWEEN 200 AND 800),  
    projected\_score\_low       integer       NULL  
        CHECK (projected\_score\_low  IS NULL OR projected\_score\_low  BETWEEN 200 AND 800),  
    projected\_score\_high      integer       NULL  
        CHECK (projected\_score\_high IS NULL OR projected\_score\_high BETWEEN 200 AND 800),  
    range\_width               integer       NULL,  
    relevant\_question\_count   integer       NULL,

    mastery\_term              numeric(8,4)  NULL,  
    fl1\_score                 integer       NULL,  
    fl2\_score                 integer       NULL,  
    fl\_count\_used             smallint      NOT NULL DEFAULT 0,  
    blend\_denominator         smallint      NOT NULL DEFAULT 1,

    projection\_constants\_hash text          NULL,  
    mastery\_model\_version     text          NOT NULL DEFAULT 'v1.0',  
    snapshot\_at               timestamptz   NOT NULL DEFAULT now(),  
    refreshed\_at\_t\_now        timestamptz   NOT NULL DEFAULT now()  
);

CREATE INDEX IF NOT EXISTS idx\_projection\_snapshots\_student\_section\_time  
    ON public.student\_section\_projection\_snapshots (student\_id, section, snapshot\_at DESC);

`snapshot_id` is a surrogate identity so the table is purely append-only (no natural-key upsert path exists). Per Q6 / INV-05C-17 this table IS the projection audit trail — there is no separate 05D projection audit log.

### **7.3 Column-level visibility contract**

| Column | Visibility | Notes |
| ----- | ----- | ----- |
| `student_id`, `section` | student-self \+ linked-guardian \+ admin/service | Identity |
| `projected_score_mid` | student-self \+ linked-guardian \+ admin/service | **The headline projected score, shown to student AND guardian (Q5).** |
| `projected_score_low` / `_high` | student-self \+ linked-guardian \+ admin/service | The confidence band, shown to both (Q5) |
| `range_width` | student-self \+ linked-guardian \+ admin/service | Shown to both |
| `relevant_question_count` | student-self \+ linked-guardian \+ admin/service | "based on N questions" context, shown to both |
| `mastery_term` | service\_role, admin only | Blend audit anchor; never client-exposed |
| `fl1_score`, `fl2_score`, `fl_count_used`, `blend_denominator` | service\_role, admin only | Blend audit anchors; never client-exposed |
| `projection_constants_hash` | service\_role, admin only | Audit |
| `mastery_model_version` | service\_role, admin only | Audit |
| `computed_at` | student-self \+ linked-guardian \+ admin/service | "updated 3h ago" |
| `refreshed_at_t_now` | service\_role, admin only | Determinism anchor; never client-exposed |

Unlike 05B (where guardians see only `mastery_level`, a deliberately coarse signal), the projection band IS the guardian-facing headline (Q5=b → student and guardian see the *same* range). The range itself is the honesty mechanism (§2.2), so showing it to the guardian is consistent with the claims-discipline pillar — the guardian sees an explicitly bounded estimate, not a precise number.

### **7.4 RLS policies**

ALTER TABLE public.student\_section\_projections          ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.student\_section\_projection\_snapshots ENABLE ROW LEVEL SECURITY;

\-- \---- Current projection: student self-read \----  
CREATE POLICY student\_section\_projections\_student\_read  
    ON public.student\_section\_projections  
    FOR SELECT  
    TO authenticated  
    USING (student\_id \= auth.uid());

\-- \---- Current projection: guardian read (active link AND active entitlement) \----  
CREATE POLICY student\_section\_projections\_guardian\_read  
    ON public.student\_section\_projections  
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

\-- \---- Snapshots: student self-read \----  
CREATE POLICY projection\_snapshots\_student\_read  
    ON public.student\_section\_projection\_snapshots  
    FOR SELECT  
    TO authenticated  
    USING (student\_id \= auth.uid());

\-- \---- Snapshots: guardian read (same entitlement gate) \----  
CREATE POLICY projection\_snapshots\_guardian\_read  
    ON public.student\_section\_projection\_snapshots  
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

\-- WRITE: no INSERT/UPDATE/DELETE policy for authenticated on either table.  
\-- Absence of policy is the denial. Only service\_role (which bypasses RLS)  
\-- writes, and only through compute\_section\_projection (SECURITY DEFINER).  
\-- INV-05C-17: the snapshot table additionally has NO UPDATE/DELETE path  
\-- for ANY role except the 05D account-deletion cascade.

The guardian read policy is byte-identical in shape to 05B's `student_domain_mastery_guardian_read` (Parent §11.1 entitlement gate). This is intentional: one guardian-gate pattern across the entire 05 family, so a reviewer audits it once.

### **7.5 Column-level grants**

REVOKE ALL ON public.student\_section\_projections          FROM PUBLIC;  
REVOKE ALL ON public.student\_section\_projection\_snapshots FROM PUBLIC;

GRANT ALL ON public.student\_section\_projections           TO service\_role;  
GRANT ALL ON public.student\_section\_projection\_snapshots  TO service\_role;

GRANT SELECT (  
    student\_id, section,  
    projected\_score\_mid, projected\_score\_low, projected\_score\_high,  
    range\_width, relevant\_question\_count, computed\_at  
) ON public.student\_section\_projections TO authenticated;

GRANT SELECT (  
    student\_id, section,  
    projected\_score\_mid, projected\_score\_low, projected\_score\_high,  
    range\_width, relevant\_question\_count, snapshot\_at  
) ON public.student\_section\_projection\_snapshots TO authenticated;

GRANT SELECT ON public.student\_section\_projections          TO admin\_role;  
GRANT SELECT ON public.student\_section\_projection\_snapshots TO admin\_role;

Defense-in-depth identical to 05B: RLS decides which rows, column GRANTs decide which columns. The blend audit anchors (`mastery_term`, `fl*`, hashes, `refreshed_at_t_now`) are NOT in the `authenticated` GRANT.

### **7.6 Lifecycle**

| Trigger | Effect |
| ----- | ----- |
| Throttle fires below Q4 gate | Upsert current row with all projection columns NULL; append a NULL snapshot. UI shows "not enough evidence yet." |
| Throttle fires at/above Q4 gate | Upsert current row with computed mid/low/high/width; append a snapshot. |
| Full-length completion | Immediate refresh (bypasses throttle, §8.3); upsert \+ snapshot. |
| 05D recompute (constants change / backfill) | Upsert current row to current canonical values; append a snapshot tagged with the new `projection_constants_hash`. |
| Student account deletion | Per Parent §11.1, both the current row and ALL snapshot rows for the student are removed in the same transaction as the identity row. 05D owns the cascade definition; this is the ONLY delete path for the append-only snapshot table (INV-05C-17). The `student_projection_refresh_state` row and any `projection_refresh_outbox` rows for the student are removed in the same cascade. |

### **7.7 05C-owned refresh-state and outbox tables (RB-05C-V1-03 / RB-05C-V1-07)**

Per RB-05C-V1-03 and RB-05C-V1-07, projection-refresh bookkeeping is owned by 05C, not by an 05A/05B table. Two small tables:

\-- Throttle counter. One row per student. 05C-owned (RB-05C-V1-03).  
CREATE TABLE IF NOT EXISTS public.student\_projection\_refresh\_state (  
    student\_id            uuid          NOT NULL PRIMARY KEY,  
    events\_since\_refresh  integer       NOT NULL DEFAULT 0  
        CHECK (events\_since\_refresh \>= 0),  
    last\_refresh\_at       timestamptz   NULL  
);

\-- Full-length-completion handoff. Append-only outbox; 04B inserts,  
\-- the 05C/05D worker consumes (RB-05C-V1-07).  
CREATE TABLE IF NOT EXISTS public.projection\_refresh\_outbox (  
    outbox\_id     bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  
    student\_id    uuid          NOT NULL,  
    reason        text          NOT NULL  
        CHECK (reason IN ('full\_length\_completed')),  
    requested\_at  timestamptz   NOT NULL DEFAULT now(),  
    processed\_at  timestamptz   NULL  
);

CREATE INDEX IF NOT EXISTS idx\_projection\_refresh\_outbox\_unprocessed  
    ON public.projection\_refresh\_outbox (requested\_at)  
    WHERE processed\_at IS NULL;

RLS / GRANTs:

ALTER TABLE public.student\_projection\_refresh\_state ENABLE ROW LEVEL SECURITY;  
ALTER TABLE public.projection\_refresh\_outbox        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student\_projection\_refresh\_state FROM PUBLIC;  
REVOKE ALL ON public.projection\_refresh\_outbox        FROM PUBLIC;

GRANT ALL ON public.student\_projection\_refresh\_state TO service\_role;  
GRANT ALL ON public.projection\_refresh\_outbox        TO service\_role;

\-- No authenticated (student/guardian) access: these are internal  
\-- refresh-bookkeeping tables, never a read surface. Absence of any  
\-- SELECT policy for \`authenticated\` is the denial (same absence-of-policy  
\-- pattern as 05B's student\_skill\_kpi).

Notes:

* `student_projection_refresh_state` is internal bookkeeping — it is NOT a student/guardian read surface (no `authenticated` policy; denial by policy absence, the 05B precedent).  
* `projection_refresh_outbox` is the single locked full-length-completion handoff (RB-05C-V1-07). 04B's only obligation is to INSERT a `('full_length_completed')` row in its scoring transaction (verified in §11.C). The partial index on `WHERE processed_at IS NULL` keeps the consumer's scan cheap regardless of total history size.  
* Both tables are removed for a student by the Parent §11.1 account-deletion cascade (05D-owned), same as the projection tables.  
* Outbox rows are retained after `processed_at` is set (append-only audit of refresh triggers); a 05D retention job MAY prune processed rows older than a documented window — that retention policy is 05D-owned and out of scope for 05C V1.0.

---

## **8\. Projection Refresh Throttle**

### **8.1 Why throttled (not synchronous per event)**

Per Q3 and §2.4, projection does not refresh on every `apply_mastery_event`. At volume a single answered question changes a domain mastery decimal — and therefore the blended projection — by an amount far below the `PROJECTION_*_ROUND_TO = 10` rounding step, so most per-event refreshes would produce an identical row while appending a redundant snapshot to an append-only table. The throttle bounds snapshot growth to roughly one row per student per section per day under heavy use.

### **8.2 Trigger conditions**

A projection refresh for `(student, section)` fires on whichever comes first:

1. **Event-count trigger:** `events_since_projection_refresh ≥ PROJECTION_REFRESH_EVENT_THRESHOLD` (40). A per-student counter is incremented by `apply_mastery_event` (05A); when it crosses the threshold, `apply_mastery_event` calls `compute_section_projection` for the affected section(s) in the same transaction and resets the counter.  
2. **Time trigger:** `now() − last projection refresh ≥ PROJECTION_REFRESH_TIME_THRESHOLD_HOURS` (24) for a student who has had any activity since the last refresh but has not hit the event threshold. This case is caught by a 05D-owned daily sweep (§8.4), not by `apply_mastery_event` (a student who did 10 questions and stopped never re-enters the event path).  
3. **Full-length-completion trigger:** a completed full-length refreshes BOTH sections immediately, bypassing the throttle entirely (§8.3).

### **8.3 Full-length completion triggers an immediate refresh via outbox (RB-05C-V1-07)**

A newly completed full-length materially changes the blend (it adds or replaces an `FL1`/`FL2` term, shifting the midpoint by potentially tens of points). Waiting up to 40 events or 24 hours to reflect a just-finished practice test would be visibly wrong to the student. So a completed full-length triggers an immediate projection refresh for both sections.

Per RB-05C-V1-07, the integration is a **transactional-outbox handoff**, not a synchronous cross-doc call. The earlier "in or right after the 04B scoring transaction, or a 05D listener" framing was too loose for lock; the single owner is now fixed:

1. **04B writes an outbox event** in the SAME transaction that finalizes the full-length section score: a row in `public.projection_refresh_outbox` (05C-owned, §7.7) with `(student_id, reason = 'full_length_completed', requested_at = now(), processed_at = NULL)`. Because the outbox insert is in the 04B scoring transaction, it commits atomically with the score — no lost or premature events, and 04B's scoring latency is NOT coupled to projection compute.  
2. **A 05C/05D worker consumes the outbox** (the same worker family that runs the §8.4 daily sweep): for each unprocessed row it calls `compute_section_projection(student, 'M', now())` and `compute_section_projection(student, 'RW', now())`, resets the student's projection-refresh counter (§8.4), and stamps `processed_at`. Consumption is idempotent (processing an already-processed row is a no-op; a duplicate refresh just appends an identical snapshot per §8.5).  
3. **Latency target:** the worker drains the outbox on a short interval (seconds, not the daily sweep cadence) so the refreshed projection is available before the student reaches the post-test summary screen. The post-test summary route MAY also opportunistically read-through: if the outbox row for the just-completed test is still unprocessed, the route MAY call `compute_section_projection` inline once and mark the outbox row processed — this is an allowed optimization, not the contract; the contract is the outbox.

This keeps the full-length-completion path with a single owner (the outbox \+ its consumer), decouples 04B scoring-transaction latency from projection compute, and gives clean at-least-once retry semantics. 04B owns only the outbox-insert obligation (verified in §11.C); 05C owns the outbox table, its schema, and the consumer contract; 05D owns the worker schedule.

### **8.4 The counter and the daily sweep (05C-owned refresh state)**

Per RB-05C-V1-03, the projection-refresh counter is owned by 05C, NOT by an 05A/05B table. The earlier draft placed `events_since_projection_refresh` / `last_projection_refresh_at` on a "per-student mastery-state row owned by 05A/05B" — a cross-doc dependency on columns those docs had not locked, for state that is core to 05C's throttle. Projection-refresh state now lives with projection ownership in a 05C-owned table (§7.7). The only cross-doc seam is a single 05C-owned increment function that `apply_mastery_event` calls; 05A/05B do not own or define any projection-refresh column.

\-- 05C-owned state table (defined in §7.7):  
\--   public.student\_projection\_refresh\_state (  
\--     student\_id              uuid PRIMARY KEY,  
\--     events\_since\_refresh    integer NOT NULL DEFAULT 0,  
\--     last\_refresh\_at         timestamptz NULL  
\--   )

\-- 05C-owned increment function. apply\_mastery\_event (05A) calls THIS;  
\-- it does not touch any projection column directly. This is the single  
\-- cross-doc seam, and it is 05C-owned (SECURITY DEFINER, service\_role).  
CREATE OR REPLACE FUNCTION public.bump\_projection\_refresh\_counter(  
    p\_student\_id uuid,  
    p\_section    text  
)  
RETURNS void  
LANGUAGE plpgsql  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_cnt        integer;  
    v\_threshold  integer;  
BEGIN  
    \-- Upsert-and-increment atomically; the row may not exist yet.  
    INSERT INTO public.student\_projection\_refresh\_state (student\_id, events\_since\_refresh)  
    VALUES (p\_student\_id, 1\)  
    ON CONFLICT (student\_id) DO UPDATE  
        SET events\_since\_refresh \= student\_projection\_refresh\_state.events\_since\_refresh \+ 1  
    RETURNING events\_since\_refresh INTO v\_cnt;

    SELECT (value \#\>\> '{}')::integer  
    INTO   v\_threshold  
    FROM   public.mastery\_constants  
    WHERE  key \= 'PROJECTION\_REFRESH\_EVENT\_THRESHOLD'  
      AND  active \= true;

    IF v\_threshold IS NULL THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_MISSING: PROJECTION\_REFRESH\_EVENT\_THRESHOLD';  
    END IF;

    IF v\_cnt \>= v\_threshold THEN  
        \-- Refresh BOTH sections (simplest correct behavior; the gate and  
        \-- range are per-section but a student's activity may have touched  
        \-- either section since the last refresh). p\_section is INTENTIONALLY  
        \-- not used to scope the refresh in V1.0 — it is retained in the  
        \-- signature deliberately (not an oversight): (a) it makes the 05A  
        \-- call site self-documenting about which section's activity  
        \-- triggered the bump, and (b) it is the forward-compat hook for  
        \-- V1.1 section-specific throttling without a signature change.  
        PERFORM public.compute\_section\_projection(p\_student\_id, 'M',  now());  
        PERFORM public.compute\_section\_projection(p\_student\_id, 'RW', now());

        UPDATE public.student\_projection\_refresh\_state  
           SET events\_since\_refresh \= 0,  
               last\_refresh\_at      \= now()  
         WHERE student\_id \= p\_student\_id;  
    END IF;  
END;  
$func$;

REVOKE ALL ON FUNCTION public.bump\_projection\_refresh\_counter FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.bump\_projection\_refresh\_counter TO service\_role;

\-- Daily-sweep path (05D-owned scheduled job, time trigger). Catches a  
\-- student who did some questions and stopped below the event threshold.  
\-- 05D owns the schedule; the query/contract is 05C-owned:  
\--   SELECT student\_id  
\--   FROM   public.student\_projection\_refresh\_state  
\--   WHERE  events\_since\_refresh \> 0  
\--     AND  ( last\_refresh\_at IS NULL  
\--            OR last\_refresh\_at  
\--                 \< now() \- make\_interval(  
\--                       hours \=\> (SELECT (value \#\>\> '{}')::integer  
\--                                 FROM mastery\_constants  
\--                                 WHERE key \= 'PROJECTION\_REFRESH\_TIME\_THRESHOLD\_HOURS'  
\--                                   AND active \= true) ) )  
\--   \-- for each: PERFORM compute\_section\_projection(student,'M',now());  
\--   \--           PERFORM compute\_section\_projection(student,'RW',now());  
\--   \--           UPDATE student\_projection\_refresh\_state  
\--   \--              SET events\_since\_refresh \= 0, last\_refresh\_at \= now()  
\--   \--            WHERE student\_id \= student;

Mechanism split (locked): the **event trigger is in-transaction** — `apply_mastery_event` (05A) calls the 05C-owned `bump_projection_refresh_counter()` after recording a mastery event; the increment, threshold check, and (on cross) the projection refresh \+ counter reset all happen inside the same transaction (mirrors how 05B's KPI refresh is invoked). The **time trigger is the 05D daily sweep** over the 05C-owned state table. The **full-length-completion trigger** is the §8.3 outbox. 05D owns only the sweep schedule and the outbox-consumer schedule; 05C owns the state table, the increment function, the outbox table, and the `compute_section_projection` contract. The single 05A→05C seam is the one documented call `apply_mastery_event` → `bump_projection_refresh_counter()`; §11 verifies that call site exists and that 05A does not define any projection-refresh column of its own.

### **8.5 Idempotency & concurrency**

`compute_section_projection` is idempotent: calling it twice with the same `(student, section, p_t_now)` and unchanged inputs produces an identical current row and appends a second identical snapshot. The §5.3 advisory lock serializes concurrent refreshes of the same `(student, section)`. A duplicate snapshot from a retried refresh is acceptable (the snapshot table is an append-only history; duplicates are visible as same-`refreshed_at_t_now` rows and are harmless for audit). The current row never tears because the upsert \+ snapshot append are one transaction.

---

## **9\. `read_projection_constants()` Helper**

### **9.1 Helper definition**

Per Q2 and the RB-05B-V1-01 precedent (operational constants get a dedicated reader, separate from the formula-hash reader), 05C owns a dedicated projection-constants reader. It reads `mastery_constants` directly and NEVER routes through `canonicalize_mastery_constants()` (formula-only).

CREATE OR REPLACE FUNCTION public.read\_projection\_constants(  
    OUT target\_qcount integer,  
    OUT min\_delta     numeric,  
    OUT max\_delta     numeric,  
    OUT mid\_round     integer,  
    OUT bound\_round   integer,  
    OUT section\_max   integer,  
    OUT section\_min   integer,  
    OUT weights       jsonb  
)  
LANGUAGE plpgsql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_raw jsonb;  
    v\_m\_sum numeric;  
    v\_rw\_sum numeric;  
BEGIN  
    SELECT jsonb\_object\_agg(key, value)  
    INTO   v\_raw  
    FROM   public.mastery\_constants  
    WHERE  active \= true  
      AND  key IN (  
          'PROJECTION\_TARGET\_QUESTION\_COUNT\_PER\_SECTION',  
          'PROJECTION\_MIN\_DELTA',  
          'PROJECTION\_MAX\_DELTA',  
          'PROJECTION\_MIDPOINT\_ROUND\_TO',  
          'PROJECTION\_BOUND\_ROUND\_TO',  
          'PROJECTION\_SECTION\_MAX\_SCORE',  
          'PROJECTION\_SECTION\_MIN\_SCORE',  
          'PROJECTION\_DOMAIN\_WEIGHTS'  
      );

    IF v\_raw IS NULL  
       OR NOT (v\_raw ? 'PROJECTION\_TARGET\_QUESTION\_COUNT\_PER\_SECTION')  
       OR NOT (v\_raw ? 'PROJECTION\_MIN\_DELTA')  
       OR NOT (v\_raw ? 'PROJECTION\_MAX\_DELTA')  
       OR NOT (v\_raw ? 'PROJECTION\_MIDPOINT\_ROUND\_TO')  
       OR NOT (v\_raw ? 'PROJECTION\_BOUND\_ROUND\_TO')  
       OR NOT (v\_raw ? 'PROJECTION\_SECTION\_MAX\_SCORE')  
       OR NOT (v\_raw ? 'PROJECTION\_SECTION\_MIN\_SCORE')  
       OR NOT (v\_raw ? 'PROJECTION\_DOMAIN\_WEIGHTS')  
    THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_MISSING: one or more projection constant keys missing/inactive in mastery\_constants';  
    END IF;

    target\_qcount := (v\_raw \-\> 'PROJECTION\_TARGET\_QUESTION\_COUNT\_PER\_SECTION' \#\>\> '{}')::integer;  
    min\_delta     := (v\_raw \-\> 'PROJECTION\_MIN\_DELTA'                         \#\>\> '{}')::numeric;  
    max\_delta     := (v\_raw \-\> 'PROJECTION\_MAX\_DELTA'                         \#\>\> '{}')::numeric;  
    mid\_round     := (v\_raw \-\> 'PROJECTION\_MIDPOINT\_ROUND\_TO'                 \#\>\> '{}')::integer;  
    bound\_round   := (v\_raw \-\> 'PROJECTION\_BOUND\_ROUND\_TO'                    \#\>\> '{}')::integer;  
    section\_max   := (v\_raw \-\> 'PROJECTION\_SECTION\_MAX\_SCORE'                 \#\>\> '{}')::integer;  
    section\_min   := (v\_raw \-\> 'PROJECTION\_SECTION\_MIN\_SCORE'                 \#\>\> '{}')::integer;  
    weights       := (v\_raw \-\> 'PROJECTION\_DOMAIN\_WEIGHTS');

    \-- Bounds checks  
    IF target\_qcount \<= 0 OR target\_qcount \> 100000 THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_OUT\_OF\_RANGE: target\_qcount=%', target\_qcount;  
    END IF;  
    IF min\_delta \< 0 OR max\_delta \< 0 OR min\_delta \> max\_delta THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_OUT\_OF\_RANGE: min\_delta=% max\_delta=%', min\_delta, max\_delta;  
    END IF;  
    IF mid\_round \<= 0 OR bound\_round \<= 0 THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_OUT\_OF\_RANGE: mid\_round=% bound\_round=%', mid\_round, bound\_round;  
    END IF;  
    IF section\_min \< 0 OR section\_max \<= section\_min OR section\_max \> 800 THEN  
        RAISE EXCEPTION 'PROJECTION\_CONSTANTS\_OUT\_OF\_RANGE: section\_min=% section\_max=%', section\_min, section\_max;  
    END IF;

    \-- Domain-weights structural \+ sum check (per section, |Σ−1| ≤ 1e-6)  
    IF NOT (weights ? 'M') OR NOT (weights ? 'RW') THEN  
        RAISE EXCEPTION 'PROJECTION\_DOMAIN\_WEIGHTS\_INVALID: missing M or RW key';  
    END IF;

    SELECT COALESCE(SUM((v.value \#\>\> '{}')::numeric), 0\)  
    INTO   v\_m\_sum  
    FROM   jsonb\_each(weights \-\> 'M') v;

    SELECT COALESCE(SUM((v.value \#\>\> '{}')::numeric), 0\)  
    INTO   v\_rw\_sum  
    FROM   jsonb\_each(weights \-\> 'RW') v;

    IF ABS(v\_m\_sum \- 1.0) \> 0.000001 OR ABS(v\_rw\_sum \- 1.0) \> 0.000001 THEN  
        RAISE EXCEPTION 'PROJECTION\_DOMAIN\_WEIGHTS\_INVALID: M sum=%, RW sum=% (must each equal 1.000000)', v\_m\_sum, v\_rw\_sum;  
    END IF;  
END;  
$func$;

REVOKE ALL ON FUNCTION public.read\_projection\_constants FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.read\_projection\_constants TO service\_role;

### **9.2 Storage-shape assumption**

The helper assumes `mastery_constants.value` is JSONB and that scalar constants are stored as JSONB scalars (`7`, not `{"value": 7}`), extracted via `#>> '{}'`. This is the SAME assumption 05B's `read_kpi_recency_constants()` makes. If the live `mastery_constants` stores values in a different shape, the §11 verification gate catches it and the helper body is reconciled to the actual shape BEFORE 05C deploys. This is a flagged implementation-watch item, not a spec ambiguity.

### **9.3 Exclusion from the formula hash (INV-05C-16)**

The eight projection constant keys are operational. They MUST NOT appear in `canonicalize_mastery_constants_serialized()` (the formula-hash basis, 05A/05D-owned). A CI guard `projection_constants_excluded_from_formula_hash` asserts none of the `PROJECTION_*` keys are in the formula-hash key list. Rationale identical to RB-05B-V1-01: changing a projection delta or a domain weight must NOT invalidate `student_skill_mastery` / `student_domain_mastery` rows — it triggers only a projection recompute.

### **9.4 Constant-change → projection recompute (05D-owned)**

When any projection constant (including a `PROJECTION_DOMAIN_WEIGHTS` revision) changes, 05D's recompute orchestration re-runs `compute_section_projection` for all affected students. `student_*_mastery` rows are NOT recomputed (projection constants do not affect the mastery formula). The new `projection_constants_hash` on the resulting rows/snapshots makes the constant-set change auditable in the append-only history.

### **9.5 `canonicalize_projection_constants_serialized()` (RB-05C-V1-06)**

Per RB-05C-V1-06, the projection-constants hash (§5.9) is computed over a *canonical* serialization, not raw `jsonb::text`. This mirrors 05A's `canonicalize_mastery_constants_serialized()` discipline: stable key order and fixed numeric formatting so the hash is reproducible across Postgres versions, jsonb internal-ordering changes, and locale. Audit-grade hashes in the Doc 05 family do not depend on incidental serialization behavior.

CREATE OR REPLACE FUNCTION public.canonicalize\_projection\_constants\_serialized()  
RETURNS text  
LANGUAGE plpgsql  
STABLE  
SECURITY DEFINER  
SET search\_path \= public, pg\_temp  
AS $func$  
DECLARE  
    v\_target\_qcount integer;  
    v\_min\_delta     numeric;  
    v\_max\_delta     numeric;  
    v\_mid\_round     integer;  
    v\_bound\_round   integer;  
    v\_section\_max   integer;  
    v\_section\_min   integer;  
    v\_weights       jsonb;  
    v\_weights\_canon text;  
BEGIN  
    SELECT target\_qcount, min\_delta, max\_delta, mid\_round,  
           bound\_round, section\_max, section\_min, weights  
    INTO   v\_target\_qcount, v\_min\_delta, v\_max\_delta, v\_mid\_round,  
           v\_bound\_round, v\_section\_max, v\_section\_min, v\_weights  
    FROM   public.read\_projection\_constants();

    \-- Canonical weights serialization: sections in fixed order (M, RW),  
    \-- domains sorted by key within each section, numeric weights to a  
    \-- fixed 6-decimal scale. Deterministic regardless of jsonb internals.  
    SELECT string\_agg(  
               sec || ':' || string\_agg(  
                   dom\_key || '=' || to\_char(dom\_val, 'FM9990.000000'),  
                   ',' ORDER BY dom\_key  
               ),  
               '|' ORDER BY sec  
           )  
    INTO   v\_weights\_canon  
    FROM (  
        SELECT s.sec,  
               w.key  AS dom\_key,  
               (w.value \#\>\> '{}')::numeric AS dom\_val  
        FROM   (VALUES ('M'), ('RW')) AS s(sec)  
        CROSS JOIN LATERAL jsonb\_each(v\_weights \-\> s.sec) AS w  
    ) flat  
    GROUP BY () ;  \-- single canonical string

    RETURN  
        'target\_qcount=' || v\_target\_qcount::text  
     || ';min\_delta='    || to\_char(v\_min\_delta,   'FM9990.000000')  
     || ';max\_delta='    || to\_char(v\_max\_delta,   'FM9990.000000')  
     || ';mid\_round='    || v\_mid\_round::text  
     || ';bound\_round='  || v\_bound\_round::text  
     || ';section\_min='  || v\_section\_min::text  
     || ';section\_max='  || v\_section\_max::text  
     || ';weights='      || COALESCE(v\_weights\_canon, '');  
END;  
$func$;

REVOKE ALL ON FUNCTION public.canonicalize\_projection\_constants\_serialized FROM PUBLIC;  
GRANT EXECUTE ON FUNCTION public.canonicalize\_projection\_constants\_serialized TO service\_role;

The output is a stable, human-inspectable string (e.g. `target_qcount=500;min_delta=25.000000;max_delta=100.000000;mid_round=10;bound_round=10;section_min=200;section_max=800;weights=M:Advanced Math=0.350000,Algebra=0.350000,...|RW:...`). §5.9 hashes this string with SHA-256. Because the serialization is fully determined by the constant *values* (not their storage representation or jsonb key order), two databases with identical projection constants produce identical `projection_constants_hash` values — the audit-grade reproducibility the rest of the family requires. This helper is `STABLE` (reads `mastery_constants` via the reader) and is the ONLY input to the projection hash.

---

## **10\. Guardian / Student Read Contract & Total Composition**

### **10.1 Visibility matrix**

| Resource | Student | Guardian (linked \+ entitled) | Admin |
| ----- | ----- | ----- | ----- |
| `student_section_projections` (mid/low/high/width/qcount) | ✓ | ✓ | ✓ |
| `student_section_projections` (blend anchors, hashes) | ✗ | ✗ | ✓ |
| `student_section_projection_snapshots` (mid/low/high/width/qcount) | ✓ | ✓ | ✓ |
| `student_section_projection_snapshots` (blend anchors, hashes) | ✗ | ✗ | ✓ |

Per Q5: student and guardian see the **same** projection rows — same `projected_score_mid`, `_low`, `_high`, `range_width`. There is no coarser guardian band and no guardian-specific computation. The guardian reads the student's canonical rows directly through the entitlement-gated RLS policy (§7.4). This is the same single-route \+ RLS-gating contract 05B §10 locks.

### **10.2 Single-route contract (mirrors 05B §10.3)**

Each projection resource is served by ONE route; the same handler runs whether the caller is the student or a linked guardian; RLS does per-row filtering. The route handler MUST NOT branch into different SQL predicates or projections by caller role; a single path-layer authorization check accepting student-self OR active linked guardian is REQUIRED and is the only permitted role-aware branch (the RB-05B-V1-05 wording, applied here verbatim so the family is consistent).

GET /api/students/{student\_id}/projection/sections     \-- returns M \+ RW rows  
GET /api/students/{student\_id}/projection/total         \-- composed; see §10.3  
GET /api/students/{student\_id}/projection/history       \-- snapshot history

Path-layer authz returns **404 (not 403\)** for unrelated authenticated callers (no existence leak); empty-list / NULL-projection semantics apply only AFTER path-layer authz has succeeded (RB-05B-V1-06 wording, applied here for family consistency). A student past the Q4 gate sees populated rows; a student below the gate sees rows with NULL projection columns (the UI renders "not enough evidence yet"); both are HTTP 200\.

### **10.3 Total projection is composed at read time (Pin-1 / §6.6)**

The total is NOT a stored row in V1.0. The `/projection/total` route reads both `student_section_projections` rows and composes:

if either section row has NULL projected\_score\_mid (Q4 gate not passed for the student):  
    total projection \= NULL  (UI: "not enough evidence yet")  
else:  
    total\_mid   \= M.projected\_score\_mid  \+ RW.projected\_score\_mid  
    total\_low   \= M.projected\_score\_low  \+ RW.projected\_score\_low  
    total\_high  \= M.projected\_score\_high \+ RW.projected\_score\_high  
    total\_width \= total\_high \- total\_low

Because the Q4 gate is whole-student, both section rows flip non-NULL together — there is no state where Math has a projection and RW does not. The composition is a pure read-layer sum; no third table, no third write path, nothing that can disagree with the section rows. A stored `student_total_projection` is a possible V1.1 optimization (§16) only if read-time composition becomes a measured hotspot.

### **10.4 No write routes**

05C exposes NO write routes for any of its tables. All writes flow through `apply_mastery_event` (05A) → counter threshold → `compute_section_projection` (§5), or the 05D daily sweep / 04B full-length-completion path → `compute_section_projection`. The projection tables have no INSERT/UPDATE/DELETE RLS policy for `authenticated`; only `service_role` (RLS-bypassing) writes, only through the SECURITY DEFINER RPC.

### **10.5 Column projection enforcement**

Response payloads expose only the columns GRANTed to `authenticated` in §7.5 (`student_id`, `section`, mid/low/high, `range_width`, `relevant_question_count`, and `computed_at`/`snapshot_at`). The blend anchors (`mastery_term`, `fl1_score`, `fl2_score`, `fl_count_used`, `blend_denominator`), `projection_constants_hash`, `mastery_model_version`, and `refreshed_at_t_now` are admin-only and MUST NOT appear in student/guardian payloads — enforced both by the column GRANT and by the route handler projecting an explicit column list (never `SELECT *` then serialize). Same defense-in-depth as 05B §10.5.

---

## **11\. Pre-Implementation Verification Gate**

Mirrors 05B §11. Before any 05C SQL or migration is written, the implementing engineer/agent MUST verify each item against the live database and post a `pre_impl_verification_05c.md` report with the exact `\d` / `\df` / `\dp` output for each check. Any deviation blocks implementation until reconciled with this document.

### **11.1 What MUST be verified**

**A. Installed RPC signatures.** For each 05C-owned function:

public.compute\_section\_projection  
public.read\_projection\_constants  
public.round\_to\_step

Statuses: `MISSING | INSTALLED_MATCHED | INSTALLED_BUT_MISMATCHED | LEGACY_PRESENT_REQUIRES_DEPRECATION`.

* `read_projection_constants` MUST read directly from `public.mastery_constants` (NOT `canonicalize_mastery_constants()`), raise `PROJECTION_CONSTANTS_MISSING` on missing/inactive keys, `PROJECTION_CONSTANTS_OUT_OF_RANGE` on bad bounds, and `PROJECTION_DOMAIN_WEIGHTS_INVALID` if a section's weights do not sum to 1.000000.  
* `compute_section_projection` MUST: hold the §5.3 advisory lock; evaluate the whole-student 8-domain Q4 gate (INV-05C-14); blend mastery \+ ≤2 completed full-lengths with adaptive denominator (INV-05C-13); apply the §6.5 range formula with the 200 floor; upsert \+ append a snapshot in one transaction.

**B. `mastery_constants` rows.** Verify presence, `active = true`, and value/shape of the 8 projection keys in §4.1 plus `PROJECTION_DOMAIN_WEIGHTS`. Verify each section's weights sum to exactly 1.000000. Verify the value storage shape is compatible with the `#>> '{}'` extraction (the §9.2 watch item — if shape differs, reconcile the helper body BEFORE deploy).

**C. Upstream dependency objects (read-only consumers).** Verify these exist with the expected shape; 05C reads them and does NOT own them:

* `public.student_domain_mastery` (05B): columns `student_id, section, domain, mastery_score, event_count_total`. 05C reads `mastery_score` and `event_count_total`; it never calls `compute_mastery_for_entity` (INV-05C-A1).  
* `public.student_section_kpi` (05B): column `events_total` — the `relevant_question_count` source (§5.8).  
* The 04B canonical completed-full-length section-score source. **`BLOCKING_UPSTREAM_GAP — 04B object unnamed` until Doc 04B names this read surface** (per review item \#10): a view/table exposing `student_id, section, section_scaled_score, is_complete, completed_at, id` for completed full-lengths, with "completed \= both modules submitted and scored" semantics. 05C MAY lock as a spec but `compute_section_projection` MUST NOT deploy until this is resolved and the §5.7 body bound to the named object. 05C never re-scores a test (INV-05C-A2).  
* 04B outbox-insert obligation (RB-05C-V1-07): the 04B full-length-finalization transaction MUST insert a `public.projection_refresh_outbox` row `(student_id, reason='full_length_completed')`. Verify the 04B finalization path includes this insert in the same transaction as the score write. Recorded as `BLOCKING_UPSTREAM_GAP — 04B outbox insert missing` if absent.  
* `public.mastery_min_events()` and `public.mastery_model_version()` accessors (05A/Parent). 05C reads `MIN_EVENTS_FOR_MASTERY` via the accessor, never hardcodes `5`.  
* 05A→05C seam (RB-05C-V1-03): verify `apply_mastery_event` (05A) calls `public.bump_projection_refresh_counter(student_id, section)` after recording a mastery event, and verify 05A/05B define NO projection-refresh column of their own (the counter is 05C-owned in `student_projection_refresh_state`, §7.7). If `apply_mastery_event` does not yet call the seam function, recorded as `BLOCKING_UPSTREAM_GAP — 05A seam call missing` (05A adds the one-line call; it owns no projection state).

**C2. Tables/functions 05C creates and owns.** Verify these do NOT pre-exist (or reconcile column-by-column if they do): `public.student_projection_refresh_state` (§7.7), `public.projection_refresh_outbox` (§7.7), `public.bump_projection_refresh_counter` (§8.4), `public.canonicalize_projection_constants_serialized` (§9.5), `public.read_projection_constants` (§9.1), `public.compute_section_projection` (§5), `public.round_to_step` (§6.4).

**D. Tables 05C creates.** `student_section_projections` and `student_section_projection_snapshots` per §7.1/§7.2. If either pre-exists, do NOT silently `CREATE TABLE IF NOT EXISTS` over it — investigate, document, reconcile column-by-column.

**E. RLS policies — required AND required-absent.**

* Must exist: `student_section_projections_student_read`, `student_section_projections_guardian_read`, `projection_snapshots_student_read`, `projection_snapshots_guardian_read`.  
* Must NOT exist: any INSERT/UPDATE/DELETE policy for `authenticated` on either projection table; any UPDATE/DELETE policy on the snapshot table for any non-`service_role` role (INV-05C-17 append-only).

**F. Column GRANTs.** Per §7.5: the blend anchors, hashes, and `refreshed_at_t_now` MUST NOT be in the `authenticated` GRANT for either table.

**G. CHECK constraints.** `projection_range_coherent` and `projection_blend_denominator_coherent` (§7.1) MUST be installed exactly as specified (INV-05C-15 / INV-05C-13 database enforcement).

**H. CI guards.** Verify present and passing:

* `projection_constants_excluded_from_formula_hash` (INV-05C-16): no `PROJECTION_*` key appears in the formula-hash key list.  
* `projection_blend_includes_mastery_term` (INV-05C-13): the §5.7 numerator always seeds with `v_mastery_term`.  
* `projection_min_floor_is_200` (§6.5): the clamp floor is `PROJECTION_SECTION_MIN_SCORE` (200), not 0\.  
* `projection_gate_uses_canonical_8set` (RB-05C-V1-01): the §5.5 gate uses the `required_domains` VALUES anti-join, NOT a `COUNT(*) = 8` row count.  
* `projection_domain_strings_match_parent` (RB-05C-V1-04): the 8 domain strings in the §5.5 gate VALUES list are byte-identical to the `PROJECTION_DOMAIN_WEIGHTS` keys and to Parent §10.2 / RB-05P-V1-13 (no punctuation variance; "Problem Solving and Data Analysis" with no hyphen).  
* `projection_hash_uses_canonical_serializer` (RB-05C-V1-06): §5.9 hashes `canonicalize_projection_constants_serialized()`, NOT raw `jsonb::text`.  
* `projection_no_record_var_from_clause` (RB-05C-V1-02): no `FROM v_result_row` (or any `FROM <record_var>`) appears in `compute_section_projection`.  
* `projection_refresh_state_is_05c_owned` (RB-05C-V1-03): `student_projection_refresh_state` exists and is 05C-owned; no projection-refresh column exists on any 05A/05B table.

### **11.2 Migration paths**

| Scenario | Action |
| ----- | ----- |
| Greenfield (no projection tables, diagnostic not yet taken by anyone) | Apply 05C migrations; tables start empty; first throttle-fire past the Q4 gate creates rows. |
| Legacy (no projection tables, students already past Q4 gate) | Apply 05C migrations; run a 05D one-off backfill calling `compute_section_projection` for every student past the gate (both sections). |
| Legacy (projection tables exist with prior data) | Block deploy. Reconcile column-by-column with §7; document deviations; ALTER or DROP-and-recreate with an explicit plan. |

---

## **12\. Diagnostic Post-Completion Expected State**

After a student completes the 40-question diagnostic (Parent: 40 \= 8 SAT domains × 5 events; the diagnostic is designed to be exactly the Q4 gate-crossing event set), the FIRST projection refresh that fires (the diagnostic completion is itself a throttle-eligible boundary, and 40 events ≥ the 40-event threshold) MUST produce:

### **12.1 `student_section_projections`**

* Exactly **2 rows**: `(student, 'M')` and `(student, 'RW')`.  
* Both rows have **non-NULL** `projected_score_mid/low/high`, `range_width`, `relevant_question_count` — because the diagnostic crosses the Q4 gate for all 8 domains simultaneously (INV-05C-14 flips on).  
* `fl_count_used = 0`, `blend_denominator = 1` for both (State A — no full-lengths yet). The projection equals the mastery term alone, rounded/clamped.  
* `relevant_question_count ≈ 20` per section (the 40 diagnostic questions split \~20 Math / \~20 RW), so `evidence_ratio ≈ 20/500 = 0.04` and `projection_delta ≈ 97` — a deliberately wide post-diagnostic band (Example 2 in §6.7).

### **12.2 `student_section_projection_snapshots`**

* At least **2 snapshot rows** (one per section) from the first post-diagnostic refresh. If the diagnostic's 40 events crossed the threshold mid-stream and the throttle fired more than once, there may be additional earlier snapshots whose projection columns are NULL (refreshes that fired before the 8th domain crossed the gate). Every snapshot is preserved (append-only); none is deduped.

### **12.3 Total (composed, not stored)**

* `/projection/total` returns `total_mid = M.mid + RW.mid`, `total_low = M.low + RW.low`, `total_high = M.high + RW.high`, with the wide post-diagnostic width (\~±200 total at this evidence level).

### **12.4 What MUST NOT happen**

* No `student_section_projections` row where `projected_score_mid` is non-NULL but any of `_low/_high/range_width` is NULL (INV-05C-15; the CHECK constraint makes this impossible — if it appears, the constraint was not installed).  
* No projection row emitted while fewer than 8 domains have ≥5 events (INV-05C-14).  
* No `projected_score_*` below 200 or above 800 (the §6.5 clamp \+ the column CHECK).  
* No `blend_denominator ≠ fl_count_used + 1` (the CHECK constraint).  
* No projection computed by calling `compute_mastery_for_entity` from within 05C (INV-05C-A1) — the §11 gate and code review enforce this.

---

## **13\. Projection Stress-Test Fixture**

All scenarios run inside a transaction that seeds the upstream rows (domain mastery, KPI events\_total, completed full-lengths), calls `compute_section_projection(student, section, FIXED_T_NOW)`, asserts, then ROLLBACK. `p_t_now` is injected fixed so output is byte-deterministic (same discipline as 05B §14).

### **13.1 Blend-state scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| P1 (State A) | All 8 domains ≥5 events; 0 completed full-lengths; Math `weighted_mastery = (480−200)/600 ≈ 0.4667` so `mastery_term = 200 + 0.4667·600 = 480` | `blend_denominator=1`, `fl_count_used=0`, `mid = round_to_step(clamp(480,200,800),10) = 480` |
| P2 (State B) | As P1 \+ 1 completed full-length Math=560 | `blend_denominator=2`, `fl_count_used=1`, `blended_raw=(480+560)/2=520`, `mid=520` |
| P3 (State C) | As P1 \+ 2 completed full-lengths Math=560, 600 | `blend_denominator=3`, `fl_count_used=2`, `blended_raw=(480+560+600)/3=546.67`, `mid=round_to_step(546.67,10)=550` |
| P4 (State C, 3+ FLs) | As P3 \+ a 3rd, older completed full-length Math=400 | Only the **2 most recent** by `completed_at` are used; the older 400 is excluded; result identical to P3 |
| P5 (abandoned FL excluded) | As P2 but the "full-length" is abandoned (04B emitted no scaled score) | `full_length_section_scores` returns 0 rows → State A → `blend_denominator=1`, `mid=480` |

### **13.2 Q4-gate scenarios (INV-05C-14)**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| P6 (gate just fails) | 7 domains ≥5 events, 1 domain at 4 events | row upserted with `projected_score_mid/low/high/range_width/relevant_question_count` ALL NULL; `fl_count_used=0`; snapshot appended with NULL projection cols |
| P7 (gate just passes) | All 8 domains at exactly 5 events | projection non-NULL; `relevant_question_count` \= section events\_total; wide band |
| P8 (gate via accessor) | All 8 at exactly `mastery_min_events()` (parameterized, not literal 5\) | passes if accessor returns 5; if a test harness overrides the accessor to 3, gate passes at 3 — proves no hardcoded 5 |

### **13.3 Range-width / clamp / rounding scenarios**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| P9 (zero evidence) | gate passed; `student_section_kpi.events_total = 0` | `evidence_ratio=0`, `projection_delta = MAX_DELTA = 100` |
| P10 (full evidence) | gate passed; `events_total = 500` (= target) | `evidence_ratio=1`, `projection_delta = MIN_DELTA = 25` |
| P11 (over-target evidence) | gate passed; `events_total = 900` | `evidence_ratio` clamped to 1, `projection_delta = 25` (not negative) |
| P12 (high clamp) | blended\_raw \= 790, delta \= 25 | `high = round_to_step(clamp(815,200,800),10) = 800` (clamped, not 815\) |
| P13 (low floor \= 200\) | blended\_raw \= 210, delta \= 100 | `low = round_to_step(clamp(110,200,800),10) = 200` (floor 200, NOT 0 — proves the §6.5 deviation) |
| P14 (rounding) | blended\_raw \= 615.0, delta \= 25 | `mid=round_to_step(615,10)`; with half-away-from-zero `ROUND(61.5)=62 → 620`; `low=round_to_step(590,10)=590`; `high=round_to_step(640,10)=640` |

### **13.4 Composition \+ determinism**

| ID | Setup | Asserts |
| ----- | ----- | ----- |
| P15 (total \= sum) | gate passed; M mid/low/high \= 620/600/650; RW \= 590/570/610 | composed total \= 1210 (1170–1260); `total_width = 90 = M.width(50)+RW.width(40)` |
| P16 (determinism) | same inputs, two calls with same `p_t_now` | identical current row; two identical snapshots (append-only; duplicate is acceptable per §8.5) |
| P17 (constants hash changes on weight revision) | run P3; then change a `PROJECTION_DOMAIN_WEIGHTS` value; re-run | `projection_constants_hash` differs; mastery rows untouched (INV-05C-16) |
| P18 (weights-sum guard) | seed weights where Math sums to 0.98 | `read_projection_constants()` raises `PROJECTION_DOMAIN_WEIGHTS_INVALID`; no projection row written |

### **13.5 Test runner expectations**

* Failure messages include expected vs actual for `mid`, `low`, `high`, `range_width`, `blend_denominator`, `fl_count_used`, and `projection_constants_hash`.  
* P8 specifically overrides `mastery_min_events()` in the test harness to prove 05C reads the accessor and contains no literal `5` for the gate.  
* P13 is the canonical proof that the floor is 200, not the range-spec's 0\.  
* All scenarios assert the `projection_range_coherent` and `projection_blend_denominator_coherent` CHECK constraints are satisfied (or that the expected raise occurs).

---

## **14\. Cross-Doc References**

| 05C element | Depends on | Contract |
| ----- | ----- | ----- |
| Mastery term (§5.6) | 05B `student_domain_mastery.mastery_score` | Read-only; 05C never calls `compute_mastery_for_entity` (INV-05C-A1) |
| Q4 gate (§5.5) | 05B `student_domain_mastery.event_count_total`, Parent `MIN_EVENTS_FOR_MASTERY` via `mastery_min_events()` | Whole-student, all 8 domains; threshold via accessor not literal |
| Full-length terms (§5.7) | Doc 04B completed full-length section scaled scores | Read-only; 05C never re-scores (INV-05C-A2); exact object name reconciled in §11.C |
| `relevant_question_count` (§5.8) | 05B `student_section_kpi.events_total` | Read-only; same evidence population 05B aggregates |
| Constants (§9) | `mastery_constants` (05D-governed), Parent RB-05P-V1-15 separation discipline | Operational; excluded from formula hash (INV-05C-16) |
| Refresh counter (§8.4) | 05C-owned `student_projection_refresh_state` (§7.7) | 05C owns the counter state and `bump_projection_refresh_counter()`; the only 05A→05C seam is `apply_mastery_event` calling that function — 05A/05B own no projection-refresh column (RB-05C-V1-03) |
| Daily sweep (§8.4) | 05D scheduled-job orchestration | 05D owns the sweep; 05C owns only the RPC it calls |
| Full-length-completion refresh (§8.3) | Doc 04B finalization path | 04B (or a 05D listener) calls `compute_section_projection` immediately on completion |
| Account-deletion cascade (§7.6) | Parent §11.1, 05D cascade definition | Only delete path for the append-only snapshot table |
| Guardian gate (§7.4) | Parent §11.1 entitlement gate; 05B §10 single-route pattern | Byte-identical guardian-read shape across the 05 family |

---

## **15\. Acceptance Criteria**

Doc 05C V1.0 is acceptable when all of the following are true:

1. `compute_section_projection` RPC is specified in §5 with signature, input validation, advisory lock, Q4 gate, mastery-term computation, full-length blend, bounded range, constants hash, upsert \+ snapshot append, and an error-code table.  
2. The blend (§5.7 / §6.3) is the mean of {mastery\_term} ∪ {≤2 most recent completed full-lengths} with an adaptive denominator (States A/B/C); the mastery term is always present (INV-05C-13); the mastery term maps weighted mastery onto the legal SAT scale via `SECTION_MIN + weighted_mastery × (SECTION_MAX − SECTION_MIN)` \= `200 + weighted_mastery × 600` (RB-05C-V1-05), so every blend input is section-score-scaled and the term is in `[200,800]`; abandoned/partial full-lengths are excluded by construction.  
3. The Q4 gate (§5.5 / §6.2 / INV-05C-14) holds the entire projection NULL until ALL 8 canonical SAT domains have ≥ `MIN_EVENTS_FOR_MASTERY` events; the threshold is read via `mastery_min_events()`, not hardcoded; the gate uses the `required_domains` VALUES anti-join (RB-05C-V1-01), NOT a `COUNT(*) = 8` row count, so duplicate/extra/non-canonical rows cannot make it pass; the 8 domain strings are byte-identical to Parent §10.2 and the weights keys (RB-05C-V1-04).  
4. The bounded range (§6.5) implements the locked range spec with `evidence_ratio` shrinking `projection_delta` from `MAX_DELTA` to `MIN_DELTA`; the lower clamp is `PROJECTION_SECTION_MIN_SCORE = 200` (the documented single deviation from the source spec's 0\) and this is fixture-proven (P13); `range_width` is explicitly the post-round/post-clamp displayed width, not `2 × projection_delta` (review item \#11).  
5. Per-section deltas apply directly from constants (`MIN_DELTA=25`, `MAX_DELTA=100`); no halving; the total is the simple sum of per-section bounds (Pin-1 / Model 5-a, §6.6); the total is composed at read time and not stored in V1.0.  
6. `student_section_projections` schema (§7.1) has the `projection_range_coherent` CHECK (INV-05C-15) and the `projection_blend_denominator_coherent` CHECK (INV-05C-13 arithmetic), making both invariants database-enforced; the snapshot insert (§5.9) uses a `VALUES` list of record fields, not `FROM v_result_row` (RB-05C-V1-02).  
7. `student_section_projection_snapshots` (§7.2) is append-only with a surrogate identity key; per Q6/INV-05C-17 it is the projection audit trail and there is NO separate 05D projection audit log; the only delete path is the Parent §11.1 account-deletion cascade.  
8. The refresh throttle (§8) fires on whichever comes first: 40 events (in-transaction via the 05C-owned `bump_projection_refresh_counter()` called by `apply_mastery_event`), 24h (05D daily sweep over the 05C-owned `student_projection_refresh_state`), or full-length completion (via the 05C-owned `projection_refresh_outbox`, RB-05C-V1-07); thresholds are `mastery_constants` keys; projection-refresh state is 05C-owned (RB-05C-V1-03), no 05A/05B projection column.  
9. `read_projection_constants()` (§9) reads `mastery_constants` directly (NOT `canonicalize_mastery_constants()`), validates bounds and the per-section weights-sum-to-1 rule, and its keys are excluded from the formula hash (INV-05C-16) with a CI guard; the projection-constants hash is computed over `canonicalize_projection_constants_serialized()` (RB-05C-V1-06), not raw `jsonb::text`.  
10. Guardian and student see the SAME projection rows AND the SAME snapshot history (§7.3 / §10.1, Q5 / 8-a); the guardian reads via the entitlement-gated RLS policy (active link AND active entitlement, Parent §11.1) byte-identical in shape to 05B's guardian-read policy; no reroute, no recompute, no guardian-specific table.  
11. Single-route \+ RLS-gating contract (§10.2) mirrors 05B §10.3/§10.4 verbatim: no SQL/projection branch by role, one required path-layer authz check, 404 (not 403\) for unrelated callers, NULL/empty semantics only after authz.  
12. No write routes for any 05C table (§10.4); all writes flow through `compute_section_projection` (SECURITY DEFINER, `service_role`\-only).  
13. Column projection enforcement (§10.5): blend anchors, hashes, `refreshed_at_t_now` are admin-only and excluded from `authenticated` GRANTs and route payloads; the 05C-owned refresh-state and outbox tables have no `authenticated` access (§7.7).  
14. The pre-implementation verification gate (§11) covers 05C RPCs, the 8 projection constants \+ weights-sum, upstream read-only dependencies, the 05C-owned tables/functions (§11.C2), required \+ required-absent RLS, GRANTs, CHECK constraints, and CI guards; the 04B completed-full-length object and the 04B outbox-insert obligation are explicit `BLOCKING_UPSTREAM_GAP` items (review item \#10) — 05C may lock as a spec but `compute_section_projection` may not deploy until both are resolved.  
15. Diagnostic post-completion expected state (§12) specifies exactly 2 section rows, both non-NULL (State A), wide post-diagnostic band, composed total, and the MUST-NOT list.  
16. The stress-test fixture (§13) covers blend States A/B/C \+ 3+FL recency \+ abandoned-FL exclusion, the Q4 gate boundary (incl. accessor-parameterized), range-width at zero/full/over-target evidence, high clamp, the 200 floor, rounding, total composition, determinism, and the weights-sum guard.  
17. INV-05C-13..17 each have a stated enforcement mechanism (CHECK constraint, CI guard, RLS absence, or fixture).  
18. No item in Doc 05C contradicts Doc 05 Parent V1.0, 05A V1.0, 05B V1.0, or Doc 04B V4.3.  
19. The mastery-term \[200,800\] affine mapping (RB-05C-V1-05) is reflected consistently in §1, §3 (INV-05C-13), §5.6, §6.1, and the §6.7 worked examples (recomputed) and §13 fixtures.  
20. The §5.5 gate is the canonical-set anti-join (RB-05C-V1-01); the §5.9 snapshot insert is `VALUES`\-from-record (RB-05C-V1-02); refresh state is 05C-owned (RB-05C-V1-03); domain strings match Parent byte-for-byte (RB-05C-V1-04); the hash uses the canonical serializer (RB-05C-V1-06); the full-length path is the locked outbox (RB-05C-V1-07).  
21. The §7.7 05C-owned tables (`student_projection_refresh_state`, `projection_refresh_outbox`) and the §8.4 `bump_projection_refresh_counter()` / §9.5 `canonicalize_projection_constants_serialized()` functions are specified with full DDL/SQL, RLS, and GRANTs; the single 05A→05C seam is the documented `apply_mastery_event` → `bump_projection_refresh_counter()` call.  
22. Guardian snapshot-history visibility is intentionally retained (8-a): the §9 review item \#8 decision is recorded; the trust trade-off is acknowledged in the change record.  
23. The cleanup register (§16.7) lists RB-05C-V1-01..08 with severity, source, and resolution; all items applied within the lock cycle; status reflects the register; no version bump per Doc 04/05 family precedent.

---

## **16\. Governance & Lock Process**

### **16.1 Owner**

Product \+ Engineering joint ownership; Engineering maintains runtime/schema alignment.

### **16.2 Review trigger**

This document must be reviewed when any of: the blend formula or weights change; the range spec changes; the Q4 gate threshold or domain count changes; the refresh throttle changes; the guardian visibility rule changes; the 04B completed-full-length contract changes; the `mastery_constants` storage shape changes; or any 05A/05B object 05C reads is renamed or reshaped.

### **16.3 Lock meaning**

"Locked" \= the contract is authoritative for implementation; changes require an explicit doc update; silent drift in code or schema is not allowed. Post-lock, additive clarification is allowed; behavior-changing changes require explicit review and a register entry (Doc 04/05 family precedent: in-lock-cycle cleanup via grep-traceable `RB-05C-V1-NN` tags, status stays "Locked", no version bump).

### **16.4 Parent dependency**

Doc 05C V1.0 depends on Doc 05 Parent V1.0 (Locked 2026-05-13, RB-05P-V1-01..15). Any Parent change to `MIN_EVENTS_FOR_MASTERY`, the 8-domain set, the entitlement gate, or the constants-separation discipline propagates to 05C.

### **16.5 Sibling dependency**

Depends on 05A V1.0 (accessors, one-formula-path), 05B V1.0 (domain mastery, KPI events\_total, guardian-read pattern), and Doc 04B V4.3 (completed full-length scaled scores). 05D owns the daily sweep, the constant-change recompute, and the account-deletion cascade 05C relies on.

### **16.6 Noted V1.1 considerations (NOT enforced in V1.0)**

* Full-length staleness window (Q1 State D currently: no staleness; last 2 count regardless of age).  
* Stored `student_total_projection` row (currently composed at read time, §10.3) if composition becomes a measured hotspot.  
* Per-section `PROJECTION_TARGET_QUESTION_COUNT` split (currently one global 500 applied per section).  
* Timezone-aware "as of" display for `computed_at` (currently UTC, consistent with 05B streak caveat).  
* `projection_refresh_outbox` processed-row retention/pruning (currently retained; 05D-owned retention job is a V1.1 option).  
* Section-specific projection throttling (currently `bump_projection_refresh_counter` refreshes both sections; `p_section` is retained in the signature as the V1.1 hook for per-section throttling without a signature change).

### **16.7 Cleanup register (in-lock-cycle, no version bump)**

Per Doc 04/05 family precedent, SWE-review cleanup is applied within the lock cycle with grep-traceable tags; status reflects the register; no version bump.

| Tag | Severity | Source | Resolution |
| ----- | ----- | ----- | ----- |
| RB-05C-V1-01 | BLOCKER | SWE review (gate counts rows, not canonical set) | §5.5 gate rewritten as a `required_domains` VALUES anti-join (`NOT EXISTS` over LEFT JOIN where `COALESCE(event_count_total,0) < mastery_min_events()`). Duplicate/extra/non-canonical rows can no longer make the gate pass. CI guard `projection_gate_uses_canonical_8set` added. |
| RB-05C-V1-02 | BLOCKER | SWE review (`FROM v_result_row` invalid SQL) | §5.9 snapshot insert rewritten as `INSERT ... VALUES (v_result_row.col, ...)` — a record-variable field list, not `FROM` a record. CI guard `projection_no_record_var_from_clause` added. |
| RB-05C-V1-03 | BLOCKER | SWE review (refresh-counter ownership misplaced) | Counter moved into 05C-owned `student_projection_refresh_state` (§7.7) \+ 05C-owned `bump_projection_refresh_counter()` (§8.4). No projection-refresh column on any 05A/05B table. Single 05A→05C seam \= `apply_mastery_event` calling `bump_projection_refresh_counter()`. §11.C verifies the seam and the no-upstream-column rule. |
| RB-05C-V1-04 | IMPORTANT | SWE review (domain string hyphen mismatch) | "Problem-Solving and Data Analysis" → "Problem Solving and Data Analysis" (no hyphen) in the weights JSON, weights prose, and the §5.5 gate VALUES list; byte-identical to Parent §10.2 / RB-05P-V1-13 / 05B. CI guard `projection_domain_strings_match_parent` added. |
| RB-05C-V1-05 | IMPORTANT | SWE review (mastery-term scale ambiguous) | Locked the \[200,800\] mapping (Karl's call): `mastery_term = SECTION_MIN + weighted_mastery × (SECTION_MAX − SECTION_MIN)` \= `200 + weighted_mastery × 600`. Updated §1, INV-05C-13, §5.6 (new `v_weighted_mastery` local \+ affine map), §6.1, recomputed §6.7 Examples 1–2, clarified P1 fixture derivation. Mastery term is now itself a legal section-scale value, homogeneous with the full-length terms. |
| RB-05C-V1-06 | IMPORTANT | SWE review (constants hash not canonical) | Added `canonicalize_projection_constants_serialized()` (§9.5) — sorted keys, fixed numeric formatting, deterministic regardless of jsonb internals — mirroring 05A's `canonicalize_mastery_constants_serialized()`. §5.9 now hashes that string, not raw `jsonb::text`. CI guard `projection_hash_uses_canonical_serializer` added. |
| RB-05C-V1-07 | IMPORTANT | SWE review (full-length refresh owner too loose) | Locked the transactional-outbox handoff: 04B inserts a `projection_refresh_outbox` row in its scoring transaction; the 05C/05D worker consumes it (idempotent, at-least-once). Replaces the "in or right after, or a 05D listener" ambiguity. §7.7 table \+ §8.3 contract \+ §11.C 04B outbox-insert obligation. |
| RB-05C-V1-08 | IMPORTANT | SWE review (guardian snapshot-history visibility) | Decision (Karl's call): keep snapshots guardian-visible (8-a). Current draft unchanged for this item; the trust trade-off (guardian sees range worsening over time) is acknowledged here and in §9 review-item-\#8 context as an intentional product choice consistent with Q5 (guardian sees the same projection artifacts as the student). |

Non-blocking review items also applied: \#10 — the 04B completed-full-length object hardened from "reconcile" to an explicit `BLOCKING_UPSTREAM_GAP` deploy gate (lock-vs-deploy distinction stated in §5.7 / §11.C); \#11 — explicit note in §6.5 that `range_width` is the post-round/post-clamp displayed width, not `2 × projection_delta`.

All eight register items \+ the two non-blocking tightenings applied within the lock cycle of 2026-05-14. Status reflects the register; no version bump.

---

## **17\. Change Record**

| Version | Date | Author | Summary |
| ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-14 | Claude (drafted), Karl (locked) | Initial draft. Locks: `compute_section_projection` RPC; the blended point estimate \= mean of {mastery\_term} ∪ {≤2 most recent completed full-lengths} with adaptive denominator (States A/B/C, no clamp — INV-05C-13); mastery\_term maps weighted mastery onto the legal SAT scale `200 + weighted_mastery × 600` reading 05B `student_domain_mastery.mastery_score` (never recomputing — INV-05C-A1); full-length terms read from Doc 04B completed section scaled scores (never re-scoring — INV-05C-A2); Q4 whole-student 8-domain gate via canonical-set anti-join holding the whole projection NULL until all 8 domains ≥ `MIN_EVENTS_FOR_MASTERY` via accessor not literal (INV-05C-14); bounded range per the locked spec with `evidence_ratio` shrinking `projection_delta` MAX(100)→MIN(25) per section at `PROJECTION_TARGET_QUESTION_COUNT_PER_SECTION`\=500, single documented deviation \= lower clamp 200 not 0 (§6.5, fixture P13), `range_width` is post-round/post-clamp not `2×delta`; total \= simple sum of per-section bounds composed at read time, Model 5-a, deltas applied directly with no halving (Pin-1); `student_section_projections` current table \+ append-only `student_section_projection_snapshots` audit trail (Q6, INV-05C-17, no separate 05D projection audit log); 05C-owned `student_projection_refresh_state` \+ `projection_refresh_outbox` (§7.7); two DB CHECK constraints making INV-05C-15 (range coherence) and INV-05C-13 (denominator arithmetic) database-enforced; throttled refresh on 40-events (05C-owned in-transaction counter via `bump_projection_refresh_counter()` called by `apply_mastery_event`) OR 24h (05D daily sweep) OR full-length completion (transactional outbox, §8.3); `read_projection_constants()` reading `mastery_constants` directly and excluded from formula hash (INV-05C-16, RB-05B-V1-01 precedent) with per-section weights-sum-to-1 validation; `canonicalize_projection_constants_serialized()` for audit-grade hash (§9.5); guardian and student see the SAME rows AND snapshot history via an entitlement-gated RLS policy byte-identical to 05B's (Q5 / 8-a); single-route \+ RLS-gating contract mirroring 05B §10.3/§10.4; pre-implementation verification gate; diagnostic post-completion expected state; 18-scenario stress fixture; 5 sub-doc invariants INV-05C-13..17 plus inherited Parent/05A/05B invariants; 23 acceptance criteria. **In-lock-cycle SWE-review cleanup applied 2026-05-14 (RB-05C-V1-01..08; no version bump):** RB-01 canonical-8-domain anti-join gate (was row-count); RB-02 snapshot insert is `VALUES`\-from-record (was invalid `FROM v_result_row`); RB-03 refresh counter moved to 05C-owned `student_projection_refresh_state` \+ `bump_projection_refresh_counter()` (was misplaced on an unlocked 05A/05B column); RB-04 domain strings byte-aligned to Parent (PSDA hyphen removed); RB-05 mastery term locked to the \[200,800\] affine map (Karl's call; semantically homogeneous with FL terms; §6.7 examples recomputed); RB-06 added `canonicalize_projection_constants_serialized()` for the audit hash (was raw `jsonb::text`); RB-07 full-length-completion handoff locked to a transactional outbox (was a loose hook/listener choice); RB-08 guardian snapshot-history visibility kept (8-a, Karl's call). Non-blocking: \#10 the 04B completed-full-length object hardened to an explicit `BLOCKING_UPSTREAM_GAP` deploy gate (spec locks; wiring deploys when 04B names the surface and emits the outbox row); \#11 explicit `range_width` post-round/post-clamp note. Status: Locked; deploy gated on the two 04B `BLOCKING_UPSTREAM_GAP` items. **Post-lock additive clarifications applied 2026-05-14 (no behavior change, no version bump, no new RB tag per §16.3): updated-review item D — stale §14 refresh-counter cross-doc row corrected to reflect the 05C-owned `student_projection_refresh_state` (the RB-05C-V1-03 ownership move); item B — documented that `bump_projection_refresh_counter`'s `p_section` parameter is intentionally retained (call-site self-documentation \+ V1.1 section-specific-throttling hook), and added the same to the §16.6 V1.1 list. Updated-review items A and C required no doc change (already covered by the §11 verification gate / §13 fixtures and §16.6 respectively). Reviewer verdict on this revision: SHIP AS SPEC, 0 doc blockers, 2 upstream deploy gates (04B) unchanged.** |

---

*End of Doc 05C V1.0.*

---

 