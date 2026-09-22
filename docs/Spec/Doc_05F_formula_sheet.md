# Doc 05F — Plan Generation Formula Sheet
**Generators:** `deterministic_v1` (primary), `fallback_v1` (fail-open backup)  **Date:** 2026-09-17  **Companions (committed with this sheet):** `scripts/ci/reference/calendar_formula_reference.py` (parity oracle, both generators), `scripts/ci/fixtures/calendar_formula_fixtures.json` (9 fixtures, input → byte-exact output for both generators), `Doc_05F_formula_fixtures.md` (the same fixtures as readable plans)

Doc 05F §11 references this sheet; the spec does not restate its numbers. Design goals, in order: auditable, boring, deterministic, explainable.

---

## 1. Shape of a day

A day holds at most four kinds of block — like a calendar with four appointment colours. Practice is split by section; review is one block (may be split later); the fourth kind is the full-length exam. A day never holds more than three at launch (exam days hold one).

| Block | Colour (proposal) | What it is | Size | Launch | Progress (§13 allocator) |
|---|---|---|---|---|---|
| `practice` · Math | blue | one Math session with a mix of up to four Math domains, e.g. `{Algebra 10, Adv Math 5}` | Math's share of the day's practice time | one practice session, section filter + domain mix, `target_count = Σ` | Math practice items answered that day, capped |
| `practice` · Reading & Writing | violet | same for the four R&W domains | R&W's share | same | R&W items that day, capped |
| `review` | amber | due review items — or, on the study day after a full-length, that exam's missed questions | what is due, ≤ 50% of the day; exam review may take the whole day | one review session | review items that day, capped |
| `full_length` | slate | one exam | — | Doc 04 | Doc 04 terminal state |

Scope is domain-level only (the eight College Board domains, **always by their full names** — `Algebra`, `Advanced Math`, `Problem Solving and Data Analysis`, `Geometry and Trigonometry`, `Information and Ideas`, `Craft and Structure`, `Expression of Ideas`, `Standard English Conventions` — exactly as production stores them; no codes, no aliases, no mapping layer anywhere in the stack), or section-level at cold start. No skills. Question choice and difficulty are the engine's (Doc 02B §15; INV-08-01).

## 2. The six steps, per date `D` in horizon order

Every quantity is an integer (seconds, questions, weights, basis points). No floats anywhere.

**Step 0 — Local dates.** Every date is the student's local date, from `student_study_profile.timezone`. That value is captured from the browser at setup and is editable. **If it cannot be determined or is not a valid IANA zone, it falls back to `America/Chicago`** — the platform standard. The calendar fails open: a student always gets a plan on a real calendar day, even if the day boundary is not the one they would have chosen. Platform quota reset is separately Chicago-owned (Doc 02B).

**Step 1 — Budget.** `B = daily_minutes × 60`. With a target date: `D ≥ target → B = 0` (nothing is planned on or after the test until the student sets a new date); `0 < target − D ≤ taper_days → B = B × taper_ratio_bp / 10000`.

**Step 2 — Exam placement** (needs a full-length weekday). In this precedence: (1) final rehearsal on the last weekday occurrence ≥ `final_exam_lead_days` before the target; (2) nothing else inside the lead window or on/after the target; (3) `full_length_min_gap_days` from the last completed exam and from each other; (4) cadence = every `full_length_every_n_occurrences`-th occurrence of the weekday counted from the first occurrence on/after `setup_completed_at`; (5) `max_full_length_per_horizon`. An exam day holds nothing else.

**Step 3 — Need weights.** `w_d = weight_by_level[L_d]` over the **live mastery domain, levels 0–4** (`public.mastery_levels`: L0 Foundations, L1 Building, L2 Developing, L3 Proficient, L4 Strong; NULL = unmeasured). Launch mapping `{0:5, 1:4, 2:3, 3:2, 4:1}` — L0 is weakest and leads; L4 keeps the floor of 1 so strengths stay in rotation. `null_level_weight` = 3 sits between Developing and Proficient, `× post_exam_multiplier` for domains the last exam marked weak while `days_since_exam ≤ post_exam_emphasis_days`. All eight unknown → cold start (Step 5 splits Math/RW evenly, no weights).

**Step 4 — Review.**
- If a full-length was completed and not yet reviewed (or one was placed earlier in this horizon): the **next study day** gets an exam-review block of `min(missed_count, B / review_seconds)` — up to the whole budget. A placed-but-not-yet-taken exam gets a placeholder size (`exam_review_default_count`); the `post_exam` regeneration replaces it with the real count.
- Otherwise: `R = min(due_through_D − already_planned, review_block_max, (B × review_share_max_bp / 10000) / review_seconds)`.
- `B ← B − R × review_seconds`.

**Step 5 — Practice.** `Q = (B / practice_seconds)` rounded down to a multiple of `granularity` (5). One rule at two levels, applied one 5-question granule at a time: **each granule goes to whoever is furthest behind its target share.** Deficit = `target share × (everything planned in the last 28 days + today) − what it has had`.
- **Level 1, sections:** granules go to Math or R&W by section weight share (`Σw` per section). Product rule: when the day has ≥ 2 granules, both sections get at least one.
- **Level 2, domains within each section:** granules go to the domain with the largest deficit; once a block holds `max_domains_per_block` distinct domains, further granules stay within them. Ties by canonical order.
- Cold start (all eight unknown): Math and R&W halves, leading section alternating by study-day index.
Result: two practice blocks (Math, R&W), each a mix in multiples of 5, each domain ≥ 5.

**Step 6 — Explanation.** Per domain in the mix: `weak` (L0–L1), `exploring` (unknown), `balanced` (L2), `strength` (L3–L4), `post_exam`. Per block: `review_due`, `exam_review`, `exam_review_placeholder`, `final_rehearsal`, `exam_cadence`, `taper`, `cold_start`. One key per domain and one per block; nothing to rank.

That is the entire algorithm. There is no round-robin, no proportional rounding, no per-day constraint set, no plan-history spacing rule, and no strength quota; the weight floor of 1 at level 5 is what keeps strong domains in rotation, and the deficit rule is monotone by construction (more need never means fewer questions).

## 3. What the evidence supports and what is a Lyceon default

| Element | Basis | Label |
|---|---|---|
| Every block is retrieval; no passive blocks | Roediger & Karpicke 2006; Dunlosky et al. 2013 (practice testing: high utility) | **Finding** |
| Review first; item spacing owned by SM-2 (Doc 02B) | Cepeda et al. 2006/2008; Dunlosky 2013 (distributed practice: high utility) | **Finding** |
| Exam review on the next study day, ahead of everything | Error-correction under test conditions is the highest-value material (Khan Academy / College Board guidance) | **Finding** for the direction; "next study day, whole budget" is a **ruling** |
| Several domains per practice block, rotating across days | Rohrer & Taylor 2007; Rohrer et al. 2015 (interleaving in math; Dunlosky rates it moderate) | **Finding** for mixing; the 4-domain cap and 5-question minimum are **rulings** |
| Weakness leads; strengths stay in rotation | Focus on weak areas (Khan / College Board) | **Finding** for the direction; the 5→1 ladder over L0–L4 is a **default** |
| Unknown mastery = neutral weight | — | **Ruling** (R-08-26) |
| Review ≤ 50% of a day | — | **Ruling** (tutor-guided review is slower per item by design) |
| Post-exam ×2 on weak domains for 7 days | Direction supported; magnitude/window not | **Default** (window matches Doc 02B §19) |
| Taper 50% for 3 days; nothing on/after test day | Rest before the test (Khan, College Board) | **Ruling** on the numbers |
| Full-length every 2nd weekday occurrence; ≥7 days lead and gap | College Board: space practice tests ≥2 weeks apart; last one 1–2 weeks out | **Aligned default** (no final-month tightening) |

## 4. Configuration — `calendar_runtime_config`

| Key | Launch | Bounds |
|---|---|---|
| `horizon_days` | 14 | 7–28 |
| `review_share_max_bp` | 5000 | 0–10000 |
| `review_block_max` | 30 | 1–100 |
| `exam_review_default_count` | 20 | 5–60 |
| `weight_by_level` | `{0:5,1:4,2:3,3:2,4:1}` | levels 0–4, live domain |
| `null_level_weight` | 3 | 1–5 |
| `post_exam_emphasis_days` / `post_exam_multiplier` | 7 / 2 | 0–30 / 1–5 |
| `min_domain_questions` / `max_domains_per_block` / `granularity` | 5 / 4 / 5 | 5–20 / 1–8 / 5 |
| `full_length_every_n_occurrences` | 2 | 1–6 |
| `full_length_min_gap_days` / `final_exam_lead_days` / `max_full_length_per_horizon` | 7 / 7 / 2 | 1–21 / 3–21 / 0–4 |
| `taper_days` / `taper_ratio_bp` | 3 / 5000 | 0–7 / 0–10000 |
| `recent_planned_window_days` | 28 | 14–56 |
| `canonical_domain_order` | the eight full College Board domain names | tie-break only |

Read from owners, never duplicated: `practice_runtime_config.target_seconds_per_question`; `review_estimated_seconds_per_item` (SCL-08-F); exam durations (Doc 02B §41 / 04A).

## 5. Snapshot (`PlanInput`) — everything the generator sees

`profile` (timezone, target date, study-days mask, daily minutes, full-length weekday, setup date); `mastery_levels[8]`; `review_due_by_date[]`; `exams` (last completed date, missed count, reviewed flag, weak domains); `recent_planned_by_domain` (last `recent_planned_window_days` of plan rows); `engine_planning` (practice seconds/unit, review seconds/unit); `constants` (this table). The generator reads nothing else. Any non-essential input the builder cannot read is recorded in `snapshot.degraded[]` and the generator runs the cold-start branch for it — a balanced plan with the reason in the audit trail, never a blank day.

## 5A. `fallback_v1` — the fail-open backup

Same six steps with the mastery-dependent parts removed, so it needs only the profile (mask, minutes, target date, full-length weekday, setup date) plus, if readable, the last exam's facts and a total review count:

- Step 1 budget, Step 2 exam placement, Step 4 review (including exam review on the next study day), Step 6 keys: **identical**.
- Step 3/5: no weights. Two practice blocks per day, `Math: Q/2` and `R&W: Q/2`, the leading section alternating by study-day index (no stored state). Review uses a single total-due count rather than a per-date queue.
- Output shape, validator, immutability, and parity gate: identical. Every block carries `fallback` so the UI and audit trail say why.

**When it runs:** `calendar_persist_version` calls the builder; if any *essential* input (profile, constants) is missing, nothing is generated and the prior plan stands. If the builder reports `degraded[]` containing mastery or the review queue, or if `calendar_compute_plan` raises, the RPC runs `calendar_compute_plan_fallback` on the same snapshot in the same transaction and records `generator = 'fallback_v1'` and the reason on the version. The student always gets a valid day; the version row says which generator produced it and why.

**Suite result:** the same 3,000 snapshots, zero violations (determinism, budget, no empty study day, one block per section, exam rules, exam review next study day).

## 6. Supabase implementation contract

Mirrors Doc 05A/B: a pure inner function, a snapshot builder, a validator, and INSERT-only writers; the formula lives in PL/pgSQL and nowhere else.

| Object | Kind | Role |
|---|---|---|
| `calendar_build_plan_input(student_id, dates[]) → jsonb` | `STABLE`; reads canonical tables + config | Freezes §5; records `degraded[]` |
| `calendar_compute_plan(p_input jsonb) → jsonb` | **pure `IMMUTABLE`, no table access, integer arithmetic only** | §2 |
| `calendar_compute_plan_fallback(p_input jsonb) → jsonb` | pure `IMMUTABLE` | §5A |
| `calendar_validate_plan(mode, input, output) → jsonb` | pure | Doc 05F validator rules |
| `calendar_persist_version(...)` and the other write RPCs | `SECURITY DEFINER SET search_path = public, pg_temp`; server role only; INSERT only | `FOR UPDATE` on the profile → build → compute → validate → insert, one transaction |

**Never fails closed:** (1) every legal snapshot yields ≥1 block on every study day with ≥15 minutes (both generators, suite: 0 empty days); (2) a rejected or thrown primary run falls back to `fallback_v1` on the same snapshot, recorded on the version; (3) if even that cannot run, the prior version stands and the read succeeds; (4) essential inputs are never invented — no `COALESCE` defaults.

**Mask convention:** `study_days_mask` and `full_length_weekday` use Postgres `DOW` (0 = Sunday) everywhere; the reference implementation uses the same convention so the parity gate would catch an `ISODOW` slip.

**Parity gate:** `calendar_formula_reference.py` (both generators) is the oracle, as `validation_sweep.py` is for 04B. CI runs the nine fixtures and the seeded suite — `suite(N=3000, seed=1)` and `suite_fallback(N=3000, seed=1)`, regenerated from `rand_snapshot`, never stored — through both the reference and the RPCs, and fails on any byte difference or any suite violation. **The gate runs against PostgreSQL 17** (matching prod): `security_invoker` semantics and integer-division edges are exactly what it exists to prove. The TypeScript server never contains the formula; it calls the RPC.

## 7. Validation record

`suite(N=3000, seed=1)` and `suite_fallback(N=3000, seed=1)`, both generators, zero violations: determinism; no study on/after target; budget; no empty study day with ≥15 min; ≤2 practice blocks per day, each within one section; ≤4 domains per block, all counts multiples of 5 and ≥5; exam-day isolation; lead window; minimum gap; exam review on the next study day after every exam; **monotonicity: 0 violations of 623** (lowering a domain's mastery never reduces its questions). Weight fidelity: **TVD 0.019 with no prior history** (the deficit rule is near-exact); 0.106 when the suite injects adversarial random 28-day history that must be repaired inside one horizon. Re-run after re-keying to levels 0–4: identical results. One-study-day-a-week students rotate through all eight domains over four weekly generations. Budget utilization 0.955.

## 8. Doc 05F change record (owner applies to the locked doc)

The locked Doc 05F predates this sheet. These are the edits that reconcile it; nothing else in the doc changes.

| # | Doc 05F | Change |
|---|---|---|
| 1 | §7.2 `calendar_plan_versions` | `generator` CHECK becomes `IN ('deterministic_v1','fallback_v1')`; `validator_detail` carries the fallback reason |
| 2 | §10.1 `PlanInput` | gains `recent_planned_by_domain`, `exams.missed_count`, `exams.reviewed`, `engine_planning`, and `degraded[]` |
| 3 | §7.4 `calendar_blocks` | `domain` and `skill_codes` columns replaced by `scope jsonb`; `section` stays and is NOT NULL for practice. Practice is **two blocks per day, one per section**: `{"mix":[{"domain","count"}]}`. Review: `{"mode":"queue"}` or `{"mode":"session","source_engine","source_session_id"}`. Full-length: `{"form_id"}`. Per-type CHECK on shape |
| 4 | §11 | Replaced by a reference to this sheet: "the generation formula is defined in the Doc 05F Formula Sheet; that file is canonical." The round-robin text and its constants go |
| 5 | §13 | Allocator matches practice items against `section` + the mix |
| 6 | §10.3 validator | V-04: at most one practice block per section per day; counts multiples of `granularity`, each ≥ `min_domain_questions`, ≤ `max_domains_per_block` domains, all in the block's section. V-06: domain valid for the block's section. V-08: ordinals contiguous across the day's blocks. V-10: applies to every mode creating a review block, and covers exam-review sizing |
| 7 | INV-08-06 | "50 stored snapshots" becomes the seeded 3,000-snapshot suite regenerated by the gate |
| 8 | §21 | Superseded by this sheet's §4. `weight_by_level` re-keyed to **levels 0–4** against the live `mastery_levels` domain (prod CHECK is `0..4`; the doc's 1–5 was wrong). `strength_level_floor`, `max_domain_gap_days`, `missed_domain_bonus`, `final_month_days`, `full_length_interval_days_final` are not keys |
| 9 | §7.9 | `calendar_runtime_config_history` is **per-table**, following `20260610000000_ws2_config_constants.sql:31-76` — thirteen such tables exist in prod. The earlier "shared history table" note was wrong |
| 10 | §7 RLS, G-08-08 | `current_student_id()` / `is_admin()` do not exist in prod; policies use `auth.uid()` (= `profiles.id`, verified 117/117) and `profiles.role = 'admin'`. G-08-08 closes |
| 11 | §14, §15, SCL-08-E, G-08-11/12 | Streak is **not calendar-owned**: `/api/me/streak` reads `student_overall_kpi.current_streak_days / longest_streak_days` (Doc 05B). SCL-08-E asks 05B for a student-local day boundary and the rest-day skip; until then the route returns 05B's UTC value with `history_complete: false`. G-08-11 and G-08-12 collapse into SCL-08-E |
| 12 | §21 `enabled_block_types` | Launch value `["practice"]`. Review and full-length are rebuild verticals; their adapters ship as fail-open stubs with contract tests, and the flag flips when each engine lands (G-08-02, G-08-03) |
| 13 | §9.3 review adapter | Review launch modes are `{"mode":"queue"}` and `{"mode":"session", source_engine ∈ {practice, full_length}, source_session_id}`. No `source_origin` field is asked of the engine |
| 14 | §16 guardian route | `/api/students/:studentId/calendar`, served through the existing `resolveSubject` + entitlement-gate pattern, not a `/api/guardian/…` path |
| 16 | §17.6 | Copy table re-keyed to what the generators emit — block: `review_due`, `exam_review`, `exam_review_placeholder`, `final_rehearsal`, `exam_cadence`, `taper`, `cold_start`, `weighted`, `fallback`; domain: `weak`, `exploring`, `balanced`, `strength`, `post_exam`. `spacing_revisit`, `maintain_strength`, `weak_domain`, `post_exam_focus` retired |
| 17 | §13 | The overlap example becomes `{Algebra 20}` vs `{Algebra 10, Geometry and Trigonometry 10}` against 20 Algebra units — skills were removed from the block model, so the old `ALG/LIN` example is unrepresentable |
| 18 | §15 | `GET /api/calendar` accepts an optional `device_timezone` query parameter; `device_timezone_mismatch` is derived from it. The server cannot otherwise know the device's zone |
| 19 | §7.1, §8.2, §14 | Timezone **fails open to `America/Chicago`** when the device zone is undetectable or invalid, at setup and for any student without a profile. This supersedes the earlier "never a Chicago fallback" note and closes G-08-12: `/api/me/streak` returns a real `current` for every student |
| 15 | SCL-08-A | Names ten tables now: the eight already listed plus `calendar_runtime_config_history` is **not** included (not student-owned); `calendar_job_runs` is |
