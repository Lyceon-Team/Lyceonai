# **Doc 05 — Mastery, KPI Rollups, Projections & Audit (Parent)**

| Field | Value |
| ----- | ----- |
| **Document** | Doc 05 Parent — Mastery, KPI Rollups, Projections & Audit |
| **Version** | V1.0 |
| **Status** | Locked 2026-05-13 (in-lock-cycle cleanup applied, RB-05P-V1-01..14; no version bump per Doc 04 family precedent) |
| **Scope** | Family doctrine. Locks the per-skill mastery formula, source family enum, bottom-up derivation contract, parameter versioning, cross-doc seams, and audit lifecycle separation. Per-table contracts and per-sub-doc specifics live in 05A / 05B / 05C / 05D. |
| **Audience** | Engineering, AI, Product, Data, Security, QA, Ops |
| **Depends on** | Doc 00 (Authoritative Platform Directive) · Doc 01 (Identity, Access, Billing & Guardian Trust) · Doc 02 (Canonical Questions & Runtime Engines) · Doc 03 (Tutor Runtime) · Doc 04 family (Full-Length Exams & Scoring) |
| **Superseded** | PDF-05 (Mastery Engine), PDF-09 (KPIs, Analytics & Reporting) |
| **Sub-docs** | 05A (Mastery Formula & Skill Mastery), 05B (Domain Mastery & KPI Rollups), 05C (Score Projections & Snapshots), 05D (Mastery Audit, Recompute & Constants Governance) |

---

## **1\. Purpose**

Doc 05 defines how Lyceon turns student answer events into a defensible measurement of skill mastery, and how that measurement propagates upward into domain mastery, section projections, and KPI rollups.

Doc 05 is the canonical contract for:

* What inputs feed mastery (which events from which sources, with which metadata)  
* How mastery is computed from those inputs (the V1.0 mastery formula)  
* How mastery is persisted (per-skill, with derived domain and section rollups)  
* How mastery is recomputed deterministically from the canonical event history  
* How mastery parameters are versioned, audited, and governed  
* How mastery decisions are explainable to engineers, product, and (in aggregate form) to guardians

Doc 05 deliberately does NOT define:

* The raw event storage schemas for practice, review, or full-length answers — those belong to Doc 02 (practice / review runtime) and Doc 04 family (full-length runtime)  
* The tutor runtime — Doc 03 owns tutor behavior; Doc 05 only locks the boundary that tutor cannot write mastery  
* The full-length scoring or reporting pipeline — Doc 04A / 04B / 04C / 04D own that domain  
* The student or guardian UI surfaces that consume mastery data — UI is a separate concern that reads Doc 05's persistence layer

The mental model is **bottom-up derivation**: a student answers a question → the raw answer is stored in a source-of-truth table owned by another Doc family → Doc 05 reads that answer (alongside its question metadata) and updates the mastery and KPI surfaces it owns.

Mastery is not asserted by upstream event handlers. Upstream runtimes commit canonical answer events, then invoke the Doc 05 write boundary. The Doc 05-owned boundary derives mastery from canonical event history and writes Doc 05-owned tables in a single transaction. Upstream runtimes do not compute mastery, do not write Doc 05 tables, and do not gate on Doc 05 success. \<\!-- RB-05P-V1-05 \--\>

---

## **2\. Doctrine**

Six principles govern every decision in the Doc 05 family. Sub-docs that conflict with these principles are wrong, not the principles.

### **2.1 Mastery is an indicator, not a prediction**

Mastery is a measurement of what a student has demonstrated. It is not a forecast of what they will do next. The product MUST NOT frame mastery as a probability of future correctness, a predicted SAT score, or an AI confidence value. Mastery is the recency-weighted, source-weighted, difficulty-weighted accuracy of the student's recent answer history for the skill.

### **2.2 Mastery comes from proven events only**

The only inputs to mastery are answered, scored question events. The three canonical event sources are practice, review, and full-length. Tutor interactions do not feed mastery. Predicted scores, AI confidence, derived signals, and inferred ability do not feed mastery. A mastery value with no underlying event evidence is not a mastery value — it is NULL.

### **2.3 Bottom-up derivation, not top-down assertion**

Mastery rows are derivative of raw answer events, which are owned by upstream Doc families. Doc 05 never asserts a mastery value that doesn't trace back to a canonical answer row. If the underlying answer history is replayed, the derived mastery state MUST converge to the same values.

### **2.4 Server-authoritative, service-role-only writes**

Mastery, domain mastery, section projections, KPI rollups, and KPI snapshots are written by server code under a service role. No student session, guardian session, or client-trusted path may write any Doc 05-owned table. Row-level security policies enforce this at the database boundary, not only at the application boundary.

### **2.5 Versioned parameters, immutable history**

Every constant that affects the mastery formula or its derived projections is stored in a versioned constants table with audit triggers. Parameter changes are append-only at the audit layer; no constant change is silent. Mastery rows carry the model version under which they were computed.

### **2.6 Determinism by construction**

The event-time update path and the full-history recompute path MUST produce identical mastery values from identical event histories, up to floating-point rounding governed by the documented precision constants. Determinism is not an aspiration; it is a hard invariant that the family is tested against.

---

## **3\. Family Structure & Sub-Doc Map**

The Doc 05 family is split along ownership boundaries. Each sub-doc owns a specific surface and is responsible for the complete contract of that surface. Parent owns doctrine, seams, and cross-cutting invariants.

### **3.1 Sub-doc ownership matrix**

| Sub-doc | Owns | Does NOT own |
| ----- | ----- | ----- |
| **05A — Mastery Formula & Skill Mastery** | The canonical mastery formula contract; `student_skill_mastery` table schema; event input contract; the per-skill mastery write RPC and its inputs/outputs; the diagnostic seeding contract | Domain mastery rollups; section projections; KPI counter table schemas; audit trail tables |
| **05B — Domain Mastery & KPI Rollups** | `student_domain_mastery` schema and refresh contract; `student_kpi_rollups_current` schema; `student_kpi_counters_current` schema; how domain mastery is computed natively from the event stream (not derived from skill mastery — see §4.7) | The mastery formula itself; per-skill mastery row contract; section projections; admin replay |
| **05C — Score Projections & Snapshots** | `student_section_projections` schema and projection formula; `student_kpi_snapshots` schema and snapshot lifecycle; how domain mastery values combine with published SAT domain distribution weights to produce per-section readiness projections | Mastery formula; KPI counter increments; audit trail tables |
| **05D — Mastery Audit, Recompute & Constants Governance** | `mastery_constants` and `kpi_constants` versioning contract; `constants_audit_log` schema; the mastery audit trail (separate from Doc 04D's exam audit); the canonical recompute / backfill function; the admin replay-from-events endpoint | The mastery formula itself; per-table runtime schemas |

### **3.2 Inter-sub-doc seams**

* **05A → 05B**: When 05A's mastery RPC writes a `student_skill_mastery` row, it MUST also refresh the affected `student_domain_mastery` row and the affected `student_kpi_rollups_current` rows within the same transaction. 05B defines the refresh logic; 05A defines the trigger boundary.  
* **05B → 05C**: When 05B updates `student_domain_mastery`, it MUST trigger a refresh of the affected `student_section_projections` row within the same transaction. 05C defines the projection logic; 05B defines the trigger boundary.  
* **05A / 05B / 05C → 05D**: Every mastery-relevant write emits an audit row to the Doc 05 audit trail. 05D defines the audit schema; 05A / 05B / 05C define when the audit row is emitted.  
* **05D → 05A / 05B / 05C**: The `mastery_constants` and `kpi_constants` tables are read by 05A (formula constants), 05B (KPI weights), and 05C (projection constants). 05D owns the tables and the audit triggers; the read consumers reference them by canonical name.

### **3.3 Family-wide naming convention**

All tables, columns, RPCs, and constants owned by the Doc 05 family use the conventions established in Doc 04 family:

* Snake case for table names, column names, and function names  
* Versioned constants identified by a `version` text key in the constants table  
* Audit trail tables suffixed `_audit_log`  
* Refresh helper functions prefixed `refresh_` and scoped explicitly to their target  
* Recompute / backfill functions prefixed `rebuild_`

The detailed schema for each table lives in its owning sub-doc.

---

## **4\. Canonical V1.0 Mastery Formula (Statement)**

The full contract — input validation, write order, error handling, idempotency, stress-tested numerical scenarios — lives in 05A. This section locks the formula's mathematical shape and parameter set as a Parent-level invariant. Sub-docs and implementations that deviate from this shape are wrong.

### **4.1 The formula**

The V1.0 mastery formula is **per-source weighted accuracy, with position-based recency weighting and a difficulty bonus on the numerator, combined across sources via macro-average with renormalization for missing sources.**

For a skill `S` and a student `U`:

**Step 1 — Position assignment (per skill, per student).**

Take all of the student's answer events for skill `S`, sorted by `occurred_at` DESC (most recent first). Assign each event a 1-based position `i = 1, 2, 3, ...` where `i = 1` is the most recent.

**Step 2 — Position weight (the recency factor).**

position\_weight(i) \= 0.5 ^ ((i \- 1\) / POSITION\_HALF\_LIFE)

With `POSITION_HALF_LIFE = 30`, the most recent event (i=1) has position\_weight \= 1.0; the 31st-most-recent event (i=31) has position\_weight \= 0.5 exactly; the 61st-most-recent (i=61) has 0.25; the 100th-most-recent has \~0.10. The formula is `0.5 ^ ((i - 1) / 30)`, so the half-life applies to the offset from the most-recent position, not to the position number itself. \<\!-- RB-05P-V1-02 \--\>

**Step 3 — Per-source accuracy (one value per source family).**

For each source family `s ∈ {test, practice, review}`:

acc\_s \= MIN( 1.0,  
    Σ\_{e ∈ events of source s}  difficulty\_weight(e) × position\_weight(i\_e) × correct(e)  
  ÷ Σ\_{e ∈ events of source s}  position\_weight(i\_e)  
)

where correct(e) ∈ {0, 1}

The numerator sums the position-weighted correct contributions, with each correct answer multiplied by its difficulty weight. The denominator sums the position weights of all events in that source (correct or not). The `MIN(1.0, ...)` clamp handles the case where uniformly-correct hard events push the ratio above 1.0.

Note: the difficulty weight appears in the numerator only. The denominator is the unweighted-by-difficulty sum of position weights. This means hard correct answers contribute MORE than easy correct answers (the difficulty bonus survives), while still being normalized by total position-weighted evidence.

If a source family has no events, `acc_s` is undefined (NULL); see Step 5 for combination handling.

**Step 4 — Combine sources via macro-average.**

mastery\_score(U, S) \=  
    Σ\_{s with events}  w\_source(s) × acc\_s  
  ÷ Σ\_{s with events}  w\_source(s)

The denominator renormalizes over the source families that actually have events for this student-skill pair. A student with practice events only has `mastery_score = acc_practice` (the only term in the sum). A student with practice and review events has mastery weighted between those two using their renormalized source weights.

**Step 5 — Evidence threshold and cold start.**

The mastery value is set to `NULL` when either of the following is true:

* **Cold start:** the student has zero events for the entity (skill or domain) across all three sources.  
* **Insufficient evidence:** the student has fewer than `MIN_EVENTS_FOR_MASTERY = 5` total events for the entity, regardless of source mix.

The threshold applies to total events for the entity, not per-source. A student with 3 practice events and 1 review event has 4 total events for the skill — below threshold, mastery is `NULL`. A student with 5 practice events alone meets the threshold.

`NULL` is not zero. `NULL` communicates "insufficient evidence to compute mastery." The persistence layer stores `NULL`; the product surface decides how to render it (e.g., "Practice more to see your mastery here").

**Step 6 — Derived values.**

mastery\_pct(U, S)   \= round( 100 × mastery\_score, ROUND\_MASTERY\_SCORE\_DECIMALS )  
mastery\_level(U, S) \= lookup against the 5-tier level boundary table (§4.5)

### **4.2 Formula in SQL-friendly form**

Expressed as a single aggregation per source (the form 05A's canonical RPC will use):

\-- Per-source accuracy (for one student, one skill, one source family):  
SELECT  
  source\_family,  
  LEAST(1.0,  
    SUM(difficulty\_weight \* position\_weight \* correct::int)  
    / NULLIF(SUM(position\_weight), 0\)  
  ) AS acc\_source  
FROM events\_with\_position\_and\_weights  
WHERE student\_id \= $1 AND skill \= $2  
GROUP BY source\_family;

\-- Final mastery score (combine the per-source accuracies):  
mastery\_score := SUM(w\_source × acc\_source) / NULLIF(SUM(w\_source), 0\)  
                 \-- summed only over sources with at least one event

A single aggregation pass per source; macro-combination at the end. No window functions required for the formula itself (position assignment is a separate step owned by 05A).

### **4.3 Source families and source weights (macro-average weights)**

The V1.0 source family enum has exactly three members. Flowcards are normalized to the practice source family upstream of the mastery write — Doc 05 does not see `flowcard` as a distinct source.

The macro-average source weights sum to 1.0 by design, matching the traditional educational grading analogy (homework \+ quizzes \+ final exam, each contributing a category-weighted share to the final grade).

| `source_family` | Weight (`w_source`) | Rationale |
| ----- | ----- | ----- |
| `test` | **0.50** | Full-length exam answers (post-completion only — see §11.4). The truth-anchor doctrine: exam conditions are closest to actual SAT performance; full-length contributes the largest share of mastery. |
| `practice` | **0.30** | Practice session answers, including flowcards normalized to practice. The "homework" of SAT prep — sustained, varied evidence. |
| `review` | **0.20** | Review session retry answers. The student answers a question they previously missed, possibly with tutor guidance and spaced-repetition prompting. Real evidence of learning, but softer than practice (the student has seen the question before). |

The weights are stored in `mastery_constants` as `weight_source_test`, `weight_source_practice`, `weight_source_review`.

### **4.4 Difficulty weights (numerator-only bonus)**

The V1.0 canonical difficulty enum is **exactly three buckets: `1` (easy), `2` (medium), `3` (hard)**. There is no 1-5 difficulty model in Lyceon V1.0. Any upstream system that emits or stores a 1-5 difficulty value is non-canonical and MUST be reconciled to the 3-bucket enum before reaching the mastery write boundary. Doc 02 owns the canonical question difficulty contract and MUST provide 1-3 buckets directly; no Parent-side translation from 1-5 to 1-3 is defined because the 5-tier model is not part of the V1.0 canonical contract. \<\!-- RB-05P-V1-06 \--\>

| `difficulty_bucket` | Weight (`w_difficulty`) | Effect on a uniformly-correct student in that source |
| ----- | ----- | ----- |
| 1 (easy) | **0.79** | Mastery caps at 0.79 — a student demonstrating only easy mastery cannot reach the top tier without harder evidence. The 0.79 value places easy-only students deterministically in Level 3, just below the Level 4 boundary at 0.80. |
| 2 (medium) | **1.0** | Neutral baseline — mastery reaches 1.0 with all medium correct. Medium-only students can reach the top tier. |
| 3 (hard) | **1.20** | Mastery push above 1.0 (clamped to 1.0 per source). Hard correct rewards more than medium or easy correct in mixed-accuracy scenarios. |

The difficulty weight appears in the formula's numerator only. The denominator's sum of position weights is NOT multiplied by difficulty. This is deliberate: difficulty is a REWARD on correctness (harder correct → more contribution to mastery), not a NORMALIZER on evidence (which the position weight handles).

The `MIN(1.0, ...)` clamp in Step 3 of §4.1 prevents uniformly-correct hard students from exceeding 1.0 in `acc_source`. A student with 100% accuracy on hard questions saturates at 1.0; the difficulty bonus is fully captured in mixed-accuracy scenarios.

### **4.5 Mastery level boundaries**

Mastery score in `[0, 1]` maps to an integer mastery level `{0, 1, 2, 3, 4}` via the locked boundary table.

| Level | Range (inclusive both ends) |
| ----- | ----- |
| 0 | `[0.00, 0.19]` |
| 1 | `[0.20, 0.39]` |
| 2 | `[0.40, 0.59]` |
| 3 | `[0.60, 0.79]` |
| 4 | `[0.80, 1.00]` |

NULL mastery score does not map to a level — `mastery_level` is also NULL in that case.

### **4.6 What V1.0 explicitly does NOT include**

These properties of mastery are deliberately out of scope for V1.0. Each is enumerated in §17 as a V1.1 candidate.

* **Calendar-time decay.** Mastery uses position-based recency (events sorted by occurred\_at; weight applied to position, not to age in days). The formula has zero time-dependence outside event ordering. A student inactive for 6 months whose last 30 events were correct retains the mastery those events earned — there is no calendar decay during inactivity.  
* **Hard cutoff on event age.** All events for a skill are included regardless of how old they are. Old events naturally contribute less via position\_weight (events beyond position \~100 have negligible weight), but there is no explicit cutoff that drops them.  
* **Asymmetric outcome penalties.** Wrong answers contribute zero to the numerator and the standard position\_weight (without difficulty) to the denominator. They do NOT receive an extra penalty multiplier. The legacy asymmetric base\_delta constants (`delta_practice_correct`, etc.) are NOT used by the V1.0 formula.  
* **Bayesian priors or smoothing.** Cold-start mastery is NULL, not a prior-shrunk estimate. A student with a single answer for a skill has a mastery value reflecting that one answer's position weight × difficulty × correctness; this is a known edge case and acceptable for V1.0.  
* **Question quality weighting beyond difficulty bucket.** A "well-calibrated" hard question and a "poorly-calibrated" hard question contribute identically. Calibration is a content-side concern.  
* **Latency or time-on-task signals.** How long a student took to answer is not part of the mastery formula. It is tracked in `student_kpi_rollups_current.avg_latency_ms` for reporting but does not enter the mastery computation.  
* **Tutor interaction signals.** Whether a student used the tutor before answering does not appear in the formula. See §13.

### **4.7 Skill mastery and domain mastery are computed independently from events**

The mastery formula in §4.1 defines `mastery_score(U, S)` for a (student, skill) pair. The same formula applies, with the same parameters, to a (student, domain) pair — but `domain_mastery` is NOT a weighted average of the student's skill mastery values within the domain.

Instead, both skill mastery and domain mastery are computed natively from the underlying event stream, with the entity filter changing:

| Output | Entity filter on events |
| ----- | ----- |
| `skill_mastery(U, S)` | events where `skill = S` |
| `domain_mastery(U, D)` | events where `domain = D` (i.e., across all skills in D) |

This has three consequences:

1. **Domain mastery is not a roll-up of skill mastery.** It is its own computation from a broader event filter. Domain mastery does not depend on individual skill masteries being defined.

2. **The 5-event threshold applies independently per entity.** A student may have 4 events on `skill_X` (skill mastery NULL) and 12 total events across the domain containing `skill_X` (domain mastery defined). This is correct behavior — the domain has sufficient evidence even when individual skills don't.

3. **No double-smoothing.** A weighted-average derivation would smooth skill values (already smoothed by recency and difficulty) into a domain value (smoothed again by skill-weight). Computing domain mastery natively from events avoids this and gives a more direct measurement.

Section projection (owned by 05C) consumes domain mastery values and applies published SAT domain distribution weights to derive section-level readiness. Section projection is NOT in scope for Doc 05's mastery formula contract — it is a downstream derivation defined in 05C.

---

## **5\. Source Families & Flowcard Normalization**

### **5.1 The canonical source family enum**

For all Doc 05 purposes, the `source_family` enum has exactly three values: `practice`, `review`, `test`. Every mastery-relevant input event MUST carry exactly one of these three values. Implementations that introduce a fourth value at the mastery write boundary are wrong.

### **5.2 Flowcard normalization rule**

Flowcards are a distinct product surface (a focused practice format) but they are NOT a distinct mastery source. The normalization rule is:

When a flowcard answer event reaches the mastery write boundary, its `source_family` MUST be set to `practice`. The flowcard distinction is preserved in upstream raw event tables and in KPI counter columns (05B), but it is invisible to the mastery formula.

This rule has three consequences:

1. The mastery formula sees `practice` weight (0.30 macro-average source weight) for flowcard-derived events. There is no separate flowcard weight in the formula.  
2. KPI counter tables (05B) MAY retain flowcard-specific columns to support product surfaces that need to distinguish flowcard activity from raw practice activity.  
3. Reporting surfaces (05C) MAY consume flowcard-specific KPI counters; mastery surfaces MUST NOT.

### **5.3 Why this matters**

Splitting flowcards out as a distinct mastery source would require either (a) duplicating all 3 source family parameters for a fourth source, or (b) introducing weights that distinguish flowcards from raw practice. Both add complexity for a distinction that the mastery formula does not need to make. The product distinction exists upstream; the mathematical distinction does not.

### **5.4 Full-length is a special case**

Full-length answers reach the mastery write boundary with `source_family = 'test'`, but ONLY after the test has been scored and the canonical answer state has landed in the Doc 04 family's source-of-truth tables. The full-length runtime MUST NOT emit per-question mastery events during the live exam. See §11.4 for the full Doc 04 → 05 seam contract.

---

## **6\. Hard Invariants**

These invariants are enforced by Doc 05 family code, tested in CI, and audited in production. Violations are blockers, not nits. The numbering is stable; subsequent versions append rather than renumber.

### **6.1 Invariant 1 — Service-role-only writes**

Every Doc 05-owned table (`student_skill_mastery`, `student_domain_mastery`, `student_section_projections`, `student_kpi_rollups_current`, `student_kpi_counters_current`, `student_kpi_snapshots`, and the mastery audit log in 05D) is writable only by a service role. Row-level security policies deny INSERT, UPDATE, and DELETE for the `authenticated` and `anon` roles. Reads MAY be permitted under role-scoped policies; writes MAY NOT.

### **6.2 Invariant 2 — Single canonical write path per surface**

For each Doc 05-owned table, exactly one canonical write function exists, named in its owning sub-doc. No application code writes these tables directly; all writes flow through the canonical function. CI enforces this with a grep guard against direct table writes outside the canonical functions.

### **6.3 Invariant 3 — Deterministic recompute**

The full-history recompute function (05D) MUST produce mastery, domain mastery, section projection, and KPI counter values that are identical to the event-time path's values for the same event history, up to floating-point rounding governed by the precision constants. Tested by a recompute-after-event-replay test that asserts equivalence.

### **6.4 Invariant 4 — Tutor never writes mastery**

No tutor runtime code path may call any Doc 05-owned canonical write function. Tutor-helped retries reach mastery via the review surface's normal write path; the tutor's involvement is irrelevant to the mastery write. CI enforces this with a grep guard.

### **6.5 Invariant 5 — Full-length writes mastery only post-completion**

The full-length runtime MUST NOT call the mastery write RPC during the live exam UI. Mastery for full-length events is derived from canonical answer state after the test has been scored. See §11.4.

### **6.6 Invariant 6 — Mastery is NULL when evidence is absent or insufficient**

The persisted `mastery_score` for an entity (skill or domain) MUST be `NULL` whenever either of the following holds:

* **Zero events:** the student has no events for that entity across all three sources.  
* **Below threshold:** the student has fewer than `MIN_EVENTS_FOR_MASTERY` (= 5 in V1.0) total events for that entity, regardless of source mix.

The threshold applies to skill mastery and domain mastery independently. A skill with fewer than 5 events is `NULL`; a domain with fewer than 5 events (counted across all skills in that domain) is `NULL`. The threshold is total event count for the entity, not per-source.

`NULL` is not zero. `NULL` communicates absence or insufficiency of evidence; zero would communicate proven non-mastery. Cold-start and below-threshold paths do not synthesize evidence to escape `NULL`.

### **6.7 Invariant 7 — Versioned constants, never silent**

Every change to `mastery_constants` or `kpi_constants` emits an audit row to `constants_audit_log`. The audit row records the old value, new value, change reason, and changing actor. No constant change happens without an audit row.

### **6.8 Invariant 8 — No predicted scores, no AI confidence**

No Doc 05-owned table, view, RPC, or surface persists or surfaces a "predicted SAT score," "AI confidence," "ability estimate," "probability of correctness," or any other inferred forward-looking signal. Section projections (05C) are documented as a recency-weighted current-state estimate with explicit confidence bands; they are not predictions.

### **6.9 Invariant 9 — Audit lifecycle separation**

The Doc 05 family audit trail (mastery transitions, KPI counter changes, projection updates) lives in tables owned by 05D. The Doc 04D family audit trail (exam runtime, scoring, reporting) lives in tables owned by 04D. Neither family's audit trail writes into the other's. See §15.

---

## **7\. Bottom-Up Derivation Contract**

This section locks the data flow and ownership boundaries from raw answer events through to section projections. Each layer is the source of truth for the layer below it; no layer asserts state that doesn't trace back to a canonical event row.

### **7.1 Layer 1 — Raw answer events (owned by upstream Doc families)**

The source of truth for what a student answered is owned by:

* **Practice answers** → Doc 02 family (practice runtime). Canonical table: `practice_session_items` joined to `practice_attempts_v0` (or equivalent, per Doc 02's lock).  
* **Review answers** → Doc 02 family (review runtime). Canonical table: `review_session_items` joined to `review_error_attempts`.  
* **Full-length answers** → Doc 04 family. Canonical feedstock: `test_session_answers` joined to `test_sessions`, `test_session_sections`, `test_form_items`, and `questions`. Eligible after the relevant section reaches `submitted` state (post-finalization, NOT gated on score\_run success). Doc 04 emits no mastery events; Doc 05 reads canonical answer state directly. \<\!-- RB-05P-V1-03 \--\>

Doc 05 does not own these tables. Doc 05 reads from them.

### **7.2 Layer 2 — Mastery write event (the boundary)**

When an upstream Doc family commits a raw answer event, it triggers a Doc 05 mastery write boundary call with the following input contract:

| Input field | Type | Notes |
| ----- | ----- | ----- |
| `student_id` | uuid | The student who answered |
| `section` | text | 'M' or 'RW' (locked enum) |
| `domain` | text | SAT-canonical domain string |
| `skill` | text | SAT-canonical skill string |
| `difficulty` | integer | 1, 2, or 3 (the normalized bucket) |
| `source_family` | text | `practice`, `review`, or `test` (flowcards normalized to `practice`) |
| `correct` | boolean | The scored outcome |
| `event_weight` | numeric | Defaults to 1.0; reserved for fractional weighting (05A) |
| `latency_ms` | integer | Optional; tracked in KPI counters but not in the mastery formula |
| `occurred_at` | timestamptz | When the answer was given (NOT when the write fires) |

The mastery write boundary is the single point at which Doc 05 takes ownership of an answer event. Upstream Doc families do not write directly to Doc 05 tables — they call the boundary function.

### **7.3 Layer 3 — Per-cell KPI rollup (05B)**

Each mastery write boundary call ALSO updates the relevant `student_kpi_rollups_current` row for the `(student, section, domain, skill, difficulty, source_family)` cell. The rollup row counts the total questions seen, correct answers, incorrect answers, accuracy percentage, and average latency for that exact cell.

**The KPI rollup is a materialized derived counter, not the source of truth.** The source of truth remains the canonical answer/event history owned by upstream Doc families (§7.1). The rollup is a denormalized, incrementally-maintained view that exists to support efficient event-time mastery computation and read-heavy product surfaces. Event-time mastery MAY consume rollups for efficiency; the recompute path (05D) MUST be able to rebuild rollups and mastery from raw canonical events without depending on any prior rollup state. \<\!-- RB-05P-V1-09 \--\>

### **7.4 Layer 4 — Skill mastery (05A)**

The mastery formula in §4 is computed natively from the canonical event history for the skill (§4.7). The mastery write path MAY consume the per-cell KPI rollups (§7.3) for efficient incremental computation, but the formula's logical input is the event history; rollups are an implementation accelerator, not a substitute for the canonical data. The result is persisted as a single row in `student_skill_mastery` keyed by `(student_id, section, domain, skill)`.

### **7.5 Layer 4b — KPI counter table (05B)**

In parallel with the skill mastery write, the wider `student_kpi_counters_current` row for the student is updated. This table carries fine-grained counters across sections, domains, skills, source families, and difficulty buckets in a denormalized form to support product surfaces that don't want to aggregate from the rollups at read time.

### **7.6 Layer 5 — Domain mastery (05B)**

After the skill mastery row is written, the affected `student_domain_mastery` row for `(student_id, section, domain)` is refreshed. The refresh recomputes domain mastery natively from the underlying event stream (events where `domain = D`, across all skills in D), using the same mastery formula defined in §4.1 — NOT as a weighted average of skill mastery values within the domain. See §4.7 for the architectural rationale.

The same 5-event threshold (`MIN_EVENTS_FOR_MASTERY`) applies per domain: a domain with fewer than 5 total events across its skills has `domain_mastery = NULL`. A domain may have defined domain\_mastery even when some of its constituent skills do not (the domain's event count includes events from all its skills).

### **7.7 Layer 6 — Section projections (05C)**

After the domain mastery row is refreshed, the affected `student_section_projections` row for `(student_id, section)` is refreshed. The projection combines the section's domain mastery values with published SAT domain distribution weights (stored in `kpi_constants.weights.math` and `kpi_constants.weights.rw`) to produce a per-section projected readiness score with low/mid/high bands. The projection formula and the band logic are defined in 05C; this section locks only the trigger and the data dependency.

### **7.8 Write transaction boundary**

Layers 3, 4, 4b, 5, and 6 are all updated within a single database transaction triggered by the mastery write boundary call. If any layer fails, the entire transaction rolls back. There is no partially-applied mastery state. This rule is enforced by 05A's RPC contract.

### **7.9 Layer 7 — Snapshots (05C)**

`student_kpi_snapshots` rows are written by a separate snapshot lifecycle, not by the mastery write boundary. Snapshots are point-in-time captures of the current KPI state, written on a schedule or at lifecycle events (test completion, weekly boundary). 05C owns the snapshot lifecycle.

### **7.10 Layer 8 — Audit (05D)**

Every mastery write boundary call also emits a row to the mastery audit log. The audit row records the input parameters, the mastery model version, the resulting mastery value, and the actor (always a service role). The audit log is the source of truth for "why did this student's mastery change."

---

## **8\. Determinism Contract**

Determinism is the property that makes mastery defensible: given the same event history, the system produces the same mastery values. Without determinism, audits are meaningless and parent trust is unearnable.

### **8.1 The two write paths must converge**

Two paths can produce a `student_skill_mastery` row's value: the event-time path (Layer 2 in §7) and the full-history recompute path (05D). These paths MUST produce the same value for the same event history.

The convergence guarantee is structural, not optional:

* The event-time path computes mastery from the current `student_kpi_rollups_current` state plus the incoming event.  
* The recompute path truncates the derived state and replays the entire event history through the same mastery write boundary function used by the event-time path.  
* Because both paths use the same function with the same inputs, the outputs match by construction, up to the floating-point rounding tolerance defined by `ROUND_MASTERY_SCORE_DECIMALS`, `ROUND_ACCURACY_DECIMALS`, and `ROUND_EVIDENCE_DECIMALS`.

### **8.2 Determinism is tested**

A determinism test exists in CI and asserts the following:

Given a fixture event history H for student U, compute mastery via the event-time path (replaying H one event at a time through the mastery write boundary). Then truncate the derived state and recompute via the recompute path on the same H. Assert that `student_skill_mastery`, `student_domain_mastery`, `student_section_projections`, and `student_kpi_rollups_current` are identical row-for-row, value-for-value, up to documented rounding precision.

This test is a hard gate on any change to the mastery family.

### **8.3 The role of the canonical event history**

"The same event history" means the answer rows in the upstream raw event tables (Layer 1 in §7) at a given moment, ordered by `occurred_at` then by row identifier as a tiebreaker. The recompute path MUST iterate this canonical ordering. Implementations that iterate by `created_at` or by another timestamp risk producing nondeterministic results when events are backfilled or reordered.

### **8.4 Recency is position-based, not time-based**

The V1.0 mastery formula has NO calendar-time decay. Recency is implemented via position weighting (§4.1 Step 2), where the position is the event's offset from the most-recent event in the entity's sorted event history. The formula has no `T_now` parameter, no `age_days` term, and no wall-clock dependence outside event ordering.

Consequences for determinism:

* Two computations over the same event history (with the same canonical ordering) produce identical mastery values regardless of when they run. Wall-clock time is not an input.  
* A student inactive for any duration does NOT see mastery drift downward purely due to time passing. The most-recent event retains `position_weight = 1.0` until a newer event is committed.  
* The recompute path does NOT require a `T_now` parameter. The audit row for a recompute records the wall-clock time of the recompute run for traceability only, not as a formula input.

Implementations that introduce calendar-time decay, hard age cutoffs, or any wall-clock-dependent weighting are NOT V1.0 — they would require a `mastery_model_version` bump and a documented behavior change. \<\!-- RB-05P-V1-01 \--\>

### **8.5 Floating-point rounding is the only allowed source of divergence**

Beyond the documented rounding precision constants, no source of divergence between event-time and recompute paths is acceptable. If the test in §8.2 fails by more than the documented tolerance, the issue is a bug in the family, not a tunable behavior.

---

## **9\. Parameter Versioning**

Doc 05's behavior is governed by parameters that MAY change over time as the product matures. Versioning the parameters makes those changes auditable, reversible, and traceable to specific student outcomes.

### **9.1 Constants tables**

Two constants tables exist, owned by 05D:

* **`mastery_constants`** — keyed by a single `key` text field. Holds scalar formula parameters: `POSITION_HALF_LIFE`, `MIN_EVENTS_FOR_MASTERY`, the three difficulty weights (`difficulty_weight_easy/medium/hard`), the three source weights (`weight_source_test/practice/review`), the five mastery level boundaries, `mastery_min` / `mastery_max`, and the precision constants (`ROUND_MASTERY_SCORE_DECIMALS`, `ROUND_ACCURACY_DECIMALS`, `ROUND_EVIDENCE_DECIMALS`, `ROUNDING_MODE`).  
* **`kpi_constants`** — keyed by a `version` text field. Holds structured configuration: domain weights for projection (per section), projection delta thresholds, score band ranges, scaling constants. Each row is a complete configuration; the "live" row is the active configuration.

The detailed schemas for these tables live in 05D.

### **9.2 The active version contract**

For `mastery_constants`, the active values are the values in the table at read time — there is no version selector. The audit trail (§9.4) provides the historical view.

For `kpi_constants`, the active row is identified by `version = 'live'` (or a `status_flags.active = true` flag). The historical rows (e.g., `version = 'kpi_truth_v1'`) are retained for snapshot consumers but are not the active configuration.

### **9.3 Reads use the constants, never literals**

All Doc 05 family code that depends on a constant MUST read the constant from the constants table by canonical name. Literal values in code (e.g., a hard-coded `0.5 ^ ((position - 1) / 30)`) are not permitted; the code must read `POSITION_HALF_LIFE` from `mastery_constants`. CI enforces this with a grep guard against known constant names appearing as literals.

### **9.4 Audit triggers on the constants tables**

Both `mastery_constants` and `kpi_constants` have BEFORE-UPDATE audit triggers that write a row to `constants_audit_log` capturing the old value, new value, changing actor, and change reason. The audit log is append-only; rows are never updated or deleted. The audit log is the source of truth for "when did this constant change and to what."

### **9.5 Mastery row version pinning**

Each `student_skill_mastery` and `student_domain_mastery` row carries a `mastery_model_version` text field. The value MUST reflect the version of the mastery formula and constants used to compute the row. V1.0 rows carry `mastery_model_version = 'v1.0'`. When the formula or its constants change in a way that produces materially different values, the version string bumps (e.g., `v1.1`).

**Any change to a formula-affecting constant in §10.1 is behavior-changing and triggers ONE of the following:**

1. **Version bump (preferred for explicit doctrine changes):** `mastery_model_version` advances (e.g., `v1.0` → `v1.1`), all newly-written mastery rows carry the new version string, and existing rows retain their original version. A recompute under the new constants is a separate operational decision.

2. **Per-row constants snapshot hash (for fine-grained tuning):** mastery rows additionally carry a `constants_snapshot_hash` column populated with a stable hash of the active `mastery_constants` table contents at write time. Old rows retain their old hash; new rows reflect the new hash. The audit trail (`constants_audit_log`) plus the per-row hash makes "this row was computed under exactly these constants" reproducible from canonical evidence.

**Silent same-version constant drift is forbidden.** A change to `mastery_constants` without either a version bump or a populated `constants_snapshot_hash` would break audit reproducibility for affected rows. 05D's RPC contract MUST enforce one of the two paths on every write. \<\!-- RB-05P-V1-08 \--\>

Version pinning at the row level enables audits to answer "this student's mastery was computed under which model and which exact constants" without ambiguity. 05A defines the column-level contract; 05D defines the constants hash computation rule (stable serialization order, included keys, exclusion rules).

### **9.6 Constants vs configuration**

Not every operational parameter belongs in the constants tables. The constants tables hold values that affect the mastery formula or its derived projections. Pure operational values (e.g., diagnostic question counts, rate limits, feature flags) MAY live in other configuration surfaces and are out of scope for Doc 05's versioning guarantees.

The exception is `DIAGNOSTIC_TOTAL_QUESTIONS`, which lives in `mastery_constants` because the diagnostic flow seeds initial mastery state and the question count bounds that seeding. See 05A for the diagnostic seeding contract.

---

## **10\. V1.0 Canonical Parameter Values**

The values below are the V1.0-locked canonical values for the parameters governed by §9. Sub-docs and implementations MUST reflect these values. Changes follow §9.4's audit trail.

### **10.1 Formula constants (mastery\_constants)**

| Key | Value | Units | Purpose |
| ----- | ----- | ----- | ----- |
| `POSITION_HALF_LIFE` | 30 | event positions | Position-based recency half-life. `position_weight(i) = 0.5 ^ ((i - 1) / POSITION_HALF_LIFE)` |
| `MIN_EVENTS_FOR_MASTERY` | 5 | events | Minimum total events for an entity (skill or domain) before mastery is computed. Below threshold, mastery is `NULL`. |
| `weight_source_test` | 0.50 | weight (macro-average) | Source weight for full-length exam answers. The three source weights sum to 1.0 by design. |
| `weight_source_practice` | 0.30 | weight (macro-average) | Source weight for practice answers (and normalized flowcards). |
| `weight_source_review` | 0.20 | weight (macro-average) | Source weight for review retry answers. |
| `difficulty_weight_easy` | 0.79 | weight (numerator-only) | Difficulty weight for bucket 1\. Caps a uniformly-easy-correct student at acc\_source \= 0.79, placing them deterministically in Level 3 (below the 0.80 Level 4 boundary). |
| `difficulty_weight_medium` | 1.0 | weight (numerator-only) | Difficulty weight for bucket 2\. Neutral baseline; medium-only students can reach Level 4\. |
| `difficulty_weight_hard` | 1.20 | weight (numerator-only) | Difficulty weight for bucket 3\. Pushes acc\_source \> 1.0 for uniformly-hard-correct students; clamped to 1.0 by `MIN(1.0, ...)`. |
| `mastery_min` | 0.0 | score | Defensive lower clamp (per-source acc and final mastery\_score). |
| `mastery_max` | 1.0 | score | Defensive upper clamp (per-source acc and final mastery\_score). |
| `mastery_level_0_max` | 0.19 | score | Upper inclusive bound for level 0\. |
| `mastery_level_1_min` / `mastery_level_1_max` | 0.20 / 0.39 | score | Range for level 1\. |
| `mastery_level_2_min` / `mastery_level_2_max` | 0.40 / 0.59 | score | Range for level 2\. |
| `mastery_level_3_min` / `mastery_level_3_max` | 0.60 / 0.79 | score | Range for level 3\. |
| `mastery_level_4_min` | 0.80 | score | Lower inclusive bound for level 4 (max is `mastery_max`). |
| `ROUND_MASTERY_SCORE_DECIMALS` | 2 | decimals | Precision for persisted `mastery_pct`. |
| `ROUND_ACCURACY_DECIMALS` | 6 | decimals | Precision for persisted accuracy in `[0, 1]` form (per-source `acc_source` and stored `accuracy` columns). |
| `ROUND_EVIDENCE_DECIMALS` | 6 | decimals | Precision for fractional weighted counter sums (attempts, correct in `student_skill_mastery`). |
| `ROUNDING_MODE` | `HALF_UP` | enum | Rounding policy for all numeric persistence. |
| `DIAGNOSTIC_TOTAL_QUESTIONS` | 40 | questions | Diagnostic seeding window. Computed as `N_canonical_domains × MIN_EVENTS_FOR_MASTERY = 8 × 5 = 40`, sized so a completed diagnostic clears the per-domain mastery threshold for every SAT domain. See 05A for the diagnostic seeding contract. \<\!-- RB-05P-V1-13 \--\> |

**Note on storage shape**: the V1.0 source weights (0.50 / 0.30 / 0.20) and difficulty weights (0.79 / 1.0 / 1.20) supersede the values previously seeded in `mastery_constants` for legacy constants (`difficulty_multiplier_easy/medium/hard` at 1.0/1.1/1.3, and any prior source weight keys). 05D's constants governance contract handles the migration; Doc 05's V1.0 canonical values are what's listed in this table.

### **10.2 KPI / projection constants (kpi\_constants, version \= 'live')**

| Field | V1.0 value |
| ----- | ----- |
| `weights.math` | `{Algebra: 0.35, Advanced Math: 0.35, Geometry and Trigonometry: 0.15, Problem Solving and Data Analysis: 0.15}` |
| `weights.rw` | `{Information and Ideas: 0.26, Craft and Structure: 0.28, Expression of Ideas: 0.20, Standard English Conventions: 0.26}` |
| `thresholds.projection_target_questions` | 1000 |
| `thresholds.projection_min_delta` | 20 |
| `thresholds.projection_max_delta` | 60 |
| `score_bands.section_max_scores` | `{M: 800, RW: 800}` |
| `scaling_constants.bound_round_to` | 10 |
| `scaling_constants.midpoint_round_to` | 5 |
| `status_flags.active` | `true` |

Each section's domain weights sum to 1.0. The projection delta thresholds bound the projection range width: at 0 relevant questions answered, the projection band is at its widest (`projection_max_delta`); at `projection_target_questions` (1000) or more answered, the projection band is at its narrowest (`projection_min_delta`).

### **10.3 Constants NOT used by V1.0**

The following keys MAY exist in `mastery_constants` for historical or future-use reasons. They are NOT part of the V1.0 mastery formula. Implementations MUST NOT reference them when computing mastery, and Doc 05 family code MAY ignore them.

| Key | Status in V1.0 |
| ----- | ----- |
| `alpha` (0.20) | Not used in V1.0. Historically the EMA learning rate; the V1.0 formula does not use an EMA shape. |
| `delta_practice_correct`, `delta_practice_incorrect`, `delta_review_correct`, `delta_review_incorrect`, `delta_test_correct`, `delta_test_incorrect` | Not used in V1.0. Historically EMA delta magnitudes; the V1.0 formula has no asymmetric outcome handling and no per-source/per-outcome delta constants. |
| `ALPHA0`, `BETA0` | Not used in V1.0. Historically Bayesian prior parameters; V1.0 cold-start is NULL, not a prior-shrunk estimate. |
| `HALF_LIFE_DAYS` | Not used in V1.0. Historically calendar-day decay half-life; the V1.0 formula uses position-based recency via `POSITION_HALF_LIFE`. |
| `difficulty_multiplier_easy/medium/hard` (1.0 / 1.1 / 1.3) | Superseded in V1.0. Replaced by `difficulty_weight_easy/medium/hard` (0.79 / 1.0 / 1.20) per §10.1. The new keys use `_weight_` not `_multiplier_` because the V1.0 placement is numerator-only, not a symmetric multiplier. |

Removal or migration of these keys from the constants table is a 05D cleanup concern, not a V1.0 formula concern. The legacy values may remain in the table without affecting V1.0 behavior, but new V1.0 code MUST read only the constants listed in §10.1.

---

## **11\. Cross-Doc Seams**

Doc 05 sits at the intersection of multiple Doc families. Each cross-doc boundary is locked here so that sub-docs and implementations don't re-litigate the contract.

### **11.1 Doc 01 → 05 seam (Identity, Access, Billing)**

**Entitlement does NOT gate mastery writes.** Mastery data is owned by the student regardless of entitlement state. A student whose entitlement lapses retains their mastery rows; the rows persist, the formula keeps applying to new events (if any are generated), and re-entitlement restores read access.

**Entitlement MAY gate mastery reads.** Product surfaces that consume mastery data (dashboards, projections, hexagon) MAY be entitlement-gated at the route level. Doc 05 does not enforce this gating; the consuming Doc family does.

**Guardian access to mastery is read-only.** Guardians MAY view a student's mastery surfaces only when (a) the guardian link is active and (b) the student's entitlement is active. This is a Doc 01 enforcement; Doc 05 exposes data, Doc 01 gates who reads it.

**Account deletion follows Doc 01's contract.** When a student account enters Doc 01's deletion window, Doc 05 data persists during the soft-delete window. On hard delete, Doc 05 rows are removed in the same transaction as the identity row.

### **11.2 Doc 02 → 05 seam (Canonical Questions & Runtime Engines)**

**Question metadata is denormalized at event time.** When a raw answer event is committed, the question's `(section, domain, skill, difficulty)` MUST be denormalized into the answer record (or its joined parent record). Doc 05 does NOT join `questions` at mastery write time. This rule exists because:

* Canonical question metadata can evolve (e.g., a skill re-tag); mastery should reflect the metadata that was active when the answer was given, not the current metadata.  
* Read-time joins against `questions` would couple mastery determinism to mutable upstream data.

The denormalization is owned by Doc 02 (for practice and review) and Doc 04 (for full-length). Doc 05's mastery write boundary contract (§7.2) specifies the metadata fields it requires, and the upstream Doc family is responsible for populating them.

**Difficulty enum is canonical 1-3 (not 1-5).** Doc 02 MUST provide question difficulty as one of `{1, 2, 3}` (easy / medium / hard) in the denormalized event payload. The 1-5 difficulty model is NOT a Lyceon V1.0 canonical contract — any upstream legacy 1-5 storage must be reconciled to the 1-3 enum at the Doc 02 boundary before mastery sees the event. Doc 05 does NOT define a 5-to-3 translation table because the 5-tier model is invalid in V1.0. Doc 02 may freely reorganize its internal authoring metadata, but the boundary to Doc 05 is locked at 1-3. \<\!-- RB-05P-V1-06 \--\>

**Difficulty bucket normalization is a Doc 02 responsibility.** The `normalize_difficulty_bucket` function that maps raw difficulty values to the `{1, 2, 3}` enum is owned by Doc 02\. Doc 05 consumes its output; Doc 05 does not redefine it.

**Practice and review tables are read by 05D's recompute path.** The recompute function iterates `practice_session_items` joined to `practice_attempts_v0` (or canonical equivalent) for practice events, and `review_session_items` joined to `review_error_attempts` for review events. Doc 02 owns the table names and join keys; if Doc 02 renames or restructures, the recompute function follows.

### **11.3 Doc 03 → 05 seam (Tutor Runtime)**

**Tutor never writes mastery.** Hard invariant per §6.4. The tutor runtime has no path to call any Doc 05 canonical write function, directly or transitively.

**Tutor-helped retries reach mastery via review.** When a student opens the tutor for a question they answered incorrectly, then retries the question (or a similar one), the retry is a review event from Doc 05's perspective. It writes mastery with `source_family = 'review'`. The tutor's involvement is a Doc 03 audit concern (Doc 03 logs the tutor-helped-retry linkage), not a Doc 05 input signal.

**Tutor does not change which events feed mastery.** The set of mastery inputs is `practice ∪ review ∪ full-length`. Tutor activity is orthogonal: a student who never uses the tutor and a student who uses it heavily can have identical mastery values if their answer histories are identical.

### **11.4 Doc 04 → 05 seam (Full-Length Exams)**

**Full-length runtime MUST NOT call the mastery write boundary during the live exam.** Hard invariant per §6.5.

**Mastery feedstock comes from Doc 04 canonical answer state, not from mastery events.** Doc 04 emits no mastery events. Doc 05's full-length derivation function reads canonical answer rows directly: `test_session_answers JOIN test_sessions JOIN test_session_sections JOIN test_form_items JOIN questions`. The derivation function lives in 05D and replays eligible answers through the mastery write boundary with `source_family = 'test'`. \<\!-- RB-05P-V1-03 \--\>

**Mastery is NOT gated on score\_run success.** Doc 04B `score_runs` provide audit traceability and may be referenced for context, but mastery eligibility is decided by section finalization state, not by scoring pipeline success. A test session whose scoring has not yet completed (or has failed and is being retried) MAY still feed mastery once its sections reach `submitted` state. \<\!-- RB-05P-V1-03 \--\>

**Mastery eligibility is at the section level, post-finalization.** Eligible full-length answer evidence comes only from sections whose `section state = submitted` per the locked Doc 04A V2.2 contract. Answers in non-submitted sections (abandoned, in-progress, or never reached) do NOT produce `source_family = 'test'` mastery evidence in V1.0. A test session with one section submitted and three sections abandoned still produces eligible mastery evidence from the submitted section only. \<\!-- RB-05P-V1-04 \--\>

**Module-1-only partials do not feed mastery.** A section requires both modules submitted (or the equivalent finalization signal per Doc 04A V2.2) to reach `submitted` state. Module-1-only completion is NOT eligible mastery evidence in V1.0. If a future V1.x wants to admit Module-1-only evidence, it must introduce a separate weaker source classification or an explicit lower-weight evidence class — out of scope for V1.0. \<\!-- RB-05P-V1-04 \--\>

**The derivation is triggered, not pushed.** Doc 04 does NOT call into Doc 05\. The Doc 05 derivation function is invoked by a Doc 04 lifecycle signal (e.g., a section-submitted event, or a post-finalization job queue trigger). The exact trigger mechanism is owned by 05D; Doc 04's responsibility ends at "make canonical answer state available with finalized section state."

**Doc 04 family does not see mastery state.** Doc 04A / 04B / 04C / 04D do not read Doc 05-owned tables. Score reports do not include mastery values. Mastery is a Doc 05 surface; scoring is a Doc 04 surface; they are siblings, not parent-child.

**Macro-average source weighting can let sparse test evidence dominate practice history. This is intentional.** Because the cross-source blend in §4.1 Step 4 renormalizes over source families with events, once a student has ≥5 events for the entity that include even a single test event, the `test` family contributes its full macro weight (0.50 of the renormalized denominator) regardless of how many practice or review events accompany it. Example: a student with 1 hard test correct \+ 100 medium practice 50%/50% reaches mastery \~0.91 (level 4\) because the test source carries 0.50 macro weight and `acc_test = 1.0`. This is the truth-anchor doctrine working as designed: full-length test evidence is the most authoritative signal Lyceon has, and a student who demonstrates skill on a test SHOULD see that reflected in mastery even when practice is mixed. Doc 05A MUST include numerical stress tests for low-count-test scenarios as a permanent test fixture. V1.0 does NOT introduce a per-source minimum-event threshold; the per-entity `MIN_EVENTS_FOR_MASTERY = 5` is the only volume gate. \<\!-- RB-05P-V1-07 \--\>

### **11.5 Internal 05 family seams**

Already enumerated in §3.2. Restated for completeness:

* 05A's mastery RPC triggers refreshes in 05B (domain mastery, KPI rollups) and 05B triggers refreshes in 05C (projections), all within one transaction.  
* 05D owns the constants tables read by 05A / 05B / 05C.  
* 05D owns the audit log written by 05A / 05B / 05C.

---

## **12\. Anti-Leak: No Predictions, No AI Confidence**

Doc 05's surfaces are subject to the same anti-leak doctrine as the rest of Lyceon. The specific applications:

### **12.1 No predicted SAT scores**

Section projections (05C) are the only Doc 05 surface that resembles a "score." They MUST be framed as a current-state estimate with confidence bands, not as a predicted exam-day outcome. Product copy that consumes the projection MUST NOT say "you will score X on the SAT." It MAY say "based on your current evidence, your performance is in the X–Y range."

The projection's range width (governed by `projection_min_delta` / `projection_max_delta`) is explicitly an evidence-confidence indicator, not a prediction confidence indicator.

### **12.2 No AI-confidence overlays on mastery**

Mastery values are computed from a deterministic formula, not from a model. There is no "AI thinks you're at level 3" framing. The product copy MUST present mastery as a measurement: "you've answered X questions for this skill; your recency-weighted accuracy is Y%."

### **12.3 No probability-of-correctness scoring**

Mastery is not framed as "the probability that you'll get the next question right." Even though the formula has the mathematical shape of a weighted accuracy (which IS a probability estimate), the product surface MUST NOT use probability framing. This is a Doc 00 / Parent V3.0 §12 doctrinal commitment carried forward.

### **12.4 No tutor influence in mastery framing**

Mastery surfaces MUST NOT attribute mastery changes to tutor use, even informationally. "You went up after using the tutor" is forbidden because (a) the tutor did not cause the mastery change — the student's retry did, and (b) such attribution risks tutor dependency. Product copy that wants to celebrate tutor-helped improvement can do so via Doc 03 surfaces, not Doc 05 surfaces.

---

## **13\. Tutor Exclusion**

Restating with the full mechanism for clarity:

### **13.1 The tutor has no mastery write path**

The Doc 03 family does not call the Doc 05 mastery write boundary, directly or via any sub-route. CI enforces this with a grep guard. This is enforced at the application boundary AND at the database boundary (service-role-only writes per §6.1).

### **13.2 Tutor-helped retries are review events**

When a student answers a question correctly after using the tutor (in the review surface), the answer is a review event. It reaches Doc 05 with `source_family = 'review'`. The mastery contribution is the standard review-weighted contribution; no bonus is added because the tutor was used.

### **13.3 Tutor activity is audited separately**

Doc 03 owns the tutor audit trail. Doc 03 records the tutor session, the question discussed, and the subsequent retry. Doc 05's mastery audit trail records the retry's mastery contribution. Joining the two trails is an analytics-layer concern, not a Doc 05 concern.

### **13.4 The forbidden anti-pattern**

The following are forbidden:

* A tutor session writing directly to `student_skill_mastery`.  
* A tutor session emitting a "tutor\_helped" mastery event.  
* A "tutor\_confidence" or "AI\_assessed" boost to mastery.  
* A mastery formula that incorporates tutor usage as an input.

These patterns may have existed in legacy implementations; they are not part of V1.0.

---

## **14\. Audit Lifecycle Separation**

The Doc 05 family has its own audit trail. It is distinct from Doc 04D's exam audit trail. Confusing the two leads to data ownership ambiguity and broken governance.

### **14.1 What Doc 05 audits**

The Doc 05 audit trail (owned by 05D) records:

* Every mastery write boundary call (input parameters, mastery model version, resulting mastery value, service-role actor)  
* Every constants change (via the `constants_audit_log` table; per §9.4)  
* Every full-history recompute run (when, scope, count of rows touched, before/after totals)  
* Every admin replay-from-events invocation (who, scope, output)

### **14.2 What Doc 04D audits (NOT Doc 05\)**

The Doc 04D audit trail records:

* Exam runtime events (start, pause, resume, submit, abandon)  
* Scoring runs (`score_runs` lifecycle)  
* Reporting access (who viewed which report when)  
* Forbidden access attempts (the 403 security tier from Doc 04D V1.0 §11)

Doc 04D does NOT record mastery changes. Mastery changes derived from full-length completions are recorded in Doc 05's audit, not Doc 04D's.

### **14.3 The separation rationale**

Mastery and exam scoring are sibling concerns:

* Mastery is a longitudinal measurement that aggregates across event sources.  
* Exam scoring is a point-in-time computation tied to a specific test session.

Mixing the two audit trails would couple their lifecycles (e.g., a mastery formula change would appear in the exam audit, which is wrong), and would make access control harder (e.g., an analyst with mastery audit access shouldn't necessarily have exam audit access).

### **14.4 Cross-audit references are allowed**

A Doc 05 audit row that records a mastery change derived from a full-length completion MAY reference the corresponding `score_run_id` from Doc 04\. This is a cross-reference, not an audit-trail merge. The score run row in Doc 04D's tables is the source of truth for the scoring event; the mastery audit row in Doc 05D's tables is the source of truth for the mastery change.

---

## **15\. Read Surfaces and Consumer Contracts**

Doc 05 owns the persistence layer. It does not own the product UI. This section locks which consumers may read which surfaces.

### **15.1 Authorized read surfaces**

| Surface | Consumer |
| ----- | ----- |
| `student_skill_mastery` | Student dashboard (own data only), hexagon visualization, admin tooling |
| `student_domain_mastery` | Student dashboard, hexagon visualization, admin tooling, guardian dashboard (read-only via Doc 01 gate) |
| `student_section_projections` | Student dashboard, guardian dashboard, admin tooling |
| `student_kpi_counters_current` | Student dashboard (selected columns), admin tooling |
| `student_kpi_rollups_current` | Admin tooling, internal analytics |
| `student_kpi_snapshots` | Admin tooling, internal analytics, weekly digest emails (if any) |
| `mastery_constants`, `kpi_constants`, `constants_audit_log` | Admin tooling only |
| Doc 05 audit log (owned by 05D) | Admin tooling only |

### **15.2 Guardian access contract**

Guardian access to Doc 05 surfaces is governed by Doc 01's guardian trust model and is enforced at the route level, not in Doc 05 RLS policies. The Doc 05 contract is:

* Guardian sessions MAY read aggregated mastery (domain mastery, section projections) for a linked student.  
* Guardian sessions MAY NOT read per-skill mastery, per-question history, or raw KPI rollups.  
* Guardian sessions MAY NOT read mastery audit data.

The route layer enforces these distinctions. Doc 05 exposes the underlying tables; Doc 01 gates the routes that read them.

### **15.3 Forbidden read patterns**

The following are forbidden across all consumers:

* Reading `mastery_score` from `student_skill_mastery` and presenting it as a predicted score.  
* Reading multiple students' mastery in aggregate without explicit admin-tier authorization.  
* Reading the constants audit log from a non-admin surface.  
* Reading the Doc 05 audit log from a guardian surface.

---

## **16\. Out of Scope for V1.0**

Items explicitly NOT in Doc 05 V1.0. Each is enumerated to prevent scope creep and to anchor V1.1 planning.

| Item | Status |
| ----- | ----- |
| Asymmetric outcome weighting (wrong-answer penalty multipliers beyond standard weight) | V1.1 candidate. The base\_delta constants in the legacy `mastery_constants` table remain available for V1.1 reactivation. |
| Bayesian smoothing / cold-start priors (`ALPHA0`, `BETA0`) | V1.1 candidate. Currently NULL cold-start; V1.1 may introduce evidence-weighted shrinkage. |
| Tutor-helped retry distinguishing flag in mastery inputs | Permanently out of scope. Doc 03's audit owns tutor attribution; Doc 05 inputs do not distinguish tutor-helped from non-tutor-helped retries. |
| Cross-student mastery comparison surfaces (percentile rank, cohort placement) | V1.1+. Requires careful product framing to avoid anti-leak violations. |
| Mastery-based question recommendation (i.e., the practice engine reading mastery to pick next question) | Owned by Doc 02 (practice runtime), not Doc 05\. Doc 05 exposes mastery; Doc 02 consumes it. |
| Time-of-day / session-context features (e.g., "tested in morning vs evening") | Not in V1.0. Not currently planned for V1.1 either. |
| Per-question quality / calibration weighting beyond difficulty bucket | V1.1+. Requires content-side calibration infrastructure. |
| Streaming / real-time mastery updates on the client | Out of scope. The mastery write boundary fires server-side after answer commit; clients fetch updated mastery on the next read. |
| Predicted SAT scores | Permanently out of scope per Doc 00 / §12. |
| AI-confidence or model-output overlays on mastery | Permanently out of scope per Doc 00 / §12. |
| Direct full-length runtime emission of mastery events during live exam | Permanently out of scope per §6.5. |
| Guardian write access to any Doc 05 surface | Permanently out of scope per §6.1 and Doc 01\. |

---

## **17\. V1.1 Candidates**

Items that have been considered and may land in V1.1 with explicit version bump and audit trail. None of these are blockers for V1.0 lock.

| Candidate | Trigger to consider | Risk if unaddressed |
| ----- | ----- | ----- |
| Asymmetric outcome weighting | Production data shows V1.0 mastery values are systematically too forgiving (e.g., students who answer 50% correctly consistently show mastery values higher than 0.50) | Mastery is interpreted as more lenient than the test conditions warrant |
| Bayesian cold-start smoothing | Student feedback indicates cold-start NULL is confusing or jarring on first practice session | Cold-start UX feels broken |
| Per-skill confidence intervals on mastery | Product surfaces want a "this mastery is from a lot of evidence" vs "this mastery is from a little evidence" distinction | Currently captured only via `attempts` count in `student_skill_mastery` |
| Mastery-as-projection-input weight tuning | Section projection accuracy is poor against actual exam-day scores in beta cohort | Section projections are not predictive enough to be useful |
| Question quality / calibration weighting | Content team produces calibration data per question | High-noise questions affect mastery as much as well-calibrated ones |
| Multi-student / cohort mastery views | Tutor-program or school-account use case emerges | Currently no cross-student aggregation |

---

## **18\. Acceptance Criteria**

Doc 05 V1.0 is acceptable when all of the following are true. This is the gate for "Parent locked" status.

1. The mastery formula in §4 is documented with all parameter values from §10.  
2. The source family enum in §5 has exactly 3 values; flowcard normalization is documented.  
3. All 9 hard invariants in §6 are documented with their enforcement mechanism (RLS policy, CI grep guard, test, audit trigger).  
4. The bottom-up derivation contract in §7 is documented with all 8 layers and the transaction boundary.  
5. The determinism contract in §8 documents both write paths and the convergence test.  
6. Parameter versioning in §9 documents both constants tables, the active-version contract, and the audit trigger behavior.  
7. Canonical V1.0 parameter values are listed in §10 with their units, purposes, and storage locations.  
8. All 5 cross-doc seams (01, 02, 03, 04, internal) are documented in §11.  
9. Anti-leak rules in §12 are documented for projections, mastery framing, and tutor framing.  
10. Tutor exclusion mechanism in §13 is documented with the forbidden anti-patterns enumerated.  
11. Audit lifecycle separation in §14 distinguishes Doc 05 audits from Doc 04D audits.  
12. Read surfaces and consumer contracts in §15 are enumerated.  
13. Out-of-scope items in §16 are enumerated with status.  
14. V1.1 candidates in §17 are enumerated with triggers.  
15. Sub-doc ownership matrix in §3.1 is documented.  
16. Inter-sub-doc seams in §3.2 are documented.  
17. No item in Doc 05 Parent contradicts Doc 04 Parent V3.0, Doc 04A V2.2, Doc 04B V4.3, Doc 04C V1.0, or Doc 04D V1.0.  
18. No item in Doc 05 Parent references repo cleanup, migration remediation, or audit findings — Doc 05 is a clean-slate canonical spec.  
19. Guardian-accessible routes expose only domain mastery values and section projection aggregates. No guardian-accessible route exposes per-skill mastery rows, per-question rows, raw KPI rollups, KPI counters, or audit log rows. 05B and 05C MUST enforce this at the route layer; route tests MUST cover the denial paths. \<\!-- RB-05P-V1-12 \--\>  
20. Read surfaces exposed to student-role and guardian-role routes return only `mastery_level` (the integer 0–4) and entity identifiers (section, domain, skill). The numeric `mastery_score` (the 0–1 float) and `mastery_pct` (the 0–100 numeric) are admin/internal/audit-only and MUST NOT appear in student or guardian API responses. This enforces the anti-leak doctrine in §12 (no probability framing) at the read-surface level: students and parents see proficiency tiers, not probabilities. 05A, 05B, and 05C MUST enforce this at the row contract and route layer; route tests MUST cover the field exposure constraint. \<\!-- RB-05P-V1-14 \--\>

---

## **19\. Governance & Lock Process**

### **19.1 Owner**

Primary owner: Product \+ Engineering joint ownership, matching the Doc 04 family precedent.

Operational source-of-truth owner: Engineering maintains the alignment between Doc 05 contracts and the implemented mastery / KPI / projection surfaces.

### **19.2 Review trigger**

Doc 05 Parent MUST be reviewed when any of the following occur:

* Any Doc 05 sub-doc (05A, 05B, 05C, 05D) is added, renamed, or has its ownership boundary changed  
* The mastery formula's shape changes (e.g., asymmetric outcomes activated)  
* The source family enum changes (e.g., a new source added or removed)  
* A cross-doc seam changes (e.g., Doc 04 → 05 contract changes)  
* An invariant is added or weakened  
* A parameter versioning rule changes

### **19.3 Lock meaning**

"Locked" means:

* Doc 05 Parent is the authoritative source for the doctrine, seams, and family-wide invariants it covers  
* Sub-doc implementations MUST conform to Parent's locks  
* Changes to Parent require an explicit version bump and review  
* Silent drift between Parent and implementation is not allowed

Post-lock, additive clarifications MAY be applied within the lock cycle without a version bump, following the Doc 04 family precedent (e.g., Doc 04 Parent V3.0's in-lock-cycle cleanup). Behavior-changing edits require a version bump.

### **19.4 Sub-doc dependency**

Sub-docs 05A, 05B, 05C, 05D MAY NOT be locked while Parent is in draft status. Parent must be locked first. This matches the Doc 04 family sequence.

### **19.5 Implementation gate**

Doc 05 Parent locking is a prerequisite for any implementation work that depends on Doc 05 family contracts. Implementations that proceed before Parent is locked do so at their own risk and may require rework.

**Pre-implementation verification (05A's responsibility).** Before 05A implementation begins, 05A MUST verify the installed Supabase state against Parent V1.0:

1. The installed mastery RPC signature matches the contract 05A will define (or no RPC is installed yet, in which case 05A defines the canonical signature).  
2. The values in `mastery_constants` match Parent §10.1 (`POSITION_HALF_LIFE = 30`, `MIN_EVENTS_FOR_MASTERY = 5`, `weight_source_*` and `difficulty_weight_*` values).  
3. The `student_skill_mastery` row schema supports the V1.0 contract including `mastery_model_version` and `constants_snapshot_hash` columns per §9.5.

If the installed database state differs materially from Parent V1.0, 05A MUST define a controlled migration plan (constants seeding, schema changes, RPC replacement) and a recompute plan for any pre-existing mastery rows BEFORE production cutover. Implementing against a stale DB shape produces silent behavior drift and is forbidden. \<\!-- RB-05P-V1-11 \--\>

---

## **20\. Change Records**

| Version | Date | Author | Summary |
| ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-13 | Claude (drafted), Karl (locked) | V1.0 LOCKED. Mastery formula: macro-average across sources of per-source weighted accuracy, with position-based recency decay (POSITION\_HALF\_LIFE \= 30 events), numerator-only difficulty weights (easy=0.79, medium=1.0, hard=1.20), MIN(1.0, …) per-source clamp, and renormalization for missing sources. 5-event threshold (MIN\_EVENTS\_FOR\_MASTERY \= 5\) for an entity (skill or domain) before mastery is computed. Skill mastery and domain mastery computed independently from the underlying event stream (not as weighted averages of each other). Source weights 0.50 / 0.30 / 0.20 (test/practice/review). 5-tier mastery levels at 0.19 / 0.39 / 0.59 / 0.79. Canonical difficulty enum is 1-3 (not 1-5). 9 hard invariants, bottom-up derivation contract, determinism guarantee, parameter versioning, 5 cross-doc seams, audit lifecycle separation from Doc 04D. Legacy EMA-shape constants (`alpha`, `delta_*`), Bayesian-prior constants (`ALPHA0`, `BETA0`), and calendar-day decay (`HALF_LIFE_DAYS`) explicitly out of V1.0 scope. Formula validated via 22-scenario numerical stress test and external cross-validation against three independent formula proposals (Kish ESS / δ\_max-in-denominator / L-DWC with K constant). **In-lock-cycle cleanup applied** (no version bump per Doc 04 family precedent): 5 reviewer blockers (RB-05P-V1-01 §8.4 calendar-decay contradiction removed; RB-05P-V1-02 half-life prose off-by-one fixed; RB-05P-V1-03 Doc 04 seam corrected to `test_session_answers` join chain, post-finalization not post-scoring, no score\_run-success gate; RB-05P-V1-04 partial-section eligibility tightened to submitted-section-only, Module-1-only excluded; RB-05P-V1-05 "not pushed from event handlers" wording clarified) \+ 3 reviewer highs (RB-05P-V1-06 canonical 1-3 difficulty enum affirmed with explicit pushback on 1-5 model; RB-05P-V1-07 macro-average truth-anchor property documented as intentional design; RB-05P-V1-08 constants versioning tightened with `constants_snapshot_hash` per-row contract) \+ 2 reviewer mediums (RB-05P-V1-09 KPI rollups clarified as materialized derivatives; RB-05P-V1-10 status flip back to Draft for cleanup, then re-locked) \+ 4 extensions for items added during 05A pre-draft Q\&A (RB-05P-V1-11 05A pre-implementation RPC verification gate added; RB-05P-V1-12 guardian exposure constraint added to §18 acceptance criteria; RB-05P-V1-13 `DIAGNOSTIC_TOTAL_QUESTIONS` recomputed as `N_canonical_domains × MIN_EVENTS_FOR_MASTERY = 8 × 5 = 40` so a completed diagnostic clears per-domain threshold for every SAT domain; RB-05P-V1-14 acceptance criterion \#20 added locking student/guardian read surfaces to `mastery_level` only — `mastery_score` and `mastery_pct` are admin/internal/audit-only). |

---

## **Appendix A — Notation and Conventions**

| Notation | Meaning |
| ----- | ----- |
| `U` | Student identifier (`user_id` or `student_id` depending on the table; sub-docs disambiguate) |
| `S` | Skill identifier (a canonical SAT skill string per Doc 02\) |
| `D` | Domain identifier (a canonical SAT domain string per Doc 02\) |
| `E_{U,S}` | The set of canonical answer events for student U on skill S, sorted by `occurred_at` DESC with event\_id as tiebreaker |
| `e` | A single answer event |
| `i` | The 1-based position of event `e` within the sorted event history (i=1 is the most recent) |
| `occurred_at(e)` | The timestamp at which the answer was given (NOT when the write fired); used only for ordering, NOT as a formula input |
| `correct(e)` | Boolean outcome of event e; `{0, 1}` when used in formula sums |
| `position_weight(i)` | `0.5 ^ ((i - 1) / POSITION_HALF_LIFE)` — recency weight as a function of event position, not wall-clock age |
| `difficulty_weight(e)` | One of `{0.79, 1.0, 1.20}` per the locked difficulty bucket of the event's question |
| `source_family(e)` | One of `{test, practice, review}` |
| `acc_s` | Per-source weighted accuracy for source family `s` (see §4.1 Step 3\) |

`[a, b]` denotes an inclusive interval. `(a, b)` denotes an exclusive interval. `{a, b, c}` denotes an enumerated set.

**Note on time:** the V1.0 formula has no `T_now`, `age_days`, or wall-clock dependence outside event ordering. Earlier drafts referenced these terms; they are removed per RB-05P-V1-01. \<\!-- RB-05P-V1-01 \--\>

---

## **Appendix B — Cross-Reference Index**

| Reference | Resolves to |
| ----- | ----- |
| "The canonical mastery formula" | §4.1 |
| "The 9 hard invariants" | §6.1 through §6.9 |
| "The bottom-up derivation contract" | §7 |
| "The determinism guarantee" | §8.1, §8.2 |
| "Parameter versioning" | §9 |
| "V1.0 canonical parameter values" | §10 |
| "Doc 04 → 05 seam" | §11.4 |
| "Tutor exclusion" | §13, §6.4 |
| "Audit lifecycle separation" | §14 |
| "Sub-doc ownership matrix" | §3.1 |
| "Family-wide naming convention" | §3.3 |
| "Out of scope for V1.0" | §16 |
| "V1.1 candidates" | §17 |

---

*End of Doc 05 Parent V1.0.*

