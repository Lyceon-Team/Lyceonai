# **Lyceon — Document 04B: Full-Length Exam Scoring Formula & Infrastructure (V4.3)**

**Version:** 4.3
**Last Updated:** 2026-05-12
**Status:** Reviewer-Cleanup Pass — Scoring Formula Locked as v1.0 (canonical, immutable, bit-exact unchanged from V4 → V4.1 → V4.2 → V4.3); Catalog schema split (`constants_sha256` ≠ `validation_packet_sha256`); `scoring_constants` immutability extended to INSERT; Single-active-version race fixed via partial unique index; Version-validation gate added at orchestrator entry; Validation packet supplemented with 60 targeted difficulty-distribution fixtures
**Owner:** Founder / CTO Review
**Governed By:** Document 00 (Authoritative Platform Directive), Document 04 Parent (V3.0 pending; this V4.3 is canonical for the scoring architecture Parent V3.0 will absorb)
**Depends On:** Document 04A V2.1 locked (Exam Runtime & Session State; V2.2 pending to remove `form_equating_offset` and pin `score_table_version` to `scoring_model_versions` FK), Document 02 series (Question Bank & Canonical Content), Document 01 (Identity & Entitlement; `current_student_id()` / `is_admin()` coordination gap), Document 05 (Mastery Engine — not yet drafted; out of 04B scope per §16), Supabase PL/pgSQL, Neon Postgres
**Applies To:** All full-length adaptive SAT exam scoring computation, scoring constants management, anti-leak comparator logic, score persistence, scoring idempotency, scoring observability, and disclosure surfaces for student-facing scaled scores. Mastery emission is **out of 04B scope** as of V4.2; the canonical answer tables are the source-of-truth feedstock for any future mastery consumer (Doc 05's design when drafted).

**Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY follow RFC 2119.

---

# **Table of Contents**

1. Purpose and Mission
2. Scope and Out-of-Scope
3. Inheritance from Doc 00, Doc 04 Parent, and Doc 04A
4. Supersession and Relationship to Prior Versions
5. Architectural Decisions and Their Justifications
6. **The Scoring Formula (Locked v1.0 — Canonical, Immutable)**
7. Scoring Model Versioning and the Form Anchor
8. Constants Doctrine
9. Database Schema
10. Anti-Leak Comparator Doctrine
11. The Canonical Scoring Function
12. The Scoring Orchestrator and Idempotency
13. Module Composition Validation and Form Publish Gate
14. The Doc 04A → 04B Consumer Seam
15. Partial-Scoring Path
16. Mastery Sourcing (No Emission from 04B)
17. Disclosure to Students
18. Validation and Calibration Approach
19. Failure Modes
20. Observability and Audit
21. CI / Testing Standards
22. Known Architectural Debt
23. Change Control
24. Verification Before Refactor Checklist
25. Cross-Document Dependencies
26. Final Principles
27. Change Records
28. Worked Examples
29. Appendix A — Scoring Constants Catalog (v1.0)
30. Appendix B — Validation Evidence Packet Reference
31. Appendix C — Supersession of V1, V2, V3, V4, V4.1, V4.2
32. Appendix D — V4.2 → V4.3 Change Map

---

# **1. Purpose and Mission**

## **Purpose**

Lyceon's full-length adaptive SAT exam scoring layer is the moment of truth for the platform. Every input — authentication, routing, item presentation, answer submission — funnels into a single number per section and a single combined number that the student will compare to their target score, to other students, to their parent's expectations, and ultimately to the actual College Board (CB) exam they will take.

This document governs how that number is computed. It locks the formula as canonical v1.0 — immutable, never to be altered without a structural redesign and explicit Founder/CTO approval. It locks the constants used by that formula at launch. It governs every piece of infrastructure that surrounds the formula: the database schema that persists scores, the PL/pgSQL function that computes them, the anti-leak comparator that prevents correct-answer leakage during scoring, the idempotency mechanism that prevents duplicate scoring on retry, the model-version anchor that pins each score to a specific scoring profile, and the disclosure language that frames the score to the student.

V4.3 differs from V4.2 in eight cleanup areas all driven by reviewer pushback: (a) `scoring_model_versions` catalog schema splits the previously-overloaded `constants_sha256` into three distinct fields (constants hash, validation packet hash, validation packet URL); (b) `scoring_constants` immutability extends to INSERT so new rows cannot be slipped into active/superseded versions; (c) single-active-version enforcement uses a partial unique index rather than a race-prone trigger check; (d) an explicit version-validation gate runs at the orchestrator entry point before any scoring work; (e) §18.1 statistics are synced exactly to the regenerated evidence packet; (f) "exhaustive sweep" wording is tightened to reflect the (r1, r2) × proportional-distribution boundary, and 60 targeted difficulty-distribution fixtures are added to the evidence packet for non-proportional coverage; (g) §21.2 CI requirements are softened — no per-deploy Python↔PG parity bottleneck, since the formula is locked-and-immutable in Supabase RPC post-launch per §23 Tier 3 governance; (h) §16 / §25 Doc 05 language is softened — the architectural commitment (no mastery emission from 04B) stands, but specific consumer-design language for the not-yet-drafted Doc 05 is removed. The formula itself remains bit-exact unchanged.

## **Strategic Mission**

The scoring formula is Lyceon's moat. It is the canonical interpretation of student performance that everything downstream — mastery, readiness, study plans, guardian reports, KPIs — depends on. Changing the formula breaks every downstream signal. Therefore the formula is treated as immutable load-bearing infrastructure: locked at v1.0 with bit-exact reproducibility, validated against an industry benchmark, deployed identically across PL/pgSQL production and a reference Python implementation, and never modified except through an explicit structural redesign that produces a new version.

The infrastructure around the formula is allowed to evolve. The formula itself is not.

## **Why This Matters**

Scoring is the most visible product output, the most easily-attacked surface for correctness regressions, and the most easily-attacked surface for answer leakage. A scoring bug that under-scores 5% of students by 50 points is invisible to the engineer who shipped it and devastating to the students who experienced it. A scoring path that serializes a correct answer through application code creates a leak vector that propagates through logs, error traces, observability tooling, and cached responses.

V4.2 hardens both surfaces. The formula is bit-exact, version-pinned, and round-half-up-deterministic across languages. The math runs entirely inside Postgres so correct answers never cross into application code. The persistence path is insert-once and enforced at the database permission layer — direct INSERT is revoked at the table level, and the canonical scoring function is the only write path with EXECUTE granted to service_role alone. The consumer pattern from Doc 04A's outbox is idempotent against retry without depending on application-layer dedup. Mastery and scoring are decoupled: scoring writes `score_runs` and the ledger and nothing else; Doc 05's mastery engine sources from canonical answer tables independently.

---

# **2. Scope and Out-of-Scope**

## **In Scope**

The canonical scoring formula and its constants. The `scoring_constants` and `scoring_model_versions` DB tables. The `score_runs` table and its insert-once invariant. The `score_run_event_ledger` for orchestrator idempotency. The canonical PL/pgSQL function `compute_section_scaled_score` and its scoring helpers. The canonical answer-comparator function `is_answer_correct`. The difficulty-bucket schema on canonical questions (easy/medium/hard) per Doc 02. The per-module question distribution requirements enforced at form-publish time. The path floor and ceiling floor mechanics. The Module 2-only deduction model. The rounding rule. The audit trail produced on scoring including intermediate value capture and constants snapshot. The disclosure language displayed to students adjacent to scaled scores. The validation methodology used to lock v1.0 and the calibration methodology that will refine constants post-launch. The consumer-pattern integration with Doc 04A's `exam_runtime_outbox`. The partial-scoring path that handles abandoned sessions whose at-least-one section reached submitted state.

**Out of 04B scope as of V4.2:** Mastery emission. V4.1 included mastery_outbox event production from inside the scoring transaction; V4.2 removes that entire path. Mastery is sourced from canonical `test_session_answers` by Doc 05's engine, independent of scaled scoring success (see §16).

## **Out of Scope**

The full-length exam runtime including session lifecycle, module routing decision logic at runtime, item presentation, answer submission protocol, timer enforcement, and resume semantics — owned by Doc 04A. The mastery model that consumes the events emitted here — owned by Doc 05. The guardian-visible and student-visible score display surfaces — owned by Doc 04C. The integrity and audit layer including answer reuse detection and proctoring — owned by Doc 04D. The KPI and analytics aggregation — owned by Doc 09. The content authoring process that produces questions with assigned difficulty values and the canonical correct_answer/correct_variants — owned by Doc 02A. The IRT migration path and per-item parameter calibration — explicitly deferred post-launch and not in v1.0 scope.

---

# **3. Inheritance from Doc 00, Doc 04 Parent, and Doc 04A**

## **3.1 Inheritance from Doc 00**

Particularly load-bearing for scoring:

- **Server-authoritative mutations.** Scoring runs server-side via a PL/pgSQL function. No client-side scoring exists.
- **Single canonical writer per table.** The scoring function is the only writer to `score_runs` for student-facing scaled scores.
- **No client role trust.** Scoring requires a server-resolved authenticated context. The function does not accept a `student_id` parameter that overrides the session-derived identity.
- **No data leakage.** Correct answers never serialize to application code on the scoring path. The comparator and the scoring math both run in PL/pgSQL with correct answers staying inside the database transaction boundary.
- **Auditable flow.** Every scored test produces a `score_runs` row plus a `score_run_event_ledger` row plus structured logs. Mastery updates are sourced independently by Doc 05 from canonical answer tables (§16).
- **Determinism.** Given identical inputs (same answers, same questions, same form, same scoring model version), scoring MUST produce identical outputs. The Python reference implementation and the PL/pgSQL production implementation MUST produce bit-exact identical scaled values for any given input.

## **3.2 Inheritance from Doc 04 Parent**

- **Tests are the truth anchor.** Full-length exam scoring outweighs practice-level signals in mastery and readiness computation. Scoring must therefore be conservative, defensible, and stable.
- **Forms are immutable once published.** A published form's question composition, routing thresholds, score table version, and timing parameters cannot change. Scoring computed against a published form remains valid even if the form is later archived.
- **Path is recorded, not re-derived.** Once a student is routed to Module 2A or 2B during the exam runtime, that path is persisted by Doc 04A on `test_session_sections.module2_path`. Doc 04B reads the recorded path; it does not re-derive routing.

## **3.3 Inheritance from Doc 04A V2.1 locked (V2.2 pending)**

This is the load-bearing alignment that V4 missed. Doc 04A V2.1 specifies the actual schema and event mechanism that scoring consumes. Doc 04B V4.3 conforms to it without exception.

**Pending 04A V2.2 changes derived from V4.2:** Two non-blocking realignments are flagged into Doc 04A V2.2 (drafted after V4.2 locks):

1. `test_forms.form_equating_offset` is RETIRED. The 3-layer scaling architecture (per-section/per-path raw→scaled curves + routing thresholds + form-equating offsets) from Parent V2.0 is retired alongside V4.2. The V4.2 formula's difficulty-weighted M2 deductions (D_e=15, D_m=9, D_h=6) provide implicit per-form reweighting through the difficulty distribution of M2 wrong answers; a form with systematically harder M2 questions produces appropriately lower scores via the deduction structure without a hidden additive offset. Form-level calibration migrates to (a) `routing_threshold_rw` / `routing_threshold_m` tuning for routing-level drift, or (b) pinning a different `scoring_model_version` for systematic recalibration. This honors the "formula is canonical and immutable" doctrine: two forms with the same `scoring_model_version` MUST produce identical scaled scores from identical raw answers.

2. `test_forms.score_table_version text NOT NULL` becomes a FK reference to `scoring_model_versions(version)`. V4.2 introduces the catalog table; 04A V2.2 enforces the FK constraint and updates the immutability trigger to reference the catalog row.

**V4.2 reads from 04A V2.1 schema as-currently-published; V4.2 ignores `form_equating_offset` as a no-op pending V2.2's column removal.**

**Schema references Doc 04B reads (canonical names from 04A V2.1):**

- `test_forms(id, score_table_version, routing_threshold_rw, routing_threshold_m, ...)` — published form record. `score_table_version` is the version anchor for scoring; `routing_threshold_rw` and `routing_threshold_m` are the routing thresholds for this form. `form_equating_offset` is present in V2.1 but V4.2 ignores it (retired pending V2.2 removal).
- `test_form_items(test_form_id, section, module, ordinal, question_id)` — canonical question membership per form. The set of presented questions for a session is deterministic from the form ID, section, and Module 2 path.
- `test_sessions(id, student_id, test_form_id, state, mode, ...)` — session header. `state` reaches `completed` or `partial_scored_abandoned` before scoring.
- `test_session_sections(test_session_id, section, state, module2_path, module1_submitted_at, module1_submitted_by, module2_submitted_at, module2_submitted_by, ...)` — per-section state and the locked routing decision in `module2_path`.
- `test_session_answers(test_session_id, section, module, ordinal, question_id, answer, last_submission_id, ...)` — canonical answer state. `module` is text in `{'1','2A','2B'}`. `answer` is the submitted value. **Missing rows for presented questions count as wrong** (V4.2 §11.2 LEFT JOIN pattern enforces this).
- `exam_runtime_outbox(id, event_type, aggregate_id, payload, status, ...)` — transactional outbox from which the scoring consumer reads. V4.2 reads from canonical tables; the `payload` field is treated as advisory metadata only.

**Section state values Doc 04B trusts:**

A section is scoreable when `test_session_sections.state = 'submitted'`. The Doc 04A state machine guarantees:

- `submitted` means: both modules have been submitted (by student or timeout), `module2_path` is locked, all answer state is final.
- Sections in any other state (`not_started`, `module1_active`, `module1_submitted`, `module2_active`) are NOT scoreable. The scoring path MUST skip them.
- **Submit-completes-even-with-unanswered:** A student who submits a module without answering all questions transitions the section state legitimately. Unanswered presented questions have no `test_session_answers` row; V4.2's scoring path treats them as wrong via the `test_form_items LEFT JOIN test_session_answers` pattern.

**Event types Doc 04B consumes from 04A's outbox:**

- `test_session_completed` — both sections reached `submitted`. Scoring computes both sections.
- `test_session_partial_scored_abandoned` — at least one section reached `submitted` but the session timed out before completion. Scoring computes only the sections that reached `submitted`; the other section's columns in `score_runs` are NULL, and `total_scaled` is NULL (V4.2 §15.2).

**Module value semantics from 04A:**

`module` is text, not integer. Values are `'1'` (Module 1) and `'2A'` / `'2B'` (Module 2 path-specific). All scoring queries that filter by module MUST use these text values.

---

# **4. Supersession and Relationship to Prior Versions**

V4.3 supersedes V4.2 (which itself superseded V4.1, V4, V3, V2, V1). Appendix C catalogs all prior versions' retired elements. Appendix D enumerates the V4.2 → V4.3 deltas in change-map format.

**The formula did not change between V4 → V4.1 → V4.2 → V4.3.** It is locked, canonical, and bit-exact. Every constant value, every coefficient, every step of the math is identical across these versions. The Python reference implementation produces bit-identical results across all four versions for every input where the rounding rule yields the same output; on the 28 input scenarios that land exactly on `.5` (half-cases), V4.2 introduced the explicit round-half-up rule that V4.3 preserves unchanged. V4.3 changes the infrastructure surrounding the formula — catalog schema, immutability triggers, validation gate, evidence packet contents, CI framing, Doc 05 language — but does not touch the math.

**What changed between V4.1 and V4.2:** the rounding rule is pinned explicitly (§6.3); the math section code mapping bug is fixed (§11.2); the missing-answer counting path is corrected to LEFT JOIN from `test_form_items` (§11.2); `scoring_model_versions.published_at` becomes nullable to support candidate workflow (§7.2); `scoring_constants` gains a mutation-prevention trigger for active/superseded versions (§8.4); `total_scaled` is NULL for partial scoring runs (§15.2); the entire §16 mastery-outbox emission machinery is removed (mastery now sources from canonical answer tables per Doc 05); `score_runs` permissions tightened to revoke direct INSERT and gate writes through function EXECUTE (§9.4); `scoring_constant()` raises explicit exceptions on missing lookups (§8.2); SECURITY DEFINER ownership pinned to a dedicated service role (§11.1, §12.1); `form_equating_offset` retired (§3.3); validation evidence packet regenerated with the new rounding rule and the documented hash is reproducible (§18.2, Appendix B).

The formula remains the moat. Everything around it has been hardened to industry-standard implementation discipline.

---

# **5. Architectural Decisions and Their Justifications**

## **5.1 The formula is canonical and immutable at v1.0**

The scoring formula in §6 is locked. It cannot be modified by constants tuning, by post-launch calibration, by an experiment harness, by an A/B test, by an admin tool, by support, or by an emergency hotfix. Modifying the formula requires:

1. Designating a new scoring model version (e.g., v2.0)
2. A new document version (V5+ of this document) that defines v2.0
3. Founder/CTO approval and explicit re-validation
4. A new `scoring_model_versions` row published
5. A coordinated form-republish cycle to attach forms to the new version
6. A communication plan for students whose scores would differ between versions

The formula at v1.0 is the platform's canonical interpretation of student performance. Treating it as load-bearing infrastructure is the only way mastery, readiness, KPIs, and study plans downstream can rely on it.

## **5.2 No IRT at launch**

CB's actual DSAT scoring uses Item Response Theory with per-item parameters: difficulty `b`, discrimination `a`, guessing probability `c`. Calibrating these parameters reliably requires roughly 200 to 1,000 student responses per item. Lyceon has zero students at launch. V1.0 uses three discrete difficulty buckets (easy / medium / hard) assigned by content authors at question creation time.

Post-launch IRT migration is possible but lives in a future scoring model version (v2.0+), not as a tunable constant within v1.0.

## **5.3 Three difficulty buckets, not item-level weights**

Every question carries one of three difficulty values. The scoring formula treats every "easy" question identically, every "medium" identically, every "hard" identically. CB's IRT model gives each item a unique scoring weight; Lyceon does not. This is a deliberate simplification, tractable for content authoring and bounded for post-launch calibration.

## **5.4 No experimental / pretest items**

Real DSAT includes 4 unscored pretest items per section. Lyceon does NOT include experimental items at launch. Every question shown is scored. If experimental items are introduced in a future version, that change belongs in v2.0+, not as a v1.0 constants tuning.

## **5.5 Continuous Module 1 ceiling, not discrete path math**

The formula uses Module 1 raw correct count as a *continuous* ceiling-shaper rather than a discrete path multiplier: `ceiling = max(430, 800 · (r₁/N₁)^0.5)`. This produces a smooth ceiling that rises with Module 1 performance.

The path (recorded by Doc 04A on `test_session_sections.module2_path`) is read by Doc 04B for floor selection (Path B has a different floor than Path A) but is not used as a hard multiplier in the ceiling math.

## **5.6 Deductions apply only to Module 2 wrong answers**

Module 1 errors lower the ceiling via the continuous power function. They do NOT additionally subtract from the score. Otherwise Module 1 errors would be counted twice.

Module 2 errors apply as point deductions from the M1-determined ceiling. M1 sets the range, M2 places the student within it.

## **5.7 No penalty for wrong vs. blank**

The comparator `is_answer_correct` returns boolean. A NULL submitted answer and a wrong submitted answer both evaluate to "not correct." There is no negative-points mechanic. Deductions are framed as "you did not earn the points available on this question," not as "you lost additional points for being wrong."

This preserves the correct test-taking strategy on the real DSAT (always guess) and prevents Lyceon from training students into a wrong habit.

## **5.8 Asymmetric difficulty weighting — easy worth more than hard**

Deduction weights: easy = 15, medium = 9, hard = 6. Missing a wrong easy Module 2 question costs more scaled-score range than missing a hard one. Ratio approximately 2.5:1 (Applerouth-confirmed direction for CB's IRT asymmetry). Single-miss magnitudes are smaller than Applerouth's reported magnitudes because linear scoring cannot replicate IRT's non-linear top-of-scale behavior; the direction is preserved, the absolute magnitudes are calibrated for sensible aggregation across a full Module 2.

## **5.9 Banded ceiling — minimum 430**

A student with very low Module 1 performance has a mathematically computed ceiling below 200 via the power function. Without a floor on the ceiling itself, such students cannot recover even with strong Module 2A.

V1.0 bands the ceiling at 430: `ceiling = max(430, 800 · (r₁/N₁)^0.5)`. The value 430 was chosen against the Test Ninjas adaptive DSAT score calculator, a widely-referenced third-party benchmark. A student with raw 27 (the 0/27 M1 + 27/27 M2A target case) hits exactly 430.

## **5.10 Raw-percent floor — protection for mid-range Path A students**

A mid Path A student has a banded ceiling near 430, then loses ~200 points to deductions, ending around 230 before the floor. Without the raw-percent floor, the formula systematically under-scores 40% of low-mid Path A scenarios.

V1.0 adds: `raw_floor = 200 + 400 · (r₁ + r₂) / N_total`. This is the lower bound below which a student cannot fall regardless of M1-vs-M2 distribution.

## **5.11 Path B floor scales with Module 1 margin**

Routing to Path B (Module 1 raw ≥ T) is itself evidence of baseline ability. CB-reported and community-reported Bluebook data both suggest Path B students rarely score below ~450 even when they collapse on Module 2B.

V1.0 implements: `path_b_floor = min(580, 450 + 15 · (r₁ - T))`. At the threshold, the floor is 450. Each additional Module 1 correct lifts the floor by 15 points, capped at 580.

## **5.12 The math runs in PL/pgSQL**

All scoring computation runs inside Postgres. This includes the comparator, the ceiling computation, the deduction sum, the floor evaluation, and the rounding. The function accepts a `session_id` and returns the scaled score(s). Correct answers never cross out of the database into application code.

## **5.13 Routing thresholds live on `test_forms`, not in `scoring_constants`**

Per Doc 04A's locked schema, `test_forms.routing_threshold_rw` and `test_forms.routing_threshold_m` are form-level properties. Each form pins its own routing thresholds. Even at MVP where every form has the same threshold values, scoring reads the threshold from the form record, not from a platform-global constants table.

This means `scoring_constants` does NOT contain `routing_threshold` rows. The threshold is part of the form contract, not the scoring model.

## **5.14 The form pins the scoring model version**

`test_forms.score_table_version` is the canonical link between a form and the scoring model that scores it. Per Doc 04A, this column is set at form-publish time and is immutable. The scoring function reads `test_forms.score_table_version` for the session's form, looks up the corresponding `scoring_model_versions` row, and uses its constants snapshot.

This is the cleanest version anchor possible: the form embeds its version. There is no ambiguity about which scoring model applies to a given score.

## **5.15 Constants live in the database, not in code**

All scoring constants — α, deduction weights, floor values, ceiling band — live in the `scoring_constants` table. The scoring function reads constants at execution time. Post-launch calibration that produces a v2.0 publishes a new `scoring_model_versions` row with new constants. The v1.0 constants remain unchanged.

## **5.16 Append-only insert-once score_runs, enforced at the DB permission layer**

A student's score for a given test session is computed exactly once. The `score_runs` row is inserted by the scoring function and is never updated. Insert-once is enforced by:

1. PostgreSQL grants: `REVOKE UPDATE, DELETE ON score_runs FROM authenticated, anon`
2. A BEFORE UPDATE/DELETE trigger that raises an exception on any attempt
3. RLS policies that block update/delete at the row level

Three layers of enforcement because the invariant is load-bearing for downstream mastery and report consistency.

## **5.17 Idempotency via Stripe-style event ledger, orchestrator-only**

The scoring orchestrator is idempotent via an event ledger keyed on `outbox_event_id`. The ledger is checked exactly once at the orchestrator entrypoint. The section-level computation function has no idempotency logic — it is a pure computation that the orchestrator may call multiple times in a single transaction without consequence.

## **5.18 Mastery sources from canonical tables, not from 04B (V4.2)**

V4.2 removes mastery emission from 04B entirely. Mastery is computed by Doc 05's engine reading directly from `test_session_answers JOIN questions` (skill, difficulty, pass/fail per question) on the section-submit boundary owned by 04A. Scaled scoring success is independent: a partial test can update mastery without ever producing a fully-scored `score_runs` row, and a scoring failure does not block mastery.

The scoring transaction commits exactly two artifacts: the `score_runs` row and the `score_run_event_ledger` row. No external calls, no mastery emission, no fan-out within the scoring transaction. This simplifies the failure surface and honors the principle that scoring and mastery are independent computations sharing the same canonical answer feedstock.

## **5.19 Partial-scoring path is first-class**

A session that abandons after at least one section reached `submitted` produces a partial score_run: the submitted section is scored, the unsubmitted section is null. The 04A → 04B integration handles both `test_session_completed` (both sections scored) and `test_session_partial_scored_abandoned` (one section scored) via the same consumer path.

This is not a special case bolted on; it is the canonical pattern. The `score_runs` schema has nullable section columns to support it. `total_scaled` is NULL for partial; `partial_display_scaled` carries the single-section value for 04C convenience (§9.1).

---

# **6. The Scoring Formula (Locked v1.0 — Canonical, Immutable)**

This section is the canonical specification of the v1.0 scoring formula. The formula is bit-exact and reproducible. The Python reference implementation in the validation evidence packet (Appendix B) and the PL/pgSQL production implementation in §11 MUST produce identical scaled values for any given input.

## **6.1 Per-section computation**

For each section in `{'rw', 'math'}`, given:

| Symbol | Definition | Source |
|---|---|---|
| `r₁` | Module 1 correct count | Computed from `test_session_answers` joined to canonical question correctness |
| `r₂` | Module 2 correct count | Computed from `test_session_answers` joined to canonical question correctness |
| `N₁` | Module 1 total questions | 27 for RW, 22 for Math (from `test_form_items` per form) |
| `N_total` | Section total questions | 54 for RW, 44 for Math (from `test_form_items` per form) |
| `T` | Routing threshold | From `test_forms.routing_threshold_rw` or `routing_threshold_m` |
| `n_e^M2`, `n_m^M2`, `n_h^M2` | Module 2 wrong counts by author-assigned difficulty | Computed from M2 answers and `questions.difficulty` |

And constants (from `scoring_constants` for the active scoring model version):

| Symbol | v1.0 Value |
|---|---|
| `α` (ceiling exponent) | 0.5 |
| `C_floor` (ceiling band floor) | 430 |
| `C_max` (scale ceiling) | 800 |
| `D_e` (easy deduction) | 15 |
| `D_m` (medium deduction) | 9 |
| `D_h` (hard deduction) | 6 |
| `R_base` (raw-floor base) | 200 |
| `R_mult` (raw-floor multiplier) | 400 |
| `F_A` (Path A floor) | 200 |
| `F_B_base` (Path B floor base) | 450 |
| `F_B_bonus` (Path B floor bonus per M1 margin) | 15 |
| `F_B_cap` (Path B floor cap) | 580 |
| `R_round` (rounding unit) | 10 |

The formula is:

```
ceiling     = max(C_floor, C_max · (r₁ / N₁)^α)
deductions  = D_e · n_e^M2 + D_m · n_m^M2 + D_h · n_h^M2
S_raw       = ceiling − deductions

raw_floor   = R_base + R_mult · (r₁ + r₂) / N_total

if r₁ ≥ T:
    path_floor = min(F_B_cap, F_B_base + F_B_bonus · (r₁ − T))
else:
    path_floor = F_A

floor       = max(raw_floor, path_floor)
S_clamped   = max(floor, min(C_max, S_raw))
S_scaled    = round_to_nearest(R_round, S_clamped)
```

## **6.2 Section total**

```
total_score = scaled_rw + scaled_math    (when both sections scored)
total_score = NULL                       (when only one section scored — partial)
```

For full scoring (both sections), the total naturally falls in 400-1600 and is persisted in `score_runs.total_scaled`. For partial scoring (only one section completed), V4.2 §9.1 stores `total_scaled = NULL` and uses `partial_display_scaled` (200-800) as the single-section convenience field. 04C surfaces the single section's value (sourced from `partial_display_scaled` or directly from the section-specific `rw_scaled` / `math_scaled` column) with disclosure framing that the other section was abandoned. Downstream consumers (analytics, support, leaderboards) MUST NOT mix `total_scaled` with single-section values.

## **6.3 Rounding rule (V4.2 — pinned for cross-language bit-exact parity)**

**Rule:** Round half up to the nearest 10.

For any clamped value `x` in `[200, 800]`, the rounded scaled score is the smallest multiple of 10 that is greater than or equal to `x` when `x mod 10 ≥ 5`, and the largest multiple of 10 that is less than or equal to `x` when `x mod 10 < 5`. Half-cases (`x mod 10 = 5.0` exactly) round up.

This rule is implemented identically in both languages. The two implementations MUST produce bit-exact identical output for all valid inputs:

```sql
-- PL/pgSQL (production)
v_scaled := (floor((v_s_clamped + 5) / 10) * 10)::int;
```

```python
# Python reference
import math
return int(math.floor((s_clamped + 5) / 10) * 10)
```

**Why this rule, not the V4.1 ambiguous specification:**

V4.1 §6.3 specified `round(s_clamped / 10) * 10` in Python and `ROUND(s_clamped / 10.0) * 10` in PL/pgSQL. These appear identical but differ at exact `.5` cases: Python's built-in `round()` uses banker's rounding (round-half-to-even), while PostgreSQL's `ROUND` on `numeric` rounds half-away-from-zero. For inputs in the scoring range `[200, 800]` where the half-case fraction is always positive, this difference manifests on exactly 28 of the 1,313 validation sweep scenarios — bit-exact parity claims could not be honored under the V4.1 specification.

V4.2 pins a single deterministic rule that both implementations honor identically. V4.3 uses round-half-up because it is deterministic across Python and PostgreSQL, intuitive at boundaries (a `.5` always rounds up rather than toggling based on parity), and matches the production PL/pgSQL implementation bit-exactly. The V4.2 doc claimed College Board's published score tables also round half up; V4.3 retires that claim as unsourced. The rationale stands on determinism and language-parity grounds alone.

**Worked examples of the rounding rule:**

| Input `s_clamped` | `(s + 5) / 10` | `floor(...)` | × 10 = scaled |
|---|---|---|---|
| 554.999 | 55.9999 | 55 | 550 |
| 555.000 | 56.0000 | 56 | 560 |
| 555.001 | 56.0001 | 56 | 560 |
| 423.1 | 42.81 | 42 | 420 |
| 601.8 | 60.68 | 60 | 600 |
| 769.8 | 77.48 | 77 | 770 |
| 200.0 | 20.50 | 20 | 200 |
| 800.0 | 80.50 | 80 | 800 |

**Validation impact:** Re-running the 1,313-scenario validation sweep under the V4.2 rounding rule produces the following stat shifts relative to V4.1:

- Within 30 scaled points: 70.8% → **71.1%** (+0.3 pp)
- Within 50 scaled points: 84.2% → **83.9%** (−0.3 pp)
- Within 100 scaled points: 98.2% → **98.2%** (unchanged)
- In Test Ninjas band: 37.8% → **37.8%** (unchanged)

Both formal acceptance thresholds (70%+ within 50, 95%+ within 100) remain satisfied. The current evidence packet hash is `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b` (see Appendix B; reproducible via the `compute_packet_hash()` function in `validation_sweep.py`).

## **6.4 The complete formula in one expression**

For audit purposes, the per-section formula as one expression:

```
scaled = round_to_10(
    max(
        max(
            200 + 400 · (r₁ + r₂) / N_total,
            (r₁ ≥ T) ? min(580, 450 + 15 · (r₁ − T)) : 200
        ),
        min(
            800,
            max(430, 800 · (r₁/N₁)^0.5) − 15·n_e^M2 − 9·n_m^M2 − 6·n_h^M2
        )
    )
)
```

## **6.5 What the formula does NOT do**

The formula does NOT:

- Apply different constants based on form (the form determines composition and routing threshold, not the deduction weights or α)
- Apply different constants based on section (RW and Math use identical constants; only `N₁`, `N_total`, and `T` differ per section)
- Apply different constants based on path (path affects floor selection only)
- Take into account question-level discrimination beyond the three difficulty buckets
- Take into account time-on-question or response patterns
- Apply experimental-item exclusion (there are no experimental items in v1.0)
- Re-weight based on question topic / domain / skill
- Use any non-deterministic input (no randomness, no timestamp-dependent behavior)

## **6.6 Why this shape works**

The formula has four moving parts:

1. The **banded ceiling** rises with Module 1 performance and cannot drop below 430. A student demonstrating ability in Module 1 unlocks higher possible scores; a student who bombs Module 1 still has a recoverable upper bound if Module 2A is strong.

2. The **Module 2 deductions** erode the ceiling based on wrong-answer count weighted by difficulty. Easy wrong answers cost more than hard wrong answers (the Applerouth-confirmed asymmetry direction).

3. The **raw-percent floor** protects students whose total raw correct count is non-trivial. It rises linearly with the fraction of total questions correct.

4. The **path-aware floor** rewards routing to Path B as evidence of baseline ability. It scales with Module 1 margin above threshold.

The maximum of the two floors is taken, then the deduction-adjusted ceiling, then capped at 800, then rounded.

---

# **7. Scoring Model Versioning and the Form Anchor**

## **7.1 The version anchor**

Every scaled score in `score_runs` is pinned to a specific scoring model version. The pinning comes from Doc 04A's `test_forms.score_table_version` column: when a form is published, it is bound to one scoring model version. Sessions using that form are scored against that version's constants.

This is the version anchor. There is no ambiguity about which constants applied to which score.

## **7.2 The `scoring_model_versions` catalog (V4.3 — split hashes, race-safe single-active)**

```sql
CREATE TABLE scoring_model_versions (
  version                   text PRIMARY KEY,                  -- e.g., 'v1.0'
  formula_name              text NOT NULL,                     -- e.g., 'option_a_banded_ceiling'
  formula_doc_ref           text NOT NULL,                     -- e.g., 'Doc 04B V4.3 §6'
  -- V4.3: three distinct attestation fields. V4.2 had a single overloaded `constants_sha256`
  -- that was being used for both purposes; reviewer correctly flagged that these are
  -- different artifacts and conflating them is unsafe.
  constants_sha256          text NULL,                         -- hash of sorted scoring_constants rows for this version (set on activation)
  validation_packet_sha256  text NULL,                         -- hash of the validation evidence packet (set on activation)
  validation_packet_url     text NULL,                         -- canonical retrieval URL/path for the packet (set on activation)
  status                    text NOT NULL CHECK (status IN ('candidate', 'active', 'superseded')),
  published_at              timestamptz NULL,                  -- NULL while candidate; set on activation
  superseded_at             timestamptz NULL,
  notes                     text NULL,

  -- Active and superseded rows MUST have published_at and all three attestation fields set.
  -- Candidate rows have all four nullable while validation work is in progress.
  CONSTRAINT active_or_superseded_attestation_complete CHECK (
    (status IN ('active', 'superseded')
       AND published_at IS NOT NULL
       AND constants_sha256 IS NOT NULL
       AND validation_packet_sha256 IS NOT NULL
       AND validation_packet_url IS NOT NULL)
    OR (status = 'candidate' AND published_at IS NULL)
  ),
  CONSTRAINT superseded_has_superseded_at CHECK (
    (status = 'superseded' AND superseded_at IS NOT NULL)
    OR (status <> 'superseded' AND superseded_at IS NULL)
  )
);

-- V4.3: Partial unique index enforces "at most one active version" at the database
-- level. The trigger below remains for friendly error messages, but the index is the
-- authoritative enforcement against the race condition where two concurrent
-- candidate→active transitions could both pass an existence check.
CREATE UNIQUE INDEX one_active_scoring_model_version
  ON scoring_model_versions ((status))
  WHERE status = 'active';

-- State-machine trigger: stamps timestamps on transitions, blocks downgrades.
CREATE FUNCTION enforce_scoring_version_status_machine() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Block illegal transitions
  IF OLD.status = 'active' AND NEW.status = 'candidate' THEN
    RAISE EXCEPTION 'Cannot downgrade scoring_model_versions from active to candidate';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'Cannot revive a superseded scoring_model_version';
  END IF;

  -- Stamp transition timestamps
  IF OLD.status = 'candidate' AND NEW.status = 'active' THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'superseded' THEN
    NEW.superseded_at := COALESCE(NEW.superseded_at, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scoring_version_status_machine
  BEFORE INSERT OR UPDATE ON scoring_model_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_scoring_version_status_machine();

-- Friendly-error trigger for the single-active rule. The partial unique index above
-- is the actual enforcement; this trigger just produces a more informative error
-- message at the application boundary. Both layers are present by design.
CREATE FUNCTION enforce_single_active_scoring_version() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1 FROM scoring_model_versions
      WHERE status = 'active' AND version <> NEW.version
    ) THEN
      RAISE EXCEPTION 'Only one scoring model version may be active at a time';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_active_scoring_version
  BEFORE INSERT OR UPDATE ON scoring_model_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_single_active_scoring_version();
```

**Why the three-field split (V4.3 reviewer fix):** V4.2's catalog row stored `constants_sha256` and was simultaneously expected to hold the validation evidence packet hash. These are different artifacts serving different attestations:

- `constants_sha256` attests that the `scoring_constants` rows belonging to this version match the values that were validated. It is computed by hashing the sorted (key, section, value) tuples of all `scoring_constants` rows for this `scoring_model_version`. Its purpose is to detect silent constants drift after lock.
- `validation_packet_sha256` attests that the version was validated against a specific evidence packet (Python reference implementation + sweep results + benchmark band table + targeted fixtures + summary). Its purpose is to make the validation claim auditable and reproducible.
- `validation_packet_url` is the canonical retrieval location for the packet — e.g., a Git URL like `git://lyceon-spec/04B/v4.3/evidence_packet_v42/` or an S3 URL. Filled in by the deploy script at activation time.

Conflating the two hashes (as V4.2 did) means a constants change could appear to invalidate the validation evidence, or a packet regeneration could appear to invalidate the constants integrity check. V4.3 separates them cleanly.

**Why `published_at` is nullable on candidates:** A new scoring model version starts life as a `candidate` while validation work is in progress. Until the candidate is approved and transitions to `active`, no publish timestamp exists meaningfully. The state machine trigger stamps it automatically on candidate→active.

**Why the partial unique index AND the trigger (V4.3 reviewer fix):** V4.2 enforced single-active using only a trigger that did `IF EXISTS (... WHERE status = 'active' ...)`. Under concurrent transactions, two activations of different versions could both pass that check before either committed — race window between SELECT and the implicit row insert. V4.3 adds a partial unique index on `(status) WHERE status = 'active'`, which Postgres enforces atomically at commit. The trigger stays for friendly error messages at the application boundary; the index is the actual race-safe enforcement.

## **7.3 v1.0 catalog row (V4.3 — three-field attestation)**

```sql
INSERT INTO scoring_model_versions (
  version, formula_name, formula_doc_ref,
  constants_sha256,
  validation_packet_sha256,
  validation_packet_url,
  status, published_at
) VALUES (
  'v1.0',
  'option_a_banded_ceiling',
  'Doc 04B V4.3 §6',
  '<computed at deploy time from sorted scoring_constants rows>',
  '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b',
  'git://lyceon-spec/04B/v4.3/evidence_packet_v42/',   -- replace with canonical deploy URL
  'active',
  '2026-05-12T00:00:00Z'
);
```

The `constants_sha256` is computed by hashing the sorted (key, section, value) tuples of all `scoring_constants` rows belonging to v1.0. This provides defense-in-depth against constants drift.

## **7.4 Form-to-version binding**

Per Doc 04A §3.1, every published form has `score_table_version` set. At publish time, the form-publish handler validates that the value matches an existing `scoring_model_versions.version` and that the version is `active`. After publish, the value is immutable per Doc 04A's immutability trigger.

When scoring runs for a session, the scoring function reads the form's `score_table_version`, looks up the constants applicable to that version, and uses them. The constants are also captured into `score_runs.constants_snapshot` for defense-in-depth audit.

## **7.5 Migration to a future version**

If a future scoring model version (v2.0+) is introduced:

1. New rows are added to `scoring_constants` for the new version (constants table has a `version` column — see §8)
2. A new `scoring_model_versions` row is inserted with `status = 'candidate'`
3. Validation is performed; on acceptance, status flips to `active`, and the previous version flips to `superseded` in the same transaction (via the trigger)
4. New forms publish against the new version
5. Existing forms continue to use their published version's constants — their `score_table_version` is immutable
6. Sessions scored against forms with v1.0 continue to use v1.0 constants forever

This means v1.0 scores remain reproducible from v1.0 constants indefinitely.

---

# **8. Constants Doctrine**

## **8.1 Constants table schema**

```sql
CREATE TABLE scoring_constants (
  scoring_model_version text NOT NULL REFERENCES scoring_model_versions(version),
  key                   text NOT NULL,
  section               text NULL CHECK (section IS NULL OR section IN ('rw', 'math')),
  value                 numeric NOT NULL,
  description           text NOT NULL,
  notes                 text NULL,

  -- Composite uniqueness: per version, per key, per section (with NULL section meaning global)
  CONSTRAINT scoring_constants_value_nonneg CHECK (value >= 0)
);

CREATE UNIQUE INDEX scoring_constants_unique_idx
  ON scoring_constants (scoring_model_version, key, COALESCE(section, '__global__'));
```

The composite key handles the reviewer-identified bug: multiple rows with the same `key` can exist if they have different `section` values. `COALESCE(section, '__global__')` ensures NULL sections (global constants) collide as expected.

## **8.2 Constants helper function (V4.2 — raises on missing)**

```sql
CREATE FUNCTION scoring_constant(
  p_version text,
  p_key     text,
  p_section text DEFAULT NULL
) RETURNS numeric AS $$
DECLARE
  v_value numeric;
BEGIN
  -- Try section-specific first, then fall back to global
  SELECT value INTO v_value FROM scoring_constants
  WHERE scoring_model_version = p_version
    AND key = p_key
    AND (
      (p_section IS NOT NULL AND section = p_section)
      OR (section IS NULL)
    )
  ORDER BY (section IS NULL)  -- false (section-specific) sorts before true (global)
  LIMIT 1;

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'scoring_constant lookup failed: version=%, key=%, section=%',
      p_version, p_key, COALESCE(p_section, '<global>')
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;
```

The fall-back behavior: section-specific wins; if no section-specific row exists, the global (section = NULL) row is returned. **V4.2 change:** the function now raises a loud `no_data_found` exception when no matching row exists, rather than silently returning NULL which previously could propagate into the scoring math and produce inscrutable downstream errors. Loud failure is preferred — missing constants are programming/deployment bugs that MUST surface at the call site.

## **8.3 v1.0 constant values**

The complete enumeration of `scoring_constants` rows for v1.0 is in Appendix A.

Of note: per §5.13, `routing_threshold` is NOT in `scoring_constants`. It is on `test_forms` per Doc 04A. The scoring function reads the threshold from the form, not from the constants table.

Similarly, `section_total_questions` and `module1_questions` are derivable from `test_form_items` for the session's form. They are stored in `scoring_constants` as a convenience cache only; the scoring function MAY read either source. The form is authoritative; the constants cache must match.

## **8.4 Constants change protocol and mutation prevention (V4.3)**

Constants changes within v1.0 are NOT permitted. The formula is canonical; the constants are part of the formula.

**V4.3 enforces immutability at the database level for INSERT, UPDATE, and DELETE.** V4.2 covered only UPDATE/DELETE, which left a real gap: a new constant row could be inserted into an already-active `scoring_model_version`, silently adding a constant the formula now reads. V4.3 closes this by adding INSERT to the trigger's event list and inspecting `NEW.scoring_model_version` for new rows.

```sql
CREATE FUNCTION prevent_active_scoring_constants_mutation() RETURNS trigger AS $$
DECLARE
  v_status text;
  v_target_version text;
BEGIN
  -- For INSERT we examine NEW (the row being inserted); for UPDATE and DELETE we
  -- examine OLD (the row being changed). In all cases we check the parent version's
  -- status: if the parent is active or superseded, the constants are sealed.
  v_target_version := CASE TG_OP
    WHEN 'INSERT' THEN NEW.scoring_model_version
    ELSE OLD.scoring_model_version
  END;

  SELECT status INTO v_status
  FROM scoring_model_versions
  WHERE version = v_target_version;

  IF v_status IN ('active', 'superseded') THEN
    RAISE EXCEPTION
      'scoring_constants rows for active/superseded scoring_model_version % are immutable. '
      'Adding, modifying, or deleting constants requires a new scoring_model_version '
      '(Doc 04B V4.3 §8.4 Tier 3 protocol).',
      v_target_version
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_active_scoring_constants_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON scoring_constants
  FOR EACH ROW EXECUTE FUNCTION prevent_active_scoring_constants_mutation();
```

Candidate-version constants remain mutable (they are work-in-progress); once the parent version transitions to `active`, the trigger seals them in all three directions: existing rows cannot be UPDATEd or DELETEd, and no new rows can be INSERTed. This means: (a) the `constants_sha256` in the catalog row is a real, stable hash that any reader can recompute against the live table and verify, (b) the formula's bit-exactness across deployments is enforced by the database, not by reviewer discipline, and (c) the "sealed constants" claim is true under all attack surfaces, including the previously-overlooked INSERT path.

**Tier 3 protocol for constants changes** (introducing a new scoring model version):

1. A new `scoring_model_versions` row is inserted with `status = 'candidate'`
2. New `scoring_constants` rows are inserted with the new version's values (allowed because the parent is candidate, not active)
3. Validation sweep is re-run against the new version's constants; a new evidence packet hash is computed
4. Founder/CTO approval
5. Status of the candidate version flips to `active`; previous version flips to `superseded` in the same transaction; `constants_sha256`, `validation_packet_sha256`, and `validation_packet_url` are all populated as part of the activation update
6. Forms publishing after this transition bind to the new version
7. **The mutation-prevention trigger now seals the new version's constants automatically** — no further INSERT/UPDATE/DELETE permitted on its `scoring_constants` rows

This is Tier 3 change governance per §23.

---

# **9. Database Schema**

## **9.1 `score_runs` — canonical scaled scores**

```sql
CREATE TABLE score_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_session_id          uuid NOT NULL REFERENCES test_sessions(id),
  student_id               uuid NOT NULL,                                       -- denormalized from test_sessions for index efficiency
  test_form_id             uuid NOT NULL REFERENCES test_forms(id),
  scoring_model_version    text NOT NULL REFERENCES scoring_model_versions(version),

  -- Outbox event that triggered this scoring (idempotency anchor)
  source_outbox_event_id   uuid NOT NULL REFERENCES exam_runtime_outbox(id),
  source_event_type        text NOT NULL CHECK (source_event_type IN (
    'test_session_completed',
    'test_session_partial_scored_abandoned'
  )),

  -- Reading & Writing (nullable for partial-scored sessions where RW was not submitted)
  rw_scored                boolean NOT NULL,
  rw_module1_correct       int NULL,
  rw_module2_correct       int NULL,
  rw_module2_path          text NULL CHECK (rw_module2_path IS NULL OR rw_module2_path IN ('A','B')),
  rw_m2_easy_wrong         int NULL,
  rw_m2_medium_wrong       int NULL,
  rw_m2_hard_wrong         int NULL,
  rw_ceiling               numeric NULL,
  rw_deduction             numeric NULL,
  rw_raw_floor             numeric NULL,
  rw_path_floor            numeric NULL,
  rw_effective_floor       numeric NULL,
  rw_s_raw                 numeric NULL,
  rw_scaled                int NULL CHECK (rw_scaled IS NULL OR (rw_scaled BETWEEN 200 AND 800 AND rw_scaled % 10 = 0)),

  -- Math (nullable for partial-scored sessions where Math was not submitted)
  math_scored              boolean NOT NULL,
  math_module1_correct     int NULL,
  math_module2_correct     int NULL,
  math_module2_path        text NULL CHECK (math_module2_path IS NULL OR math_module2_path IN ('A','B')),
  math_m2_easy_wrong       int NULL,
  math_m2_medium_wrong     int NULL,
  math_m2_hard_wrong       int NULL,
  math_ceiling             numeric NULL,
  math_deduction           numeric NULL,
  math_raw_floor           numeric NULL,
  math_path_floor          numeric NULL,
  math_effective_floor     numeric NULL,
  math_s_raw               numeric NULL,
  math_scaled              int NULL CHECK (math_scaled IS NULL OR (math_scaled BETWEEN 200 AND 800 AND math_scaled % 10 = 0)),

  -- Total scaled score: ONLY populated when both sections are scored.
  -- V4.2: do NOT overload total_scaled to mean "single section's score" — that is dangerous
  -- to downstream consumers (analytics, support, 04C report rendering) that assume
  -- total_scaled is a 400-1600 full SAT total. For partial scoring, total_scaled is NULL
  -- and partial_display_scaled carries the single-section convenience value for 04C use.
  total_scaled             int NULL CHECK (total_scaled IS NULL OR (total_scaled BETWEEN 400 AND 1600 AND total_scaled % 10 = 0)),
  partial_display_scaled   int NULL CHECK (partial_display_scaled IS NULL OR (partial_display_scaled BETWEEN 200 AND 800 AND partial_display_scaled % 10 = 0)),

  -- Defense-in-depth snapshot
  constants_snapshot       jsonb NOT NULL,

  -- Audit
  computed_at              timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  UNIQUE (test_session_id),
  CHECK (rw_scored OR math_scored),
  CHECK (
    (rw_scored AND rw_scaled IS NOT NULL AND rw_module1_correct IS NOT NULL)
    OR (NOT rw_scored AND rw_scaled IS NULL AND rw_module1_correct IS NULL)
  ),
  CHECK (
    (math_scored AND math_scaled IS NOT NULL AND math_module1_correct IS NOT NULL)
    OR (NOT math_scored AND math_scaled IS NULL AND math_module1_correct IS NULL)
  ),
  -- V4.2: total_scaled MUST be NULL for partial; partial_display_scaled MUST be NULL for full.
  -- These are mutually exclusive and dictated by the (rw_scored, math_scored) pair.
  CHECK (
    -- Full scoring: both sections scored, total_scaled = sum, partial_display_scaled = NULL
    (rw_scored AND math_scored
       AND total_scaled = rw_scaled + math_scaled
       AND partial_display_scaled IS NULL)
    OR
    -- Partial scoring: exactly one section scored, total_scaled = NULL, partial_display_scaled = that section
    (rw_scored AND NOT math_scored
       AND total_scaled IS NULL
       AND partial_display_scaled = rw_scaled)
    OR
    (math_scored AND NOT rw_scored
       AND total_scaled IS NULL
       AND partial_display_scaled = math_scaled)
  )
);

CREATE INDEX idx_score_runs_student ON score_runs (student_id, computed_at DESC);
CREATE INDEX idx_score_runs_form ON score_runs (test_form_id, computed_at DESC);
CREATE INDEX idx_score_runs_event ON score_runs (source_outbox_event_id);
```

**Why nullable section columns:** the partial-scoring path (§15) produces score_runs with one section's columns NULL. The CHECK constraints ensure consistency: a section is either fully scored (all intermediate values populated) or fully NULL.

**Why `total_scaled` is NULL for partial (V4.2 reviewer fix):** V4.1 overloaded `total_scaled` to carry the single-section score when one section was abandoned. That overload is dangerous: `total_scaled` semantically means a full-SAT 400-1600 total, and downstream consumers (04C report rendering, analytics, support tooling) reasonably assume that. A single-section value in that column invites silent misuse — e.g., a leaderboard query `SELECT student_id, total_scaled FROM score_runs ORDER BY total_scaled DESC` would mix 1600-scale full scores with 800-scale partial scores. V4.2 separates the two semantic spaces: `total_scaled` is strictly full-SAT (400-1600, NULL when partial); `partial_display_scaled` is the single-section convenience field (200-800, NULL when full). The CHECK constraint enforces mutual exclusion. This also aligns with Parent Q7-partial which says total scaled score MUST NOT display for partial.

**Why `constants_snapshot` plus `scoring_model_version`:** defense in depth. The version pins the canonical scoring profile. The snapshot is the actual values used. If constants are ever migrated or corrupted, the snapshot is the immutable record of what scored this row.

## **9.2 `score_run_event_ledger` — orchestrator idempotency**

```sql
CREATE TABLE score_run_event_ledger (
  outbox_event_id   uuid PRIMARY KEY REFERENCES exam_runtime_outbox(id),
  score_run_id      uuid NOT NULL REFERENCES score_runs(id),
  test_session_id   uuid NOT NULL,
  processed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_score_run_event_ledger_session ON score_run_event_ledger (test_session_id);
```

The primary key is `outbox_event_id`, which is the canonical event UUID from Doc 04A's `exam_runtime_outbox.id`. On retry, the orchestrator finds the existing ledger row and returns the existing `score_run_id` without recomputing.

## **9.3 `score_runs_admin_recompute` — post-launch calibration audit**

```sql
CREATE TABLE score_runs_admin_recompute (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_score_run_id       uuid NOT NULL REFERENCES score_runs(id),
  recomputed_at               timestamptz NOT NULL DEFAULT now(),
  recompute_reason            text NOT NULL,
  recomputed_by               uuid NOT NULL,
  scoring_model_version_used  text NOT NULL REFERENCES scoring_model_versions(version),
  constants_snapshot          jsonb NOT NULL,
  rw_scaled                   int NULL,
  math_scaled                 int NULL,
  total_scaled                int NULL,
  delta_total                 int NULL
);
```

The original `score_runs` row is never modified. This table records what a student would have scored under a different scoring model version, for calibration analysis. Student-facing UI never reads from this table.

## **9.4 Insert-once enforcement (three layers — V4.2 hardened)**

V4.2 strengthens the write gate. V4.1 granted `INSERT` to `authenticated`, which technically allowed any authenticated session to insert a score_runs row (the trigger and RLS would have caught most cases, but the surface was open). V4.2 closes the gate: no direct table writes are permitted at all; the canonical scoring function is the only write path, and it executes under a privileged service role.

```sql
-- Layer 1: Permission grants — table writes are FORBIDDEN at the table level
-- The scoring function (§11.2) is the sole write path, executed by service role only
REVOKE INSERT, UPDATE, DELETE ON score_runs        FROM PUBLIC, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON score_run_event_ledger FROM PUBLIC, authenticated, anon;
GRANT  SELECT                  ON score_runs        TO authenticated;
-- Internal ledger is never readable by students
REVOKE SELECT                  ON score_run_event_ledger FROM authenticated, anon;

-- The scoring function and orchestrator hold INSERT privilege via SECURITY DEFINER
-- (see §11.1 and §12.1 ownership rules).
-- EXECUTE on those functions is granted only to the service_role identity used by the
-- outbox publisher worker; students and admins do NOT have EXECUTE on scoring functions.
GRANT EXECUTE ON FUNCTION score_test_session_from_outbox(uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION compute_section_scaled_score(uuid, text)    TO service_role;
REVOKE EXECUTE ON FUNCTION score_test_session_from_outbox(uuid)       FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION compute_section_scaled_score(uuid, text)   FROM PUBLIC, authenticated, anon;

-- Layer 2: BEFORE UPDATE/DELETE trigger — blocks any path that bypasses Layer 1
CREATE FUNCTION prevent_score_runs_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'score_runs is insert-once. UPDATE and DELETE are forbidden. Use score_runs_admin_recompute for post-launch calibration audit.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_score_runs_update
  BEFORE UPDATE ON score_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_score_runs_mutation();

CREATE TRIGGER trg_prevent_score_runs_delete
  BEFORE DELETE ON score_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_score_runs_mutation();

-- Layer 3: RLS policy (defense in depth; the trigger fires even if RLS is bypassed)
ALTER TABLE score_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY score_runs_no_update ON score_runs FOR UPDATE USING (false);
CREATE POLICY score_runs_no_delete ON score_runs FOR DELETE USING (false);
-- No INSERT policy is needed — table-level REVOKE blocks all non-function inserts.
```

**Why three layers (V4.2 reviewer rationale):** the table-level REVOKE is the primary gate — a student session cannot insert a `score_runs` row no matter what query they construct. The SECURITY DEFINER scoring function runs as the function-owner role (a dedicated service role, see §11.1 ownership note), which retains INSERT privilege. EXECUTE on the function is granted only to `service_role`, which is held by the outbox publisher worker. Students and admins cannot execute the scoring function; they can only observe its results via SELECT. The BEFORE UPDATE/DELETE trigger catches anything that bypasses the permission layer (e.g., direct database superuser activity), and the RLS policy is a third layer of defense.

This is the industry-standard insert-once pattern: gate writes through a function, gate function execution through a dedicated role, gate the table itself with REVOKE and RLS.

## **9.5 RLS policies for read access**

```sql
-- Students read only their own score_runs
-- NOTE: This policy assumes Lyceon identity maps profiles.id = auth.uid().
-- This mapping is owned by Doc 01. If Doc 01 introduces an indirection
-- (e.g., account_members), this policy SHALL be updated to use that path.
-- At V4.3 lock, this remains a coordination gap flagged in §22.1.
CREATE POLICY score_runs_student_read ON score_runs FOR SELECT
  USING (student_id = (SELECT current_student_id()));

-- The ledger is internal — no student-facing read
ALTER TABLE score_run_event_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY score_run_event_ledger_internal ON score_run_event_ledger FOR ALL USING (false);

-- Admin recompute table — admin role only (via Doc 01's role check)
ALTER TABLE score_runs_admin_recompute ENABLE ROW LEVEL SECURITY;
CREATE POLICY score_runs_admin_recompute_admin ON score_runs_admin_recompute FOR ALL
  USING (is_admin());  -- helper from Doc 01
```

`current_student_id()` and `is_admin()` are Doc 01 helpers; their implementation is owned by Doc 01.

---

# **10. Anti-Leak Comparator Doctrine**

## **10.1 The comparator function**

A single PL/pgSQL function determines whether a submitted answer matches the canonical correct answer for a question. This is the canonical comparator used by both Doc 04A (for routing decisions) and Doc 04B (for scoring).

```sql
CREATE FUNCTION is_answer_correct(
  p_submitted   text,
  p_question_id text   -- text per Doc 02; canonical question ID like 'SATRW2L9X3FZ'
) RETURNS boolean
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question_type    text;
  v_correct_answer   text;
  v_correct_variants text[];
BEGIN
  -- p_submitted = NULL means no answer / blank; always false
  IF p_submitted IS NULL THEN
    RETURN false;
  END IF;

  -- Read canonical correctness from Doc 02's question record
  -- (Question table name and exact schema is Doc 02's contract;
  --  V4.2 references it as `questions` with columns question_type,
  --  correct_answer, correct_variants. Adjust if Doc 02 names differ.)
  SELECT question_type, correct_answer, correct_variants
    INTO v_question_type, v_correct_answer, v_correct_variants
  FROM questions
  WHERE id = p_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found: %', p_question_id;
  END IF;

  -- Multiple choice: exact letter match
  IF v_question_type = 'multiple_choice' THEN
    RETURN p_submitted = v_correct_answer;
  END IF;

  -- Student-produced response: variant array match
  IF v_question_type = 'student_produced_response' THEN
    RETURN p_submitted = ANY(v_correct_variants);
  END IF;

  -- Unknown question type: explicitly false rather than ambiguous
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;
```

The function is `SECURITY DEFINER` so it can read sensitive correctness fields. The function returns only a boolean. The correct answer never leaves the function body.

## **10.2 Question canonical forms**

For student-produced response questions, the `correct_variants` array stores all acceptable string representations:

```
correct_variants for "1/2" question  = ['1/2', '0.5', '.5']
correct_variants for "-7" question   = ['-7', '-7.0']
correct_variants for "3.14" question = ['3.14', '3.140']
```

The content authoring process (Doc 02A) is responsible for populating `correct_variants` exhaustively at question creation time.

## **10.3 Why the comparator lives in the database**

Three reasons:

1. **Anti-leak.** Correct answers never serialize out of the database into application code.
2. **Single source of truth.** Doc 04A's routing logic and Doc 04B's scoring logic must agree on "correct."
3. **Atomicity.** Comparison runs inside the scoring transaction; no race condition between reading the correct answer and reading the submitted answer.

## **10.4 What the comparator does NOT do**

- Distinguish between NULL submission and wrong submission (both return false)
- Apply partial credit
- Apply numeric tolerance (variants must be enumerated)
- Apply case sensitivity reasoning (variants are exact strings)
- Consider time-of-submission

---

# **11. The Canonical Scoring Function**

## **11.1 Function signature**

```sql
CREATE FUNCTION compute_section_scaled_score(
  p_test_session_id     uuid,
  p_section             text   -- 'rw' or 'math'
) RETURNS TABLE (
  scaled               int,
  module1_correct      int,
  module2_correct      int,
  module2_path         text,
  m2_easy_wrong        int,
  m2_medium_wrong      int,
  m2_hard_wrong        int,
  ceiling              numeric,
  deduction            numeric,
  raw_floor            numeric,
  path_floor           numeric,
  effective_floor      numeric,
  s_raw                numeric
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
-- body in §11.2
$$;

-- V4.2 ownership requirement (reviewer hardening):
-- This function MUST be owned by a dedicated DB role (e.g., 'lyceon_scoring_owner'),
-- NOT by a human admin or the database superuser. The function runs with the owner's
-- privileges due to SECURITY DEFINER; if the owner is a human admin, the function
-- inherits whatever privileges that human currently has (including future privilege
-- escalations they receive). A dedicated role with the minimum required privileges
-- (SELECT on test_*, test_form_*, questions, scoring_constants, scoring_model_versions;
-- INSERT on score_runs and score_run_event_ledger) is the principle-of-least-privilege
-- posture. EXECUTE on this function is granted to service_role only (§9.4).
ALTER FUNCTION compute_section_scaled_score(uuid, text) OWNER TO lyceon_scoring_owner;
```

The function returns the scaled value PLUS all intermediate values, so the orchestrator can persist them to `score_runs` for audit. The function is pure — same inputs, same outputs, no side effects.

## **11.2 Function body (V4.2 — math section code mapping fixed, LEFT JOIN from form-items)**

```sql
CREATE OR REPLACE FUNCTION compute_section_scaled_score(
  p_test_session_id  uuid,
  p_section          text
) RETURNS TABLE (
  scaled int, module1_correct int, module2_correct int, module2_path text,
  m2_easy_wrong int, m2_medium_wrong int, m2_hard_wrong int,
  ceiling numeric, deduction numeric, raw_floor numeric,
  path_floor numeric, effective_floor numeric, s_raw numeric
)
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section_code        text;        -- 04A section code: 'RW' or 'M'
  v_m2_module           text;        -- '2A' or '2B' for the routed path
  v_test_form_id        uuid;
  v_score_table_version text;
  v_routing_threshold   int;
  v_n1                  int;
  v_n_total             int;
  v_module2_path        text;
  v_section_state       text;

  -- Constants for the form's scoring model version
  c_alpha       numeric;
  c_ceil_floor  numeric;
  c_ceil_max    numeric;
  c_d_easy      numeric;
  c_d_med       numeric;
  c_d_hard      numeric;
  c_raw_base    numeric;
  c_raw_mult    numeric;
  c_path_a_fl   numeric;
  c_path_b_base numeric;
  c_path_b_bon  numeric;
  c_path_b_cap  numeric;
  c_round       int;

  -- Computed values
  v_r1           int;
  v_r2           int;
  v_n_e_m2       int;
  v_n_m_m2       int;
  v_n_h_m2       int;
  v_ceiling      numeric;
  v_deduction    numeric;
  v_raw_floor    numeric;
  v_path_floor   numeric;
  v_floor        numeric;
  v_s_raw        numeric;
  v_s_clamped    numeric;
  v_scaled       int;
BEGIN
  -- ===================================================================
  -- SECTION-CODE MAPPING (V4.2 — derived once, used everywhere)
  -- ===================================================================
  -- V4.1 had a hard implementation bug: `upper(p_section)` produced 'MATH'
  -- for the math section, but 04A uses 'M'. V4.2 derives the mapping once
  -- via an explicit CASE and uses v_section_code at every site that needs it.
  v_section_code := CASE
    WHEN p_section = 'rw'   THEN 'RW'
    WHEN p_section = 'math' THEN 'M'
    ELSE NULL
  END;
  IF v_section_code IS NULL THEN
    RAISE EXCEPTION 'Unknown section: %. Expected ''rw'' or ''math''.', p_section;
  END IF;

  -- ===================================================================
  -- LOAD FORM AND SECTION CONTEXT (from 04A's canonical schema)
  -- ===================================================================
  SELECT ts.test_form_id, tf.score_table_version,
         CASE WHEN p_section = 'rw' THEN tf.routing_threshold_rw
              ELSE tf.routing_threshold_m END
  INTO v_test_form_id, v_score_table_version, v_routing_threshold
  FROM test_sessions ts
  JOIN test_forms tf ON tf.id = ts.test_form_id
  WHERE ts.id = p_test_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session or form not found: session_id=%', p_test_session_id;
  END IF;

  -- Read section state and path from 04A's test_session_sections
  SELECT tss.state, tss.module2_path
  INTO v_section_state, v_module2_path
  FROM test_session_sections tss
  WHERE tss.test_session_id = p_test_session_id
    AND tss.section = v_section_code;

  IF v_section_state IS NULL THEN
    RAISE EXCEPTION 'Section state not found: session=%, section=%',
                    p_test_session_id, p_section;
  END IF;

  -- Section must be in 'submitted' state to be scored
  IF v_section_state <> 'submitted' THEN
    RAISE EXCEPTION 'Section not scoreable: state=%, expected=submitted', v_section_state;
  END IF;

  -- module2_path MUST be locked at this point (04A invariant §2.3)
  IF v_module2_path IS NULL THEN
    RAISE EXCEPTION 'Module 2 path not locked for scoreable section';
  END IF;

  v_m2_module := '2' || v_module2_path;  -- '2A' or '2B'

  -- Compute N1 and N_total from the canonical form-items count
  -- (this is the authoritative source per §8.3; the constants cache is fallback only)
  SELECT
    COUNT(*) FILTER (WHERE module = '1'),
    COUNT(*)
  INTO v_n1, v_n_total
  FROM test_form_items
  WHERE test_form_id = v_test_form_id
    AND section = v_section_code
    AND module IN ('1', v_m2_module);

  -- ===================================================================
  -- LOAD CONSTANTS FOR THIS SCORING MODEL VERSION
  -- ===================================================================
  c_alpha       := scoring_constant(v_score_table_version, 'alpha_ceiling_exponent');
  c_ceil_floor  := scoring_constant(v_score_table_version, 'ceiling_floor');
  c_ceil_max    := scoring_constant(v_score_table_version, 'ceiling_max');
  c_d_easy      := scoring_constant(v_score_table_version, 'deduction_easy');
  c_d_med       := scoring_constant(v_score_table_version, 'deduction_medium');
  c_d_hard      := scoring_constant(v_score_table_version, 'deduction_hard');
  c_raw_base    := scoring_constant(v_score_table_version, 'raw_floor_base');
  c_raw_mult    := scoring_constant(v_score_table_version, 'raw_floor_multiplier');
  c_path_a_fl   := scoring_constant(v_score_table_version, 'path_a_floor');
  c_path_b_base := scoring_constant(v_score_table_version, 'path_b_floor_base');
  c_path_b_bon  := scoring_constant(v_score_table_version, 'path_b_floor_bonus_per_m1_point');
  c_path_b_cap  := scoring_constant(v_score_table_version, 'path_b_floor_cap');
  c_round       := scoring_constant(v_score_table_version, 'round_to_nearest')::int;

  -- ===================================================================
  -- COUNT M1 CORRECT  (V4.2: LEFT JOIN — missing answers count as wrong)
  -- ===================================================================
  -- V4.1 used `FROM test_session_answers JOIN test_form_items` as the base,
  -- which silently excluded presented questions that had no answer row.
  -- A student who left a question blank produces no answer row; that question
  -- was being skipped entirely, deflating the wrong count and inflating the score.
  -- V4.2 makes test_form_items the base table and LEFT JOINs to answers, so
  -- a missing answer row appears as `a.answer = NULL`, which is_answer_correct()
  -- correctly treats as wrong (see §10.1).
  SELECT COUNT(*) FILTER (WHERE is_answer_correct(a.answer, i.question_id))
  INTO v_r1
  FROM test_form_items i
  LEFT JOIN test_session_answers a
    ON a.test_session_id = p_test_session_id
   AND a.section         = i.section
   AND a.module          = i.module
   AND a.ordinal         = i.ordinal
   AND a.question_id     = i.question_id
  WHERE i.test_form_id = v_test_form_id
    AND i.section      = v_section_code
    AND i.module       = '1';

  -- ===================================================================
  -- COUNT M2 CORRECT AND M2 WRONG-BY-DIFFICULTY
  -- (only the presented M2 path matters; LEFT JOIN as above)
  -- ===================================================================
  SELECT
    COUNT(*) FILTER (WHERE is_answer_correct(a.answer, i.question_id)),
    COUNT(*) FILTER (
      WHERE NOT is_answer_correct(a.answer, i.question_id)
        AND q.difficulty = 'easy'),
    COUNT(*) FILTER (
      WHERE NOT is_answer_correct(a.answer, i.question_id)
        AND q.difficulty = 'medium'),
    COUNT(*) FILTER (
      WHERE NOT is_answer_correct(a.answer, i.question_id)
        AND q.difficulty = 'hard')
  INTO v_r2, v_n_e_m2, v_n_m_m2, v_n_h_m2
  FROM test_form_items i
  JOIN questions q ON q.id = i.question_id
  LEFT JOIN test_session_answers a
    ON a.test_session_id = p_test_session_id
   AND a.section         = i.section
   AND a.module          = i.module
   AND a.ordinal         = i.ordinal
   AND a.question_id     = i.question_id
  WHERE i.test_form_id = v_test_form_id
    AND i.section      = v_section_code
    AND i.module       = v_m2_module;

  -- ===================================================================
  -- APPLY THE CANONICAL FORMULA (locked v1.0)
  -- ===================================================================
  v_ceiling := GREATEST(c_ceil_floor, c_ceil_max * (v_r1::numeric / v_n1) ^ c_alpha);
  v_deduction := c_d_easy * v_n_e_m2 + c_d_med * v_n_m_m2 + c_d_hard * v_n_h_m2;
  v_raw_floor := c_raw_base + c_raw_mult * ((v_r1 + v_r2)::numeric / v_n_total);

  IF v_r1 >= v_routing_threshold THEN
    v_path_floor := LEAST(c_path_b_cap, c_path_b_base + c_path_b_bon * (v_r1 - v_routing_threshold));
  ELSE
    v_path_floor := c_path_a_fl;
  END IF;

  v_floor := GREATEST(v_raw_floor, v_path_floor);
  v_s_raw := v_ceiling - v_deduction;
  v_s_clamped := GREATEST(v_floor, LEAST(c_ceil_max, v_s_raw));

  -- V4.2 canonical rounding: round half up to nearest 10 (§6.3)
  -- MUST match Python reference: int(math.floor((s_clamped + 5) / 10) * 10)
  v_scaled := (floor((v_s_clamped + 5) / c_round) * c_round)::int;

  -- Return all values
  scaled := v_scaled;
  module1_correct := v_r1;
  module2_correct := v_r2;
  module2_path := v_module2_path;
  m2_easy_wrong := v_n_e_m2;
  m2_medium_wrong := v_n_m_m2;
  m2_hard_wrong := v_n_h_m2;
  ceiling := v_ceiling;
  deduction := v_deduction;
  raw_floor := v_raw_floor;
  path_floor := v_path_floor;
  effective_floor := v_floor;
  s_raw := v_s_raw;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
```

## **11.3 Why this function does NOT check idempotency**

Per §5.17, idempotency lives in the orchestrator (§12). The section function is a pure computation. The orchestrator decides whether to call it (on first processing) or to skip it (on retry). The section function has no knowledge of retries.

This resolves the V4 reviewer-identified bug where the section function checked the ledger but did not write to it, producing dead code at best and confused intent at worst.

## **11.4 Section-name mapping (04A vs 04B)**

Doc 04A uses section codes `'RW'` and `'M'` in its schema. Doc 04B exposes function parameters as `'rw'` and `'math'` for ergonomics. The mapping:

```
Doc 04B param  →  Doc 04A column value
'rw'           →  'RW'
'math'         →  'M'
```

The scoring function applies a single explicit CASE mapping at the top of `compute_section_scaled_score` (V4.2 §11.2: `v_section_code := CASE WHEN p_section='rw' THEN 'RW' WHEN p_section='math' THEN 'M' END`) and uses `v_section_code` at every site that queries 04A's schema. V4.1 used `upper(p_section)` which produced the wrong value `'MATH'` for the math section; V4.2 retires that pattern entirely. This mapping is purely cosmetic at the boundary; both names refer to the same section.

---

# **12. The Scoring Orchestrator and Idempotency**

## **12.1 The orchestrator function**

```sql
CREATE FUNCTION score_test_session_from_outbox(
  p_outbox_event_id uuid
) RETURNS uuid
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_type      text;
  v_test_session_id uuid;
  v_test_form_id    uuid;
  v_student_id      uuid;
  v_score_table_ver text;
  v_existing_run_id uuid;
  v_score_run_id    uuid;

  -- Section results
  v_rw_present   boolean := false;
  v_math_present boolean := false;
  v_rw_row       record;
  v_math_row     record;
  v_total        int;
  v_partial_display int;
BEGIN
  -- ===================================================================
  -- IDEMPOTENCY CHECK
  -- ===================================================================
  SELECT score_run_id INTO v_existing_run_id
  FROM score_run_event_ledger
  WHERE outbox_event_id = p_outbox_event_id;

  IF FOUND THEN
    RETURN v_existing_run_id;
  END IF;

  -- ===================================================================
  -- READ THE OUTBOX EVENT (04A wrote this; we consume it)
  -- ===================================================================
  SELECT event_type, aggregate_id
  INTO v_event_type, v_test_session_id
  FROM exam_runtime_outbox
  WHERE id = p_outbox_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outbox event not found: %', p_outbox_event_id;
  END IF;

  IF v_event_type NOT IN ('test_session_completed', 'test_session_partial_scored_abandoned') THEN
    RAISE EXCEPTION 'Outbox event type not handled by scoring: %', v_event_type;
  END IF;

  -- Read session metadata
  SELECT student_id, test_form_id
  INTO v_student_id, v_test_form_id
  FROM test_sessions
  WHERE id = v_test_session_id;

  SELECT score_table_version
  INTO v_score_table_ver
  FROM test_forms
  WHERE id = v_test_form_id;

  -- ===================================================================
  -- VERSION-VALIDATION GATE (V4.3 reviewer fix — Blocker #4)
  -- ===================================================================
  -- Before any scoring work, verify that the form's score_table_version
  -- references an attested, lockable scoring_model_version. A missing,
  -- candidate, or partially-attested version MUST NOT score; failing here
  -- prevents inserting a score_runs row whose model-version provenance
  -- cannot be reproduced post-hoc.
  --
  -- Scoring against a 'superseded' version is explicitly ALLOWED — this is
  -- the historical-reproducibility path. Sessions tied to forms published
  -- against an older version must continue to score against that version's
  -- constants forever (per §5.3 immutability doctrine and §7.5 migration
  -- rule). Only 'active' and 'superseded' versions are valid scoring targets.
  PERFORM 1
  FROM scoring_model_versions
  WHERE version = v_score_table_ver
    AND status IN ('active', 'superseded')
    AND published_at IS NOT NULL
    AND constants_sha256 IS NOT NULL
    AND validation_packet_sha256 IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Scoring blocked: scoring_model_version % is missing, candidate, or '
      'incompletely attested. score_runs MUST NOT be inserted for an '
      'unattested version. (Doc 04B V4.3 §12.1 + §19.2.)',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Defense-in-depth: confirm at least one scoring_constants row exists for
  -- this version. The attestation hash already covers this, but the explicit
  -- existence check protects against catalog/constants table desync.
  IF NOT EXISTS (
    SELECT 1 FROM scoring_constants
    WHERE scoring_model_version = v_score_table_ver
  ) THEN
    RAISE EXCEPTION
      'Scoring blocked: no scoring_constants rows for version %',
      v_score_table_ver
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- ===================================================================
  -- DETERMINE WHICH SECTIONS ARE SCOREABLE
  -- ===================================================================
  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'RW'
      AND state = 'submitted'
  ) INTO v_rw_present;

  SELECT EXISTS (
    SELECT 1 FROM test_session_sections
    WHERE test_session_id = v_test_session_id
      AND section = 'M'
      AND state = 'submitted'
  ) INTO v_math_present;

  IF NOT v_rw_present AND NOT v_math_present THEN
    RAISE EXCEPTION 'No scoreable sections found for session %', v_test_session_id;
  END IF;

  -- ===================================================================
  -- COMPUTE PRESENT SECTIONS
  -- ===================================================================
  IF v_rw_present THEN
    SELECT * INTO v_rw_row
    FROM compute_section_scaled_score(v_test_session_id, 'rw');
  END IF;

  IF v_math_present THEN
    SELECT * INTO v_math_row
    FROM compute_section_scaled_score(v_test_session_id, 'math');
  END IF;

  -- ===================================================================
  -- COMPUTE TOTAL_SCALED AND PARTIAL_DISPLAY_SCALED
  -- (V4.2: total_scaled is strictly full-SAT 400-1600 — NULL when partial.
  --  partial_display_scaled carries the single-section convenience value
  --  for partial rows; it is NULL when both sections scored.)
  -- ===================================================================
  IF v_rw_present AND v_math_present THEN
    v_total := v_rw_row.scaled + v_math_row.scaled;        -- full SAT total
    v_partial_display := NULL;
  ELSIF v_rw_present THEN
    v_total := NULL;                                        -- partial: no full total
    v_partial_display := v_rw_row.scaled;
  ELSE
    v_total := NULL;
    v_partial_display := v_math_row.scaled;
  END IF;

  -- ===================================================================
  -- INSERT score_runs ROW (with ALL intermediate values)
  -- ===================================================================
  INSERT INTO score_runs (
    test_session_id, student_id, test_form_id, scoring_model_version,
    source_outbox_event_id, source_event_type,
    rw_scored, rw_module1_correct, rw_module2_correct, rw_module2_path,
    rw_m2_easy_wrong, rw_m2_medium_wrong, rw_m2_hard_wrong,
    rw_ceiling, rw_deduction, rw_raw_floor, rw_path_floor, rw_effective_floor,
    rw_s_raw, rw_scaled,
    math_scored, math_module1_correct, math_module2_correct, math_module2_path,
    math_m2_easy_wrong, math_m2_medium_wrong, math_m2_hard_wrong,
    math_ceiling, math_deduction, math_raw_floor, math_path_floor, math_effective_floor,
    math_s_raw, math_scaled,
    total_scaled, partial_display_scaled, constants_snapshot
  ) VALUES (
    v_test_session_id, v_student_id, v_test_form_id, v_score_table_ver,
    p_outbox_event_id, v_event_type,
    v_rw_present,
    CASE WHEN v_rw_present THEN v_rw_row.module1_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_correct END,
    CASE WHEN v_rw_present THEN v_rw_row.module2_path END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_easy_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_medium_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.m2_hard_wrong END,
    CASE WHEN v_rw_present THEN v_rw_row.ceiling END,
    CASE WHEN v_rw_present THEN v_rw_row.deduction END,
    CASE WHEN v_rw_present THEN v_rw_row.raw_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.path_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.effective_floor END,
    CASE WHEN v_rw_present THEN v_rw_row.s_raw END,
    CASE WHEN v_rw_present THEN v_rw_row.scaled END,
    v_math_present,
    CASE WHEN v_math_present THEN v_math_row.module1_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_correct END,
    CASE WHEN v_math_present THEN v_math_row.module2_path END,
    CASE WHEN v_math_present THEN v_math_row.m2_easy_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_medium_wrong END,
    CASE WHEN v_math_present THEN v_math_row.m2_hard_wrong END,
    CASE WHEN v_math_present THEN v_math_row.ceiling END,
    CASE WHEN v_math_present THEN v_math_row.deduction END,
    CASE WHEN v_math_present THEN v_math_row.raw_floor END,
    CASE WHEN v_math_present THEN v_math_row.path_floor END,
    CASE WHEN v_math_present THEN v_math_row.effective_floor END,
    CASE WHEN v_math_present THEN v_math_row.s_raw END,
    CASE WHEN v_math_present THEN v_math_row.scaled END,
    v_total, v_partial_display,
    scoring_constants_snapshot_jsonb(v_score_table_ver)
  ) RETURNING id INTO v_score_run_id;

  -- ===================================================================
  -- WRITE THE LEDGER ENTRY (idempotency anchor)
  -- ===================================================================
  INSERT INTO score_run_event_ledger (outbox_event_id, score_run_id, test_session_id)
  VALUES (p_outbox_event_id, v_score_run_id, v_test_session_id);

  -- ===================================================================
  -- V4.2: NO MASTERY EMISSION
  -- Mastery sources directly from canonical test_session_answers via Doc 05
  -- (§16). The scoring transaction does NOT fan out mastery events.
  -- ===================================================================

  RETURN v_score_run_id;
END;
$$;
```

## **12.2 Transactional guarantees**

The orchestrator runs in a single transaction. Either:

- The `score_runs` row AND the `score_run_event_ledger` row commit together
- Neither commits, and the consumer retries safely with the same `outbox_event_id`

No partial states are possible. The single-transaction guarantee is the basis for the outbox-publisher's retry safety per Doc 04A §3.7. **V4.2 note:** V4.1 included mastery_outbox row inserts in this transaction; V4.2 removes them entirely. Mastery has its own canonical-table-sourced path (§16) that is independent of scoring transaction success.

## **12.3 What `scoring_constants_snapshot_jsonb` does**

```sql
CREATE FUNCTION scoring_constants_snapshot_jsonb(p_version text)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE SQL STABLE
AS $$
  SELECT jsonb_object_agg(
    key || COALESCE(':' || section, ''),
    value
  )
  FROM scoring_constants
  WHERE scoring_model_version = p_version;
$$;
```

Returns a JSONB object like `{"alpha_ceiling_exponent": 0.5, "ceiling_floor": 430, "ceiling_max": 800, "deduction_easy": 15, "deduction_medium": 9, "deduction_hard": 6, "path_a_floor": 200, "path_b_floor_base": 450, "path_b_floor_bonus_per_m1_point": 15, "path_b_floor_cap": 580, "raw_floor_base": 200, "raw_floor_multiplier": 400, "round_to_nearest": 10}`. This is the defense-in-depth snapshot stored in `score_runs.constants_snapshot`.

**V4.3 note (reviewer non-blocking #4):** routing thresholds are NOT in this snapshot. V4.2 moved `routing_threshold_rw` and `routing_threshold_m` to `test_forms` per Doc 04A; they are read from the form at scoring time, not from `scoring_constants`. The V4.2 doc still had a stale example showing `"routing_threshold:rw": null` in this snapshot; V4.3 removes that entirely. If a future version moves the routing threshold back into `scoring_constants` (Tier 3 governance only), this example will need to be updated again.

---

# **13. Module Composition Validation and Form Publish Gate**

## **13.1 Locked Lyceon module composition**

Per §3.3 of Doc 04A, every published form must have a deterministic question composition recorded in `test_form_items`. Doc 04B requires that composition match locked targets:

**Reading & Writing (27 questions per module):**

| Module | Easy | Medium | Hard |
|---|---|---|---|
| Module 1 (`module = '1'`) | 8 (30%) | 11 (40%) | 8 (30%) |
| Module 2A (`module = '2A'`) | 14 (52%) | 9 (33%) | 4 (15%) |
| Module 2B (`module = '2B'`) | 4 (15%) | 9 (33%) | 14 (52%) |

**Math (22 questions per module):**

| Module | Easy | Medium | Hard |
|---|---|---|---|
| Module 1 | 7 (32%) | 9 (41%) | 6 (27%) |
| Module 2A | 11 (50%) | 8 (36%) | 3 (14%) |
| Module 2B | 3 (14%) | 8 (36%) | 11 (50%) |

## **13.2 Composition validation function**

```sql
CREATE FUNCTION validate_form_composition(p_test_form_id uuid)
RETURNS TABLE (section text, module text, valid boolean, expected jsonb, actual jsonb)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  -- Expected counts per (section, module)
  expected_counts jsonb := jsonb_build_object(
    'RW:1',  jsonb_build_object('easy', 8,  'medium', 11, 'hard', 8),
    'RW:2A', jsonb_build_object('easy', 14, 'medium', 9,  'hard', 4),
    'RW:2B', jsonb_build_object('easy', 4,  'medium', 9,  'hard', 14),
    'M:1',   jsonb_build_object('easy', 7,  'medium', 9,  'hard', 6),
    'M:2A',  jsonb_build_object('easy', 11, 'medium', 8,  'hard', 3),
    'M:2B',  jsonb_build_object('easy', 3,  'medium', 8,  'hard', 11)
  );
BEGIN
  RETURN QUERY
  WITH actual AS (
    SELECT
      i.section,
      i.module,
      COUNT(*) FILTER (WHERE q.difficulty = 'easy')   AS easy,
      COUNT(*) FILTER (WHERE q.difficulty = 'medium') AS medium,
      COUNT(*) FILTER (WHERE q.difficulty = 'hard')   AS hard
    FROM test_form_items i
    JOIN questions q ON q.id = i.question_id
    WHERE i.test_form_id = p_test_form_id
    GROUP BY i.section, i.module
  )
  SELECT
    a.section,
    a.module,
    (
      a.easy   = (expected_counts->(a.section || ':' || a.module)->>'easy')::int
      AND a.medium = (expected_counts->(a.section || ':' || a.module)->>'medium')::int
      AND a.hard   = (expected_counts->(a.section || ':' || a.module)->>'hard')::int
    ) AS valid,
    expected_counts->(a.section || ':' || a.module) AS expected,
    jsonb_build_object('easy', a.easy, 'medium', a.medium, 'hard', a.hard) AS actual
  FROM actual a;
END;
$$;
```

## **13.3 Publish-time gate**

The form-publish handler (owned by Doc 02/Doc 04 content tooling) MUST call `validate_form_composition` and refuse to mark a form as published if any row returns `valid = false`. This is the canonical gate.

In v1.0, draft forms with off-spec composition can exist but cannot transition to `status = 'published'`. Published forms cannot have their composition changed (per Doc 04A's immutability trigger).

## **13.4 Why composition is locked at the form level**

The scoring formula's constants are calibrated assuming the locked compositions. An off-spec form would produce scores that systematically miss the validated bands.

This is the highest-stakes integrity constraint in the scoring system. Validation at publish-time is non-negotiable.

---

# **14. The Doc 04A → 04B Consumer Seam**

## **14.1 The integration pattern**

Doc 04A writes a row into `exam_runtime_outbox` when a session reaches a scoreable terminal state. A separate consumer process reads from the outbox and invokes Doc 04B's scoring.

```
┌─────────────────────────────────────────────────┐
│ Doc 04A:  test session completes / partially    │
│           abandons with submitted sections      │
│           ├── transition state                   │
│           ├── INSERT INTO exam_runtime_outbox    │
│           │     (event_type, aggregate_id, ...)  │
│           └── commit                              │
└─────────────────────────────────────────────────┘
                  │
                  ▼ (separate process)
┌─────────────────────────────────────────────────┐
│ Outbox publisher / scoring consumer:             │
│   ├── SELECT pending row FOR UPDATE SKIP LOCKED  │
│   ├── CALL score_test_session_from_outbox(id)   │
│   ├── On success: mark outbox row 'published'    │
│   └── On failure: increment attempts, retry      │
└─────────────────────────────────────────────────┘
                  │
                  ▼ (inside score_test_session_from_outbox)
┌─────────────────────────────────────────────────┐
│ Doc 04B scoring (atomic transaction):            │
│   ├── Check ledger (idempotency)                 │
│   ├── Compute sections                            │
│   ├── INSERT INTO score_runs                      │
│   ├── INSERT INTO score_run_event_ledger          │
│   └── commit                                       │
└─────────────────────────────────────────────────┘
                  │
                  ▼ (independent path, NOT inside scoring txn)
┌─────────────────────────────────────────────────┐
│ Doc 05 mastery engine:                           │
│   ├── Reads test_session_answers JOIN questions  │
│   ├── Per-section, per-question (skill, diff,    │
│   │   pass/fail) → mastery update                │
│   └── Independent of score_runs success/failure  │
└─────────────────────────────────────────────────┘
```

## **14.2 Consumer process responsibilities**

The consumer process (operationally part of the Lyceon API/worker tier) is responsible for:

1. Polling `exam_runtime_outbox WHERE status = 'pending'` with `FOR UPDATE SKIP LOCKED LIMIT N`
2. For each row: calling `score_test_session_from_outbox(outbox_row.id)`
3. On success: updating the outbox row to `status = 'published', published_at = now()`
4. On failure: incrementing `attempts`, populating `failure_reason`, leaving the row in `pending` for retry per Doc 04A's outbox semantics (§3.7)

The consumer is NOT part of Doc 04B's scope; it is operational infrastructure. Doc 04B specifies only the function it calls (`score_test_session_from_outbox`) and the function's idempotency contract.

## **14.3 Idempotency contract from 04A's perspective**

Per Doc 04A §4.4: "The scoring pipeline's idempotency contract (defined by 04B) ensures that duplicate `test_session_completed` events for the same `aggregate_id` produce one score_run, not multiple. This is what allows the outbox publisher to retry safely."

Doc 04B fulfills this contract via the orchestrator's ledger check on `outbox_event_id`. If the outbox publisher retries by re-invoking the consumer with the same outbox row, the second invocation returns the existing `score_run_id` without creating a duplicate.

## **14.4 Doc 04A field mapping for scoring queries**

This is the canonical mapping Doc 04B uses to query 04A's schema:

| Doc 04B variable | Doc 04A source |
|---|---|
| `test_session_id` | `test_sessions.id` (passed as `exam_runtime_outbox.aggregate_id`) |
| `student_id` | `test_sessions.student_id` |
| `test_form_id` | `test_sessions.test_form_id` |
| `scoring_model_version` | `test_forms.score_table_version` |
| `routing_threshold` (RW) | `test_forms.routing_threshold_rw` |
| `routing_threshold` (Math) | `test_forms.routing_threshold_m` |
| Section state | `test_session_sections.state` (scoreable when = `'submitted'`) |
| Module 2 path | `test_session_sections.module2_path` |
| M1 correct count | Count of `test_session_answers` with `module = '1'` where `is_answer_correct(answer, question_id) = true` |
| M2 correct/wrong by difficulty | Count of `test_session_answers` with `module = '2A'` or `'2B'` joined to `questions.difficulty` |
| Presented items filter | Join `test_session_answers` against `test_form_items` on `(test_form_id, section, module, ordinal, question_id)` |

---

# **15. Partial-Scoring Path**

## **15.1 What partial scoring means**

A session enters `partial_scored_abandoned` state per Doc 04A §8.3 when:

- At least one section reached state `'submitted'` (by student action or timeout)
- The session's grace window expired before the other section also reached `'submitted'`

Per Doc 04A §8.4, the partial-scoring runtime rule is: only sections in state `'submitted'` are eligible for scoring.

Doc 04A inserts an `exam_runtime_outbox` row with `event_type = 'test_session_partial_scored_abandoned'` carrying a payload that identifies which sections are eligible.

## **15.2 How Doc 04B handles partial scoring**

The orchestrator's flow handles both event types identically with one branch on section eligibility:

- For `test_session_completed`: both sections reached `'submitted'`; both are scored. `total_scaled = rw_scaled + math_scaled`; `partial_display_scaled IS NULL`.
- For `test_session_partial_scored_abandoned`: the orchestrator inspects each section's state. Sections in `'submitted'` are scored; sections in any other state produce NULL columns in `score_runs`. `total_scaled IS NULL`; `partial_display_scaled` carries the single-section scaled value (see §9.1 CHECK constraint).

**Submit-completes-even-with-unanswered.** A student who hits submit on a module without answering every question still transitions that section to `'submitted'` per 04A's state machine. Unanswered presented questions have no `test_session_answers` row; the V4.2 LEFT JOIN scoring pattern (§11.2) treats them as wrong via `is_answer_correct(NULL, ...) = false`. This means the submit action is unambiguous completion — a partially-answered submitted module produces a real, defensible scaled score that reflects the actual answers given.

**Abandonment vs submission.** An abandoned section is one that never reached `'submitted'` state before grace expiry (the student never hit submit). 04A's sweep moves the session to `partial_scored_abandoned` if at least one section was submitted, or `abandoned_final` if no section was submitted. 04B scores only `'submitted'` sections; abandoned sections produce NULL columns and contribute nothing to `total_scaled`.

## **15.3 What students see for partial scores**

The disclosure surface (§17) for partial scores must clearly communicate that the score reflects only one section. The student-facing UI MUST show:

- Which section was scored
- The single section's scaled score (200-800) — sourced from `partial_display_scaled`, NOT from `total_scaled`
- That the other section was abandoned without scoring
- That the partial score is not directly comparable to a full SAT total

The exact UI wording is owned by Doc 04C. Doc 04B provides the underlying data including the `rw_scored` / `math_scored` boolean flags, `partial_display_scaled` (the single-section convenience field), and per-section scaled values.

## **15.4 Why partial scoring is first-class**

Abandoned-mid-test scenarios are not edge cases — they happen routinely in real-world test-taking (technical issues, time pressure, life events). Treating partial scoring as a first-class path (rather than as an error path) means:

- Students who completed one section get credit for it
- The student's effort produces a usable artifact
- Forced retakes are not required to score what was already demonstrated
- Mastery from the completed section's per-question outcomes is captured by Doc 05 (sourced from canonical answer tables — see §16) regardless of whether the other section was abandoned

---

# **16. Mastery Sourcing (No Emission from 04B)**

## **16.1 Doc 04B does not emit mastery events**

Doc 04B emits no mastery events. The `emit_mastery_outbox_for_score_run()` helper, the `test_section_completed` and `test_total_completed` event types, and any `mastery_outbox` writes that earlier drafts of this document described are explicitly out of scope.

The 04B-side architectural commitment, locked at V4.3: **scoring does not fan out mastery signals.** The scoring transaction commits exactly two artifacts — `score_runs` and `score_run_event_ledger` — and nothing else. Mastery is independent of scaled scoring success. A partial test that never produces a full scoring run can still contribute mastery for its completed section; a scoring infrastructure failure does not block mastery updates; the two paths run independently.

This decoupling is the resolution of a coordination ambiguity that earlier drafts inherited from Parent V2.0 §9 invariant #11 ("Mastery events fire only after `score_run` success"). Under V4.3's architecture, that invariant is revised (see §16.4).

## **16.2 Mastery consumer architecture is deferred**

The mastery consumer — how, when, and from where mastery state is computed — is owned by Doc 05. Doc 05 is not yet drafted, and V4.3 does not pre-commit Doc 05 to any specific consumer pattern (polling, trigger-driven, outbox-notified, batch, etc.). Doc 04B asserts only the data contract:

- The canonical answer state lives in `test_session_answers` (Doc 04A's table)
- Per-question correctness is derivable from `test_session_answers JOIN questions` via the canonical comparator `is_answer_correct()` (§10)
- These tables exist the moment a section reaches `'submitted'` state, regardless of whether 04B has computed a scaled score
- Doc 04B does not interpose itself between this data and any mastery consumer

What Doc 05 chooses to do with this data — weighting model, partial-section policy, event timing, retry semantics, KPI rollups — is Doc 05's design space. V4.3 makes no claim about it.

## **16.3 What Doc 04B continues to provide**

Doc 04B continues to provide:

- `score_runs` rows with the computed scaled scores, accessible via SELECT
- The audit-grade decomposition (`rw_module1_correct`, `rw_m2_easy_wrong`, etc.) for support and analytics consumers
- The `source_outbox_event_id` linkage back to 04A's completion event for traceability

What Doc 04B does NOT provide:

- Mastery events of any kind
- Per-question outcome publication (consumers read canonical answer tables directly)
- Any blocking signal that gates mastery on scoring success

## **16.4 Cross-doc invariant (revised from Parent V2.0)**

Parent V2.0 §9 invariant #11 ("Mastery events fire only after score_run success") is **revised** under V4.3's no-mastery-emission-from-04B architecture:

> **Invariant (V4.3):** Mastery state is independent of scaled scoring. A `score_runs` row and any mastery state update are independent artifacts that may complete in any order, fail independently, and recover independently. Scaled scoring success is not a prerequisite for mastery work; mastery work is not a prerequisite for scoring success. The shared feedstock — canonical `test_session_answers` rows — is the only coupling point.

Parent V3.0 will absorb this revision. The V2.0 invariant is preserved in the V2 closeout register for audit history; it is superseded.

---

# **17. Disclosure to Students**

## **17.1 Required disclosure language**

Every UI surface that displays a Lyceon scaled score MUST carry the following language:

> "Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon's internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more."

The wording is approved as v1.0. Variations require Founder/CTO approval.

## **17.2 What disclosure cannot say**

Lyceon UI MUST NOT say:

- "Predicted SAT score" (we model, not predict)
- "Calibrated to College Board scoring" (we are not — calibrated against a widely-referenced third-party adaptive calculator)
- "Equivalent to a real SAT score of X"
- "Score guarantee"
- Anything implying official CB partnership or endorsement

## **17.3 What students see for context — does NOT include path**

Students may optionally view their scoring breakdown. The fields surfaced are:

- Module 1 raw correct count per section
- Module 2 raw correct count per section
- Number of wrong answers per difficulty (easy / medium / hard) in Module 2

The Module 2 path (A or B) is NOT surfaced to students by Doc 04B. Doc 04B stores the path on `score_runs` for audit. Whether to surface path-derived information ("second module difficulty mix") to students is owned by Doc 04C, which may approve specific framings of that information after its own product-spec review.

Intermediate scaled values (ceiling, deductions, floors) are not surfaced to students.

## **17.4 Partial-score disclosure**

For partial-scored sessions, students see:

- The section that was scored, clearly labeled
- The single section scaled score
- Clear messaging that the other section was abandoned without scoring
- Explicit non-comparability to full SAT totals

Exact UI wording is owned by Doc 04C.

## **17.5 Re-scoring transparency**

If a future scoring model version (v2.0+) is published and admin recompute is run, students are NOT shown the recomputed score by default. The original `score_runs` row's `scaled` value remains the student's view.

---

# **18. Validation and Calibration Approach**

## **18.1 Pre-launch validation (V4.3 — synced to regenerated packet)**

v1.0 was validated against Test Ninjas, a widely-referenced third-party adaptive DSAT score calculator. The validation has two components:

1. **Main proportional sweep** — exhaustive over all `(r₁, r₂)` pairs across both sections and both Module 2 paths, with M2 wrong distributions assigned **proportional to the locked Lyceon module composition** (§12). 1,313 total scenarios. The sweep is exhaustive over the `(r₁, r₂)` input space under the proportional-distribution assumption; it is NOT exhaustive over every possible difficulty distribution. The targeted fixtures below cover the non-proportional cases.

2. **Targeted difficulty-distribution fixtures (V4.3 addition)** — 60 scenarios exercising specific non-proportional M2 wrong patterns: `perfect_m2`, `zero_m2`, `all_easy_wrong`, `all_hard_wrong`, and `mixed_half_each`. Generated at 3 canonical M1 levels per section per path (one below threshold, one at threshold, one above). These fixtures give bit-exact reference values for migration-time PG parity verification.

**Main sweep results:**

- 37.8% in exact Test Ninjas band (496 / 1,313)
- 71.1% within 30 scaled points (934 / 1,313)
- 83.9% within 50 scaled points (1,101 / 1,313)
- 98.2% within 100 scaled points (1,290 / 1,313)

**Formal acceptance thresholds** (per Appendix B):

- ≥ 70% within 50 scaled points → **PASS** (83.9%)
- ≥ 95% within 100 scaled points → **PASS** (98.2%)

**Specific data points verified** (from the regenerated V4.3 packet):

- Target case (0/27 M1 + 27/27 M2A RW): Lyceon **430** ✓
- Applerouth Path B miss 1 easy: Lyceon **790**, expected ~750 (+40)
- Applerouth Path B miss 1 hard: Lyceon **790**, expected ~780 (+10)
- Applerouth Math 15/22 M1 + 0/22 M2B: Lyceon **480**, expected ~460 (+20)
- Reddit Bluebook 25/27 + 7/27 M2B RW: Lyceon **600**, expected ~580 (+20)
- Perfect Path B: Lyceon **800** ✓
- Zero everything: Lyceon **200** ✓
- CB Path B floor at threshold: Lyceon **450**, expected 450-480 ✓
- CB Path A peak: Lyceon **630**, expected 580-610 (+20)

The full per-scenario breakdown is in the validation evidence packet referenced in Appendix B.

## **18.2 The validation evidence packet**

The validation is reproducible. The evidence packet (Appendix B) contains:

- `validation_sweep.py` — canonical Python reference implementation, including both the main sweep and the targeted fixtures generator
- `validation_results.csv` — all 1,313 main-sweep scenarios with inputs, intermediate values, Lyceon scaled output, and Test Ninjas band comparison
- `validation_targeted_fixtures.csv` — 60 targeted difficulty-distribution fixtures (V4.3 addition)
- `test_ninjas_bands_reference.csv` — the benchmark band table
- `validation_summary.md` — per-band statistics
- `source_snapshot/extraction_notes.md` — methodology and source-URL documentation (V4.3 addition)
- `evidence_packet.sha256` — SHA-256 hash covering all packet files

**V4.3 packet hash:** `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`

This hash is stored in `scoring_model_versions.v1.0.validation_packet_sha256` (the V4.3 catalog field, distinct from `constants_sha256` per §7.2). The URL to the packet is stored in `validation_packet_url`.

## **18.3 Reference implementation parity**

The Python reference implementation in the evidence packet and the PL/pgSQL production implementation in §11 MUST produce bit-exact identical scaled values for any input. This parity is enforced by:

1. A CI test that runs both implementations against the validation fixtures and asserts equality
2. The validation sweep's results CSV is the contract: any production deploy that disagrees with these results on any scenario fails CI

## **18.4 Known validation limitations**

- The Test Ninjas benchmark is itself a community-calibrated approximation, not official CB IRT output
- The pre-launch validation does not include adaptive-aware paired (Lyceon, real DSAT) student data
- Section-specific behavior in extreme low-score bands is not fully tested due to sparse benchmark coverage there

These limitations are accepted for v1.0. Post-launch student-data calibration (per §18.5) will refine confidence.

## **18.5 Post-launch calibration**

Once student response data accumulates (target: 50+ paired observations per section of Lyceon and real DSAT scores), calibration shifts from theoretical-vs-benchmark to empirical-vs-outcomes.

Calibration that produces directional bias greater than 50 scaled points in any band triggers the v2.0 protocol per §5.1: new scoring model version, new constants, new doc version. **The v1.0 formula is not modified by calibration.** Forms published against v1.0 continue to use v1.0. New forms can opt into v2.0 after its activation.

---

# **19. Failure Modes**

## **19.1 Section not in `submitted` state**

If `score_test_session_from_outbox` is invoked with an outbox event for a session whose target section is not in state `'submitted'`, `compute_section_scaled_score` raises an exception. The orchestrator transaction rolls back. The outbox publisher retries per its policy.

If the section never reaches `'submitted'` (e.g., the row is stuck in `not_started`), the outbox event will fail repeatedly until either operational intervention resolves the session state or the outbox row reaches its retry budget and becomes `failed` (terminal dead-letter per Doc 04A §3.7).

## **19.2 Missing answer for a presented question**

V4.2's LEFT JOIN scoring pattern (§11.2) handles this cleanly: the query base is `test_form_items`, with `test_session_answers` joined in. A presented item with no corresponding answer row appears as `a.answer = NULL`, which `is_answer_correct(NULL, ...)` returns `false` — the question is counted as wrong. This is a normal, first-class path under V4.2/V4.3, not a failure mode.

The presented-item filter via the same LEFT JOIN ensures only-presented-items-are-scored. A stale answer row for a non-presented question (e.g., a routing decision changed during a session) is excluded because the join from `test_form_items` filters it out.

## **19.3 Question record updated mid-session (Doc 02 immutability violation)**

Per Doc 04A §12, Doc 02 immutability violations are hard incidents. If a question's `correct_answer` or `difficulty` changes between presentation and scoring, the scoring function will use the current value. This produces a score that doesn't match what the student saw.

Mitigation: Doc 02's immutability trigger prevents this in normal operation. If it occurs, ops is paged per Doc 04A §12.

## **19.4 Difficulty value missing or invalid**

If `questions.difficulty` is NULL or outside `('easy','medium','hard')`, the question is not counted in any of the difficulty buckets but is still evaluated for correctness. Defense in depth: the `questions.difficulty` column has a NOT NULL constraint and a CHECK constraint per Doc 02. The scoring function logs a warning if it encounters an unexpected value.

## **19.5 Mismatched form composition**

If a form was somehow published with off-spec composition (the publish-time gate failed), the scoring formula will systematically miss its calibrated bands. The scoring function does NOT re-validate composition at scoring time.

Mitigation: `validate_form_composition` is the canonical gate at form-publish. The scoring function trusts published forms.

## **19.6 Scoring model version missing, candidate, or incompletely attested (V4.3 — BLOCKING)**

If `test_forms.score_table_version` references a `scoring_model_versions` row that is missing, in `candidate` status, or has any of `published_at` / `constants_sha256` / `validation_packet_sha256` / `validation_packet_url` NULL, V4.3 **blocks scoring entirely** at the orchestrator entry (§12.1 version-validation gate). The function raises an `integrity_constraint_violation` exception, the transaction rolls back, and no `score_runs` row is inserted.

This is intentional: a `score_runs` row whose model-version provenance cannot be reproduced post-hoc is a worse artifact than no row at all. Better to leave the outbox event pending and surface the misconfiguration to ops than to commit an inscrutable score.

**Scoring against a `superseded` version is explicitly allowed.** This is the historical-reproducibility path: a session tied to a form that was published against a now-superseded version must continue to score against that version's constants forever (per §5.3 and §7.5). Only `superseded` versions with the full attestation triple intact qualify; a superseded row with NULL attestation fields (which shouldn't be possible given the §7.2 CHECK constraint, but defense in depth) is still blocked.

V4.1 and V4.2 docs said the function "still produces a score using whatever constants are present" in this case — that wording is retired in V4.3. The orchestrator now fails hard.

## **19.7 Concurrent scoring of the same session**

If two consumer processes simultaneously invoke `score_test_session_from_outbox` for the same outbox event:

1. Both check the ledger; both see no existing row
2. Both attempt to insert into `score_runs`; one wins via the `UNIQUE (test_session_id)` constraint
3. The loser raises a unique-constraint exception, the transaction rolls back, the consumer retries
4. The retry finds the ledger entry written by the winner and returns the existing `score_run_id`

No duplicate scores. The constraint plus the ledger together provide the safety net.

## **19.8 Outbox publisher exhausts retries**

If the outbox row reaches its retry budget and transitions to `status = 'failed'`, an alert fires per Doc 04A §3.7. The session has been scored if scoring succeeded but the publisher failed to update the outbox row — in which case re-running the publisher manually finds the ledger entry and returns success without re-scoring.

If scoring itself was failing, the outbox row remains in `pending` (publisher increments `attempts` but doesn't transition to `failed` for ordinary failures). Persistent scoring failure requires operational investigation.

## **19.9 Student requests their score before scoring completes**

If a student queries `score_runs` after their test completed but before the outbox publisher has invoked scoring, no row exists. The student-facing UI MUST handle this gracefully ("Scoring in progress"). Doc 04C owns the UI behavior; Doc 04B's responsibility is ensuring scoring happens within bounded latency (target: < 60 seconds from outbox row creation under normal load).

---

# **20. Observability and Audit**

## **20.1 Logging on scoring**

Every `score_test_session_from_outbox` invocation emits a structured log:

```json
{
  "event": "scoring.session.scored",
  "score_run_id": "uuid",
  "test_session_id": "uuid",
  "student_id": "uuid",
  "test_form_id": "uuid",
  "scoring_model_version": "v1.0",
  "source_outbox_event_id": "uuid",
  "source_event_type": "test_session_completed",
  "rw_scored": true,
  "math_scored": true,
  "rw_scaled": 720,
  "math_scaled": 680,
  "total_scaled": 1400,
  "computation_ms": 12,
  "idempotent_return": false
}
```

Logs MUST NOT include: submitted answers, correct answers, per-question correctness, constants_snapshot. The snapshot is in the row, not in the log.

## **20.2 Metrics**

- `scoring.session.duration_ms` (histogram)
- `scoring.session.count` (counter, tagged with source_event_type, both_sections_scored)
- `scoring.session.idempotent_returns` (counter)
- `scoring.session.failures` (counter, tagged with error_class)
- `scoring.section.scaled_distribution` (histogram, tagged with section, path)
- `scoring.total.scaled_distribution` (histogram)
- `scoring.constants.snapshot_hash_mismatches` (counter; alerts on any non-zero rate)

## **20.3 Score audit query (ops/support read access)**

```sql
-- Support query to explain a student's score
SELECT
  sr.test_session_id,
  sr.student_id,
  sr.test_form_id,
  sr.scoring_model_version,
  sr.rw_scored, sr.rw_module1_correct, sr.rw_module2_correct,
  sr.rw_module2_path, sr.rw_m2_easy_wrong, sr.rw_m2_medium_wrong, sr.rw_m2_hard_wrong,
  sr.rw_ceiling, sr.rw_deduction, sr.rw_raw_floor, sr.rw_path_floor,
  sr.rw_effective_floor, sr.rw_s_raw, sr.rw_scaled,
  sr.math_scored, sr.math_module1_correct, sr.math_module2_correct,
  sr.math_module2_path, sr.math_m2_easy_wrong, sr.math_m2_medium_wrong, sr.math_m2_hard_wrong,
  sr.math_ceiling, sr.math_deduction, sr.math_raw_floor, sr.math_path_floor,
  sr.math_effective_floor, sr.math_s_raw, sr.math_scaled,
  sr.total_scaled,
  sr.constants_snapshot,
  sr.computed_at
FROM score_runs sr
WHERE sr.id = $1;
```

This is the canonical answer to "why did this student get score X." Every intermediate value is persisted. Ops can reproduce the computation by reading the row and applying the formula.

## **20.4 No PII in logs**

Per Doc 00 logging discipline, scoring logs contain UUIDs only. Names, emails, and identifying fields are not in scoring log output.

---

# **21. CI / Testing Standards**

## **21.1 Required test classes**

**Unit tests on `compute_section_scaled_score`:**
- The 20+ canonical scenarios in §28 produce exact expected scaled values
- All 1,313 validation sweep scenarios produce identical results to the Python reference
- Idempotency NOT required at this level (orchestrator only)

**Unit tests on `is_answer_correct`:**
- Multiple choice: exact match true, mismatch false
- Student-produced response: variant match true, non-variant false
- NULL submitted: returns false
- Unknown question_type: returns false
- Missing question: raises exception

**Integration tests on `score_test_session_from_outbox`:**
- Full happy path (both sections submitted): `score_runs` row and `score_run_event_ledger` row both present in one transaction; `total_scaled = rw_scaled + math_scaled`; `partial_display_scaled IS NULL`
- Partial-scoring path (only one section submitted): single-section `score_runs` row with other section NULL columns; `total_scaled IS NULL`; `partial_display_scaled = scored_section.scaled`
- Submit-with-blank-answers (V4.2): a `'submitted'` section that has missing answer rows for some presented questions scores those questions as wrong (LEFT JOIN pattern verified)
- Idempotency: second invocation with same `outbox_event_id` returns existing `score_run_id`, no duplicate rows
- Stale outbox event for non-scoreable session: raises exception, no rows written
- Outbox event for missing session: raises exception
- **No mastery_outbox writes** (V4.2): the scoring transaction commits exactly `score_runs` + `score_run_event_ledger`; nothing else

**Schema enforcement tests:**
- Attempt UPDATE on score_runs row: trigger raises exception
- Attempt DELETE on score_runs row: trigger raises exception
- Attempt to insert score_runs with both `rw_scored = false` and `math_scored = false`: CHECK constraint fails
- Attempt to insert score_runs with `rw_scored = true` but `rw_scaled = NULL`: CHECK constraint fails
- Attempt to insert scoring_constants with duplicate (version, key, section): UNIQUE constraint fails

**Anti-leak tests:**
- No log output contains correct answer text in any scoring path
- No exception message contains correct answer text
- `is_answer_correct` does not surface the correct answer in any error case
- Student RLS: a student querying another student's score_runs returns empty (not error)

**Reference parity tests:**
- Run PL/pgSQL `compute_section_scaled_score` against all 1,313 validation scenarios
- Compare against Python `validation_results.csv` row-by-row
- Any disagreement on any scenario fails CI

**Performance tests:**
- Single `score_test_session_from_outbox` completes in < 200ms under normal load
- Concurrent scoring of 100 sessions without deadlock
- Constants table reads bounded to < 20 queries per scoring run (measured via `pg_stat_statements`)

## **21.2 Reference parity — lock-time validation, not a per-deploy CI gate (V4.3)**

V4.1 and V4.2 framed the Python↔PL/pgSQL parity check as a CI gate that runs on every deploy. V4.3 rejects that framing. The canonical scoring formula lives in Supabase as a PL/pgSQL RPC and is **immutable post-launch per §23 Tier 3 governance** — the function does not change once v1.0 is locked. There is no meaningful "drift" surface that a per-deploy CI gate would catch.

What V4.3 requires instead:

1. **Lock-time validation (once, at v1.0 activation).** At the moment the v1.0 `scoring_model_versions` row transitions from `candidate` to `active`, the deployer MUST run the validation evidence packet's Python reference against the deployed PL/pgSQL function and confirm bit-exact parity on:
   - All 1,313 main-sweep scenarios in `validation_results.csv`
   - All 60 targeted difficulty-distribution fixtures in `validation_targeted_fixtures.csv`
   - The 28 boundary `.5`-case rounding scenarios identified in §6.3

   Any disagreement blocks activation. The activation transaction will not commit.

2. **Migration-time smoke check.** When the scoring function is initially deployed via migration (and only at that moment), the migration runs a smoke-check fixture of ~20 canonical scenarios from §28 (worked examples) and asserts the function returns expected values. This is a one-shot migration test, not a recurring CI job.

3. **Post-lock invariance.** Per §23, the scoring function definition is sealed: no Tier 1 documentation changes affect it; no Tier 2 changes are permitted within v1.0; any Tier 3 change requires a new `scoring_model_versions` row (e.g., v2.0) with its own validation packet and its own activation cycle. Because the function does not change, there is nothing to re-verify on each application deploy.

4. **The validation evidence packet is the canonical proof at lock time.** Reviewers and auditors can re-run `validation_sweep.py` independently against the locked v1.0 formula and confirm the documented hash (`29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`) and the documented statistics. This is the proof of correctness; it does not need to be repeated per deploy.

**Why this matters:** the formula is the moat. Treating it as a thing that requires constant per-deploy re-verification implies it might drift, which contradicts the "canonical and immutable" doctrine. Lock-time validation + immutability triggers + Tier 3 governance + sealed `scoring_constants` (§8.4) collectively guarantee the formula does not drift; no CI bottleneck is needed.

## **21.3 Coverage requirements**

- 95%+ line coverage on `compute_section_scaled_score`
- 95%+ line coverage on `is_answer_correct`
- 95%+ line coverage on `score_test_session_from_outbox`
- 100% coverage on the formula computation steps (`v_ceiling`, `v_deduction`, `v_raw_floor`, `v_path_floor`, `v_floor`, `v_s_raw`, `v_s_clamped`, `v_scaled`)
- Coverage is measured at lock time and at any Tier 3 change cycle; not on each application deploy (consistent with §21.2)

---

# **22. Known Architectural Debt**

## **22.1 RLS identity assumption — Doc 01 coordination gap**

V4.3's `score_runs_student_read` RLS policy uses `current_student_id()`, a helper expected to be defined by Doc 01. At V4.3 lock time, Doc 01 V6 declares `profile-service.ts` as canonical writer for `profiles` but does not yet enumerate the `current_student_id()` resolution function for RLS contexts. Same gap applies to `is_admin()` for the admin recompute table policy.

**Resolution path:** Doc 01 V7 (or coordination memo) defines `current_student_id()` and `is_admin()`. Doc 04B's RLS policies update to use them. Until then, the placeholder is `auth.uid()` for student identity with the explicit caveat that this may need to change. **This is the single remaining external blocker for production deployment of 04B V4.3; it does NOT block document lock.**

## **22.2 `form_equating_offset` retirement (V4.2 — no longer debt)**

V4.1 carried `form_equating_offset` forward from Parent V2.0's 3-layer scaling architecture as latent calibration capacity. V4.2 retires it: the column is dropped from `test_forms` (pending 04A V2.2 schema migration) and 04B ignores it. The difficulty-weighted M2 deductions (D_e=15, D_m=9, D_h=6) provide implicit per-form reweighting through the difficulty distribution of M2 wrong answers, which honors the canonical-formula doctrine (two forms with the same `scoring_model_version` produce identical scaled scores from identical raw answers). Form-level calibration migrates to routing threshold tuning or version pinning.

This was formerly architectural debt; under V4.2 it is **resolved**. Listed here for closure and audit history.

## **22.3 No section-specific constants forked at launch**

The `scoring_constants` schema supports per-section constants via the `section` column. At v1.0, all formula constants use `section = NULL` (global). Post-launch data may show RW and Math need different α or different deductions; the fork is supported but not pre-populated. This is **NOT a v1.0 modification path** — section-specific tuning produces v2.0.

## **22.4 No experimental items**

Per §5.4. Future need would produce v2.0.

## **22.5 IRT migration**

Per §5.2. Post-launch ADR, year 2+. Produces v2.0+.

## **22.6 Form composition tuning is not retroactive**

If module composition targets change in v2.0, existing v1.0 forms continue with their original compositions. No automated migration. Manual form-retirement cycle if needed.

## **22.7 No mid-test score preview**

Intentional. Score is computed once on completion, not progressively. Preview would risk leakage.

---

# **23. Change Control**

## **23.1 Levels of change**

**Tier 1 — Documentation only.** Wording, examples, explanatory text. No constants, schema, or function body changes. Approval: Document Owner.

**Tier 2 — Forbidden within v1.0.** Constants changes, schema changes, function-body changes within the v1.0 scoring model version are NOT permitted. Per §5.1, the formula is canonical and immutable at v1.0.

**Tier 3 — New scoring model version.** Introducing v2.0+ with new formula structure, new constants, or new behavior. Requires:
- Full external review cycle
- New `scoring_model_versions` row with `status = 'candidate'`
- Validation sweep results against industry benchmark
- Founder/CTO approval
- A new V5+ of this document
- Coordinated form-republish for forms opting in to the new version

## **23.2 What does NOT trigger a version change**

- Documentation clarifications
- Adding new audit columns to `score_runs` (Tier 1 if they don't affect computation)
- Adding new metrics or observability surfaces
- Bug fixes that bring PL/pgSQL into parity with the Python reference (these are correctness fixes, not formula changes)
- Pinning the rounding rule explicitly when prior wording was ambiguous (per V4.2 §6.3 precedent — same canonical formula, clearer spec)

## **23.3 What absolutely triggers a version change**

- Changing α, any deduction weight, any floor parameter, ceiling band, ceiling max, or rounding
- Changing the formula structure (e.g., replacing the banded ceiling with proportional deductions)
- Changing the comparator logic
- Changing the module composition targets
- Changing the routing threshold values
- Changing how the path floor scales with M1 margin
- Adding any new term to the formula

---

# **24. Verification Before Refactor Checklist**

Before any refactor that touches scoring code or schema:

- [ ] The current `compute_section_scaled_score` has 95%+ test coverage with reference parity passing
- [ ] The validation sweep produces results identical to `validation_results.csv` before the refactor (hash check via Appendix B)
- [ ] The `score_runs` schema accommodates all fields the new code path will write, including `partial_display_scaled` for partial paths (V4.2)
- [ ] The `score_run_event_ledger` is reachable from the new code path
- [ ] The anti-leak boundary is preserved: no correct answer serializes to application code
- [ ] RLS policies still apply to all new/changed read paths
- [ ] The `constants_snapshot` and `scoring_model_version` captures are preserved
- [ ] Idempotency at the orchestrator level is preserved
- [ ] No client-side scoring path has been introduced
- [ ] Disclosure language is unchanged or has Founder/CTO approval
- [ ] The LEFT JOIN pattern from `test_form_items` is preserved — missing answers count as wrong (V4.2 §11.2)
- [ ] Rounding remains round-half-up-to-10 in both implementations (V4.2 §6.3)
- [ ] The scoring transaction does NOT emit mastery events (V4.2 §16 invariant)
- [ ] The Doc 04A → 04B consumer seam contract is preserved (event types, payload shape)
- [ ] SECURITY DEFINER + search_path is present on every privileged function
- [ ] DB permission grants (REVOKE UPDATE/DELETE) are preserved
- [ ] Partial-scoring path is exercised by tests

The engineer runs the checklist pre-PR. The reviewer runs it pre-merge. Both sign off.

---

# **25. Cross-Document Dependencies**

## **25.1 Doc 04B depends on:**

- **Doc 00** for platform invariants
- **Doc 04 Parent V3.0** (pending) for full-length governance and "tests are truth anchor"; absorbs V4.2's architectural decisions
- **Doc 04A V2.1** for `test_forms`, `test_form_items`, `test_sessions`, `test_session_sections`, `test_session_answers`, `exam_runtime_outbox` schemas; the event-type contract; the section state machine. **04A V2.2** (pending) will drop `form_equating_offset` and pin `score_table_version` FK to `scoring_model_versions`
- **Doc 01 V6+** for `current_student_id()`, `is_admin()`, identity model — coordination gap flagged in §22.1
- **Doc 02A** for question authoring including difficulty bucketing
- **Doc 02B** for `questions` table schema and canonical correct_answer/correct_variants

## **25.2 Doc 04B is depended on by:**

- **Doc 04C** for score display surface (student and guardian); reads `partial_display_scaled` for single-section partial display (V4.2 §9.1)
- **Doc 04D** for integrity and audit reading `score_runs`
- **Doc 09** for KPI aggregation
- Future tutor coaching features

**Doc 05 is NOT a Doc 04B consumer.** Doc 04B does not emit mastery events; the scoring transaction commits only `score_runs` and `score_run_event_ledger`. Whatever consumer pattern Doc 05 ultimately adopts when drafted will source its inputs from the canonical answer tables (`test_session_answers`, `questions`), which exist independently of 04B's outputs. Doc 04B asserts only the no-emission commitment; specific Doc 05 design decisions are out of 04B's scope and will be settled when Doc 05 is drafted.

## **25.3 Coordination protocol**

- Changes to the 04A → 04B consumer seam require sign-off from both document owners
- Changes to score disclosure require Doc 04C owner sign-off
- Changes to comparator behavior require Doc 02A and Doc 04A owner sign-off
- Any future proposal to route mastery signals through 04B (rather than sourcing from canonical answers) requires reopening the V4.3 §16 architectural decision via Tier 3 change governance

---

# **26. Final Principles**

1. **The scoring formula is canonical and immutable at v1.0.** Constants tuning does not exist within v1.0. Changes produce v2.0+.

2. **The math runs in the database, never in application code.** Comparator, math, and persistence inside Postgres. Application calls one function.

3. **The score is computed exactly once per test session.** `score_runs` is insert-once. Retries return existing row.

4. **The score is deterministic.** Identical inputs produce identical outputs. Python reference and PL/pgSQL production produce bit-exact identical scaled values.

5. **The score is auditable.** Every intermediate value persisted. Every constant snapshotted. Scoring model version pinned.

6. **The score is calibratable only by introducing new versions.** v1.0 forms produce v1.0 scores forever. New formulas produce new versions, never modify existing ones.

7. **The score does not leak.** Correct answers stay in the database. No log, no error trace, no API response exposes a correct answer.

8. **The score is honest about its limits.** Disclosure tells students this is Lyceon-modeled, not CB-predicted.

9. **The score serves learning, not engagement.** No softening, no inflation.

10. **The formula is the moat.** Everything else builds around it to work perfectly and deterministically.

---

# **27. Change Records**

| Version | Date | Author | Change | Rationale |
|---|---|---|---|---|
| V1 | (prior) | (prior) | Initial deduction-only scoring | Initial structure |
| V2 | (prior) | (prior) | M2-only deduction model | Eliminated double-counting |
| V3 | (prior) | (prior) | Lifecycle complexity + 23-closeout register | Locked lifecycle later reset |
| V4 | 2026-05-11 | Karl + Claude | Full rewrite. Locked Option A formula. Removed lifecycle complexity. | Validation sweep confirmed industry-benchmark alignment |
| V4.1 | 2026-05-12 | Karl + Claude | Engineering alignment pass. Formula unchanged (canonical v1.0). Schema and infrastructure conformed to Doc 04A V2.1 locked. All 10 V4 reviewer blockers addressed. | Reviewer-identified correctness and seam issues; formula declared canonical moat |
| V4.2 | 2026-05-12 | Karl + Claude | Reviewer pushback pass. Formula unchanged (bit-exact). Rounding pinned to round-half-up-to-10 in both languages. Math section code bug fixed. LEFT JOIN refactor so missing answers count as wrong. `total_scaled` strict 400-1600 + new `partial_display_scaled`. `scoring_model_versions.published_at` nullable for candidate workflow. `scoring_constants` mutation-prevention trigger. `score_runs` permissions tightened (function-EXECUTE gating). `scoring_constant()` raises loudly. SECURITY DEFINER ownership pinned to `lyceon_scoring_owner`. **Mastery emission removed entirely from 04B** — Doc 05 sources from canonical `test_session_answers`. `form_equating_offset` retired alongside 3-layer scaling. Evidence packet regenerated; documented hash now reproducible. | Reviewer 7-blocker pushback + 4 non-blocking hardening items; Karl Q1/Q2/Q3 alignment on scoring architecture |
| V4.3 | 2026-05-12 | Karl + Claude | Reviewer-cleanup pass. Formula bit-exact unchanged. `scoring_model_versions` catalog split into three attestation fields (`constants_sha256`, `validation_packet_sha256`, `validation_packet_url`). `scoring_constants` mutation trigger extended to INSERT (was UPDATE/DELETE only). Partial unique index added for race-safe single-active enforcement. Explicit version-validation gate at orchestrator entry (§12.1) blocks scoring against missing/candidate/incompletely-attested versions. §18.1 statistics synced exactly to regenerated packet (71.1/83.9/98.2). §18.1 wording tightened: "exhaustive over (r1,r2) under proportional M2 distribution"; 60 targeted difficulty-distribution fixtures added to evidence packet (`validation_targeted_fixtures.csv`). §21.2 CI parity rewritten — no per-deploy bottleneck; lock-time validation + immutable post-lock + Tier 3 governance is sufficient. §12.3 snapshot example refreshed (no stale `routing_threshold:rw`). §19.6 failure mode tightened to BLOCKING for unattested versions. §16/§25 Doc 05 language softened — no pre-commitment of Doc 05's consumer design. Unsourced "CB rounds half up" claim dropped. "Industry-standard" softened to "widely-referenced third-party" where appropriate. Evidence packet hash: `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`. | Reviewer 7-blocker pushback (constants_sha256 overload, INSERT gap, race-prone single-active, validation gate, stats mismatch, exhaustive wording, snapshot example) + 2 SWE standards (CB claim, source notes) + Karl Q1-Q6 alignment |

Future change records to be appended below this row.

---

# **28. Worked Examples**

All examples use the locked v1.0 formula. Values verified bit-exact against the Python reference and the PL/pgSQL production implementations.

## **28.1 Strong Path B student (both sections)**

Inputs:
- RW: M1 = 24/27, M2B path, M2 = 22/27 (5 wrong: 1 easy, 2 medium, 2 hard)
- Math: M1 = 20/22, M2B path, M2 = 18/22 (4 wrong: 1 easy, 1 medium, 2 hard)

RW: ceiling = max(430, 800·(24/27)^0.5) = **754.2**. Deduction = 15+18+12 = **45**. Raw floor = 200 + 400·(46/54) = **540.7**. Path floor = min(580, 450 + 15·6) = **540**. Effective floor = 540.7. S_raw = 709.2. **Scaled = 710.**

Math: ceiling = max(430, 800·(20/22)^0.5) = **762.8**. Deduction = 15+9+12 = **36**. Raw floor = 200 + 400·(38/44) = **545.5**. Path floor = min(580, 450 + 15·5) = **525**. Effective floor = 545.5. S_raw = 726.8. **Scaled = 730.**

Total = **1440.**

## **28.2 Mid Path A student**

Inputs:
- RW: M1 = 14/27, M2A path, M2 = 14/27 (13 wrong: 7 easy, 4 medium, 2 hard from M2A distribution)

ceiling = max(430, 800·(14/27)^0.5) = **576.1**. Deduction = 105+36+12 = **153**. Raw floor = 200 + 400·(28/54) = **407.4**. Path floor = **200**. Effective floor = 407.4. S_raw = 423.1. **Scaled = 420.**

## **28.3 Target case (banded ceiling)**

Inputs:
- RW: M1 = 0/27, M2A path, M2 = 27/27 (0 wrong)

ceiling = max(430, 800·0^0.5) = **430**. Deduction = **0**. Raw floor = 200 + 400·(27/54) = **400.0**. Path floor = **200**. Effective floor = 400. S_raw = 430. **Scaled = 430.** Banded ceiling enforces protection for strong M2A despite zero M1.

## **28.4 Perfect everything**

Inputs:
- RW: 27/27 M1 + 27/27 M2B
- Math: 22/22 M1 + 22/22 M2B

ceiling = 800. Deduction = 0. **Each section = 800.** **Total = 1600.**

## **28.5 High M1, collapsed M2B**

Inputs:
- RW: M1 = 25/27, M2B path, M2 = 7/27 (20 wrong: 3 easy, 7 medium, 10 hard from M2B distribution)

ceiling = max(430, 800·(25/27)^0.5) = **769.8**. Deduction = 45+63+60 = **168**. Raw floor = 200 + 400·(32/54) = **437.0**. Path floor = min(580, 450 + 15·7) = **555**. Effective floor = 555. S_raw = 601.8. **Scaled = 600.** Matches community-reported Bluebook outcome of 580 within +20.

## **28.6 Zero everything**

Inputs:
- RW: M1 = 0/27, M2A path, M2 = 0/27 (27 wrong: 14 easy, 9 medium, 4 hard from M2A distribution)

ceiling = **430**. Deduction = 210+81+24 = **315**. Raw floor = **200**. Path floor = **200**. Effective floor = 200. S_raw = 115. Clamped to floor 200. **Scaled = 200.**

## **28.7 Partial scoring — RW completed, Math abandoned**

Inputs:
- RW: completed normally (e.g., 22/27 M1 + 22/27 M2B = scaled 670 per the formula)
- Math: state remained `module1_active` at grace expiry; never submitted

Result (V4.2): `score_runs` row with `rw_scored = true`, `rw_scaled = 670`, `math_scored = false`, `math_scaled = NULL`, **`total_scaled = NULL`** (per §15.2 — total_scaled is strictly full-SAT), **`partial_display_scaled = 670`** (single-section convenience field per §9.1).

Disclosure: student sees "RW: 670. Math: abandoned." with appropriate framing per Doc 04C. 04C MUST source the displayed value from `partial_display_scaled` (or directly from `rw_scaled` / `math_scaled`), NOT from `total_scaled`.

## **28.8 Submit-with-blank-answers (V4.2 LEFT JOIN demonstration)**

Inputs (RW section):
- M1: 27 questions presented; student answers 25, leaves 2 blank, hits submit (`submitted_by = 'student'`)
- M2: routed to M2A based on M1 raw; 27 questions presented; student answers 20, leaves 7 blank, hits submit

Under V4.2's LEFT JOIN scoring (§11.2), the 2 missing M1 answer rows and 7 missing M2 answer rows count as wrong via `is_answer_correct(NULL, ...) = false`. The scoring math operates on the full presented counts. If, of those answers given, M1 has 18 correct (out of the 25 answered → 9 wrong including the 2 blanks) and M2A has 14 correct (out of the 20 answered → 13 wrong including the 7 blanks, distributed across difficulty by the M2A composition), the scaled score reflects all 27 presented questions per module, not just the 25/20 answered.

Under V4.1's INNER JOIN scoring (the bug), the missing rows were silently excluded; effective N1 and N_total shrunk to the answer-count, inflating the score artificially. V4.2 fixes this so submit-with-blank-answers is semantically "complete but incorrect on the blanks" — exactly the Karl-confirmed mental model.

---

# **29. Appendix A — Scoring Constants Catalog (v1.0)**

```sql
INSERT INTO scoring_model_versions (
  version, formula_name, formula_doc_ref,
  constants_sha256,
  validation_packet_sha256,
  validation_packet_url,
  status, published_at
) VALUES (
  'v1.0',
  'option_a_banded_ceiling',
  'Doc 04B V4.3 §6',
  '<computed at deploy time from sorted scoring_constants rows below>',
  '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b',
  'git://lyceon-spec/04B/v4.3/evidence_packet_v42/',   -- replace with canonical deploy URL
  'active',
  '2026-05-12T00:00:00Z'
);

INSERT INTO scoring_constants (scoring_model_version, key, section, value, description) VALUES
  ('v1.0', 'alpha_ceiling_exponent', NULL, 0.5,
   'Power function exponent for M1-driven ceiling'),
  ('v1.0', 'ceiling_floor', NULL, 430,
   'Minimum value of the M1-driven ceiling; protects low-M1/strong-M2 students'),
  ('v1.0', 'ceiling_max', NULL, 800,
   'SAT scaled-score maximum per section'),
  ('v1.0', 'deduction_easy', NULL, 15,
   'Scaled points subtracted per wrong easy M2 question'),
  ('v1.0', 'deduction_medium', NULL, 9,
   'Scaled points subtracted per wrong medium M2 question'),
  ('v1.0', 'deduction_hard', NULL, 6,
   'Scaled points subtracted per wrong hard M2 question'),
  ('v1.0', 'raw_floor_base', NULL, 200,
   'Raw-percent floor constant term'),
  ('v1.0', 'raw_floor_multiplier', NULL, 400,
   'Raw-percent floor scaling factor (against total raw fraction)'),
  ('v1.0', 'path_a_floor', NULL, 200,
   'Absolute floor for Path A students'),
  ('v1.0', 'path_b_floor_base', NULL, 450,
   'Path B floor at routing threshold'),
  ('v1.0', 'path_b_floor_bonus_per_m1_point', NULL, 15,
   'Path B floor lift per M1 correct above threshold'),
  ('v1.0', 'path_b_floor_cap', NULL, 580,
   'Maximum value of the Path B graded floor'),
  ('v1.0', 'round_to_nearest', NULL, 10,
   'Final score rounding unit');

-- Note: routing_threshold_rw and routing_threshold_m are NOT in this table.
-- They live on test_forms per Doc 04A and are read from there during scoring.
-- Per §8.3, section_total_questions and module1_questions are also NOT
-- canonical here; they are derived from test_form_items at scoring time.
```

---

# **30. Appendix B — Validation Evidence Packet Reference (V4.3)**

The validation evidence packet contains the canonical Python reference implementation, the full validation sweep results, the targeted difficulty-distribution fixtures (V4.3 addition), the benchmark band table, the summary report, and source-extraction notes. The packet is referenced by SHA-256 hash for tamper-evidence.

**V4.3 packet hash:**

```
29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b
```

This is the SHA-256 of the concatenated file contents, taken in sorted-full-path order. The hash is reproducible by running `validation_sweep.py` and applying the `compute_packet_hash()` helper at the end of the script. Any consumer who re-runs the sweep against the v1.0 formula MUST observe this exact hash; a mismatch indicates either drift in `validation_sweep.py`, a Python platform difference (none expected — the rounding rule is pinned in V4.3 §6.3), or a CI environment problem.

**V4.3 validation statistics** (under the round-half-up-to-10 rule, regenerated for V4.3):

| Metric | V4.3 result | Threshold | Pass |
|---|---|---|---|
| Main-sweep scenarios | 1,313 | — | — |
| In Test Ninjas band | 496 (37.8%) | informational | — |
| Within 30 scaled points | 934 (71.1%) | informational | — |
| Within 50 scaled points | **1,101 (83.9%)** | ≥ 70% | ✓ |
| Within 100 scaled points | **1,290 (98.2%)** | ≥ 95% | ✓ |
| Targeted fixtures (V4.3) | 60 | bit-exact reference | — |

Both formal acceptance thresholds are satisfied with margin. The numbers are unchanged from V4.2's regenerated packet (the formula did not change between V4.2 and V4.3); the V4.3 hash differs because the packet now also contains `validation_targeted_fixtures.csv` and `source_snapshot/extraction_notes.md`.

**Packet contents (V4.3):**

| File | Purpose |
|---|---|
| `validation_sweep.py` | Canonical Python reference implementation of the locked v1.0 formula; reproducible sweep generator; includes both the main sweep and the targeted fixtures generator |
| `validation_results.csv` | All 1,313 main-sweep scenarios with full intermediate values, Lyceon scaled, and Test Ninjas band comparison |
| `validation_targeted_fixtures.csv` | **V4.3 addition.** 60 scenarios exercising non-proportional M2 wrong patterns: `perfect_m2`, `zero_m2`, `all_easy_wrong`, `all_hard_wrong`, `mixed_half_each` — at 3 canonical M1 levels per (section, path) |
| `test_ninjas_bands_reference.csv` | Test Ninjas raw-to-scaled band table used as benchmark |
| `validation_summary.md` | Per-band summary statistics and acceptance threshold pass/fail |
| `source_snapshot/extraction_notes.md` | **V4.3 addition.** Methodology, source URLs, date accessed, and Lyceon's interpretation notes for the benchmark band table. See §18.2. |
| `evidence_packet.sha256` | SHA-256 hash covering all packet files (V4.3: `29c3e0fd...9b88651b`) |

**Reproducibility guarantee:**

The packet's `validation_results.csv` and `validation_targeted_fixtures.csv` are byte-identical for any run of `validation_sweep.py` against the locked v1.0 formula with the V4.3 round-half-up rounding rule. The packet is the canonical proof artifact at v1.0 lock time per §21.2; it is not regenerated on each deploy because the formula does not change post-lock.

**Packet hash usage** (V4.3 catalog schema, per §7.2):

- The packet hash is stored in `scoring_model_versions.v1.0.validation_packet_sha256`
- The packet retrieval URL is stored in `scoring_model_versions.v1.0.validation_packet_url`
- The hash of the actual `scoring_constants` rows for v1.0 is stored separately in `scoring_model_versions.v1.0.constants_sha256` (these are different artifacts; V4.2 incorrectly conflated them)

**Source corroboration** (informational, not part of the deterministic hash):

| Source | URL | Use |
|---|---|---|
| Test Ninjas DSAT score calculator | https://test-ninjas.com/digital-sat-score-calculator | Primary third-party benchmark for the band-alignment validation |
| Applerouth practice DSAT report | (interview notes; reviewer can fetch from cited URL) | Specific calibration check cases in §28 and high-priority cases table |
| College Board DSAT practice tests | https://bluebook.collegeboard.org | Boundary case sanity check (perfect, near-perfect, Path B threshold) |
| r/SAT community Bluebook reports | https://www.reddit.com/r/Sat/ | Community calibration check for high-M1 / collapsed-M2B path |

**Reviewer note (V4.3):** Live HTML snapshots, screenshots, and reviewer signoffs are NOT bundled in the evidence packet. The Lyceon evidence packet contains the methodology, the extracted band table, the Python reference, and the documented source URLs. Reviewers performing audit-grade verification are expected to capture live snapshots from the cited URLs themselves; pre-fetched binary artifacts are not Lyceon's responsibility to fabricate. See `source_snapshot/extraction_notes.md` in the packet.

---

# **31. Appendix C — Supersession of V1, V2, V3, V4, V4.1, V4.2**

**Retired from V1:**
- 50/30/20 deduction scheme
- Deductions applied to both modules
- Flat Path B floor of 450
- Binary path routing math

**Retired from V2:**
- α = 0.7 ceiling exponent
- 25/15/10 deduction weights
- No banded ceiling

**Retired from V3:**
- `score_table_versions` lifecycle complexity
- 5-state machine on score runs
- `is_current` / `run_sequence` patterns
- `invalidated` / `superseded` row-level state machine
- `admin_audit_outbox` table
- Separate `easy_path_ceiling` table
- `form_equating_offset` separate table
- `disclosure_versions` table

**Retired from V4:**
- Direct call from Doc 04A to `score_test_session` (replaced by outbox consumer pattern)
- V4 field names like `test_sessions.form_id`, `test_sessions.module2_path_{section}`, `test_session_answers.session_id`, `test_session_answers.submitted_answer` (replaced with Doc 04A canonical names)
- `module` as integer 1/2 (replaced with text '1'/'2A'/'2B' per 04A)
- `routing_threshold` in `scoring_constants` (moved to `test_forms` per 04A)
- `scoring_constants` PRIMARY KEY on (key) alone (replaced with composite key via UNIQUE INDEX)
- Section-level idempotency in `compute_section_scaled_score` (idempotency moved to orchestrator only)
- "External mastery emission" framing
- Student-facing exposure of Module 2 path (removed; deferred to Doc 04C)
- Presented-item filtering as v1.1 debt (V4.1 implemented as test_form_items join; V4.2 hardens via LEFT JOIN)
- Insert-once enforced only by RLS (V4.1 added three-layer enforcement; V4.2 tightens further by revoking direct INSERT and gating via function EXECUTE)
- RLS using `auth.uid()` directly (V4.1 introduced placeholder for Doc 01 `current_student_id()`; V4.2 maintains the coordination flag)

**Retired from V4.1 (V4.2 changes):**
- Banker's-rounding ambiguity in §6.3 — V4.2 pins round-half-up-to-10 explicitly in both languages
- `upper('math') = 'MATH'` section code mapping bug in §11.2 — V4.2 derives `v_section_code` via explicit CASE
- INNER JOIN `test_session_answers JOIN test_form_items` scoring queries — V4.2 inverts to LEFT JOIN from `test_form_items` so missing answers count as wrong
- `scoring_model_versions.published_at NOT NULL` — V4.2 makes it nullable with CHECK constraint for `active`/`superseded` only
- Missing mutation-prevention on `scoring_constants` — V4.2 adds BEFORE UPDATE/DELETE trigger for active/superseded versions
- `total_scaled` overloaded to single-section value when partial — V4.2 makes `total_scaled` strictly full-SAT NULL when partial, introduces `partial_display_scaled`
- **Entire §16 mastery-outbox emission machinery** — V4.2 removes `emit_mastery_outbox_for_score_run()`, the `test_section_completed` / `test_total_completed` event types, and the `mastery_outbox` schema sketch. Mastery sources from canonical answer tables (Doc 05's design)
- `score_runs` INSERT granted to `authenticated` — V4.2 revokes all direct table writes; only the scoring function with EXECUTE-to-service_role can insert
- `scoring_constant()` returning NULL silently on missing lookups — V4.2 raises `no_data_found` exception
- SECURITY DEFINER functions owned by deployer/superuser — V4.2 pins ownership to `lyceon_scoring_owner` role
- `form_equating_offset` retained as latent calibration knob — V4.2 retires it (flagged to 04A V2.2 for column removal)
- Validation packet hash documented but not reproducible by a reader — V4.2 documents hash + the `compute_packet_hash()` script method (sorted-full-path concatenation) so any reader can verify

**Preserved from V1-V4.1:**
- The canonical scoring formula (unchanged at v1.0; bit-exact except for the 28 `.5`-boundary scenarios whose output is now disambiguated by V4.2's explicit rounding rule)
- All v1.0 constant values (unchanged)
- "Scoring math runs in PL/pgSQL" architectural decision
- DB-driven constants pattern
- Disclosure language framing
- Append-only persistence pattern
- The transactional outbox consumer pattern via `exam_runtime_outbox`

**Retired from V4.2 (V4.3 changes):**
- `constants_sha256` overloaded to also represent the validation packet hash — V4.3 splits into three distinct fields: `constants_sha256` (sorted scoring_constants rows), `validation_packet_sha256` (the evidence packet hash), `validation_packet_url` (canonical retrieval location)
- `scoring_constants` mutation trigger covering only UPDATE/DELETE — V4.3 extends to INSERT so new rows cannot be slipped into active/superseded versions
- Single-active-version enforcement via trigger-only existence check (race-prone) — V4.3 adds a partial unique index `WHERE status = 'active'` for atomic enforcement; trigger remains for friendly errors
- §19.6 wording "still produces a score using whatever constants are present" for missing/superseded versions — V4.3 makes scoring against unattested versions BLOCKING (via §12.1 version-validation gate)
- §18.1 statistics carrying V4.1 banker's-rounding numbers (70.8 / 84.2) and Path B miss-1-easy = 780 — V4.3 syncs to the regenerated packet exactly (71.1 / 83.9 and 790)
- "Exhaustive sweep of all scenarios" overclaim — V4.3 tightens to "exhaustive over (r1, r2) under proportional M2 distribution" and adds 60 targeted difficulty-distribution fixtures (`validation_targeted_fixtures.csv`)
- §21.2 framing the Python↔PL/pgSQL parity as a per-deploy CI gate — V4.3 replaces with lock-time validation + post-lock immutability + Tier 3 governance; the formula is set-and-forget in Supabase RPC, no per-deploy bottleneck
- `scoring_constants_snapshot_jsonb` example still mentioning `"routing_threshold:rw"` — V4.3 refreshes the example (routing thresholds moved to `test_forms` in V4.2)
- Unsourced "College Board's own published score tables round half up" claim in §6.3 — V4.3 drops it; rationale stands on determinism + cross-language parity alone
- "Industry-standard" wording for Test Ninjas — V4.3 softens to "widely-referenced third-party DSAT score calculator"
- §16/§25 pre-committing Doc 05 to a specific consumer pattern — V4.3 softens to "Doc 05 design is deferred"; 04B asserts only the no-emission commitment

**Preserved from V1-V4.2:**
- The canonical scoring formula (unchanged at v1.0; bit-exact across V4 → V4.1 → V4.2 → V4.3)
- All v1.0 constant values (unchanged)
- "Scoring math runs in PL/pgSQL" architectural decision
- DB-driven constants pattern
- Round-half-up-to-10 rounding rule (V4.2 introduction, preserved)
- LEFT JOIN scoring pattern (V4.2 introduction, preserved)
- `total_scaled` / `partial_display_scaled` split (V4.2 introduction, preserved)
- No mastery emission from 04B (V4.2 introduction, preserved)
- Disclosure language framing
- Append-only persistence pattern
- The transactional outbox consumer pattern via `exam_runtime_outbox`

---

# **32. Appendix D — V4.2 → V4.3 Change Map**

Each row below maps a specific V4.3 change to the reviewer pushback or Karl-confirmed architectural decision that motivated it.

| V4.3 Change | Source (Blocker / Decision) | V4.3 Section |
|---|---|---|
| `scoring_model_versions` catalog schema split: `constants_sha256` + `validation_packet_sha256` + `validation_packet_url` | Reviewer Blocker #1 — overloaded hash field | §7.2, §7.3, Appendix A, Appendix B |
| `scoring_constants` mutation trigger extended to BEFORE INSERT OR UPDATE OR DELETE | Reviewer Blocker #2 — INSERT path open | §8.4 |
| Partial unique index `WHERE status = 'active'` for race-safe single-active enforcement; trigger retained for friendly errors | Reviewer Blocker #3 — concurrent activation race | §7.2 |
| Version-validation gate added at orchestrator entry — blocks scoring against missing/candidate/incompletely-attested versions; `superseded` allowed (historical reproducibility) | Reviewer Blocker #4 — version validation too loose | §12.1, §19.6 |
| §18.1 statistics synced to regenerated packet (71.1 / 83.9 / 98.2); Path B miss-1-easy corrected to 790 | Reviewer Blocker #5 — doc-vs-packet contradiction | §18.1 |
| "Exhaustive" wording tightened; 60 targeted difficulty-distribution fixtures added to evidence packet | Reviewer Blocker #6 — overclaim on input-space coverage | §18.1, validation_sweep.py |
| `scoring_constants_snapshot_jsonb` example refreshed (no stale `routing_threshold:rw`) | Reviewer Blocker #7 — stale example | §12.3 |
| §21.2 rewritten — no per-deploy Python↔PG CI bottleneck; lock-time validation + immutability + Tier 3 governance | Karl Q3 alignment — set-and-forget, Supabase RPC | §21.2 |
| Unsourced "College Board rounds half up" claim dropped; rationale stands on determinism + cross-language parity | Reviewer SWE Standard #1 — unsourced claim | §6.3 |
| `extraction_notes.md` added to evidence packet; binary snapshots deferred to reviewer's own audit capture | Reviewer SWE Standard #2 + Karl Q5 direction | Appendix B, packet contents |
| "Industry-standard" softened to "widely-referenced third-party" for Test Ninjas references | Reviewer Nice-to-Have #1 + Karl Q6 alignment | §5.6, §17.2, §18.1, Appendix B |
| §16/§25 Doc 05 commitment language softened — no pre-commitment of Doc 05's consumer design | Karl Q4 alignment — defer to Doc 05 drafting | §16, §25.2, §25.3 |

---

**End of Document 04B V4.3.**

The formula is the moat. V4.3 cleans up the perimeter without touching the math.
