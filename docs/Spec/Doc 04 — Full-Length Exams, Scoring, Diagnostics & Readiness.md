# **Doc 04 — Full-Length Exams, Scoring, Diagnostics & Readiness**

**Version:** V3.0 **Status:** **LOCKED 2026-05-12** — Parent absorbs Doc 04B V4.3 architectural decisions; post-review cleanup applied within lock cycle (no version bump; see Change Records) **Scope:** SAT MVP only **Audience:** Engineering, Product, Content, QA, Ops **Owns:** full-length exam runtime boundaries, scoring architecture intent, report contract intent, review unlock semantics, family-wide invariants, cross-doc seams **Does NOT own:** scoring formula details (Doc 04B V4.3 — locked), mastery formula (Doc 05), tutor orchestration during/after exams (Doc 03), KPI snapshots and analytics warehouse (Doc 07), public marketing claims, future non-SAT exams, calendar/study-plan algorithm

**Supersedes:** Doc 04 Parent V2.0 (closes V2.0→V3.0 revision; see V3 closeout register below). V2.0 is preserved in the closeout register for audit history.

**Depends on:** Doc 04B V4.3 (spec-locked 2026-05-12; evidence packet hash `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`; deploy-time attestation values `validation_packet_url` and `constants_sha256` pending — see §14). Doc 04A V2.2 (pending; absorbs V4.3 schema decisions). Doc 04C (pending; consumes V4.3 report-payload fields). Doc 04D (pending). Doc 00 (Authoritative Platform Directive). Doc 01 (Identity, Roles & Entitlement). Doc 02 series (Question Bank & Canonical Content). Doc 05 (Mastery Engine — not yet drafted).

**Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY follow RFC 2119\.

---

## **Lock conditions**

This parent doc locks when:

1. Engineering review of subdoc family boundaries against Doc 04B V4.3 lock state  
2. Product review of intent statements (esp. claims discipline \+ guardian visibility scope)  
3. Content team confirmation that the form authoring lift (147 authored questions per form × 2-3 forms \= 294-441 authored questions) remains feasible at MVP  
4. Karl sign-off on V3.0 calibration register (V4.3-aligned)  
5. §14 launch-blocker values flagged; resolution required before any subdoc deploys to production (not a parent-lock blocker; tracked separately for production-readiness)

Once locked, subdocs absorb these assumptions and proceed in updated draft order: **04A V2.2 → 04C → 04D**. (Doc 04B V4.3 is already locked and is the canonical anchor that Parent V3.0 conforms to, not the other way around.)

---

## **V3 closeout register**

V3.0 absorbs the architectural decisions locked in Doc 04B V4.3 (2026-05-12). The reviewer's 10-point Parent alignment list from the V4.2 cycle is captured in full; additional V3.0 changes derive from V4.3 itself and from the V4.3 reviewer's PASS verdict.

| ID | Type | Change | Section(s) |
| ----- | ----- | ----- | ----- |
| RB-V3-01 | BLOCKER | **04B owns canonical scoring formula v1.0** (locked, immutable; bit-exact bounded; banded-ceiling architecture). V2.0's 3-layer scaling model is RETIRED. | Q1, Q1-arch, Q1-cap, §7 (rewritten), §13 |
| RB-V3-02 | BLOCKER | **`form_equating_offset` is retired.** V2.0's Layer 3 form-equating offset is removed entirely. Form-level difficulty differences are absorbed by the difficulty-weighted M2 deductions in the canonical formula. | §6, §7, §13, §14 |
| RB-V3-03 | BLOCKER | **`test_forms.score_table_version` is a foreign key into `scoring_model_versions.version`**, not a free-form string. V2.0's string-versioning convention is superseded by the catalog row referenced in 04B V4.3 §7. | Q1, §6, §7.6 |
| RB-V3-04 | BLOCKER | **Forms bind immutably to one scoring model version at publish.** Reaffirmed against 04B V4.3 §7.5 (historical reproducibility). Forms published against `v1.0` continue to score against `v1.0` constants forever, even after a future `v2.0` activates. | §6, §9 invariant \#7 (reaffirmed), §9 invariant \#18 (new) |
| RB-V3-05 | BLOCKER | **Partial scores: `total_scaled` is NULL in the database, not a single-section value.** V4.3 §9.1 split. V2.0's Q7-partial output rule ("total scaled score MUST NOT display") is now backed by a NOT-displayable NULL at the database level, not just by display-layer discipline. | Q7-partial, §9 invariant \#16, §10.2 |
| RB-V3-06 | BLOCKER | **Partial display uses `partial_display_scaled`** (200–800, single-section). V4.3 §9.1 introduces this field for single-section partial visibility. 04C consumes it. | Q7-partial, §3 (04C ownership), §10.2 |
| RB-V3-07 | BLOCKER | **Scoring does NOT emit mastery events from Doc 04\.** V2.0 §11.2 `test_pass` / `test_fail` event emission is REMOVED. The `TestQuestionEvent` payload schema is retired. V4.3 §16 architectural commitment: 04B emits only `score_runs` \+ `score_run_event_ledger`; no mastery fan-out. | §9 invariant \#11 (revised), §11.2 (rewritten), §12 (augmented) |
| RB-V3-08 | BLOCKER | **Doc 05 owns mastery consumption from canonical answer state.** Doc 05 reads `test_session_answers JOIN questions` directly; it does NOT consume Doc 04 events. The specific consumer pattern is Doc 05's design space when drafted. | §4 (Doc 05 row revised), §11.2 (rewritten), §13 (new risk \#9) |
| RB-V3-09 | BLOCKER | **Module 2 path is internal-only and not student-facing.** Reaffirmed; V4.3 §17 disclosure doctrine extends this with explicit forbidden phrases at the report-payload boundary. | Q9-route (reaffirmed), §9 invariant \#15 (reaffirmed) |
| RB-V3-10 | BLOCKER | **Validation evidence packet exists, is locked, and supports the formula as modeled approximation — not as CB-official scoring.** V4.3 hash `29c3e0fd…9b88651b`. V2.0 evidence-packet TBD status is closed. | Q1 (resolved), §7.4, §14 (first entry resolved) |
| RB-V3-11 | non-blocking | **V2.0 invariant \#11 ("Mastery events fire only after `score_run` success") is explicitly revised** rather than silently dropped. V4.3 §16.4 wording adopted verbatim. V2.0 invariant preserved in this closeout register for audit history. | §9 invariant \#11 (revised), this register |
| RB-V3-12 | non-blocking | **Hard guarantees \#17 and \#18 added** — version attestation (V4.3 §12.1 gate) and constants immutability (V4.3 §8.4 triggers) — to make the new invariants enforceable at the parent level. | §9 (\#17 new, \#18 new) |
| RB-V3-13 | non-blocking | **`ExamReportState` enum preserved unchanged at the parent level.** V4.3 §19.6 makes unattested-version scoring BLOCKING (raises `integrity_constraint_violation` before any `score_runs` row exists); this surfaces as `failed_requires_review`, not as a new state. Enum stability protects 04C. | §10.2 (clarification added, no enum change) |
| RB-V3-14 | non-blocking | **§14 launch-blocker table is materially shorter.** Scoring evidence packet, Layer 1 curves, easy-path ceiling values, Layer 3 form offsets, score table version naming — all RESOLVED by V4.3. Remaining open items: routing thresholds, initial form bank, Product timing values, Doc 01 entitlement predicate. | §14 (rewritten) |
| RB-V3-15 | non-blocking | **Calibration risk language replaced.** V2.0 Risk \#3 (easy-path ceiling-cap value) retired; Risk \#2 (form-equating Layer 3 judgment) retired. New Risk \#9 acknowledges that Test Ninjas validation is a calibrated approximation. | §13 (revised) |

---

## **1\. Purpose \+ intent**

Lyceon's full-length exams are the **truth anchor** of the system. Practice teaches; tutoring guides; mastery tracks; tests measure. When practice and tutoring claim a student is ready, the full-length exam is what decides whether that claim is real.

The parent doc establishes:

* What a full-length exam IS in Lyceon (structure, sections, modules, routing)  
* What's authoritative about its outputs (raw scoring, modeled scaled scoring per Doc 04B V4.3, diagnostics)  
* What it hands off to other docs (analytics events, planning signals, guardian summaries — no mastery events as of V3.0)  
* What it explicitly will NOT do (predict scores, replace official SAT, gate features behind opaque metrics, emit mastery events)

V3.0 differs from V2.0 in one architectural respect: **04B V4.3 is now the canonical scoring authority**, and the parent doc conforms to it rather than the other way around. The 3-layer scaling model V2.0 sketched is retired. The canonical formula v1.0 (banded ceiling \+ difficulty-weighted M2 deductions \+ dual-floor protection \+ round-half-up-to-10) is locked in Doc 04B V4.3 §6 and validated by the evidence packet referenced there. Parent V3.0 does not re-derive any of this; it absorbs the architecture and updates the family contracts that depend on it.

V3.0 also removes the V2.0 Doc 04 → Doc 05 mastery event emission contract. Doc 04 produces canonical answer state (Doc 04A) and canonical scaled scores (Doc 04B); mastery consumption is Doc 05's concern when Doc 05 is drafted, sourced directly from canonical answer tables.

---

## **2\. Calibration register (V3.0 — V4.3-aligned)**

The calibration register is the parent-level locked answer to each load-bearing structural question. Subdocs draft against these answers without re-litigating.

| ID | Question | V3.0 Lock |
| ----- | ----- | ----- |
| Q1 | Scoring architecture sourcing | **Doc 04B V4.3 owns the canonical scoring formula v1.0.** The formula is locked, immutable, bit-exact across deployments, and validated against a third-party DSAT benchmark calculator (Test Ninjas). The validation evidence packet is at hash `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`. Parent V3.0 does not author scoring math; it inherits it. |
| Q1-arch | Scaling architecture | **V2.0's 3-layer model is RETIRED.** Replaced by V4.3's canonical formula v1.0: banded ceiling (`max(430, 800·(r1/N1)^0.5)`) − difficulty-weighted M2 deductions (D\_e=15, D\_m=9, D\_h=6) bounded by raw-rate floor and path-specific floor, clamped to \[200, 800\], rounded half-up to nearest 10\. Per-section, per-path; deterministic; reproducible. Full math in 04B V4.3 §6. |
| Q1-cap | Easy-path scaled-score ceiling | **V2.0's separate easy-path ceiling-cap value is RETIRED.** The canonical formula's banded ceiling produces path-A maxima naturally (a perfect 0/27 M1 \+ 27/27 M2A in RW yields 430 per V4.3 §28; a perfect path-A in Math yields a higher value from the formula). No separate cap value is authored. Subdoc 04B's evidence packet documents the alignment with Test Ninjas bands. |
| Q2 | Form bank at MVP | **Unchanged from V2.0.** 147 authored questions per form (RW M1: 27, M2A: 27, M2B: 27; Math M1: 22, M2A: 22, M2B: 22). 98 questions delivered per completed route (M1 \+ one of M2A/M2B per section). 2 forms \= 294 authored; 3 forms \= 441 authored. **V3.0 change:** the "reference form" concept tied to V2.0's Layer 3 form-equating offset is retired (per RB-V3-02). All forms bind to the same `scoring_model_versions.version = 'v1.0'`. |
| Q3 | Section structure | **Unchanged.** Section-adaptive: Module 1 → routing decision (raw\_M1 ≥ T\_section ? path B : path A) → Module 2A or 2B. Mirrors real DSAT. RW: 27+27 \= 54 per route. Math: 22+22 \= 44 per route. |
| Q4 | Time accommodations | **Unchanged. None at MVP.** Future target: guardian/admin-set 1.5x and 2.0x. 04A flags that routing thresholds may need recalibration when accommodations land. |
| Q5 | In-section pacing | **Unchanged. Silent.** Section timer only; no per-question warnings. Pacing analytics surface in the post-test report (04C), not during the test. |
| Q6 | Section break behavior | **Unchanged. Soft gate.** Break is suggested between RW and Math sections (default \~10 min); student CAN start Math early. |
| Q7 | Session mode (strict vs lenient) | **Unchanged.** Single flag on \`test\_sessions.mode: 'strict' |
| Q7-disclosure | Mode disclosure on report | **Unchanged.** Report carries structural field \`timing\_condition: 'strict\_test\_like' |
| Q7-grace | Test-level grace \+ abandonment | **Unchanged.** 24h grace from session start. After 24h: session goes to `abandoned_final`; partial scoring runs on submitted-section answers per V4.3 §15. |
| Q7-partial | Partial-scoring output rules (V3.0 — V4.3 §9.1 alignment) | **Database-backed:** `score_runs.total_scaled = NULL` for partial sessions (NOT a single-section value); `score_runs.partial_display_scaled` carries the single-section 200–800 value for 04C display. **04C MUST NOT display total scaled score or full-test readiness label for partial sessions.** **04C MAY display the completed-section raw, the completed-section scaled, and `partial_display_scaled`** (which is the same single-section value, exposed as the canonical display field). Un-submitted sections show as "not attempted." |
| Q8 | Retake policy | **Unchanged. Unlimited retakes.** No cooldown logic in session-start guards. Same form or different form. |
| Q8-meta | Retake metadata \+ interpretation rules | **Unchanged.** Every report carries structural fields `attempt_number_for_form: number`, `prior_completed_attempts_for_form: number`, `is_first_seen_form_attempt: boolean`. First-attempt scores are primary readiness evidence. Same-form retakes labeled "practice/review evidence." |
| Q9 | Guardian visibility (MVP restriction) | **Unchanged.** Headline only at MVP: scaled section scores \+ total \+ completion timestamp \+ `timing_condition` \+ `is_first_seen_form_attempt` \+ `attempt_number_for_form`. Guardian does NOT see: domain breakdowns, skill diagnostics, pacing analytics, individual answers, routing decisions, or raw scores. Future expansion possible behind explicit product review. |
| Q9-route | Routing visibility to student | **Unchanged.** Student does NOT see which Module 2 path they were routed to. Internal-only field; available in audit trails and `score_run` records. Reaffirmed against V4.3 §17 disclosure doctrine. |
| Q10 | Scoring failure UX (V3.0 — V4.3 §19.6 alignment) | **(b) with V4.3 refinement.** Raw scoring \+ diagnostics may render immediately on completion to the student UI; scaled score deferred if scoring is transiently delayed (outbox retry pending). Report state machine: `raw_available_scaled_pending`. **V4.3 §19.6 sharpens the permanent-failure path:** if `test_forms.score_table_version` references a missing, candidate, or incompletely-attested `scoring_model_versions` row, scoring FAILS at the orchestrator entry with `integrity_constraint_violation`; no `score_runs` row is written; report state is `failed_requires_review`. This is a misconfiguration, not a transient retry candidate. **V3.0 mastery-events change (RB-V3-07):** mastery events are NOT emitted from Doc 04 in any scoring outcome. Doc 05 sources mastery from canonical answer tables. |

---

## **3\. Subdoc family map (V3.0 — 04B V4.3 locked)**

Doc 04 is the parent. Four subdocs hold the procedural depth. Each subdoc inherits the calibration register from this parent. Subdoc draft order: **04A V2.2 → 04C → 04D** (04B V4.3 already locked).

| Subdoc | Status | Owns | Key invariants enforced here |
| ----- | ----- | ----- | ----- |
| **04A** Exam Runtime & Session State | V2.1 locked; V2.2 pending | Session lifecycle, section state machine, server-authoritative timing, routing decision execution, answer submission contract, idempotency, resume behavior, mode flag semantics, abandonment \+ partial-scoring runtime triggers, `exam_runtime_outbox` event production. **V2.2 pending changes:** drop `form_equating_offset` column; pin `test_forms.score_table_version` FK to `scoring_model_versions(version)`; form-publish gate validates version status. | Server time only; no client clock trust; routing locked at Module 1 submit; no answer reveal pre-completion; resume returns same state; mode flag affects only timer-pause-on-exit; outbox events drive 04B scoring. |
| **04B** Scoring Tables & Score Computation | **V4.3 spec-locked 2026-05-12** (deploy-time attestation values pending — see §14) | **Canonical scoring formula v1.0** (banded ceiling \+ difficulty-weighted M2 deductions \+ dual-floor protection \+ round-half-up-to-10); `scoring_model_versions` catalog with three-field attestation (`constants_sha256`, `validation_packet_sha256`, `validation_packet_url`); `scoring_constants` table with INSERT/UPDATE/DELETE immutability triggers; canonical `compute_section_scaled_score()` PL/pgSQL function; `score_test_session_from_outbox()` orchestrator with version-validation gate; `score_runs` insert-once persistence including `partial_display_scaled` for partial paths; `score_run_event_ledger` idempotency; LEFT-JOIN scoring pattern (missing answers count as wrong); anti-leak comparator (`is_answer_correct`); validation evidence packet (hash `29c3e0fd…9b88651b`). | **Determinism:** identical answers \+ identical form \+ identical scoring model version \= identical scaled score, bit-exact across Python reference and PL/pgSQL production. **Insert-once:** every displayed score traces to one `score_run_id`. **Version-attested:** scoring against missing/candidate/unattested versions is BLOCKING. **No mastery emission:** scoring transaction commits exactly `score_runs` \+ `score_run_event_ledger`; nothing else. **Constants sealed:** active/superseded version constants cannot be added, modified, or deleted. |
| **04C** Reports, Disclosure & Guardian View | Not yet drafted | Report payload contract (student variant \+ guardian variant), `ExamReportState` lifecycle handling, structural disclosure fields (`timing_condition`, retake metadata), domain diagnostics, skill diagnostics, pacing analytics, claims-discipline-as-structure, review mode contract, entitlement gating, **`partial_display_scaled` consumption for partial sessions**. | Guardian payload is a strict projection of student payload (no extra fields); claims discipline is structural (forbidden phrases filtered at serialization, not just at copywriting time); review unlock gated on completion \+ scoring success; `total_scaled` NULL means single-section display only; routing path never serialized to student. |
| **04D** Integrity, Reliability & Audit | Not yet drafted | Anti-leak threat model (during exam, during review), form immutability enforcement, idempotency replay verification, score audit trail completeness, observability events \+ metrics \+ alerts, failure modes \+ recovery procedures, regression test matrix shape, **v1.0 constants attestation audit (V4.3 §7.2 / §8.4 enforcement)**, **scoring\_model\_version state-machine audit**. | Every state transition emits an audit event; published forms cannot mutate; duplicate submits are detected and replayed safely; failure modes have explicit handlers, not silent fallbacks; constants integrity is database-enforced not convention-enforced. |

---

## **4\. Source-of-truth boundaries (V3.0)**

Doc 04 explicitly does NOT own these things. Cross-doc handoffs:

| Concern | Owner | How Doc 04 interacts |
| ----- | ----- | ----- |
| Canonical questions (stems, options, correct answers, domain/skill metadata) | Doc 02 | Doc 04 consumes question records by `question_id`; Doc 04 never authors questions or stores correctness duplicates. 04B V4.3 §10 comparator (`is_answer_correct`) is the single read-side use; 04A presents items without correct-answer leakage. |
| Tutor behavior during exam (allowed: strategy only, per Doc 03\) and during review (full explanation allowed) | Doc 03 | Doc 04 emits exam states (`active`, `complete`, `review_unlocked`) that Doc 03 reads to gate tutor modes; Doc 04 does NOT call tutor or modify tutor state. |
| **Mastery formula and mastery state updates** (V3.0 — REVISED per RB-V3-07/08) | Doc 05 | **Doc 04 does NOT emit mastery events.** 04B V4.3 §16 commits the architectural decision: scoring transaction commits only `score_runs` \+ `score_run_event_ledger`. The canonical feedstock for any mastery consumer is `test_session_answers JOIN questions` (Doc 04A schema); Doc 05 reads these tables directly when Doc 05 is drafted. Doc 04 does NOT interpose itself between this data and the mastery engine. |
| Calendar / study plan algorithm | Doc 05 / Planning subdoc TBD | Doc 04 emits exam outcomes (analytics events to Doc 07; `score_runs` rows readable by any authorized consumer); planner reads them; Doc 04 does NOT modify plans. |
| Identity, roles, active product entitlement, guardian-student linking | Doc 01 | Doc 04 calls Doc 01-owned authorization checks at every API boundary; guardian access requires linked \+ entitled per Doc 01 contracts. **Open coordination:** Doc 01 V7 must define `current_student_id()` and `is_admin()` for RLS contexts (V4.3 §22.1 production-deploy blocker; not parent-lock blocker). |
| KPI snapshots, trend dashboards, analytics warehouse | Doc 07 | Doc 04 emits raw events; Doc 07 aggregates; Doc 04 does NOT compute KPIs. |
| Public marketing claims (advertising, landing pages, sales copy) | Growth/marketing (out of doc-spec scope) | Doc 04 enforces claims discipline structurally in the report payload (no `predicted_score` field, no "guaranteed" copy strings); marketing teams have their own content review process not gated by this doc. |

---

## **5\. SAT MVP structure (summary — unchanged from V2.0)**

Full procedural detail in 04A. Summary here so the parent doc establishes the shape.

### **5.1 Sections \+ modules**

Each full-length exam has 2 sections, each section has 2 modules:

| Section | Module 1 | Module 2 (one of) | Total raw per route |
| ----- | ----- | ----- | ----- |
| Reading & Writing (RW) | 27 questions, mixed difficulty | Module 2A (Easy, 27 Q) **or** Module 2B (Hard, 27 Q) | 0–54 |
| Math | 22 questions, mixed difficulty | Module 2A (Easy, 22 Q) **or** Module 2B (Hard, 22 Q) | 0–44 |

Module 2 routing happens per-section independently (RW routing doesn't affect Math routing).

### **5.2 Section timing**

| Section | Module 1 duration | Module 2 duration | Total |
| ----- | ----- | ----- | ----- |
| Reading & Writing | 32 min | 32 min | 64 min |
| Math | 35 min | 35 min | 70 min |
| Break between sections | — | — | \~10 min (Q6 soft gate) |

Total active test time: \~134 min (matches real DSAT). 04A holds the configurable timing constants.

### **5.3 Section-adaptive routing flow**

Test start  
   ↓  
RW Module 1 (32 min, 27 Q)  
   ↓  
Module 1 submit → routing decision: raw\_M1 ≥ T\_rw ? hard : easy  
   ↓  
RW Module 2A or 2B (32 min, 27 Q)  
   ↓  
RW section complete → break suggested (soft gate, skippable)  
   ↓  
Math Module 1 (35 min, 22 Q)  
   ↓  
Module 1 submit → routing decision: raw\_M1 ≥ T\_math ? hard : easy  
   ↓  
Math Module 2A or 2B (35 min, 22 Q)  
   ↓  
Test complete → 04A writes exam\_runtime\_outbox → 04B consumes → score\_runs → review unlocked (gated on score\_run success per §10.2)

**Routing decision is locked at Module 1 submit.** Once routed to 2A or 2B, the path is immutable for that section. If the test abandons before Module 2 is submitted, partial scoring uses the locked routing decision per Q7-partial rules.

T\_rw and T\_math are values authored by content team during form authoring and live on `test_forms.routing_threshold_rw` and `test_forms.routing_threshold_m` (V4.2 architectural decision — routing thresholds moved off `scoring_constants` and onto the form). Default expected ranges per documented external research: T\_rw ≈ 18–21 of 27; T\_math ≈ 13–16 of 22\. **Parent doc does not lock numeric values; values are content-team authored per form and captured in the form-publish evidence per 04A V2.2 publish gate.**

---

## **6\. Form architecture (summary — V3.0)**

Full schema in 04A V2.2. A `test_form` is an immutable bundle published before any session can use it. Each form contains:

* 6 module bundles: RW-M1, RW-M2A, RW-M2B, Math-M1, Math-M2A, Math-M2B (147 questions total per form)  
* **(RETIRED in V3.0)** \~\~1 form-equating offset (0 for the reference form; non-zero for variants)\~\~ — per RB-V3-02  
* **1 `score_table_version`** — foreign key into `scoring_model_versions.version` (V3.0 RB-V3-03). At MVP, the value is `'v1.0'` for every published form  
* **1 routing-threshold pair** (`test_forms.routing_threshold_rw`, `test_forms.routing_threshold_m`) — content-team authored per form per the V4.2 architectural decision (routing thresholds are form-specific configuration, not global scoring constants)  
* Status: `draft` | `published` | `archived`  
* `published_at` timestamp; immutable after publish

**Form publication invariant (reaffirmed):** once a form is `published`, its module bundles \+ thresholds \+ `score_table_version` cannot change. To "fix" a form, archive it and publish a new form. Archived forms remain queryable for historical score audits but cannot be selected for new sessions.

**Form-to-scoring-version binding is immutable (V3.0 — RB-V3-04):** the form's `score_table_version` FK is set at publish time and never changes. If `scoring_model_versions.v1.0` later transitions to `superseded` (because a future `v2.0` activates), forms still bound to `v1.0` continue scoring against `v1.0`'s constants per 04B V4.3 §7.5 historical-reproducibility rule. The version-validation gate (V4.3 §12.1) permits scoring against `active` or `superseded` versions; only missing/candidate/unattested versions block.

This invariant is enforced at the schema level (CHECK constraints, no UPDATE allowed on published rows for content-bearing columns, FK enforces version existence) and at the API level (form-publish endpoint is one-way; validates target version status as `active` at publish time).

**04A V2.2 publish-gate requirements (derived from V3.0):**

1. `score_table_version` references a `scoring_model_versions` row with `status = 'active'` at publish time  
2. Module composition matches the locked Lyceon composition per 04B V4.3 §13 (RW M1: 27, M2A: 14E/9M/4H, M2B: 4E/9M/14H; Math M1: 22, M2A: 11E/8M/3H, M2B: 3E/8M/11H)  
3. Routing thresholds are within the documented expected range (T\_rw ≈ 18–21; T\_math ≈ 13–16) — outside-range values require explicit Founder/CTO override flag on the form row  
4. No post-publish mutation on `module bundles`, `routing_threshold_*`, or `score_table_version`

---

## **7\. Scoring architecture (V3.0 — V4.3 canonical formula v1.0)**

Full procedural detail in **Doc 04B V4.3** (LOCKED 2026-05-12). This section is the parent-level summary; it does NOT duplicate V4.3 §6 or restate the formula. Where the parent and V4.3 disagree, V4.3 is authoritative and this section MUST be updated.

### **7.1 The canonical formula v1.0 (locked)**

V2.0's 3-layer scaling model is **retired**. V4.3 §6 locks a single canonical formula computed per section, per Module 2 path:

ceiling     \= max(430, 800 · (r₁/N₁)^0.5)  
deductions  \= 15·n\_easy\_wrong\_M2 \+ 9·n\_medium\_wrong\_M2 \+ 6·n\_hard\_wrong\_M2  
S\_raw       \= ceiling − deductions  
raw\_floor   \= 200 \+ 400 · (r₁ \+ r₂) / N\_total  
path\_floor  \= (r₁ ≥ T) ? min(580, 450 \+ 15·(r₁ − T)) : 200  
floor       \= max(raw\_floor, path\_floor)  
S\_clamped   \= max(floor, min(800, S\_raw))  
scaled      \= floor((S\_clamped \+ 5\) / 10\) · 10        \-- round half up to nearest 10

Where `r₁ = M1 correct count`, `N₁ = M1 question count`, `r₂ = M2 correct count`, `N_total = N₁ + N₂`, `T = test_forms.routing_threshold_section`. Constants 430, 800, 0.5, 15, 9, 6, 200, 400, 580, 450, 15 are sealed in `scoring_constants` for `scoring_model_versions.v1.0` and cannot be mutated post-activation (V4.3 §8.4 immutability triggers cover INSERT, UPDATE, and DELETE).

The formula is **deterministic** across Python reference and PL/pgSQL production: bit-exact for every valid input. The 28 input scenarios that land exactly on a `.5` boundary at the rounding step are pinned by V4.3 §6.3 round-half-up rule.

### **7.2 What V3.0 retires from V2.0 §7**

| V2.0 element | V3.0 disposition |
| ----- | ----- |
| Layer 1: Per-section/per-path raw→scaled curves (RW-Easy, RW-Hard, Math-Easy, Math-Hard) | **RETIRED.** No curve tables. The canonical formula produces the section scaled directly from raw inputs. |
| Layer 2: Module 1 → Module 2 routing thresholds (T\_rw, T\_math) | **RETAINED** but relocated: now on `test_forms.routing_threshold_rw` / `routing_threshold_m`, not in `scoring_constants`. Per-form, content-team authored. |
| Layer 3: Per-form difficulty-equating offsets (`form_equating_offset`) | **RETIRED.** Form-level difficulty differences are absorbed by the difficulty-weighted M2 deduction structure (heavier penalties for missing easy questions; lighter for hard). |
| Score table version as free-form string (`lyceon-modeled-2026-q2-v1`) | **REPLACED.** `score_table_version` is now an FK into `scoring_model_versions.version`; v1.0 catalog row carries the three attestation hashes per V4.3 §7. |
| "Reference form" concept (form-equating offset \= 0\) | **RETIRED.** All forms bind to the same `v1.0` version; no reference/variant distinction at the scoring-architecture level. Variants exist as different forms with different content. |

### **7.3 Versioning and catalog**

The `scoring_model_versions` catalog row for v1.0 is the canonical attestation:

INSERT INTO scoring\_model\_versions (  
  version, formula\_name, formula\_doc\_ref,  
  constants\_sha256,  
  validation\_packet\_sha256,  
  validation\_packet\_url,  
  status, published\_at  
) VALUES (  
  'v1.0',  
  'option\_a\_banded\_ceiling',  
  'Doc 04B V4.3 §6',  
  '\<computed at deploy from sorted scoring\_constants rows\>',  
  '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b',  
  '\<canonical deploy URL\>',  
  'active',  
  '2026-05-12T00:00:00Z'  
);

Three-field attestation (V4.3 §7.2 split): `constants_sha256` hashes the sorted `scoring_constants` rows for this version; `validation_packet_sha256` is the evidence packet hash; `validation_packet_url` is the retrieval location. These are distinct artifacts; conflating them (as the V4.2 draft did) is unsafe and is now prevented by the schema.

**Single-active enforcement (V4.3 §7.2):** a partial unique index on `((status)) WHERE status = 'active'` enforces at most one active version at any time. Future v2.0 candidates progress through `candidate → active`; the prior `active` row transitions to `superseded` atomically.

**Constants immutability (V4.3 §8.4):** a `BEFORE INSERT OR UPDATE OR DELETE` trigger on `scoring_constants` blocks all mutation when the parent `scoring_model_versions.status` is `active` or `superseded`. Candidate-version constants remain mutable during validation; once activated, they seal automatically. This is database-enforced, not convention-enforced.

### **7.4 Validation evidence packet (V3.0 — RB-V3-10 resolved)**

The packet exists, is locked, and is the canonical proof artifact for v1.0:

* **Packet hash:** `29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b`  
* **Contents:** `validation_sweep.py` (Python reference), `validation_results.csv` (1,313 main-sweep scenarios), `validation_targeted_fixtures.csv` (60 targeted non-proportional difficulty fixtures), `test_ninjas_bands_reference.csv` (benchmark band table), `validation_summary.md` (statistics), `source_snapshot/extraction_notes.md` (methodology and source URLs)  
* **Validation statistics:** 37.8% in exact Test Ninjas band; 71.1% within 30 scaled points; 83.9% within 50 (formal acceptance threshold ≥70% — PASS); 98.2% within 100 (formal acceptance threshold ≥95% — PASS)  
* **Reproducibility:** running `validation_sweep.py` against the locked v1.0 formula MUST produce a packet whose SHA-256 matches the documented hash exactly

V2.0's "TBD scoring evidence packet" launch-blocker is closed by V4.3.

**Important framing (V3.0):** the validation packet is **internal reproducible validation evidence**, not a third-party source archive. Test Ninjas is a third-party DSAT benchmark calculator, not College Board's official scoring. Lyceon's scaled scores are modeled approximations aligned with this benchmark within documented tolerance; they are NOT certified-official scores. Disclosure copy in 04C must continue to frame scaled scores as modeled (per §12 forbidden phrases).

### **7.5 Determinism contract (preserved from V2.0)**

For any tuple `(test_form_id, M1_raw_rw, M2_raw_rw, M1_path_rw, M2_difficulty_distribution_rw, M1_raw_math, M2_raw_math, M1_path_math, M2_difficulty_distribution_math, score_table_version)`, the scaled score is deterministic and reproducible. The `score_runs` row stores all relevant inputs plus the intermediate decomposition (`rw_module1_correct`, `rw_m2_easy_wrong`, etc., per V4.3 §9); auditing a score is a matter of re-running the computation against the stored inputs and the catalog-row constants.

### **7.6 Version evolution (post-launch)**

When Lyceon recalibrates the formula or its constants (Tier 3 change per V4.3 §23):

1. A new `scoring_model_versions` row is inserted with `status = 'candidate'`  
2. New `scoring_constants` rows are inserted with the candidate's values (allowed because the parent is candidate)  
3. Validation sweep is re-run against the new version; a new evidence packet hash is computed  
4. Founder/CTO approval  
5. Candidate transitions to `active`; previous active transitions to `superseded` atomically; the three attestation fields are populated  
6. New forms publishing after this transition bind to the new version  
7. **Existing forms still bound to v1.0 continue scoring against v1.0's constants forever** (historical reproducibility)  
8. Constants are sealed automatically when the new version goes active

Old `score_runs` preserve their old `scoring_model_version`; new sessions use whatever version their form references. Scaled scores remain stable across recalibrations.

---

## **8\. Session mode (strict vs lenient — unchanged from V2.0)**

Per Q7 lock and Q7-disclosure:

| Aspect | Strict mode | Lenient mode (default) |
| ----- | ----- | ----- |
| Section timer when student is in section UI | Runs | Runs |
| Section timer when student leaves UI | **Continues running** | **Pauses** |
| Resume mid-section | Returns with remaining time decremented by elapsed real-time | Returns with remaining time decremented only by active-in-section time |
| Test-level grace (24h from session start) | Same | Same |
| Routing logic | Same | Same |
| Scoring logic | Same | Same |
| Partial scoring on abandonment | Same | Same |
| Report payload | Same shape; `timing_condition: 'strict_test_like'` | Same shape; `timing_condition: 'lenient_practice'` |
| Mode displayed on student report | Yes (via `timing_condition` field) | Yes (via `timing_condition` field) |
| Mode displayed to guardian | Yes (per Q9 headline includes `timing_condition`) | Yes (per Q9 headline includes `timing_condition`) |
| Report copy distinguishes interpretation | "Completed under test-like timing" | "Completed with pause-on-exit enabled; use as practice readiness, not full test-day simulation" |

**Mode is a single column** on `test_sessions`. Section runtime checks it in exactly one place: the timer-decrement function. Everything else is mode-agnostic.

UX guidance (not enforced by spec, but recommended): default to lenient; offer strict as an opt-in for "test day rehearsal" sessions; recommend strict for the final 1-2 practice tests before a real SAT date.

---

## **9\. Hard guarantees \+ invariants (V3.0)**

These are the things Doc 04 cannot violate. Subdocs implement against them. Tests verify them. CI enforces them where machine-checkable.

1. **SAT-like structure preserved.** Two sections, two modules per section, four delivered modules per completed route, section-adaptive routing per real DSAT.  
2. **Server-authoritative timing.** All timer state derives from server timestamps. Client clock is display-only and never trusted.  
3. **No answer leakage during active exam.** Pre-completion question payloads exclude `correct_answer`, `explanation`, internal option metadata, distractor taxonomy, and any field whose presence would leak the answer. (04B V4.3 §10 comparator runs server-side only.)  
4. **Immutable published forms.** Once a form is `published`, its content-bearing columns cannot mutate. Schema-enforced.  
5. **Idempotent answer submission.** Duplicate submits with same `idempotency_key` return the prior result, not a duplicate row.  
6. **Deterministic raw and modeled scaled scoring.** Same inputs → same outputs, bit-for-bit. Reproducible from `score_run` row alone. (04B V4.3 §6 canonical formula; round-half-up-to-10 pinned across Python and PL/pgSQL.)  
7. **Score table version recorded on every score.** Every displayed score traces to one `score_run_id` which traces to one `scoring_model_versions.version` which traces to one validation evidence packet (V4.3 §7).  
8. **Routing decision is locked at Module 1 submit.** Cannot be re-computed on resume, cannot drift, cannot be overridden by client.  
9. **Review unlocks only after completion AND `score_run` success.** No completion → no review mode → no answer/explanation reveal. Pending or failed scoring → review remains locked until scoring resolves.  
10. **Guardian visibility is linked-student \+ entitled.** Both conditions required; either condition alone denies access.  
11. **Mastery is independent of scoring (V3.0 — REVISED per RB-V3-07/11).** Replaces V2.0 invariant \#11 ("Mastery events fire only after `score_run` success"). The new invariant is adopted verbatim from V4.3 §16.4: *"Mastery state is independent of scaled scoring. A `score_runs` row and any mastery state update are independent artifacts that may complete in any order, fail independently, and recover independently. Scaled scoring success is not a prerequisite for mastery work; mastery work is not a prerequisite for scoring success. The shared feedstock — canonical `test_session_answers` rows — is the only coupling point."* Doc 04 emits NO mastery events. The V2.0 invariant is preserved in the V3 closeout register for audit history.  
12. **Mode flag affects timer-pause behavior only.** Strict and lenient produce identical scores from identical answers; the mode is a UX choice, not a scoring choice.  
13. **`timing_condition` field is structural, not optional.** Every report serializes with `timing_condition`. Cannot be omitted.  
14. **Retake metadata is structural, not optional.** Every report serializes with `attempt_number_for_form`, `prior_completed_attempts_for_form`, `is_first_seen_form_attempt`. Same-form retakes cannot be silently presented as if they were first-attempts.  
15. **Claims discipline is structural.** No `predicted_score` field, no `guaranteed` copy. The schema itself prevents the marketing-overclaim failure mode. Routing path is internal-only; never serialized to student.  
16. **Partial-abandoned-final scores are bounded.** `score_runs.total_scaled = NULL` for partial sessions. `score_runs.partial_display_scaled` carries the 200–800 single-section value for 04C display. 04C MAY display completed-section raw \+ completed-section scaled \+ `partial_display_scaled`. 04C MUST NOT display total scaled or full-test readiness label.  
17. **Scoring model version is attested before scoring (V3.0 — NEW per RB-V3-12).** V4.3 §12.1 orchestrator gate: before any `score_runs` row is written, the orchestrator MUST verify that `test_forms.score_table_version` references a `scoring_model_versions` row with `status IN ('active', 'superseded')`, `published_at IS NOT NULL`, `constants_sha256 IS NOT NULL`, and `validation_packet_sha256 IS NOT NULL`. Scoring against a missing, candidate, or incompletely-attested version raises `integrity_constraint_violation` and the orchestrator transaction rolls back; no partial `score_runs` row exists. This is database-enforced.  
18. **Constants are sealed once active (V3.0 — NEW per RB-V3-12).** V4.3 §8.4 trigger: `BEFORE INSERT OR UPDATE OR DELETE ON scoring_constants` blocks all mutation when the parent `scoring_model_versions.status` is `active` or `superseded`. Tier 3 governance (V4.3 §23) is the only path to constants change; it requires a new version. Candidate-version constants remain mutable during validation. This is database-enforced.

---

## **10\. Acceptance criteria \+ report state lifecycle**

### **10.1 Parent-level acceptance**

Doc 04 parent V3.0 is satisfied when:

1. The calibration register (Q1 through Q10 \+ sub-locks, V3.0-revised) is reviewed and locked  
2. The 4 subdocs (04A V2.2 / 04B V4.3 / 04C / 04D) draft against this calibration register without re-litigating  
3. Each subdoc's "owns" boundary is respected (no scope leakage between subdocs, no scope leakage into Doc 03/05/07 territory)  
4. The hard guarantees in §9 are enforced somewhere in the subdoc \+ test layer (each guarantee maps to at least one subdoc section \+ at least one test scenario)  
5. The form-publishing pipeline can produce a real form with all 6 module bundles \+ `score_table_version` FK \+ routing thresholds, end-to-end, before any production launch (form-equating offsets retired per RB-V3-02)  
6. Doc 04B V4.3's scoring evidence packet (hash `29c3e0fd…9b88651b`) is referenced and accessible — RESOLVED at V3.0 lock time

Subdoc-level acceptance criteria are owned by each subdoc.

### **10.2 Canonical report state enum (unchanged from V2.0; refined semantics per V4.3 §19.6)**

Defined at parent level so 04B and 04C use the same names:

type ExamReportState \=  
  | 'not\_available'              // session not completed; no report yet  
  | 'raw\_available\_scaled\_pending' // completed; raw \+ diagnostics shown; scaled scoring transiently delayed (outbox retry pending)  
  | 'partial\_scored\_abandoned'   // abandoned-final with at least one section completed; per Q7-partial rules  
  | 'complete'                   // completed; score\_run succeeded; full report available  
  | 'failed\_requires\_review';    // score\_run permanently failed (e.g., unattested scoring\_model\_version per V4.3 §19.6); incident workflow handles

State transitions:

* Session not completed → `not_available`  
* Session completed, scoring transient delay → `raw_available_scaled_pending` (outbox retry pending; no `score_runs` row yet)  
* Session completed, scoring success → `complete`  
* Session completed, scoring permanent failure (version-validation gate raises, or other §19 hard failure) → `failed_requires_review` (manual intervention; no `score_runs` row will ever exist for this session under the current configuration)  
* Session abandoned-final, at least one section submitted → `partial_scored_abandoned` (with `total_scaled = NULL` and `partial_display_scaled` set)  
* Session abandoned-final, no sections submitted → `not_available`

**V3.0 clarification of failure semantics (RB-V3-13):** V4.3 §19.6 made the unattested-version failure path BLOCKING — the orchestrator raises an exception before any `score_runs` row is written. From the report state machine's perspective, this surfaces as `failed_requires_review` (the same terminal failure state V2.0 already defined). The enum is unchanged. The internal difference is that 04C's failed-state handler must distinguish between transient retry-able failures and permanent misconfiguration failures (via incident metadata, not via a new state).

**04C source-of-truth for failed states (V3.0).** When no `score_runs` row exists because scoring failed before insert (per V4.3 §19.6 unattested-version path, or any other §19 hard failure that prevents the orchestrator from writing a `score_runs` row), 04C MUST derive `failed_requires_review` from the scoring/outbox failure ledger or incident metadata defined in 04D. 04C MUST NOT depend on `score_runs.SELECT` alone for the failed terminal state, since for the unattested-version path the `score_runs` row never exists. The exact failure-ledger schema and incident-metadata table are 04D's design space; Parent V3.0 commits only that 04D owns this surface and that 04C reads from it.

**V3.0 mastery-events clarification (RB-V3-07):** in V2.0, the transition into `complete` was the trigger for `test_pass` / `test_fail` event emission to Doc 05\. In V3.0, no events fire from Doc 04 at any state transition. The transition into `complete` triggers `score_run_event_ledger` (V4.3 §12) and review-unlock (V4.3 §9), but no fan-out to Doc 05\.

---

## **11\. Cross-doc handoffs (V3.0)**

How Doc 04 interfaces with the rest of the document family:

### **11.1 Doc 02 → Doc 04 (questions in — unchanged)**

Doc 04 reads questions from Doc 02 by `question_id`. Required fields consumed:

* `question_id`, `stem`, `options[]`, `assets[]` (for serving to student)  
* `correct_answer`, `correct_variants` (for scoring \+ diagnostics; never sent to client pre-completion per 04B V4.3 §10 comparator)  
* `domain`, `skill_code`, `difficulty` (for scoring \+ diagnostics; difficulty bucketing into easy/medium/hard drives the M2 deduction weights)  
* `section` (validates question belongs to RW or Math correctly)

Doc 04 never writes to Doc 02\. Doc 04 never duplicates Doc 02 fields in its own tables (`test_form_items` references `question_id` only).

### **11.2 Doc 04 → Doc 05 (V3.0 — REWRITTEN per RB-V3-07/08)**

**Doc 04 emits NO mastery events.**

V2.0 specified that Doc 04 emit one `TestQuestionEvent` per scored question on completion \+ `score_run` success. **This contract is retired.** The `TestQuestionEvent` payload schema is removed from Doc 04's specification.

**New contract:**

* Doc 04A persists canonical answer state in `test_session_answers` (with `(test_session_id, section, module, ordinal, question_id, answer, last_submission_id, ...)`)  
* Doc 02 owns the canonical `questions` table with correctness and difficulty  
* Doc 04B writes only `score_runs` \+ `score_run_event_ledger` from the scoring transaction; nothing else  
* **Doc 05 reads `test_session_answers JOIN questions` directly** when Doc 05 is drafted, to compute mastery from `(student_id, question_id, is_correct, difficulty, skill_code, occurred_at)` tuples that are derivable from these two tables

The exact Doc 05 consumer pattern — polling, trigger, outbox notification from 04A, batch — is Doc 05's design space when Doc 05 is drafted. Doc 04 makes no commitment about it.

**Why this changed:** the V2.0 contract coupled mastery to scaled scoring success. Under that contract, a transient scoring failure delayed mastery; a permanent scoring failure permanently lost it. V4.3 §16 decoupled the two: a partial test that never produces a full scaled score still contributes mastery for its completed section; a scoring infrastructure failure does not block mastery; the canonical answer state is the single coupling point.

**What Doc 04 does provide for downstream consumers:**

* `score_runs` rows with computed scaled scores (accessible via SELECT to authorized consumers per RLS policies)  
* The audit-grade decomposition fields (`rw_module1_correct`, `rw_m2_easy_wrong`, `math_module1_correct`, `math_m2_hard_wrong`, etc., per V4.3 §9) for support and analytics  
* `source_outbox_event_id` linkage back to 04A's completion event for traceability  
* `test_sessions.mode` and computed retake metadata for any consumer needing `timing_condition` or `is_first_seen_form_attempt` context

What Doc 04 does NOT provide:

* Mastery events of any kind  
* Per-question outcome publication (Doc 05 reads canonical answer tables directly)  
* Any blocking signal that gates mastery on scoring success

**Doc 05 inherited constraint (V3.0).** When Doc 05 is drafted, it must accept the no-emission posture above as an inherited architectural constraint from Parent V3.0. Doc 05 MUST NOT specify that Doc 04 emit mastery events in any form; reintroducing event-driven mastery consumption from Doc 04 would violate hard guarantee \#11 and force a Parent V3.0 revision. Doc 05's consumer pattern (polling, trigger from 04A, outbox notification, etc.) is Doc 05's design space, but the data source is fixed: canonical `test_session_answers JOIN questions` per the Doc 04A schema. If Doc 05 needs a different feedstock shape, that change goes through Doc 04A schema governance, not through reintroducing Doc 04 → Doc 05 events.

### **11.3 Doc 04 ↔ Doc 03 (tutor coordination — unchanged)**

Doc 03 reads exam session state to gate tutor modes:

* Session in `active` state during a section → tutor in restricted mode (strategy only, per Doc 03 rules)  
* Session in `complete` (per `ExamReportState`) → tutor in full review mode (explanations allowed)  
* Session in any other state → tutor not exam-aware

Doc 04 does NOT call tutor APIs. Doc 03 reads exam state via Doc 04's session-query endpoints.

### **11.4 Doc 04 → Doc 01 (auth/entitlement checks in — unchanged \+ V4.3 §22.1 coordination)**

Every Doc 04 API endpoint calls Doc 01-owned auth \+ entitlement checks:

* Student-facing endpoints: authenticated student session \+ active product entitlement that includes full-length exams  
* Guardian-facing endpoints: authenticated guardian session \+ active linked-student relationship \+ active student entitlement (including full-length exams scope)

Auth failures are blocking (return 401/403). Entitlement failures are blocking. Doc 04 does NOT bypass these checks under any condition.

The exact entitlement-bundle structure is Doc 01's concern. Doc 04 calls a Doc 01-defined predicate like `has_full_length_exam_entitlement(student_id)`; Doc 01 owns the predicate's implementation.

**V4.3 §22.1 coordination gap (production-deploy blocker, not parent-lock blocker):** Doc 04B V4.3's RLS policies (`score_runs_student_read`, admin recompute policies) use `current_student_id()` and `is_admin()` helpers expected to be defined by Doc 01\. Doc 01 V6 declares `profile-service.ts` as canonical writer for `profiles` but does not yet enumerate these helpers. Resolution: Doc 01 V7 (or coordination memo) defines `current_student_id()` and `is_admin()`; 04B V4.3 RLS updates to use them. Until then, the deploy-time placeholder is `auth.uid()` with the explicit caveat that this may need to change.

### **11.5 Doc 04 → Doc 07 (analytics out — unchanged)**

Doc 04 emits structured events to Doc 07's event sink:

* `test_started`, `section_started`, `answer_submitted` (without answer content), `section_submitted`, `section_expired`, `test_completed`, `score_computed`, `review_unlocked`, `guardian_exam_summary_viewed`

Doc 07 aggregates. Doc 04 does NOT compute KPIs, trends, or dashboards.

---

## **12\. What Doc 04 explicitly does NOT do (V3.0)**

Forbidden (would violate scope, claims discipline, or cross-doc boundaries):

* Doc 04 does NOT predict future SAT scores. There is no `predicted_score` field anywhere in the report payload, the `score_run`, or any API response.  
* Doc 04 does NOT certify scores as official. The disclosure framing \+ report copy frame scaled scores as **modeled** estimates aligned with a third-party DSAT benchmark calculator, not as College Board's official scoring.  
* Doc 04 does NOT implement mastery math. **Doc 04 does NOT emit mastery events (V3.0 — RB-V3-07).** Doc 05 reads canonical answer state directly and owns the math.  
* Doc 04 does NOT generate analytics dashboards or KPI snapshots. Events fire to Doc 07; Doc 07 aggregates.  
* Doc 04 does NOT support ACT, AP, PSAT, or international exams at MVP. SAT only.  
* Doc 04 does NOT let tutor modify scores or canonical answer state. Tutor can teach/review; Doc 04's outputs are tutor-immutable.  
* Doc 04 does NOT support `score_run` mutation post-creation. `score_runs` are insert-once (V4.3 §9); recalibration produces new `score_runs` against a new `scoring_model_versions.version`, not edits to old ones.  
* Doc 04 does NOT support partial-form publication. Forms publish as complete bundles or not at all; a form missing a module bundle cannot publish.  
* Doc 04 does NOT trust client clocks. Ever. Client time is informational; server time decides.  
* Doc 04 does NOT implement section-level adaptive item routing within a module. Module 1 → Module 2 routing is the only adaptivity; within each module, items are pre-authored in fixed order.  
* Doc 04 does NOT silently expose same-form retake scores as primary readiness evidence. Retake metadata is structural and surfaced.  
* Doc 04 does NOT serialize a report without `timing_condition`. Mode disclosure is data integrity.  
* Doc 04 does NOT mix `total_scaled` with single-section values. `total_scaled` is strictly full-SAT (400–1600); `partial_display_scaled` is strictly single-section (200–800). Partial sessions store `total_scaled = NULL` (V4.3 §9.1).  
* Doc 04 does NOT score against a missing, candidate, or incompletely-attested `scoring_model_versions` row. The orchestrator version-validation gate (V4.3 §12.1) raises `integrity_constraint_violation` before any work; the report state is `failed_requires_review`.  
* Doc 04 does NOT permit `scoring_constants` mutation on active or superseded versions. INSERT, UPDATE, and DELETE are all blocked by trigger (V4.3 §8.4); only Tier 3 governance with a new candidate version can change constants.  
* Doc 04 does NOT carry a `form_equating_offset` column (RETIRED in V3.0 per RB-V3-02). Form-level difficulty is absorbed by the canonical formula's difficulty-weighted M2 deductions; statistical or judgment-based form equating is not part of the v1.0 scoring architecture.

---

## **13\. Risks acknowledged at parent level (V3.0)**

Things documented as honest engineering reality, not buried:

1. **Section-adaptive complexity in 04A.** The state machine has split timers, mid-test routing decisions, dual-mode interaction with timer-pause logic, and partial-scoring semantics across abandonment scenarios. 04A will be the longest subdoc. This is by design; the complexity exists in the real DSAT and Lyceon mirrors it.

2. **(RETIRED in V3.0)** \~\~Form-equating Layer 3 is judgment-based at MVP.\~\~ — V4.3 retires `form_equating_offset` entirely. Difficulty differences across forms are absorbed by the canonical formula's difficulty-weighted M2 deductions. No statistical form equating is needed because no per-form offset exists. (V2.0 Risk \#2)

3. **(RETIRED in V3.0)** \~\~Easy-path ceiling-cap value is Lyceon's calibration call.\~\~ — V4.3's banded ceiling produces path-A maxima from the formula directly; no separate cap value is authored. The Test Ninjas benchmark is the calibration reference. (V2.0 Risk \#3)

4. **Routing thresholds (T\_rw, T\_math) are content-team calibration calls.** Per the V4.2 architectural decision, routing thresholds live on `test_forms.routing_threshold_rw` and `routing_threshold_m` — per-form configuration, not global scoring constants. Documented external research suggests T\_rw ≈ 18–21 and T\_math ≈ 13–16; final values are content-team judgment captured in the form-publish evidence per 04A V2.2 publish gate.

5. **Form authoring lift is real.** 2-3 forms × 147 authored questions per form \= 294-441 unique questions at MVP launch. Content team confirms feasibility as a lock condition.

6. **MVP scope deliberately omits accommodations.** Per Q4. When accommodations land (post-MVP), routing thresholds may need recalibration. Flagged in 04A; not implemented at MVP.

7. **Same-form retake interpretation is a known integrity surface.** Retake metadata makes the data honest. Whether reports display retake-N differently from retake-1 is a 04C concern; the parent guarantees the metadata is always present.

8. **Lenient mode is the default and produces identical scores to strict mode** but represents a different test-condition validity. The `timing_condition` structural field forces honest interpretation. Without this field, lenient scores could be over-interpreted as test-day readiness.

9. **Validation against Test Ninjas is a calibrated approximation, not CB-official scoring (V3.0 — NEW per RB-V3-15).** The V4.3 evidence packet documents this honestly: 37.8% in exact Test Ninjas band; 71.1% within ±30; 83.9% within ±50; 98.2% within ±100. Lyceon scaled scores are aligned with Test Ninjas within these tolerances. If Test Ninjas updates its calculator post-launch, the band table will diverge; v1.0 does not recalibrate in response — any recalibration requires a Tier 3 governance cycle producing a new `scoring_model_versions.version`. Disclosure copy in 04C must continue to frame scaled scores as modeled, not as official.

10. **Doc 05 mastery consumer pattern is undefined at V3.0 lock (V3.0 — NEW per RB-V3-08).** Doc 05 is not yet drafted. V3.0 commits Doc 04 to the no-emission posture (RB-V3-07) and the canonical-feedstock data contract (`test_session_answers JOIN questions`), but does not commit Doc 05 to a specific consumer pattern. The undefined consumer pattern is a known coordination surface; it will be resolved when Doc 05 is drafted. Doc 04 does NOT block on Doc 05 — mastery state can be absent indefinitely without affecting scoring, runtime, or display behavior.

---

## **14\. Launch-blocker values (V3.0 — most resolved by V4.3)**

The parent doc flags these values; subdocs depend on them; resolution is via lock-evidence ticket before any subdoc deploys to production.

| Launch blocker | Status (V3.0) | Resolved by | Used in |
| ----- | ----- | ----- | ----- |
| Scoring evidence packet (V2.0 entry 1\) | **RESOLVED** — V4.3 packet hash `29c3e0fd…9b88651b`, locked 2026-05-12 | Doc 04B V4.3 | 04B scoring \+ `scoring_model_versions.v1.0` catalog row |
| Layer 1 curves: 4 raw→scaled tables (V2.0 entry 2\) | **RETIRED** — V2.0 3-layer model superseded by V4.3 canonical formula v1.0 | — | — |
| Easy-path ceiling-cap values (V2.0 entry 3\) | **RETIRED** — banded-ceiling formula produces maxima directly; no separate cap value | — | — |
| Layer 2 routing thresholds (T\_rw, T\_math) (V2.0 entry 4\) | **OPEN** — per-form, content-team authored, lives on `test_forms.routing_threshold_*` | Content team (within form-publish evidence per 04A V2.2 publish gate) | 04A routing decision; 04B `path_floor` computation |
| Layer 3 form-equating offsets per non-reference form (V2.0 entry 5\) | **RETIRED** — `form_equating_offset` column removed; no per-form offsets in v1.0 | — | — |
| Initial form bank — which 2-3 forms ship at launch (V2.0 entry 6\) | **OPEN** | Content team | 04A form selection \+ content authoring schedule |
| Score table version naming convention (V2.0 entry 7\) | **RESOLVED** — `scoring_model_versions.version` PK is a text PK; v1.0 is the launched value | Engineering | 04B versioning |
| Section break duration default (V2.0 entry 8\) | **OPEN** | Product | 04A section transitions |
| Test-level grace window value (V2.0 entry 9\) | **OPEN** (default 24h pending Product sign-off) | Product | 04A abandonment handling |
| Section grace window value (lenient mode pause-on-exit) (V2.0 entry 10\) | **OPEN** | Product | 04A timer logic |
| Exam-entitlement predicate name in Doc 01 (V2.0 entry 11\) | **OPEN** — coordination gap | Doc 01 owners | 04A \+ 04C entitlement checks |
| **Doc 01 RLS identity helpers (V3.0 — NEW)** | **OPEN** — `current_student_id()` and `is_admin()` not yet defined; V4.3 §22.1 deploy-time placeholder is `auth.uid()` | Doc 01 V7 (or coordination memo) | 04B V4.3 `score_runs_student_read` and admin recompute RLS policies |
| **`scoring_model_versions.v1.0.validation_packet_url` canonical retrieval URL (V3.0 — NEW)** | **OPEN** — deploy-time value | Engineering (deploy script) | 04B `scoring_model_versions` catalog row at v1.0 activation |
| **`scoring_model_versions.v1.0.constants_sha256` computed value (V3.0 — NEW)** | **OPEN** — deploy-time value (computed from sorted `scoring_constants` rows at activation) | Engineering (deploy script) | 04B `scoring_model_versions` catalog row at v1.0 activation |

The V3.0 OPEN items list is materially shorter than V2.0's (9 open items vs V2.0's 11\) because V4.3's lock resolved or retired the scoring-architecture entries. The remaining open items are operational (Product timing values, content team form-publish work, Doc 01 coordination, and v1.0 activation deploy-time values). Resolved and retired V2.0 entries are kept in the table for traceability.

These are NOT lock conditions for the parent doc itself; the parent doc locks based on review \+ sign-off (per Lock conditions section). These ARE prerequisites for any subdoc to ship to production.

---

## **15\. Acceptance for moving to subdoc drafting (V3.0)**

Once this parent doc V3.0 is green-lit:

1. Calibration register is locked (V4.3-aligned); subdocs inherit  
2. Subdoc family map is locked; scope boundaries respected (04B V4.3 already locked)  
3. Hard guarantees are locked (including new \#17 and \#18); subdocs implement against them  
4. Cross-doc handoffs are locked; integration contracts established (Doc 04 → Doc 05 mastery-emission contract retired)  
5. Risks are documented; honest engineering notes propagate to subdocs  
6. Launch-blocker values are flagged (V3.0 list); tracking begins for content team and Doc 01 coordination

Then **04A V2.2 drafting begins**, followed by 04C, then 04D. 04B is already locked at V4.3 and is the anchor.

---

## **16\. V2.0 → V3.0 Supersession Crosswalk**

Each row maps a V2.0 element to its V3.0 disposition. Engineers and reviewers can use this table to audit any V2.0 reference encountered in adjacent docs or in legacy code.

| V2.0 Element | V3.0 Disposition | Where in V3.0 |
| ----- | ----- | ----- |
| **§Header** "Version: V2.0; Draft for lock; Supersedes: V1.0" | **REPLACED** — V3.0 header; supersedes V2.0 | Header |
| **V2 closeout register** (13 V1→V2 findings) | **PRESERVED in V2.0 archive** — not reproduced here; V3 closeout register catalogs V2→V3 changes | V3 closeout register (this doc) |
| **Q1** "Scaling architecture sourcing" (CB-derived 3-layer modeled) | **SUPERSEDED** — 04B V4.3 canonical formula v1.0 | §2 Q1 (V3.0), §7 |
| **Q1-arch** "3-layer model" | **SUPERSEDED** — single canonical formula | §2 Q1-arch (V3.0), §7.2 retirement table |
| **Q1-cap** "Easy-path scaled-score ceiling 590-670" | **SUPERSEDED** — banded ceiling in canonical formula produces maxima directly | §2 Q1-cap (V3.0) |
| **Q2** "Form bank at MVP, 147/form, reference form concept" | **PARTIALLY REVISED** — form counts preserved; reference form concept retired alongside `form_equating_offset` | §2 Q2 (V3.0), §6 |
| **Q3** "Section-adaptive structure" | **PRESERVED** unchanged | §2 Q3, §5 |
| **Q4** "No accommodations at MVP" | **PRESERVED** unchanged | §2 Q4 |
| **Q5** "Silent in-section pacing" | **PRESERVED** unchanged | §2 Q5 |
| **Q6** "Soft-gate section break" | **PRESERVED** unchanged | §2 Q6 |
| **Q7** "Single `mode` flag, strict vs lenient" | **PRESERVED** unchanged | §2 Q7, §8 |
| **Q7-disclosure** "`timing_condition` structural field" | **PRESERVED** unchanged | §2 Q7-disclosure, §9 \#13 |
| **Q7-grace** "24h test-level grace" | **PRESERVED** unchanged | §2 Q7-grace |
| **Q7-partial** "Completed-section raw \+ scaled allowed; total NOT allowed" | **REVISED** — `total_scaled = NULL` (DB-backed), `partial_display_scaled` for single-section display | §2 Q7-partial (V3.0), §9 \#16, §10.2 |
| **Q8** "Unlimited retakes" | **PRESERVED** unchanged | §2 Q8 |
| **Q8-meta** "Retake metadata structural fields" | **PRESERVED** unchanged | §2 Q8-meta, §9 \#14 |
| **Q9** "Guardian headline only at MVP" | **PRESERVED** unchanged | §2 Q9 |
| **Q9-route** "Routing path internal-only" | **PRESERVED** \+ reaffirmed against V4.3 §17 | §2 Q9-route, §9 \#15 |
| **Q10** "Scoring failure UX (b) — raw \+ diagnostics first" | **REVISED** — V4.3 §19.6 split: transient failure → `raw_available_scaled_pending`; permanent unattested-version failure → `failed_requires_review` (no `score_runs` row); mastery events NOT emitted | §2 Q10 (V3.0), §10.2 |
| **§3 Subdoc family map** | **REVISED** — 04B status flipped to LOCKED; 04A V2.2 pending; 04B "owns" updated with V4.3 specifics; 04C "owns" includes `partial_display_scaled` consumption; 04D "owns" includes V4.3 attestation audit | §3 (V3.0) |
| **§4 Source-of-truth boundaries** Doc 05 row "Doc 04 emits events after `score_run` success" | **REWRITTEN** — Doc 04 emits NO mastery events; Doc 05 reads canonical answer tables directly | §4 (V3.0), §11.2 |
| **§5 SAT MVP structure** | **PRESERVED** unchanged (5.1, 5.2, 5.3 verbatim except routing-threshold storage note) | §5 |
| **§6 Form architecture** "1 form-equating offset" bullet | **RETIRED** — `form_equating_offset` removed entirely | §6 (V3.0) |
| **§6 Form architecture** "score\_table\_version string" | **REVISED** — FK into `scoring_model_versions.version`; v1.0 at MVP | §6 (V3.0) |
| **§7 Scoring architecture** "3-layer model \+ scoring evidence packet TBD" | **COMPLETELY REWRITTEN** — V4.3 canonical formula v1.0; packet exists (hash `29c3e0fd…9b88651b`); three-field attestation in catalog; constants immutability triggers; version-validation gate | §7 (V3.0) |
| **§8 Session mode** | **PRESERVED** unchanged | §8 |
| **§9 Hard guarantees** \#11 "Mastery events fire only after `score_run` success" | **REVISED** — mastery state is independent of scoring; Doc 04 emits NO events; V4.3 §16.4 wording adopted | §9 \#11 (V3.0) |
| **§9 Hard guarantees** \#1–\#10, \#12–\#16 | **PRESERVED** unchanged (some wording cleanup) | §9 |
| **(NEW)** §9 \#17 "Scoring model version attested before scoring" | **NEW** — V4.3 §12.1 gate | §9 \#17 |
| **(NEW)** §9 \#18 "Constants sealed once active" | **NEW** — V4.3 §8.4 triggers | §9 \#18 |
| **§10.1 Parent-level acceptance** | **REVISED** — V4.3 packet reference added; `form_equating_offset` removed from acceptance items | §10.1 (V3.0) |
| **§10.2 `ExamReportState` enum** | **PRESERVED** unchanged at the enum level; V3.0 clarifies semantics (transient vs permanent failure paths; no mastery emission on state transitions) | §10.2 (V3.0) |
| **§11.1 Doc 02 → Doc 04** | **PRESERVED** \+ `correct_variants` field added per V4.3 §10 comparator | §11.1 |
| **§11.2 Doc 04 → Doc 05** "TestQuestionEvent emission" | **REWRITTEN** — no events emitted; Doc 05 reads canonical answer tables | §11.2 (V3.0) |
| **§11.3 Doc 04 ↔ Doc 03** | **PRESERVED** unchanged | §11.3 |
| **§11.4 Doc 04 → Doc 01** | **PRESERVED** \+ V4.3 §22.1 coordination gap referenced | §11.4 (V3.0) |
| **§11.5 Doc 04 → Doc 07** | **PRESERVED** unchanged | §11.5 |
| **§12 What Doc 04 explicitly does NOT do** | **AUGMENTED** — new entries: no mastery events; no `total_scaled` overload; no scoring against unattested versions; no `scoring_constants` mutation on active/superseded; no `form_equating_offset` | §12 (V3.0) |
| **§13 Risks** \#1 (section-adaptive complexity) | **PRESERVED** | §13 \#1 |
| **§13 Risks** \#2 (Layer 3 form-equating judgment) | **RETIRED** — V4.3 retires `form_equating_offset` | §13 (V3.0) |
| **§13 Risks** \#3 (easy-path ceiling-cap value) | **RETIRED** — banded ceiling in canonical formula | §13 (V3.0) |
| **§13 Risks** \#4–\#8 | **PRESERVED** (renumbered as \#4–\#8) | §13 (V3.0) |
| **(NEW)** §13 Risk \#9 (Test Ninjas calibrated approximation) | **NEW** | §13 \#9 |
| **(NEW)** §13 Risk \#10 (Doc 05 consumer pattern undefined) | **NEW** | §13 \#10 |
| **§14 Launch-blocker values** | **HEAVILY REVISED** — most resolved by V4.3; remaining items shorter; three V3.0-new entries (Doc 01 RLS helpers, validation\_packet\_url, constants\_sha256) | §14 (V3.0) |
| **§15 Acceptance for moving to subdoc drafting** | **REVISED** — 04A V2.2 → 04C → 04D draft order (04B already locked) | §15 (V3.0) |

---

## **17\. Change Records**

| Version | Date | Reviewer | Summary | Source |
| ----- | ----- | ----- | ----- | ----- |
| V1.0 | (historical) | (V1 closeout register in V2.0) | Initial parent draft | — |
| V2.0 | 2026-04 (approx) | Karl \+ reviewer | 13 V1→V2 findings closed (7 BLOCKER, 6 non-blocking); calibration register; subdoc family map; hard guarantees; report state enum; cross-doc handoffs | V2 closeout register (in V2.0 doc) |
| V3.0 | 2026-05-12 | Karl \+ Claude | Parent absorbs Doc 04B V4.3 architectural decisions. Canonical scoring formula v1.0 (3-layer model retired). `form_equating_offset` retired. `test_forms.score_table_version` FK into `scoring_model_versions(version)`. Partial scores: `total_scaled = NULL` \+ `partial_display_scaled`. Mastery events removed from Doc 04 (V2.0 invariant \#11 revised verbatim from V4.3 §16.4). New hard guarantees \#17 (version attestation gate) and \#18 (constants immutability). §14 launch-blocker list materially shortened (most resolved by V4.3). New supersession crosswalk (§16). | V4.3 reviewer 10-point Parent alignment list \+ V4.3 lock state \+ V4.3 architectural decisions |
| V3.0 lock-cycle cleanup | 2026-05-12 | Karl \+ ChatGPT (SWE review) | Post-review minor cleanup applied within the V3.0 lock cycle (no version bump): (1) softened 04B V4.3 "LOCKED" wording to "spec-locked; deploy-time attestation values pending" in header and §3; (2) explicit Doc 05 inherited-constraint statement added to §11.2; (3) "widely-referenced" softened to "third-party DSAT benchmark calculator" in Q1, §7.4, §12; (4) hard guarantee \#1 wording fixed to "two modules per section, four delivered modules per completed route"; (5) §10.2 04C source-of-truth-for-failed-states clarification added (04D failure ledger / incident metadata is the source when no `score_runs` row exists). | ChatGPT SWE review verdict "PASS with minor cleanup" |

Future change records to be appended below this row.

---

**End of Doc 04 Parent V3.0.**

V4.3 is the moat. Parent V3.0 absorbs it and tells the family how to align.

