# Lyceon — Document 05F: Study Calendar & Plan Generation

**Version:** 1.0  **Date:** 2026-09-23  **Status:** LOCKED
**Owner:** Founder / CTO review  **Governed by:** Doc 00 V6.0, Doc 01 V8 / Doc 01A V1.0, Doc 02 Preamble V3
**Depends on:** Doc 02B V4 (practice + review runtime), Doc 04 family (exam runtime), Doc 05 family V1.0 (mastery), Doc 06A/B/C (ops)
**Supersedes:** PDF-07 — Calendar, Study Plan & Scheduling (Locked MVP, 2026-01-19) in full
**Companion:** `docs/Spec/Doc_05F_formula_sheet.md` — canonical for the generation formula (§11)
**Naming:** this document was drafted as "Doc 08". Ruling ids keep the `R-08-*`, `INV-08-*`, `V-*`, `G-08-*` and `SCL-08-*` prefixes they were issued under; only the document number changed.

> **Reading rule.** Where this document names a mechanism another document owns, it says *"defined in Doc XX §Y; that file is canonical"* and adds only the calendar-side contract. Any line restating a number or algorithm owned elsewhere is a defect (§20).

> **Organizing principle.** Four facts, none of which may change retroactively. **PLAN** — what we recommended, stored as immutable blocks in immutable versions. **ACTIVITY** — what the student did, owned entirely by the engines. **PROGRESS** — engine activity units on a date allocated once each to blocks in display order, capped at target; derived, never stored. **HISTORY** — every prior plan, unchanged. The calendar is a plan, never a gate (INV-08-19).

---

## Table of Contents

0. Summary and Launch Posture
1. Purpose and Scope
2. Supersession
3. Rulings Log (R-08-*)
4. Cross-Document Seam Table
5. Core Invariants (INV-08-*) with Proving Mechanisms
6. Domain Model — Plan, Activity, Progress, History
7. Schema (DDL) and Database Surface
8. Student Inputs and Derivations
9. Engine Adapters — Planning, Launch, Progress
10. Generator Contract and Validator
11. Generation Formula — reference to the Formula Sheet
12. Regeneration Lifecycle, Overrides, Block-Level Freeze
13. Progress Model — The Allocator
14. Derived State — Day, Extra Work, Streak, Facts
15. API Surface
16. Entitlement, Roles, Guardian Read
17. UI Contract
18. Observability, Events, Failure Modes
19. Testing, CI Gates, Plants
20. Forward References, Deploy Gates, Audit Rule
21. Runtime Constants Catalog
22. Worked Examples
23. Open Items and SCLs
24. Change Record
Appendix A — Future Generator Contract (feature state only)

---

## 0. Summary and Launch Posture

The study calendar turns the student's stated availability (minutes per day, study days, timezone, target exam date, target score, optional full-length test day) and the platform's knowledge of them (domain mastery, review items due, exam cadence) into a rolling 14-day plan of **blocks** — "Math · 20 questions · Algebra 10, Advanced Math 5, Geometry and Trigonometry 5", "Review · 7 due items", "Full-length SAT". A block launches its engine in one tap. Progress is a **count**: activity in the block's scope on the block's date, read from the engine's own immutable item records, capped at the target. Work beyond or outside the plan is shown as extra work. Nothing about completion is stored, matched, or reconciled.

| Capability | Launch |
|---|---|
| Generator | `deterministic_v1` primary, `fallback_v1` fail-open backup; formula in the Formula Sheet (§11) |
| Engines | practice and review live; full-length ships as a fail-open stub behind `enabled_block_types` (G-08-02) |
| Progress | counter over engine items per scope per local date (§13) |
| Plan history | append-only versions; normalized date ownership and block membership (§7) |
| Weekly auto-regen | once per student-local week, Monday-anchored, monitored |
| Timezone | student-local IANA, captured from the browser at setup, editable; falls open to `America/Chicago` |
| Streak | platform-wide, owned by Doc 05B; served without an entitlement gate (INV-08-20) |
| Top-level metric | none — facts only (R-08-28); rings post-launch (Appendix A note) |

---

## 1. Purpose and Scope

**In scope:** study profile; plan generation and validation; versioned plan storage; block launch; progress counting; overrides, block-level freeze and blocked-out days; regeneration; student UI; guardian read; calendar constants; calendar events.

**Out of scope (referenced, never redefined):** question selection (Doc 02B §15); practice/review/exam lifecycles (Doc 02B §14/§16; Doc 04A); mastery (Doc 05A/B); the activity streak itself (Doc 05B — this document serves it, §14); projections (Doc 05C); entitlement and `calendar_access` (Doc 01 / `EntitlementService`); guardian links (Doc 01); config doctrine, observability, idempotency, rate limiting (Doc 01A Parts I, II, IV, V); job registry (Doc 06C); analytics export (Doc 07).

---

## 2. Supersession

PDF-07 is superseded in full. What carries forward and what changes:

| PDF-07 | Doc 05F | Reason |
|---|---|---|
| §1 student owns plan; AI baseline not mandate; **no daily cap**; overrides preserved | Carried. The daily-minutes target bounds **auto-generation only**; student edits and actual study are never capped (R-08-19) | Core philosophy |
| §2 Auto / Custom, per-day overrides | Carried (`planner_mode`, `is_user_override`) | R-08-06 |
| §3 inputs | Replaced: `timezone`, `study_days_mask`, `daily_minutes`, `target_exam_date`, `target_score`, `full_length_weekday` | R-08-03/04/10/17/27 |
| §4 14-day primary / 30-day preview | 14-day plan horizon; the month view is a read-only lens over the same blocks (§17) | R-08-02 |
| §5 six block types | Three: `practice`, `review`, `full_length`; practice is split by section, so a day shows up to four kinds of card | R-08-01 |
| §6 `calendar_blocks` with `estimated_minutes` | `calendar_blocks` with `target_count` and `scope jsonb` | R-08-03 |
| §7–§11 regen, day editor, toggle | Carried (§12, §17) | — |
| §13 catch-up blocks | Removed. Missed blocks stay historical; "Do it now" creates a new block today (R-08-20) | Immutable history |
| §14 guardian visibility | Same dashboard, view-only, **no target score**, no "why" copy, no controls (R-08-08/22) | — |
| §15 free = limited | Free = nothing (R-08-09) | Doc 02B §12 matrix; prod `calendar_access` |
| §17 events, §18 failure modes | Carried, expanded (§18) | — |

---

## 3. Rulings Log (R-08-*)

Owner rulings, stated as current truth.

| ID | Ruling |
|---|---|
| R-08-01 | Block type enum = `practice`, `review`, `full_length`. Exam review and practice review both fall under `review`. |
| R-08-02 | Rolling 14-day horizon; weekly regeneration once per student-local ISO week, Monday-anchored, plus student-triggered refresh. |
| R-08-03 | Student sets time per day; the system derives engine units. Minutes are input-only; units are stored. |
| R-08-04 | Setup captures the study profile; the first plan is generated on the student's first entitled calendar open after setup completes. Setup collects timezone, target exam date, target score, study days, daily minutes, optional full-length weekday. Cold start = balanced. The diagnostic is a recommendation card, never a gate. |
| R-08-05 | Generation mixes weaknesses, strengths, review, practice and full-length exams. The formula is locked in the Formula Sheet; launch constants are runtime-configurable. |
| R-08-06 | Override scope is per day; a student edit marks the date `is_user_override`. |
| R-08-08 | Guardians get a view-only copy of the student's calendar dashboard — no settings, no target score, no controls, no explanation copy. |
| R-08-09 | The calendar surface is premium-only via `calendar_access`; free sees the CTA. The platform activity streak is excluded from this restriction. |
| R-08-10 | Calendar day boundaries use the student's local IANA timezone, captured from the browser at setup, changed only by the student, falling open to `America/Chicago` when undetectable or invalid. Platform quota reset stays `America/Chicago` and is separately owned (Doc 02B). |
| R-08-11 | Launch generators are `deterministic_v1` and `fallback_v1`; an LLM generator is feature state only (Appendix A). |
| R-08-12 | Legacy calendar code is deleted and rebuilt from this document. |
| R-08-13 | A block opens its engine with a pre-filled session in one tap. All engine activity, on- or off-calendar, reflects into calendar progress through the read-time allocator (R-08-24, R-08-29). Review and exam engines are built to the adapter contract (§9). |
| R-08-14 | The calendar is a plan, never a gate. No engine, mastery, KPI, or entitlement path depends on it (INV-08-19). Unmatched activity appears as Extra work. |
| R-08-15 | Every engine launches from the calendar through its adapter; an engine appears in `enabled_block_types` only once its contract test passes against the real engine. |
| R-08-16 | Partial work is shown (`12 / 20`). |
| R-08-17 | Target score is required at setup. |
| R-08-18 | When a block starts, only that block freezes; unstarted blocks on the day remain editable, and the day may still be blocked out around it. |
| R-08-19 | Student edits may exceed the daily-minutes target with no warning. Auto-generation respects the target. |
| R-08-20 | Missed blocks stay historical. "Do it now" creates a new block today. |
| R-08-21 | `llm_v1`: no columns, no code, no config values; Appendix A only. |
| R-08-22 | Guardians do not see target score. |
| R-08-24 | Progress is derived by the allocator from immutable engine activity; nothing about completion is stored, matched or reconciled. |
| R-08-25 | **Streak = platform-wide activity**, owned by Doc 05B and read from `student_overall_kpi`. A local day counts when any engine shows activity. The calendar renders it and never computes it (§14). |
| R-08-26 | NULL mastery on a mixed profile = neutral weight; all-NULL = balanced cold start. |
| R-08-27 | Optional full-length test weekday collected at setup, independent of study days. |
| R-08-28 | No single progress percentage at launch; facts only. Rings are post-launch and buildable on the allocator without schema change. |
| R-08-29 | Scope overlap is a formula property: each engine activity unit is consumed at most once, allocated to blocks in display order. |
| R-08-30 | Weekly regeneration is anchored to Monday permanently; not configurable. |
| R-08-31 | A student may **block out** any current or future date: the day is stored as their override with zero blocks, and no regeneration plans it. Started work on that day is carried, never removed (R-08-18). Blocked-out work is not moved anywhere — there is no catch-up pile (R-08-20). |
| R-08-32 | **System-initiated regeneration owns dates from tomorrow.** `weekly` and `post_exam` never replace a block sitting on the student's today. `setup`, `profile_change`, `student_refresh` and `rollback` own from today, because the student or an admin asked. |
| R-08-33 | The calendar resumes a live block **directly into its running session**, rather than routing to the engine's own hub page. A calendar block is a specific instruction; handing the choice back would be the calendar forgetting what it is. This divergence from an engine's landing page is deliberate. |

---

## 4. Cross-Document Seam Table

Verified against production (read-only) 2026-09-23 unless FORWARD_REF.

| Seam | Owner | Exact mechanism consumed | Calendar-side contract |
|---|---|---|---|
| Entitlement gate | Doc 01 / `EntitlementService` | `calendar_access` | Every calendar route; server is the authority, RLS is defense in depth (§16). |
| Entitlement predicate | Doc 01 | `public.entitlement_active(uuid)` | Guardian gate. |
| Guardian link | Doc 01 | `guardian_links(status)` | Guardian read requires `active` ∧ `entitlement_active(student)`, through `resolveSubject`. |
| Timezone names | PostgreSQL | `pg_timezone_names`, reached through `calendar_is_known_timezone(text)` | The catalog is not exposed through PostgREST, so the check is a database function (§7.13). |
| Practice timing | Doc 02B §41 | `practice_runtime_config.target_seconds_per_question` | Snapshotted into `engine_planning`; served to the UI as `estimates`. Never restated. |
| Practice create / items | Doc 02B §14 | `startOrReplaySession(...)`; `practice_session_items(question_section, question_domain, status, occurred_at)` | Adapter create; allocator reads answered items. |
| Review create | Doc 02B §16 | `startOrReplayReviewSession({ studentId, actorId, poolSpec, clientInstanceId, idempotencyKey, targetCount })` | Adapter calls it directly — one create path, never a second (§9.3). |
| Review queue | Doc 02B §16 | `review_schedule(student_id, status, queued_at)`, joined to `servable_questions` | `review_due_by_date` in `calendar_build_plan_input`. |
| Review items / lifecycle | Doc 02B §16 | `review_session_items(id, question_section, question_domain, status, occurred_at)`; `review_sessions(status)` | Allocator units; `progress` lifecycle. |
| Exam create / state / progress | Doc 04A | exam session tables, terminal states, Doc 04's progress presentation — **FORWARD_REF, absent in prod** | Exam adapter; G-08-02. |
| Domain mastery | Doc 05B | `student_domain_mastery.mastery_level`, levels 0–4 or NULL (`public.mastery_levels`) | Need weights (Formula Sheet §2 Step 3). |
| Activity streak | Doc 05B | `student_overall_kpi.current_streak_days`, `longest_streak_days` | Read and rendered; the calendar computes no streak (SCL-08-E). |
| Diagnostic state | Doc 02B / 05 | `student_diagnostic_states.state` | Recommendation card only (§17). |
| Config doctrine | Doc 01A Part I | `*_runtime_config` + per-table `_history` | `calendar_runtime_config` (§21). |
| Idempotency | Doc 01A Part IV | `IdempotencyService` (absent) | `calendar_mutation_ledger` interim (G-08-04). |
| Observability | Doc 01A Part II | logger, correlation ids, redaction | §18. |
| Rate limiting | Doc 01A Part V | `RateLimitLedger` bucket definitions | Regenerate routes (§21). |
| Jobs | Doc 06C | registry, dead-letter, owners | Weekly regen job; the dead-letter does not yet exist (§12.5, G-08-05). |
| Account deletion | Doc 05D §10 | deletion cascade | Calendar tables added by name (SCL-08-A). |
| Analytics | Doc 07 | — FORWARD_REF | §18 events; `calendar_launch_rate` (G-08-07). |

---

## 5. Core Invariants (INV-08-*) with Proving Mechanisms

| ID | Invariant | Proving mechanism |
|---|---|---|
| INV-08-01 | The calendar never selects questions, writes mastery, writes any engine table, or passes an engine a parameter its create function does not accept. | CI grep gate; launch payload ⊆ engine create signature, asserted by the contract tests. |
| INV-08-02 | Every engine launched from the calendar satisfies the adapter contract (§9.1). | `calendar.launch-contract.<engine>.test.ts` per engine, PG-backed and behind the vitest summary gate; `enabled_block_types` may not name an engine without a passing test against the real engine. |
| INV-08-03 | A block with a launch row is never removed from, or altered on, any version of its date. A date with `is_user_override=true` is never owned by a non-student version. | Validator V-12, V-14; writer gates; plants. |
| INV-08-04 | In `planner_mode='custom'` no non-student trigger writes anything. | Weekly job over a custom student writes zero rows. |
| INV-08-05 | `calendar_plan_versions`, `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches` have no runtime UPDATE/DELETE path: grants revoked, RLS denies, no RPC exposes them. Account deletion cascades through FK. | Grant/RLS gates; RPC inventory sweep; cascade test. |
| INV-08-06 | The generators are pure functions of their snapshot and read **nothing else** — no config table, no adapter call. | Parity gate: nine committed fixtures plus a seeded 3,000-snapshot suite regenerated per run, both generators, byte-exact against an independent Python oracle, on PostgreSQL 17. |
| INV-08-07 | Every plan passes the validator (§10.3) under its mode before persistence. | Per-rule gates; mode gates; rejection gates. |
| INV-08-08 | Progress is derived from immutable inputs only. No progress, completion, or attribution is ever stored. | Schema gate (no such columns); determinism test: same fixtures → same progress across two reads. |
| INV-08-09 | Every calendar mutation is idempotent via `idempotency_key`, and the ledger is read **under** the profile row lock. | Replay tests; concurrency gate C-2 (eight same-key callers → one write). |
| INV-08-10 | No calendar response contains question content, answers, or explanations. | Response schema tests on every route. |
| INV-08-11 | Every route under `/api/calendar` and the guardian calendar route enforces `calendar_access` server-side. `GET /api/me/streak` is explicitly exempt (R-08-25, INV-08-20). | Denial tests per route; presence test that the streak route has no entitlement check; plant. |
| INV-08-12 | Guardian access is read-only, through the guardian route only; no guardian grant or policy on any calendar table. | Route inventory; RLS test as guardian returns zero rows; the guardian payload is a distinct `.strict()` type, not the student type with fields deleted. |
| INV-08-13 | Every plan change not initiated by the student is surfaced with its trigger; student edits never mask it. | `latest_unacknowledged_nonstudent_change` fixture test. |
| INV-08-14 | No plan-shaping numeric literal in calendar code. | Constants gate scoped to `calendar/**`, with a narrow mask for `<x>_bp / 10000` basis-point division and its own self-test. |
| INV-08-15 | All local-date computations use the plan date's own timezone; no timezone literal in calendar code outside the single documented fall-open. | Grep gate; two-zone derivation test; DST tests at 23 and 25 hours. |
| INV-08-16 | Every calendar view is `security_invoker = true`. | Catalog gate; cross-student read returns zero rows; plant (dropping it leaks another student's plan). |
| INV-08-17 | Version numbers are allocated under a per-student row lock. | Two-transaction gate. |
| INV-08-18 | A block has at most one **live** engine session at a time; it may be launched again after that session is terminal. | Engine idempotency key `calendar:block:<block_id>:<launch_sequence>`; `calendar_link_launch` takes `FOR UPDATE` on the block row before allocating a sequence; concurrency gate C-3 (N launches → N distinct sequences, zero errors). |
| INV-08-19 | **Calendar non-authority.** No engine, mastery writer, KPI, entitlement decision, or learning-event path depends on a calendar block or launch existing. | CI gate: no non-calendar module imports `calendar/**`; engine create paths accept the calendar key as an opaque idempotency key with no calendar semantics. |
| INV-08-20 | **Streak independence.** Streak eligibility never depends on calendar launch, block completion, plan adherence, or `calendar_access`. | Streak service reads `student_overall_kpi` only, asserted; `GET /api/me/streak` has no entitlement gate, asserted, with a plant. |
| INV-08-21 | **Unit conservation.** An engine activity unit contributes to at most one block on its local date; progress + extra work never exceed recorded activity. | Allocator property test over generated cases; overlapping-scope fixtures in both display orders; plant by removing the consumed-set. |
| INV-08-22 | Cross-student integrity is relational: every calendar row's `student_id` is FK-bound to its parent's `student_id`. | Insert with a mismatched `student_id` → FK violation, per table. |
| INV-08-23 | **An activity unit is retrieval, dated by the column the schema guarantees.** Units are selected with `status = 'answered'` — never a nullness test on a timestamp — and dated by `occurred_at`, which both item tables CHECK non-null on every resolved row. | Skip fixtures per engine (a skipped row carries a timestamp and must produce zero units); plants on both the predicate and the column, one against a real engine and real constraint. |

---

## 6. Domain Model — Plan, Activity, Progress, History

```
STUDY PROFILE ─► GENERATOR ─► PLAN VERSION ─► PLAN DATES ─► BLOCK MEMBERSHIPS ─► BLOCKS   (PLAN, immutable)
                                                                                   │ launch (optional)
                                                                            ENGINE SESSIONS & ITEMS       (ACTIVITY, engine-owned, immutable outcomes)
                                                                                   │ count by scope × local date
                                                                            PROGRESS / EXTRA WORK          (derived, never stored)
```

**Block** — the stored planning grain: a scope and a target. Immutable, identity-stable across versions.
**Plan version** — the unit of change. Owns a set of **plan dates**; for each owned date lists **memberships** (which blocks, in what display order, `created` here or `carried` from an earlier version). Started blocks (launch row exists) must be carried by any later version owning their date (V-12).
**Current plan** for a date — the memberships of the highest accepted version owning that date. Ownership resolves **per date**, so two versions may jointly constitute one student's plan. A cleared or blocked-out day is an owned date with zero memberships; its `is_user_override` lives on the plan-date row, not on blocks.
**Progress** — §13. The day's engine activity units are allocated, each at most once, to blocks in display order by scope match, capped at target (R-08-29).

**Block types and scopes:**

| `block_type` | Engine | `section` | `scope` | Target unit |
|---|---|---|---|---|
| `practice` | practice | `M` or `RW`, NOT NULL | `{"level":"domain","mix":[{domain,count,explanation_key}]}` or, at cold start, `{"level":"section","count","explanation_key"}` | questions, in multiples of `granularity` |
| `review` | review | NULL | `{"mode":"queue"}` or `{"mode":"session","source_engine","source_session_id"}` | due items (1 … `review_block_max`; exam review may take the day) |
| `full_length` | exam | NULL | `{"form_id"}` (null = Doc 04 rotation) | 1 exam |

A day therefore shows up to four kinds of card — Math practice, Reading & Writing practice, Review, Full-length — from three block types. Scope is domain-level, by the eight College Board domain names **in full**, exactly as production stores them: no codes, no aliases, no mapping layer anywhere in the stack. No skills: question choice within a domain is the engine's (Doc 02B §15, INV-08-01).

---

## 7. Schema (DDL) and Database Surface

Three places (migration, prod by owner, genesis). RLS identity is `auth.uid()`, which equals `profiles.id`; admin is `profiles.role = 'admin'` — `current_student_id()` and `is_admin()` do not exist (G-08-08 closed). Views `WITH (security_invoker = true)`.

### 7.1 `student_study_profile`
```sql
CREATE TABLE public.student_study_profile (
  student_id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  timezone              text NOT NULL,                        -- IANA, validated by calendar_is_known_timezone(text)
  target_exam_date      date,                                 -- nullable; route enforces >= local today
  target_score          integer CHECK (target_score BETWEEN 400 AND 1600 AND target_score % 10 = 0),
  study_days_mask       smallint NOT NULL CHECK (study_days_mask BETWEEN 1 AND 127),   -- bit i = Postgres DOW i (0=Sun)
  daily_minutes         integer NOT NULL CHECK (daily_minutes BETWEEN 5 AND 600),       -- real bounds from config at the route
  full_length_weekday   smallint CHECK (full_length_weekday BETWEEN 0 AND 6),           -- nullable = no automatic exams
  planner_mode          text NOT NULL DEFAULT 'auto' CHECK (planner_mode IN ('auto','custom')),
  setup_completed_at    timestamptz,
  last_acknowledged_nonstudent_version_no integer NOT NULL DEFAULT 0 CHECK (last_acknowledged_nonstudent_version_no >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT setup_requires_target_score CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL)
);
```
The only calendar table updated at runtime (profile edits; acknowledgement). Timezone is captured at setup from `Intl.DateTimeFormat().resolvedOptions().timeZone`. **If it cannot be determined or is not a known IANA zone, it falls open to `America/Chicago`** — never a 400, never a blank calendar. `pg_timezone_names` lives in `pg_catalog`, which PostgREST does not expose, so the check is `calendar_is_known_timezone(text)` (§7.13): the answer comes from the database that will consume the value with `AT TIME ZONE`, rather than from a second IANA list in TypeScript. If the browser later reports a different zone the UI offers "Update your study calendar timezone?" — never silent (§17.3).

### 7.2 `calendar_plan_versions` (append-only)
```sql
CREATE TABLE public.calendar_plan_versions (
  plan_version_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version_no            integer NOT NULL CHECK (version_no >= 1),
  generator             text NOT NULL DEFAULT 'deterministic_v1'
                          CHECK (generator IN ('deterministic_v1','fallback_v1')),
  generator_version     text NOT NULL,
  trigger               text NOT NULL CHECK (trigger IN
                          ('setup','profile_change','weekly','student_refresh','post_exam','day_edit','day_regenerate','day_reset','do_it_now','rollback')),
  initiated_by          text NOT NULL CHECK (initiated_by IN ('student','system','admin')),
  input_snapshot        jsonb NOT NULL,
  input_snapshot_hash   text NOT NULL,
  constants_snapshot    jsonb NOT NULL,
  validator_result      text NOT NULL CHECK (validator_result IN ('accepted','rejected')),
  validator_detail      jsonb,                                -- violations, and the fallback reason when fallback_v1 ran
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, version_no),
  UNIQUE (plan_version_id, student_id)                        -- composite FK target (INV-08-22)
);
```
A **rejected** version is still written: it is the audit record of a refused generation, and because `calendar_current_plan` considers accepted versions only, writing it cannot disturb the student's plan. Its dates, blocks and memberships are not written.

### 7.3 `calendar_plan_dates` (append-only) — who owns a date, and whether it is overridden
```sql
CREATE TABLE public.calendar_plan_dates (
  plan_version_id       uuid NOT NULL,
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_date        date NOT NULL,                        -- student-local
  timezone              text NOT NULL,                        -- IANA zone in force when this date was planned; the date's temporal meaning, immutable
  is_user_override      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_version_id, scheduled_date),
  UNIQUE (plan_version_id, scheduled_date, student_id),
  FOREIGN KEY (plan_version_id, student_id) REFERENCES public.calendar_plan_versions(plan_version_id, student_id) ON DELETE CASCADE
);
CREATE INDEX calendar_plan_dates_student_date ON public.calendar_plan_dates (student_id, scheduled_date);
```

### 7.4 `calendar_blocks` (append-only, identity-stable)
```sql
CREATE TABLE public.calendar_blocks (
  block_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_in_version_id uuid NOT NULL,
  scheduled_date        date NOT NULL,
  block_type            text NOT NULL CHECK (block_type IN ('practice','review','full_length')),
  section               text CHECK (section IN ('M','RW')),   -- NOT NULL for practice, NULL otherwise
  scope                 jsonb NOT NULL,                       -- per-type shape, guarded by calendar_scope_is_valid
  target_count          integer NOT NULL CHECK (target_count >= 1),
  source                text NOT NULL CHECK (source IN ('auto','student','post_exam')),
  derived_from_block_id uuid,
  explanation_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, student_id),
  UNIQUE (block_id, student_id, scheduled_date),
  FOREIGN KEY (derived_from_block_id, student_id) REFERENCES public.calendar_blocks(block_id, student_id),
  FOREIGN KEY (created_in_version_id, student_id) REFERENCES public.calendar_plan_versions(plan_version_id, student_id),
  CONSTRAINT calendar_blocks_section_by_type CHECK (
    (block_type = 'practice' AND section IS NOT NULL) OR
    (block_type IN ('review','full_length') AND section IS NULL)),
  CONSTRAINT calendar_blocks_full_length_single CHECK (block_type <> 'full_length' OR target_count = 1),
  CONSTRAINT calendar_blocks_scope_shape CHECK (public.calendar_scope_is_valid(block_type, section, scope))
);
```
`scope` replaces the former `domain`, `skill_codes` and `form_id` columns. Shapes, enforced by `calendar_scope_is_valid(block_type, section, scope)` — shape only, never a config-derived magnitude, which belongs to the validator:

- **practice, weighted:** `{"level":"domain","mix":[{"domain","count","explanation_key"}, …]}` — each entry exactly those three keys, `domain` one of the eight full names valid for the block's `section`, `count` a positive integer, no domain twice.
- **practice, cold start / fallback:** `{"level":"section","count","explanation_key"}` — the generators emit this when mastery is unknown, so a parser that cannot represent it fails on every new student.
- **review:** `{"mode":"queue"}`, or `{"mode":"session","source_engine":"practice"|"full_length","source_session_id"}` for reviewing one past session.
- **full_length:** `{"form_id"}`, the value nullable (Doc 04 rotation).

The per-domain `explanation_key` lives on the mix entry because the block's own key describes the block (§17.6). No ordinal, no override flag, no status: order is membership, override is the plan date, status is derived.

### 7.5 `calendar_plan_block_memberships` (append-only)
```sql
CREATE TABLE public.calendar_plan_block_memberships (
  plan_version_id       uuid NOT NULL,
  student_id            uuid NOT NULL,
  scheduled_date        date NOT NULL,
  block_id              uuid NOT NULL,
  display_ordinal       smallint NOT NULL CHECK (display_ordinal >= 1),
  membership_type       text NOT NULL CHECK (membership_type IN ('created','carried')),
  PRIMARY KEY (plan_version_id, scheduled_date, block_id),
  UNIQUE (plan_version_id, scheduled_date, display_ordinal),
  FOREIGN KEY (plan_version_id, scheduled_date, student_id) REFERENCES public.calendar_plan_dates(plan_version_id, scheduled_date, student_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id, student_id, scheduled_date) REFERENCES public.calendar_blocks(block_id, student_id, scheduled_date)
);
```
The composite FK to `calendar_blocks(block_id, student_id, scheduled_date)` makes "a block never moves dates" and "same student" relational facts, not RPC promises (INV-08-22). Moving a block between days is therefore a *new* block on the target date carrying `derived_from_block_id` (§12.8), never a row that changes date.

### 7.6 `calendar_current_plan` (view)
```sql
CREATE VIEW public.calendar_current_plan WITH (security_invoker = true) AS
WITH owner AS (
  SELECT d.student_id, d.scheduled_date, MAX(v.version_no) AS version_no
  FROM public.calendar_plan_dates d
  JOIN public.calendar_plan_versions v ON v.plan_version_id = d.plan_version_id
  WHERE v.validator_result = 'accepted'
  GROUP BY d.student_id, d.scheduled_date
)
SELECT d.student_id, d.scheduled_date, d.timezone, d.is_user_override, v.version_no, v.plan_version_id,
       m.block_id, m.display_ordinal, m.membership_type
FROM owner o
JOIN public.calendar_plan_versions v ON v.student_id = o.student_id AND v.version_no = o.version_no
JOIN public.calendar_plan_dates d ON d.plan_version_id = v.plan_version_id AND d.scheduled_date = o.scheduled_date
LEFT JOIN public.calendar_plan_block_memberships m ON m.plan_version_id = d.plan_version_id AND m.scheduled_date = d.scheduled_date;
```
Ownership is resolved per date, so a plan may legitimately span versions. A cleared or blocked-out day appears with `block_id NULL` and its override flag intact.

### 7.7 `calendar_block_launches` (append-only)
```sql
CREATE TABLE public.calendar_block_launches (
  block_id              uuid NOT NULL,
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  launch_sequence       smallint NOT NULL CHECK (launch_sequence >= 1),
  engine                text NOT NULL CHECK (engine IN ('practice','review','full_length')),
  engine_session_id     uuid NOT NULL,
  launched_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, launch_sequence),
  UNIQUE (engine, engine_session_id),
  FOREIGN KEY (block_id, student_id) REFERENCES public.calendar_blocks(block_id, student_id)
);
```
A block may be launched more than once over its life (12/20 then abandoned → `Continue` starts a second session); at most one **live** session at a time (INV-08-18, §15.1). `calendar_link_launch` takes `FOR UPDATE` on the block row before reading `max(launch_sequence)`: without it, two launches of the same block with different session ids both read the same maximum and collide on the primary key, which is a 500 on a student pressing Start twice. Used for Resume/Continue and `calendar_launch_rate` only. Never for progress.

### 7.8 `calendar_mutation_ledger` (interim idempotency, INV-08-09)
```sql
CREATE TABLE public.calendar_mutation_ledger (
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key       uuid NOT NULL,
  route                 text NOT NULL,
  response_hash         text NOT NULL,
  response              jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, idempotency_key)
);
```
A replayed key returns the stored response and writes nothing. **Order matters:** every writer takes `FOR UPDATE` on the study profile *before* reading the ledger. Read first, and concurrent callers sharing a key all miss the ledger, serialize on the lock, and then collide on the ledger's primary key — the replay returns a constraint error instead of the stored response. Retired when Doc 01A Part IV `IdempotencyService` ships (G-08-04); the client contract does not change.

### 7.9 `calendar_runtime_config` and `calendar_runtime_config_history`
Shape identical to `practice_runtime_config` (Doc 01A Part I doctrine), with a **per-table** history table and the same `notify_config_change` and `prevent_update_delete` triggers every other `*_runtime_config` pair uses. History is per table, not shared — production carries one `_history` table per config table. Keys and launch values in §21. Read only through the runtime-config accessor, which raises on a missing or malformed key rather than defaulting.

### 7.10 `calendar_job_runs` (observability only)
```sql
CREATE TABLE public.calendar_job_runs (
  run_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job                   text NOT NULL CHECK (job IN ('weekly_regen')),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_key            date NOT NULL,                        -- local ISO-week Monday
  outcome               text NOT NULL CHECK (outcome IN ('ok','skipped_fresh','skipped_custom','skipped_no_entitlement','failed')),
  detail                jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
```
No uniqueness on `(student, period)`: reruns are safe and recorded. Weekly idempotency is a property of plan versions (§12.5), not of this table.

### 7.11 Immutability (INV-08-05)
`REVOKE UPDATE, DELETE` on the five plan/launch tables from `authenticated` and `anon`; RLS with no UPDATE/DELETE policy; the write RPCs INSERT only, except `student_study_profile`, which is the one table with an UPDATE grant. No trigger, no GUC: account deletion cascades through FKs untouched, because a referential action runs with the FK's privileges rather than the deleting role's.

### 7.12 Access boundary and RLS
**Client access.** Calendar reads and mutations are available only through authenticated server API routes (§15). `authenticated` and `anon` have no INSERT/UPDATE/DELETE grants on any calendar table and **no EXECUTE grant** on any calendar write RPC; those are callable only by the trusted server role after the route's auth, role and entitlement checks. The one exception is `calendar_viewer_is_admin()`, which the RLS policies themselves call.
**RLS** is defense in depth, not the authorization boundary: student SELECT policies on `auth.uid() = student_id` for the profile, versions, dates, blocks, memberships and launches; `calendar_plan_versions` is additionally granted column by column, so `input_snapshot` and `constants_snapshot` are withheld from `authenticated` even on a direct base-table query; explicit admin SELECT policies via `profiles.role = 'admin'`; **no policies of any kind for guardians** (§16); `calendar_mutation_ledger`, `calendar_job_runs` and the config tables have RLS enabled with no client policies at all — denial by absence.

### 7.13 Database surface — the functions the calendar owns

| Function | Kind | Role |
|---|---|---|
| `calendar_scope_is_valid(block_type, section, scope)` | pure, `IMMUTABLE` | §7.4 shape guard; total by construction (no cast that can raise) |
| `calendar_require_int(obj, key)` | pure | Strict snapshot accessor; raises `22023` rather than defaulting |
| `calendar_is_known_timezone(text)` | `STABLE` | IANA check against `pg_timezone_names`, unreachable through PostgREST |
| `calendar_viewer_is_admin()` | `STABLE`, `SECURITY DEFINER` | Admin predicate for the RLS policies |
| `calendar_build_plan_input(student_id, dates[])` | `STABLE`, `SECURITY DEFINER` | Freezes the snapshot (§10.1); records `degraded[]`; the only calendar function that reads canonical tables |
| `calendar_place_full_lengths(input)` | pure, `IMMUTABLE` | Exam placement, shared by both generators so the precedence rules have one implementation |
| `calendar_compute_plan(input)` | **pure, `IMMUTABLE`, integer-only** | `deterministic_v1` (Formula Sheet §2) |
| `calendar_compute_plan_fallback(input)` | pure, `IMMUTABLE` | `fallback_v1` (Formula Sheet §5A) |
| `calendar_plan_to_output(plan, generator_version, enabled_block_types)` | pure | Generator days → §10.2 `PlanOutput`, filtered to enabled engines |
| `calendar_carry_started(input, output)` | pure | Prepends the date's started blocks as carried members (§12.2) |
| `calendar_drop_today_for_system(output, trigger, today)` | pure | R-08-32: removes today from a `weekly` or `post_exam` output |
| `calendar_drop_unowned_dates(output, owned_dates)` | pure | Removes dates the trigger does not own — see §12.3 |
| `calendar_regenerate_day_only(output, date)` | pure | Narrows a whole-horizon plan to one date (§12.9) |
| `calendar_validate_plan(mode, input, output)` | pure | §10.3; returns a rejection as **data**, never a raise |
| `calendar_write_version(...)` | writer | The single writer: validate, allocate `version_no` under the caller's lock, INSERT append-only |
| `calendar_persist_version(...)` | writer, `SECURITY DEFINER` | Horizon regeneration (§12.3) |
| `calendar_edit_day(...)` | writer | Day edit and block-out (§12.4) |
| `calendar_regenerate_day(...)` | writer | `day_regenerate` / `day_reset` (§12.9) |
| `calendar_do_it_now(...)` | writer | §12.6 |
| `calendar_move_block(...)` | writer | §12.8 |
| `calendar_acknowledge_version(...)` | writer | §12.7, monotonic and clamped |
| `calendar_link_launch(...)` | writer | §7.7; `FOR UPDATE` on the block row |
| `calendar_weekly_candidates(limit)` | `STABLE` | §12.5 predicate, returning the outcome |

**Every generator function is integer-only.** Ratios are basis points; there is no float anywhere in the formula path, so PL/pgSQL truncation and the oracle's floor division agree on every operand the formula uses.

---

## 8. Student Inputs and Derivations

### 8.1 Setup
| Field | Type | Bounds | Stored |
|---|---|---|---|
| Timezone | auto-captured, editable | `calendar_is_known_timezone`; falls open to `America/Chicago` | `timezone` |
| Target exam date | date or "not yet" | ≥ local today … +`target_exam_date_max_days` | `target_exam_date` |
| Target score | integer step 10, required | 400–1600 | `target_score` |
| Study days | weekday chips, ≥1 | — | `study_days_mask` |
| Time per day | chips from `daily_minutes_presets` | `daily_minutes_min … max` | `daily_minutes` |
| Full-length test day | weekday chip or "I'll add them myself" | independent of study days (R-08-27) | `full_length_weekday` |

Every bound and preset above is a `calendar_runtime_config` row served to the client in the setup payload (§15), so the sheet's chips and the server's own validation cannot disagree; none is a client literal (INV-08-14).

### 8.2 Local dates
`today` is in `profile.timezone`. Every planned date carries the timezone in force when it was planned (`calendar_plan_dates.timezone`); the allocator converts engine timestamps with **that date's own timezone**, never today's profile value, so a later timezone change cannot move historical activity between days. Changing the profile timezone regenerates future unlocked dates (which take the new zone); history is untouched. A day's window is computed from the next local day's start, not from "plus 24 hours", so a 23-hour spring-forward day and a 25-hour fall-back day are both counted correctly.

### 8.3 Minutes are the planning currency
The generator budgets **minutes** (R-08-03). Each engine's seconds-per-unit is snapshotted into `engine_planning` and converted to units by the formula; blocks store units. Nothing stores minutes. The UI renders "~30 min" from the `estimates` object the read returns (§15), not from a client constant.

---

## 9. Engine Adapters — Planning, Launch, Progress

### 9.1 Adapter contract (INV-08-02, R-08-15)
```ts
type CalendarEngineAdapter = {
  engine: "practice" | "review" | "full_length";
  create(block, size: number, ctx: { client_instance_id; idempotency_key }): Promise<Result<{ session_id: string; next: string }>>;
                                          // size = THIS launch's size, not the block target; a refusal is data, never a throw
  resumeHref(session_id: string): string; // where a LIVE session of this engine is resumed — the launch service builds no path itself
  activityUnits(student_id, localDate, tz): Promise<ActivityUnit[]>;
  nextLaunchSize(block, remaining: number): number;   // a size this engine's create accepts for the remaining work
  progress(session_id): Promise<{ lifecycle: "active"|"completed"|"abandoned"; presentation?: { label: string; ratio?: number } } | null>;
};

type ActivityUnit = { engine: "practice"|"review"|"full_length"; unit_id: string;   // identity = (engine, unit_id)
                      occurred_at: string; local_date: string;
                      section?: "M"|"RW"; domain?: string; form_id?: string };
```

Five methods, and deliberately not more. `matches` and `scopeOf` are **not** adapter methods: `unitMatchesBlock` in `packages/shared` already answers "did this item count" for the §13 allocator, and an adapter carrying its own copy would be a second answer to one question. `allowedPlanSizes` and `estimateSeconds` are not adapter methods either: the generator budgets from the snapshot's `engine_planning`, in PL/pgSQL, and the formula lives there only. `editorFields` is a UI concern and lives in the UI.

`resumeHref` exists because the launch service previously built the resume path itself and built practice's path for every engine — so the first launch of a review block worked (that one goes through `create`) and every launch after it sent the student to the wrong page. Correcting the string alone would have left the next engine free to repeat it; with `resumeHref` on the contract a new engine supplies its route or it does not compile.

**`ActivityUnit` has no `skills` field.** No block scope can reference a skill, so the field would be dead weight; the shared schema is `.strict()` and rejects it.

**The activity rule, for every engine (INV-08-23):** a unit exists iff the item's `status = 'answered'`, and it is dated by the item's `occurred_at`. Never `answered_at IS NOT NULL` — a *skipped* item also carries a non-null `answered_at`, and a skip is not retrieval. Never `answered_at` as the timestamp either: both item tables CHECK `occurred_at` non-null on every resolved row (`psi_resolved_requires_occurred_at`, `rsi_resolved_requires_occurred_at`) while `answered_at` is plain nullable. The two agree on every resolved row today because the writers set them from one `now` — a property of today's writers, not of the schema. A resolved row that ever landed without `answered_at` would drop out of the window in silence and be reported as "the student did nothing today".

A contract test per engine plants each method, runs PG-backed against the real engine, and sits behind a vitest summary gate that treats a skipped test as red. `enabled_block_types` may not name an engine without one passing against the real engine — not a stub, not a mock.

### 9.2 Practice adapter
- `create(block, size)` → `startOrReplaySession({ userId, actorId, role, section, mode: 'structured', clientInstanceId, idempotencyKey, targetQuestionCount: size, sessionSpec })` — called **directly**, never over HTTP: the session cap, the replay and the client-instance binding live in that function, and a second create path would be a second contract. `sessionSpec` carries `sections: [block.section]` and `domains` = the block's mix domains by their full names. `ctx.idempotency_key` is forwarded **unchanged**; adapters never construct the key (§15.1).
- `resumeHref(id)` → practice's own session route.
- `activityUnits(date)` → one unit per `practice_session_items` row with `status = 'answered'` whose `occurred_at` falls in the date's local window, carrying `question_section` and `question_domain`.
- `nextLaunchSize(block, remaining)` → `remaining`, capped by practice's own maximum.
- `progress(session_id)` → the session's lifecycle from its own columns.

### 9.3 Review adapter
- `create(block, size)` → `startOrReplayReviewSession({ studentId, actorId, poolSpec, clientInstanceId, idempotencyKey, targetCount: size })`, called directly for the same reason. `poolSpec` is `{ mode: "queue" }` — a bare discriminant: a calendar review block means "the work you owe", which is the student's open queue, the same queue the generator sized the block against. `filter` mode would be the calendar inventing a selection the plan never made; `session` mode belongs to "review this test" (§9.4). **No `source_origin`** — the signature takes none, and the calendar records its own launches; the engine does not need to carry the calendar's provenance for the calendar to know what it launched. **No `platform`** — the signature takes none either, and review sets it on the row itself, so one passed from the calendar would be silently dropped.
- `resumeHref(id)` → review's own session route.
- `activityUnits(date)` → one unit per `review_session_items` row with `status = 'answered'` in the date's local window by `occurred_at`; `unit_id` = the item's id; `section` and `domain` from `question_section` and `question_domain`; ownership through `student_id`.
- `nextLaunchSize(block, remaining)` → `remaining`.
- `progress(session_id)` → `review_sessions.status`: `created` or `active` → active; `completed` → completed; `abandoned` → abandoned.

### 9.4 Full-length adapter (FORWARD_REF, G-08-02)
Ships as a **fail-open stub**: `create` returns `{ ok: false, reason: 'engine_unavailable' }` as data — never a throw, never a 500 — `activityUnits` returns `[]`, and `progress` returns `null`, so a full-length block reads `0/target` and its control says "Coming soon" without ever calling launch. `full_length` is absent from `enabled_block_types`, and while it is absent `calendar_build_plan_input` nulls `full_length_weekday` and the exam facts, so no exam and no exam-review placeholder consume a day's budget (§10.1).

What the real engine must supply when Doc 04 lands, unchanged from the contract above: `create` by `form_id` or Doc 04 rotation with the key forwarded; `resumeHref`; `activityUnits` → one unit per exam Doc 04 reports complete on that local date under Doc 04's own activity-date rule, carrying `form_id`; `nextLaunchSize` → 1; `progress` → Doc 04's own presentation, which the calendar renders and never computes. The exam-review seam is `{"mode":"session","source_engine":"full_length","source_session_id"}` on a review block, plus a per-exam missed count and weak-domain list for sizing and emphasis.

---

## 10. Generator Contract and Validator

### 10.1 Input snapshot (canonical, hashed)
```ts
type PlanInput = {
  student_id: string;
  today: string;
  generated_for: { dates: string[] };
  profile: { timezone; target_exam_date; target_score; study_days_mask; daily_minutes; full_length_weekday; planner_mode; setup_date };
  mastery: Array<{ section; domain; mastery_level: 0|1|2|3|4|null }>;          // 8 rows, full domain names
  review_due_by_date: Array<{ date: string; due_count: number }>;              // review_schedule.queued_at ⋈ servable_questions, local dates
  exams: { last_completed_local_date; days_since_exam; missed_count; reviewed; weak_domains[] };
  recent_planned_by_domain: Array<{ domain: string; count: number }>;          // last recent_planned_window_days of plan rows
  started_blocks_by_date; existing_blocks_by_date; current_overrides;          // §12.2 protected state, and V-12/V-13/V-14 inputs
  enabled_block_types: string[];
  engine_planning: { practice_seconds_per_unit: number; review_seconds_per_unit: number };
  constants: Record<string, unknown>;                                          // calendar_runtime_config snapshot
  degraded: string[];                                                          // non-essential inputs that could not be read
};
```
The **builder** reads canonical owners immediately before generation and freezes them here; the **generators** read only `PlanInput` (INV-08-06). Replaying a stored snapshot months later reproduces the plan even if practice has since changed `target_seconds_per_question`.

Three rules the builder follows:
- **Essential inputs are never invented.** A missing study profile or missing constants raises; nothing is generated and the prior plan stands. There are no `COALESCE` defaults on the essential path.
- **The snapshot tells the truth about enabled engines.** When `full_length` is not in `enabled_block_types` the builder nulls `full_length_weekday` and the exam facts; when `review` is not, it passes an empty review queue. Otherwise the formula budgets for blocks the output filter then removes, and the student loses study time to work they cannot see.
- **A student with no mastery rows is cold start, not degraded.** All eight unknown is a state the formula has a branch for; calling it degraded would push every new student onto the fallback generator for being new.

### 10.2 Output shape
```ts
type PlanOutput = {
  generator: "deterministic_v1" | "fallback_v1";
  generator_version: string;
  dates: Array<{ scheduled_date: string; is_user_override: boolean;
                 members: Array<{ kind: "created"; block: NewBlock } | { kind: "carried"; block_id: string }> }>;  // display order = array order
};
```

### 10.3 Validator — invoked with a mode
`calendar_validate_plan(mode, input, output)`, with `mode ∈ { generated, student_edit, do_it_now, rollback, day_regenerate }`. It returns a rejection as **data** — `{result, violations[]}` — and never raises on a bad plan, because the writer has to record the rejection and fall back; it raises only when the snapshot itself is unusable.

| Rule | Mode | Assertion |
|---|---|---|
| V-01 | all | Every date ∈ `generated_for.dates`; none < local today. |
| V-02 | generated, day_regenerate | Practice/review created blocks on study days; `full_length` only on `full_length_weekday`. |
| V-03 | all | `block_type` ∈ `enabled_block_types`. |
| V-04 | all | At most **one practice block per section per day**; practice counts are multiples of `granularity`, each domain ≥ `min_domain_questions`, ≤ `max_domains_per_block` domains, all within the block's section, and the mix sums to `target_count`; review `1 ≤ target_count` and ordinary review ≤ `review_block_max`; full_length `target_count = 1`. |
| V-05 | generated, day_regenerate | Per date, Σ `target × seconds_per_unit` over **created** practice+review ≤ `daily_minutes × 60`; an exam date carries no other created blocks. Not applied to `student_edit` (R-08-19). |
| V-06 | all | Every domain is canonical and valid for the block's section. |
| V-07 | — | **Retired.** It checked `skill_codes` against the registry; skills were removed from the block model, so there is nothing left for it to check. Listed so a reader does not think it was forgotten. |
| V-08 | all | Display order is the member array order, so contiguity is automatic within a date; V-08 catches a date appearing twice in `dates` (whose ordinals would collide) and a carried block appearing on two different dates. |
| V-09 | generated, day_regenerate | Every block `explanation_key` is in the §17.6 block set, and every mix entry's key is in the domain set. |
| V-10 | every mode creating a review block | Ordinary review ≤ canonical availability through that date, net of review already planned. Exam review is sized by the exam, not the queue, so the queue cap does not apply to it. `do_it_now` clamps a copied review target to today's availability rather than copying the missed block's size. |
| V-11 | all | `full_length` created over the horizon ≤ `max_full_length_per_horizon`. |
| V-12 | all incl. rollback | Every id in `started_blocks_by_date[date]` appears as a `carried` member of that date. |
| V-13 | all | Every carried id is an existing block of this student on the same `scheduled_date`. |
| V-14 | generated, do_it_now | Non-student modes never own a date whose current plan-date row has `is_user_override = true`. `do_it_now` carries the date's current override flag unchanged. |

**Mode `day_regenerate` is `generated` minus V-14, and nothing else.** V-14 guards a non-student version stomping a student edit; clearing that override *is* the operation of the two day-regenerate routes, and they are student-initiated (§12.1), so the rule is not aimed at them. V-02, V-05 and V-09 all still fire.

A rejection under `generated` triggers the fallback ladder (§12.3); if the fallback is rejected too, the rejected version is recorded, owns no date, and the prior plan stands.

---

## 11. Generation Formula — reference to the Formula Sheet

**The generation formula is defined in `docs/Spec/Doc_05F_formula_sheet.md`; that file is canonical.** This document does not restate its steps, its constants, or its numbers — a line here that did would be the defect §20 names.

What this document keeps is the contract around it: the snapshot the formula reads (§10.1), the output it must produce (§10.2), the validator it must satisfy (§10.3), the two generators and when each runs (§12.3), and the parity gate that holds all of it in place (INV-08-06).

Two generators ship:

- **`deterministic_v1`** — the primary. Budget, exam placement, need weights over the live mastery levels, review, a two-level deficit allocation into one Math and one Reading & Writing practice block, explanation keys.
- **`fallback_v1`** — the fail-open backup. The same steps with every mastery-dependent part removed, so it needs only the profile plus, where readable, the last exam's facts and a total review count. Same output shape, same validator, same immutability. Every practice block it produces carries the `fallback` explanation key, so the UI and the audit trail say why the day looks the way it does.

Both are pure PL/pgSQL functions, integer-only, reading nothing but the snapshot. The TypeScript server never contains the formula; it calls the RPC.

---

## 12. Regeneration Lifecycle, Overrides, Block-Level Freeze

### 12.1 Triggers
| Trigger | `initiated_by` | Dates owned | Mode |
|---|---|---|---|
| `setup` | student, on first entitled calendar open after setup completes | horizon, including overridden dates | any |
| `profile_change` | student | today … horizon end, non-overridden | auto (custom: offered) |
| `weekly` | system | **tomorrow** … horizon end, non-overridden (R-08-32) | auto only |
| `student_refresh` | student | today … horizon end, non-overridden | any |
| `post_exam` | system | **tomorrow** … horizon end, non-overridden (R-08-32) | auto only |
| `day_edit` | student | that date (sets `is_user_override`) | any |
| `day_regenerate` / `day_reset` | student | that date (clears override) | any |
| `do_it_now` | student | today (override flag carried unchanged) | any |
| `rollback` | admin | any future dates; **must carry started blocks** (V-12) | admin |

`calendar_persist_version` takes the trigger as a parameter and serves every horizon-scoped trigger; only the date ownership above differs.

### 12.2 Protected state
Past dates: never owned, never edited (409). **Started blocks**: carried unchanged onto any later version of their date, and carried blocks take the leading ordinals, because for a regeneration there is no client-supplied order and "already started comes first" matches how the day is used. Overridden and blocked-out dates: never owned by a non-student version.

### 12.3 Horizon regeneration and the fail-open ladder (INV-08-17)
`calendar_persist_version(student, trigger, initiated_by, generator_version, idempotency_key)`, one transaction:

`FOR UPDATE` on the study profile → ledger read → build snapshot → compute → carry started → narrow → validate → INSERT.

The ladder, in order:
1. **Essential input missing** (no profile, no constants) → the builder raises, nothing is generated, and the prior plan stands. This is not caught: a silent no-op would hide it.
2. **Mastery or the review queue degraded, or the primary raises, or the primary's plan is rejected** → `calendar_compute_plan_fallback` runs on the **same snapshot in the same transaction**, and the version records `generator = 'fallback_v1'` with the reason in `validator_detail`.
3. **The fallback is rejected too** → the rejected version is recorded, owns no date, and the prior version keeps the student's plan.

**Narrowing is done on the output, never on the date series.** The generators derive their dates from the snapshot's `today` and never read `generated_for.dates`, so starting the series later narrows only what V-01 will *accept*, not what the generator *emits* — the primary is rejected for containing a date the series omits, the fallback is rejected for the same reason, and the version owns nothing. `calendar_drop_unowned_dates` and `calendar_drop_today_for_system` therefore remove dates from the computed output after `calendar_carry_started` has run. V-01 is a membership test and nothing requires every `generated_for` date to appear, so a narrowed output validates cleanly.

This is why a student who edited one day used to freeze their whole plan: every later horizon regeneration contained that overridden date, V-14 rejected it, and nothing was written. Both narrowing steps are gated, and the gates assert the version is **accepted and `deterministic_v1` and owns a non-empty date set** before asserting what it does not own — because "weekly does not own today" passes just as well when the version was rejected and owns nothing at all.

### 12.4 Day edit and blocked-out days
Client sends the full desired member list for the date (created specs + carried ids); the server injects started blocks if omitted, validates in `student_edit` mode, and persists with `is_user_override = true`. No budget check, no warning (R-08-19).

**An empty member list is a cleared day, not a no-op** — and that is how a student blocks out a date (R-08-31): the day is stored as their override with zero blocks, the weekly job and every settings change leave it alone, and a started session on that day is carried and survives. Blocking out a date beyond the horizon works the same way; when the date later enters the horizon it is still theirs. **Undo** is `day_reset` (§12.9). No reason field, and no catch-up: the work is not moved anywhere.

### 12.5 Weekly job
A daily cron whose predicate is weekly. §12.5's three conditions and its per-student Monday-anchored truncation are all queries, so they ship as one SQL function, `calendar_weekly_candidates(limit)`, returning `(student_id, period_key, outcome)` where a null outcome means generate — the outcome rather than only the due students, because `calendar_job_runs.outcome` already enumerates three skips and a function that filtered them away would make three of its five values unreachable.

For each `auto` student with active `calendar_access`: generate iff **no accepted horizon-refresh version** — `trigger ∈ {setup, profile_change, weekly, student_refresh, post_exam}` — was created in the student's current local ISO week. Day-scoped versions never suppress the weekly run. Setup on Wednesday means the first weekly run is the following Monday. The cron fires daily because a cron fires in one timezone and students are in all of them; "once per local week" is the predicate's job, never the schedule's.

Per-student transaction; a failure records `outcome = 'failed'` with its reason and logs at ERROR. **§12.5's Doc 06C dead-letter does not exist yet** — no table, no queue, no enqueue helper anywhere in the repository. The `failed` branch is where the enqueue goes when 06C ships, and it is marked as such in the job rather than left to be rediscovered. Inventing a dead-letter here would be the wrong shape when the real one arrives (G-08-05).

### 12.6 "Do it now"
Missed block → `calendar_do_it_now(block_id)`: one version owning today, carrying today's members and override flag unchanged, appending one created block with the same scope, `source='student'`, `derived_from_block_id` pointing at the missed block. A review block's `target_count` is clamped to today's canonical availability (V-10) rather than copied: the queue has moved on since the block was missed.

### 12.7 Acknowledgement (INV-08-13)
`latest_unacknowledged_nonstudent_change` = the highest version with `initiated_by <> 'student'`, `validator_result = 'accepted'`, and `version_no > last_acknowledged_nonstudent_version_no`.

`calendar_acknowledge_version(student, version_no)` raises the watermark to `GREATEST(current, LEAST(requested, highest accepted))`. The route carries no idempotency key, which is only sound if the write is monotonic — and the clamp is the part that matters: without it a client could acknowledge version 10⁹ and permanently suppress the §17.4 banner, including for a support rollback it has never been shown.

### 12.8 Moving a block between days
`calendar_move_block(student, block_id, to_date, generator_version, idempotency_key)`: one version owning **both** dates — the source date's current members minus the block, and the target date's members plus one **created** block copying the source's type, section, scope and target, with `derived_from_block_id` pointing at the source. Both dates become `is_user_override = true`. A block never changes date (INV-08-22, §7.5), so a move is a new block with recorded lineage, not a row that moves.

Refused as data, never as a raise: a **started** block does not move (R-08-18), neither date may be in the past, and source may not equal target.

### 12.9 Day regenerate and reset
`calendar_regenerate_day(student, date, trigger, generator_version, idempotency_key)` serves both `day_regenerate` and `day_reset`; the only difference is the trigger recorded on the version. It writes `is_user_override = false`, which is what makes it the **Undo** for a blocked-out day.

It plans the **whole horizon** and narrows the output to the requested date through `calendar_regenerate_day_only`, because the generators cannot plan a single day — handing them a one-date series produces a fourteen-day plan that V-01 rejects thirteen times over. This is also the better answer on the merits: what belongs on a Tuesday depends on where the exams sit and what the other days took, so the day is cut from a coherent horizon rather than guessed in isolation.

For a date **beyond** the horizon — a concert blocked out three weeks ahead — it writes a version owning that date with no blocks and no override, so the date returns to automatic planning and is planned normally once it enters the horizon.

---

## 13. Progress Model — The Allocator (R-08-24, R-08-29)

One pure function in `packages/shared/src/calendar/allocate.ts`, run at read time:

```
units  = ∪ adapter.activityUnits(student, D, tz = calendar_plan_dates.timezone of the owning version for D) over enabled engines,
         identity (engine, unit_id); sorted by (occurred_at, engine, unit_id)   -- immutable engine facts
blocks = current members of D in display order
for b in blocks:
    need = b.target_count
    for u in units (unconsumed, u.engine = engineOf(b), unitMatchesBlock(u, b)):
        consume u → b; need −= 1; stop when need = 0
actual(b) = units consumed by b
extra(D)  = unconsumed units, grouped by (engine, section, domain)
```

`unitMatchesBlock` compares **engine first**, then the engine's scope: a practice unit matches a practice block whose `section` equals the unit's and whose mix contains the unit's domain (or whose scope is section-level); a review unit matches on engine alone; a full-length unit matches when the block's `form_id` is null or equal.

```
progress(b) = actual(b) / target(b)
status(b)   = completed   if actual = target
            | partial     if 0 < actual < target
            | in_progress if a launch exists whose adapter.progress().lifecycle = 'active' and actual = 0
            | missed      if D < today and actual = 0
            | scheduled   otherwise
```

Properties: inputs are immutable plan rows and finalized engine outcome columns (INV-08-08); each unit is consumed once (INV-08-21), so overlapping scopes cannot inflate progress. A block of `{Algebra 20}` followed by a block of `{Algebra 10, Geometry and Trigonometry 10}` against 20 Algebra units yields 20/20 and 0/10, and the reverse order yields 10/10 and 10/20. Two 10s satisfy a 20; a 20 satisfies two 10s; 30 against 20 = 20/20 plus 10 extra; a midnight-spanning session splits by item `occurred_at`; review needs no lifecycle to count; a full-length counts 1 on the date Doc 04 assigns it. Display order is the only tiebreak and it is stored, so the result is a deterministic function of stored facts.

---

## 14. Derived State — Day, Extra Work, Streak, Facts

| Derived | Rule |
|---|---|
| `day.blocks[]` | current members in display order with `target`, `actual`, `progress`, `status`, and the adapter's presentation where it has one. |
| `day.extra_work[]` | `{engine, section?, domain?, count}` per §13. |
| `day.status` | First match, in this order: `rest` (not a study day and no blocks) · `complete` (has blocks, all completed) · `partial` (has blocks, any progress) · `missed` (past, has blocks, no progress) · `today` (today, no progress yet) · `upcoming`. A **past day with partial progress is `partial`, never `missed`** — a student who did 12 of 20 did not miss the day. A rest day with activity stays `rest` and shows its extra work: studying on an off day does not turn it into a planned one. A **blocked-out** day is an overridden day with no blocks and renders as "Day off" (§17). |
| **Facts** (R-08-28, no percentage) | per range: blocks completed / partial / missed; questions completed; full-length tests completed; extra questions. Same facts for guardian. |
| `streak` | **Doc 05B owns it.** `GET /api/me/streak` reads `student_overall_kpi.current_streak_days` and `longest_streak_days` and serves them with **no `calendar_access` check** (INV-08-20). The calendar computes no streak and stores none: a derived streak beside a stored one would disagree the day they diverge. Doc 05B's definition is activity-based over UTC days with no rest-day skip; SCL-08-E asks 05B for a student-local day boundary and the skip, and until it lands the route returns 05B's value with `history_complete: false`. Rendered in the calendar header and on the practice page. |
| `calendar_launch_rate` (Doc 07 only) | blocks with a launch row ÷ blocks. Never on a student or guardian surface. |

Rings (post-launch, R-08-28): each ring is a daily target vs the same counter — questions vs `Σ target`, minutes vs `daily_minutes` via the snapshotted seconds-per-unit, review vs due. No schema change needed.

---

## 15. API Surface

Calendar handlers: auth → role → `canAccessFeature('calendar_access')` → Zod → domain → serialize. Streak handler: auth → student role → service → serialize, **no entitlement check**. All workflow lives in `server/services/calendar/*`; handlers delegate and never own logic; the database never calls an engine.

| Method + path | Role | Body / query | Returns | Idempotency |
|---|---|---|---|---|
| GET `/api/calendar` | student | `?from&to&device_timezone` | **A discriminated union on `status`** — see below | — |
| PUT `/api/calendar/profile` | student | fields + key | `{ profile, version_no? }` | key |
| POST `/api/calendar/plan/regenerate` | student | key | `{ version_no }` | key + `calendar_plan_regenerate` bucket |
| POST `/api/calendar/days/:date/regenerate` · `/reset` | student | key | `{ version_no }` | key + `calendar_day_regenerate` bucket |
| PUT `/api/calendar/days/:date` | student | `{ members[], idempotency_key }` | `{ version_no, day }` | key |
| POST `/api/calendar/blocks/:id/move` | student | `{ to_date, idempotency_key }` | `{ version_no }` | key + `calendar_day_regenerate` bucket |
| POST `/api/calendar/blocks/:id/launch` | student | `{ client_instance_id }` | `{ engine, session_id, next, resumed }` | engine key (§15.1) |
| POST `/api/calendar/blocks/:id/do-it-now` | student | key | `{ version_no, block }` | key |
| POST `/api/calendar/acknowledge` | student | `{ version_no }` | `{ ok }` | monotonic + clamped (§12.7) |
| GET `/api/me/streak` | student (any tier) | — | `{ current, longest, history_complete }` — **no `calendar_access` check** (INV-08-20) | — |
| GET `/api/students/:studentId/calendar` | guardian | `?from&to` | the guardian projection — see §16 | — |

**`GET /api/calendar` is a 200 in both states.** A student who has not set up has an empty calendar, not a missing one; a 404 would make every fetch hook treat the most common first visit as an error and log it as one.

```ts
{ status: "setup_required", defaults: { timezone, daily_minutes_presets, daily_minutes_min, daily_minutes_max, target_exam_date_max_days } }
{ status: "ready", profile, days[], facts, estimates, streak,
  latest_unacknowledged_nonstudent_change, diagnostic_state, projection?, device_timezone_mismatch? }
```
`defaults.timezone` is the `device_timezone` query parameter when `calendar_is_known_timezone` accepts it, else `America/Chicago`; every other default is a config row, so the setup sheet's chips and the server's validation cannot disagree. The guardian route returns the same discriminant with **no `defaults`** — a guardian has no write path, so offering the chips would offer a control that does not exist. The one 404 that remains is the **mutation** path against a student with no profile at all, under its own code, so the two situations cannot be conflated.

`device_timezone` is a query parameter because the server cannot otherwise know the device's zone; `device_timezone_mismatch` is derived from it.

`estimates` carries `practice_seconds_per_unit` and `review_seconds_per_unit`, read from their owning config tables, and travels on **both** the student and guardian payloads: §17.1 renders "~N min" on every practice row, the parent view is identical to the student's, and minutes are not among §16's exclusions. Withholding them was not a protection — with no estimate the card fell back to a full-sitting label for every block type, so a guardian reading a 15-question Math set was told it was a full sitting.

Errors: 400 · 401 · 402 (shared CTA payload, flat platform shape so the existing upgrade component recognises it) · 403 guardian gate · 404 · 409 (launch of a past or future date, launch of a complete block, editing a past date, moving a started block) · 429 · 500 (ERROR log, correlation id). Every other calendar error uses the nested envelope of Coding Standards §8.2. **A policy denial is a decision, not a fault:** it settles at 402 or 403 with a structured log, never a 500.

### 15.1 Launch — `CalendarLaunchService.launch(block_id, ctx)` (INV-08-18)
Handler does auth, entitlement and parse, then delegates. The service:

1. load the block; **409 unless `scheduled_date` = the student's local today** — past → "Do it now"; future → view-only; studying ahead happens directly in the engines and shows as today's actual or extra work;
2. load the block's latest launch by `launch_sequence`; if `adapter.progress(session).lifecycle = 'active'`, return it with `resumed = true` and `next = adapter.resumeHref(session_id)` — **the adapter for `latest.engine`, the engine that owns the session id, not the block's current type**, because those differ when a day was edited after a launch;
3. `remaining = target − actual` from the allocator; `409 already_complete` at zero;
4. `size = adapter.nextLaunchSize(block, remaining)`; `seq = last_sequence + 1`; `adapter.create(block, size, { client_instance_id, idempotency_key: 'calendar:block:<block_id>:<seq>' })`;
5. `calendar_link_launch(block_id, seq, engine, session_id)`;
6. return.

**`CalendarLaunchService` is the sole owner of the key format**; adapters never construct one and treat it as opaque. `seq` is derived from the stored launch rows rather than a counter, which is what heals a crash: a failure between 4 and 5 leaves no row, so the retry recomputes the **same** key, the engine replays the same session instead of creating a second, and the link lands at sequence 1. Two concurrent launches compute the same key and get one session (the engine's replay) and one link row (the block-row lock in `calendar_link_launch`) — two separate guarantees, both needed.

**The calendar resumes directly into the running session** (R-08-33), and `next` is always the adapter's, on both branches.

---

## 16. Entitlement, Roles, Guardian Read

The route is the authority (INV-08-11); RLS is defense in depth. Student premium: full surface; free: 402 CTA; lapse: 402, rows retained. **Guardian:** the server route only, `/api/students/:studentId/calendar`, through the existing `resolveSubject` + entitlement-gate pattern — `guardian_links.status = 'active' ∧ entitlement_active(student)` — reading through a **distinct guardian projection type**, never the student type with fields deleted. The projection has no profile, no target score (R-08-22), no controls, and no explanation copy at either level: a per-domain `explanation_key` inside a practice block's scope *is* the §17.6 copy §16 withholds, so stripping only the block-level key leaks it one level down. No guardian grants or policies on any calendar table (INV-08-12). Admin: explicit read; rollback through the writer with V-12 enforced.

---

## 17. UI Contract

Week-first with a month toggle; one primary action per block; engine-specific rows and editor forms. The visual contract is `docs/design/calendar-prototype.html`, committed and byte-identical to the approved design.

### 17.1 Layout — `/calendar`
Reachable from the **Calendar tab in the app's top navigation**, and from a per-student link on the guardian dashboard. A free student sees the tab and the page answers 402 with the upgrade CTA — that is the upsell path, not a hidden route.

1. **Left rail** — the Lyceon wordmark (links to the dashboard), the student's identity, a mini-month that navigates the main view, a **"Your schedule"** summary card with a **Change schedule** button, and block-type filters.
2. **Top bar** — **← Dashboard**, previous/next, **Today**, the visible range, a **Week / Month** toggle (Week default), the streak, days-to-test, **Edit schedule**, and **Refresh plan**.
3. **Plan-updated banner** (§17.4).
4. **Week view** — seven day columns. Blocks are **agenda cards, not an hour grid**: a block has no clock time, and drawing time slots would misrepresent the data. Four card kinds by colour — Math practice, Reading & Writing practice, Review, Full-length — each showing its scope, its target, its "~N min" from `estimates`, and its progress when any. Day headers carry a **⋯ menu**: Block out this day (or Undo day off), Regenerate day, Reset to auto. A blocked-out day renders as a hatched **"Day off"** with an Undo, visibly distinct from a rest day, which has nothing to undo.
5. **Month view** — the same blocks as compact chips over a six-week grid, with the same day menu. It is a lens over the same 14-day plan plus history, not a second horizon.
6. **Side sheet** — opens beside the calendar on any block: scope rows (practice: domain + count, add or remove a domain within the section's four, counts in multiples of `granularity`; review: items; full-length: date), **Start / Resume / Do it now / Remove**, **Move to…** (the keyboard and screen-reader path for a move), and "Why this is here" (§17.6).
7. **Facts strip** — the §14 facts for the visible range.

**Drag to move.** A block can be dragged to another day, with pointer, touch and keyboard sensors. Started blocks and past blocks are not draggable, and the client mirrors the server's refusals so an illegal drop never leaves the pointer.

### 17.2 Day editor
Row per member, with started members locked. `Add` chooses the engine first. Every change is a full-member-list `PUT /days/:date` with started blocks carried. Planned-time readout, no warning, no disable (R-08-19).

### 17.3 Settings sheet
Opened from **Edit schedule** or the rail card: study days, time per day, SAT date, target score, practice-test day (weekday or None — independent of study days), timezone, and an **Auto plan** toggle. Bounds and presets come from the response `defaults`; a live readout states what the choices mean ("5 study days a week · about 60 questions a day · practice tests on Saturdays"). Saving re-plans **open days only**: days the student edited or blocked out are never touched. In `custom` mode nothing is re-planned until the student confirms. If `device_timezone_mismatch` is set: "Your device is now on America/New_York. Update your study calendar timezone?" — the student chooses; never silent.

### 17.4 Plan-updated banner (INV-08-13)
Shown when `latest_unacknowledged_nonstudent_change` is non-null: "Your plan was refreshed for the week" / "…after your exam" / "…was restored by support". Dismiss acknowledges that `version_no`. Student-initiated changes never raise it — the copy map has only the three non-student triggers, so it cannot.

### 17.5 States
Loading (skeleton); **setup required** (the setup sheet over a greyed sample week, built from `defaults`); 402 (the shared premium CTA); error (inline retry, never a blank page); rest day; day off; all-done; past day (read-only); timezone mismatch.

### 17.6 "Why this block" copy (student only)
Info affordance per block; copy keyed by `explanation_key`. **Block keys:**

| key | copy |
|---|---|
| `review_due` | "Questions you missed earlier are due for a retry." |
| `exam_review` | "Going over what you missed on your last full-length." |
| `exam_review_placeholder` | "Going over what you missed on your last practice test." |
| `final_rehearsal` | "Your last full rehearsal before test day." |
| `exam_cadence` | "A full-length every two weeks keeps you test-ready." |
| `taper` | "Test week: lighter days so you arrive rested." |
| `cold_start` | "We're still learning where you stand — this balances the sections." |
| `fallback` | "A balanced session while we catch up on your progress data." |
| `weighted` | **No block-level copy** — it is the key on a practice block that *has* a domain mix, and the mix's per-domain reasons are more specific and already on screen. |

**Domain keys**, rendered on the mix chips:

| key | copy |
|---|---|
| `weak` | "One of your weaker areas right now." |
| `exploring` | "We haven't seen enough of this yet." |
| `balanced` | "Keeping this one moving." |
| `strength` | "You're strong here — a short set keeps it sharp." |
| `post_exam` | "Your last test pointed here." |

`weak_domain`, `maintain_strength`, `post_exam_focus` and `spacing_revisit` are retired. Guardian view renders none of this (§16).

### 17.7 Interaction rules
- **Launch must feel instant.** On a successful launch the client prefetches **that engine's** state query key before navigating, and warms the engine's lazy route chunk on hover or focus of any Start control. Prefetching the wrong engine's key is worse than not prefetching: it caches a miss.
- `Start` / `Resume` disable until navigation; the service's idempotency handles double-taps.
- Server state via TanStack Query; refetch on window focus, so returning from a session shows progress without a reload; no polling; local state only for sheet and selection.
- No raw `fetch` in components, no derived state in `useEffect`, no plan-shaping literal (Coding Standards §11, INV-08-14).
- Mobile-first at 390px; sheets not modals.
- Domain logic imported from `packages/shared/src/calendar/`, never inlined; the formula is never in the client.

---

## 18. Observability, Events, Failure Modes

Events (Doc 01A Part II conventions): `calendar.setup_completed`, `calendar.plan_generated {trigger, initiated_by, generator, validator_result, created_count, carried_count}`, `calendar.plan_rejected {rule_ids}`, `calendar.day_edited`, `calendar.day_blocked_out`, `calendar.day_reset`, `calendar.block_moved`, `calendar.block_launched {engine, resumed}`, `calendar.do_it_now`, `calendar.plan_acknowledged`, `calendar.timezone_changed`, `calendar.job_run {job, outcome}`. Never logged: scope beyond type, target score, timezone, bodies. Metrics: generation latency; `generated`-mode rejections (alert > 0); fallback-generator runs (alert on a sustained rate — one is fail-open working, a stream of them is an upstream outage); job outcomes; launch rate per engine.

| Failure | Handling |
|---|---|
| Engine create fails | No link; the refusal is data; the block stays `scheduled`. |
| Created but link failed | Retry → same `seq` → same engine key → same session → link lands. |
| Two tabs launch | Same key → one engine session; the block-row lock → one link row; the second caller gets `resumed = true`. |
| Engine disabled | Its adapter refuses as data, its control says "Coming soon", and the builder removes its inputs so it consumes no budget. |
| Mastery or review queue unreadable | `fallback_v1` on the same snapshot, reason recorded on the version. |
| Essential input missing | Nothing generated; the prior plan stands; loud at the accessor. |
| `generated` rejection | Fallback ladder (§12.3); if that is rejected too, the rejected version is recorded and owns nothing. |
| Job vs student edit | Row lock; V-12 keeps started blocks; ownership resolves per date. |
| Late engine write | The counter reflects it on the next read; nothing to repair. |
| Timezone change | Future dates regenerate; past untouched; prompt, never silent. |
| Entitlement lapse / link revoked | 402 / 403; nothing deleted. |
| Account deletion | FK cascade; no trigger in the way. |

---

## 19. Testing, CI Gates, Plants

Every assertion below exists as a gate, and **every gate has been planted**: the behaviour was broken, the named gate was watched to go red, and the change was reverted byte-identical. A gate nobody has watched fail is decoration.

| Area | Gates |
|---|---|
| Formula parity | Nine committed fixtures plus a seeded 3,000-snapshot suite regenerated per run, both generators, byte-exact against an independent Python oracle, on **PostgreSQL 17**. Constants in the database are asserted to match the oracle's. |
| Schema | Every FK, CHECK and `security_invoker` reloption asserted; scope-shape cases per block type; `generator_version` asserted to name the newest migration that redefines a generator function. |
| Grants and RLS | Own rows readable, another student's zero, INSERT rejected, write-RPC EXECUTE rejected — each error verbatim. Plant: dropping `security_invoker` leaks another student's plan. |
| Writers | ~50 assertions over version allocation, ownership per trigger, carried blocks, the narrowing steps, the acknowledge clamp, the move, the beyond-horizon reset. Z-34 asserts a `weekly` version is accepted, `deterministic_v1`, and owns a non-empty date set *before* asserting it does not own today. |
| Concurrency | Two persists serialize to n and n+1; eight same-key callers replay rather than collide; N launches → N distinct sequences, zero errors. |
| Builder body | The live `calendar_build_plan_input` is asserted to read `queued_at` and not `next_review_at` — a stale body passes every structural check and fails every plan generation at runtime. |
| Adapters | Contract test per engine, PG-backed, behind a vitest summary gate that treats a skipped test as red. Landing assertions: `next` is that engine's own route on **both** the create and resume branches, and the session id in it resolves in that engine's own table. Skip fixtures: a resolved-but-skipped row produces zero units. |
| Transport | The launch path driven over real PostgREST on a real service-role JWT, with the first link failing, proving crash-retry heals to one session and one row at sequence 1. |
| Allocator | Unit conservation as a property test; overlapping scopes in both display orders; midnight split; off-scope work becomes extra. |
| Validator | One case per rule × applicable modes; rejection cases, so a validator that always accepts cannot pass. |
| Routes | Denial per route (free 402, guardian no-link 403, guardian link-but-student-free 403) and the streak route asserted to have **no** entitlement check. The guardian payload asserted to contain the block and none of §16's withheld keys, at both levels. |
| Weekly | Setup Wednesday → no weekly until Monday; a `day_edit` never suppresses it; two runs the same day write one version. |
| UI | Guardian tree-walk with the side sheet **open** — a closed-page walk cannot see a control that renders on click; drag refusals; the prefetch asserted by the practice page's first render having `isLoading === false`. |
| CI hygiene | PG-backed suites exit 1 on any skipped test. A job that reports green while skipping everything is the failure mode these gates exist to prevent. |

---

## 20. Forward References, Deploy Gates, Audit Rule

| ID | Gate | State |
|---|---|---|
| G-08-01 | Practice create honours structured filters, `target_count`, and an opaque idempotency key | **Closed** — verified against the real engine |
| G-08-02 | Doc 04A exam tables, create path, terminal states and progress presentation in prod; the full-length contract test passes against the real engine; `full_length` added to `enabled_block_types` as its own last migration | **Open** — Doc 04 wave |
| G-08-03 | Review queue writer live; the review launch contract test passes against the **real** engine; `review` present in `enabled_block_types` | **Closed** 2026-09-23 |
| G-08-04 | Doc 01A `IdempotencyService` replaces `calendar_mutation_ledger` | Open |
| G-08-05 | Doc 06C registry entry and dead-letter for the weekly job | Open |
| G-08-06 | SCL-08-A applied (Doc 05D cascade list) | Open |
| G-08-07 | Doc 07 consumes §18 events and `calendar_launch_rate` | Open |
| G-08-08 | RLS identity helpers | **Closed** — `auth.uid()` and `profiles.role` |
| G-08-09 | Production PostgreSQL ≥ 15 for `security_invoker` | **Closed** — production is 17 |
| G-08-10 | Domain importance seam resolved or declared absent | Open (SCL-08-G) |
| G-08-11 / G-08-12 | Streak tier-on-date and signup timezone | **Collapsed into SCL-08-E** — the streak is Doc 05B's, and the timezone falls open to `America/Chicago` |

**Audit rule:** any line in this document restating a number or mechanism owned by 01/01A/02B/04/05/06, or by the Formula Sheet, is a defect; every foreign constant appears only as a reference with its owner named.

---

## 21. Runtime Constants Catalog — `calendar_runtime_config`

**The generation constants are the Formula Sheet §4 and are not restated here.** This section catalogues what the sheet does not own: the surface constants the routes and the job read.

| Key | Launch | Bounds | Use |
|---|---|---|---|
| `generator_version` | the timestamp of the migration defining the formula | — | Stamped on every plan version, so a stored plan traces to the exact SQL that produced it. Not a tunable; any migration that changes a generator function updates it in the same file. |
| `enabled_block_types` | `["practice","review"]` | — | V-03, and the builder's input neutralisation (§10.1). `full_length` is added only when G-08-02 closes. |
| `daily_minutes_min` / `_max` | 15 / 180 | 5–60 / 60–600 | §8.1 |
| `daily_minutes_presets` | `[15,30,45,60,90,120]` | — | §8.1 |
| `target_exam_date_max_days` | 540 | 30–730 | §8.1 |
| `weekly_job_interval_minutes` | 1440 | 15–1440 | §12.5 — the job is a daily cron with a weekly predicate; the week anchor is Monday and is not configurable (R-08-30) |
| `review_estimated_seconds_per_item` | 120 | 30–600 | Calendar-owned until Doc 02B claims a review timing constant (SCL-08-F). It errs toward **smaller** review blocks, which is the safe direction: a block that finishes early costs nothing, one that overruns the day costs the rest of the plan. **Revisit once 200 answered review items exist**, measured as `occurred_at − served_at`. |

Rate-limit buckets (Doc 01A Part V): `calendar_plan_regenerate` 20/day, `calendar_day_regenerate` 60/day. Two buckets rather than one shared number, because a morning of day edits must not lock the student out of the refresh button — the control they reach for when the plan is wrong.

Read from their owners, never duplicated: `practice_runtime_config.target_seconds_per_question`; exam durations (Doc 02B §41 / Doc 04A). `quota_reset_timezone` is not read.

---

## 22. Worked Examples

### 22.1 A weekday for a mixed profile
Mon–Sat, 60 min (`B = 3600s`), 45 items queued, review enabled. Review takes `min(due, review_block_max, 50% of the day)` → 15 items × 120s = 1800s. `B_rem = 1800s` → `Q = 20` questions, split by the deficit rule into one Math block and one Reading & Writing block of 10 each, each a mix of full-name domains in multiples of 5. The day reads: **Review · 15 · Math · 10 {Advanced Math 5, Algebra 5} · Reading & Writing · 10 {Expression of Ideas 5, Craft and Structure 5}** — 60 minutes exactly.

### 22.2 The same student with an engine disabled
With `review` absent from `enabled_block_types`, the builder passes an empty queue, no review block is budgeted, and the whole hour goes to practice: `Q = 40`, 20 Math and 20 R&W. The student loses nothing. This is the shape the launch config depends on: if the builder did **not** neutralise the input, the formula would reserve 30 minutes for a review block the output filter then removed, and the student would see a half-empty day with no explanation.

### 22.3 Counter
Tuesday plans Math 20 {Algebra 10, Advanced Math 10} and R&W 10. The student launches Math, answers 12, abandons → `12/20 partial`. Later, from the practice page, 10 more Algebra → Math actual 22 → `20/20` plus extra "+2 Algebra". Then 15 Expression of Ideas → extra "+15 Expression of Ideas". R&W `0/10`. Facts: 1 complete, 1 missed after the day, 37 questions, 17 extra.

### 22.4 Midnight (Los Angeles)
A session starts Sunday 23:50; 8 items resolve before midnight, 12 after. Sunday counts 8, Monday 12 — by item `occurred_at`, in the plan date's own timezone. The window is computed from the next local day's start, so the same logic holds on a 23-hour and a 25-hour day.

### 22.5 Edit around a started block
Thursday: [R&W 10 (1), Math 20 started (2), Review 5 (3)]. The student edits the day → a new version owns Thursday: [R&W 10 replaced (1), Math carried (2), Review removed]. The Math block's identity and position are unchanged, and V-12 would have rejected a plan that dropped it.

### 22.6 Blocking out a day
Tuesday is blocked out: a day edit with an empty member list, stored as the student's override. The weekly run on Monday leaves it alone; a settings change on Wednesday leaves it alone. The student then changes their study days to drop Saturdays — Tuesday is still off, because a blocked-out day is theirs. Undo is `day_reset`, which clears the override and returns the date to automatic planning.

### 22.7 Exam precedence
Target 7 Nov, `full_length_weekday` = Saturday, horizon 26 Oct – 8 Nov. The final rehearsal is the last Saturday at least `final_exam_lead_days` before the target: Sat 31 Oct. The next cadence Saturday falls outside the horizon. One exam placed, key `final_rehearsal`, and the following study day carries the exam-review block.

---

## 23. Open Items and SCLs

The register is `docs/SpecAudit/SPEC_CHANGES_LOG.md`, whose ids are three-digit (`SCL-###`). The `SCL-08-*` ids below were issued in this document's own scheme and are **invisible to the register's duplicate gate**, which matches `SCL-\d{3}`; each must be filed in the canonical scheme to become actionable.

| Local id | Ask | State |
|---|---|---|
| SCL-08-A | Doc 05D §10's deletion cascade names, by table: `student_study_profile`, `calendar_plan_versions`, `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches`, `calendar_mutation_ledger`, `calendar_job_runs`. `calendar_runtime_config` and its history are not student-owned and are excluded. | Open (G-08-06) |
| SCL-08-B | Doc 02B review create seam. | **Withdrawn** — `source_origin` never existed and the calendar records its own launches; the opaque key is already honoured (register SCL-118). |
| SCL-08-D | Doc 02B practice create accepts an opaque idempotency key. | **Satisfied** — verified against the real engine (G-08-01). |
| SCL-08-E | Doc 05B: a student-local day boundary for the activity streak, and the rest-day skip. Until then `/api/me/streak` returns 05B's UTC value with `history_complete: false`. | Open |
| SCL-08-F | Doc 02B claims a review timing constant, or `review_estimated_seconds_per_item` stays calendar-owned. | Open |
| SCL-08-G | Does any locked document own a per-domain importance weight? If Doc 05 Parent's macro-average implies equal domains, declare it absent. | Open (G-08-10) |
| SCL-08-H | Superseded by the timezone fall-open (§7.1): a student without a captured zone gets `America/Chicago`, so no signup-timezone dependency remains. | **Closed** |

**Register entries filed against this document**, all amending text this version already carries: SCL-115 (§4 review seam row), SCL-116 (§9.3 review adapter), SCL-117 (G-08-03's clearing conditions), SCL-118 (SCL-08-B withdrawn). Each may move to APPLIED against this version.

---

## 24. Change Record

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-09-16 | Locked. Promoted from PDF-07 and revised to owner rulings. |
| 1.0 | 2026-09-23 | Consolidated in place. The build's thirty-eight ruled amendments and the Formula Sheet's nineteen reconciling edits are applied inline, and the separate change-record addendum is retired. Substantive changes: §11 defers to the Formula Sheet; `fallback_v1` joins `deterministic_v1`; `calendar_blocks` carries `scope jsonb` and practice splits into one block per section; mastery levels re-keyed to the live 0–4 domain; the adapter contract is five methods with `resumeHref`, no `skills` on a unit, and `status = 'answered'` dated by `occurred_at`; the review seam restated against the rebuilt engine; system-initiated regeneration owns dates from tomorrow; blocked-out days, block moves and beyond-horizon reset added; `GET /api/calendar` returns a 200 discriminated union with `estimates` on both payloads; the streak moves to Doc 05B; §17 covers the week/month views, the settings sheet and the day menu; §21 keeps only the surface constants; G-08-03, G-08-08 and G-08-09 close and G-08-11/12 collapse into SCL-08-E. Status stays LOCKED; no version bump. |

---

## Appendix A — Future Generator Contract (feature state only)

Feature state only — no columns, no code, no config values ship for this at launch (R-08-21). Interface: `generate(input: PlanInput): PlanOutput`, identical to the shipped generators. A future `llm_v1` implements it, is validated in `generated` mode exactly as `deterministic_v1` is, and falls back — to `deterministic_v1` first and `fallback_v1` after, since the ladder already exists (§12.3). Enabling it is a CHECK widening on `generator` plus whatever audit columns that migration adds. Model stack, cost caps and orchestration are Doc 03's. Determinism is not required of it; auditability and INV-08-13 are.

**Rings (R-08-28):** completion ring = Σ actual / Σ target on blocks; workload ring = Σ `actual × seconds_per_unit` / `daily_minutes × 60`; review ring = review actual / due — all from the allocator, no schema change.

*End of Doc 05F V1.0 — LOCKED.*
