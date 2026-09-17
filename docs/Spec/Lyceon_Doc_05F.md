# Lyceon — Document 08: Study Calendar & Plan Generation

**Version:** 1.0  **Date:** 2026-09-16  **Status:** LOCKED
**Owner:** Founder / CTO review  **Governed by:** Doc 00 V6.0, Doc 01 V8 / Doc 01A V1.0, Doc 02 Preamble V3
**Depends on:** Doc 02B V4 (practice + review runtime), Doc 04 family (exam runtime), Doc 05 family V1.0 (mastery), Doc 06A/B/C (ops)
**Supersedes:** PDF-07 — Calendar, Study Plan & Scheduling (Locked MVP, 2026-01-19) in full
**Branch:** `calendar`

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
7. Schema (DDL)
8. Student Inputs and Derivations
9. Engine Adapters — Planning, Launch, Progress
10. Generator Contract and Validator
11. `deterministic_v1` — Time-Budgeted Smooth Weighted Allocation
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

The study calendar turns the student's stated availability (minutes per day, study days, timezone, target exam date, target score, optional full-length test day) and the platform's knowledge of them (domain mastery, review items due by date, exam cadence) into a rolling 14-day plan of **blocks** — "Practice · Algebra · 20 questions", "Review · 7 due items", "Full-length SAT". A block launches its engine in one tap. Progress is a **count**: activity in the block's scope on the block's date, read from the engine's own immutable item records, capped at the target. Work beyond or outside the plan is shown as extra work. Nothing about completion is stored, matched, or reconciled.

| Capability | Launch |
|---|---|
| Generator | `deterministic_v1` (§11), time-budgeted, per-engine sizing |
| Engines | practice, review, full-length — each through an adapter (§9), each gated by its contract test |
| Progress | counter over engine items per scope per local date (§13) |
| Plan history | append-only versions; normalized date ownership and block membership (§7) |
| Weekly auto-regen | once per student-local week, monitored |
| Timezone | student-local IANA, captured from the browser at setup, changed only by the student |
| Streak | platform-wide activity streak (R-08-25 B), shown in calendar header and practice page |
| Top-level metric | none — facts only (R-08-28); rings post-launch (Appendix A note) |

---

## 1. Purpose and Scope

**In scope:** study profile; plan generation and validation; versioned plan storage; block launch; progress counting; overrides and block-level freeze; regeneration; student UI; guardian read; calendar constants; calendar events; the platform activity streak definition.

**Out of scope (referenced, never redefined):** question selection (Doc 02B §15); practice/review/exam lifecycles (Doc 02B §14/§16/§17; Doc 04A); mastery (Doc 05A/B); projections (Doc 05C); entitlement and `calendar_access` (Doc 01 §1623 / `EntitlementService`); guardian links (Doc 01); config doctrine, observability, idempotency, rate limiting (Doc 01A Parts I, II, IV, V); job registry (Doc 06C); analytics export (Doc 07).

---

## 2. Supersession

PDF-07 is superseded in full. What carries forward and what changes:

| PDF-07 | Doc 08 | Reason |
|---|---|---|
| §1 student owns plan; AI baseline not mandate; **no daily cap**; overrides preserved | Carried. The daily-minutes target bounds **auto-generation only**; student edits and actual study are never capped (R-08-19) | Core philosophy |
| §2 Auto / Custom, per-day overrides | Carried (`planner_mode`, `is_user_override`) | R-08-06 |
| §3 inputs | Replaced: `timezone`, `study_days_mask`, `daily_minutes`, `target_exam_date`, `target_score`, `full_length_weekday` | R-08-03/04/10/17/27 |
| §4 14-day primary / 30-day preview | 14-day only | R-08-02 |
| §5 six block types | Three: `practice`, `review`, `full_length` | R-08-01 |
| §6 `calendar_blocks` with `estimated_minutes` | `calendar_blocks` with `target_count` | R-08-03 |
| §7–§11 regen, day editor, toggle | Carried (§12, §17) | — |
| §13 catch-up blocks | Removed. Missed blocks stay historical; "Do it now" creates a new block today (R-08-20) | Immutable history |
| §14 guardian visibility | Same dashboard, view-only, **no target score**, no "why" copy, no controls (R-08-08/22) | — |
| §15 free = limited | Free = nothing (R-08-09) | Doc 02B §12 matrix; prod `calendar_access` |
| §17 events, §18 failure modes | Carried, expanded (§17, §18) | — |

---

## 3. Rulings Log (R-08-*)

Owner rulings, 2026-09-16, stated as current truth.

| ID | Ruling |
|---|---|
| R-08-01 | Block type enum = `practice`, `review`, `full_length`. Exam review and practice review both fall under `review`. |
| R-08-02 | Rolling 14-day horizon; weekly regeneration once per student-local ISO week, Monday-anchored, plus student-triggered refresh. |
| R-08-03 | Student sets time per day; the system derives engine units. Minutes are input-only; units are stored. |
| R-08-04 | Setup captures the study profile; the first plan is generated on the student's first entitled calendar open after setup completes. Setup collects timezone, target exam date, target score, study days, daily minutes, optional full-length weekday. Cold start = balanced. The diagnostic is a recommendation card, never a gate. |
| R-08-05 | Generation mixes weaknesses, strengths, review, practice and full-length exams. `deterministic_v1` is locked (§11); launch constants are runtime-configurable. |
| R-08-06 | Override scope is per day; a student edit marks the date `is_user_override`. |
| R-08-08 | Guardians get a view-only copy of the student's calendar dashboard — no settings, no target score, no controls, no explanation copy. |
| R-08-09 | The calendar surface is premium-only via `calendar_access`; free sees the CTA. The platform activity streak (R-08-25) is excluded from this restriction. |
| R-08-10 | Calendar day boundaries use the student's local IANA timezone, captured from the browser at setup, changed only by the student. Platform quota reset stays `America/Chicago` (Doc 02B). |
| R-08-11 | Launch generator is `deterministic_v1`; an LLM generator is feature state only (Appendix A). |
| R-08-12 | Legacy calendar code is deleted and rebuilt from this document. |
| R-08-13 | A block opens its engine with a pre-filled session in one tap. All engine activity, on- or off-calendar, reflects into calendar progress through the read-time allocator (R-08-24, R-08-29). Review and exam engines are built to the adapter contract (§9). |
| R-08-14 | The calendar is a plan, never a gate. No engine, mastery, KPI, or entitlement path depends on it (INV-08-19). Unmatched activity appears as Extra work. |
| R-08-15 | All three engines launch from the calendar at launch, each through its adapter. |
| R-08-16 | Partial work is shown (`12 / 20`). |
| R-08-17 | Target score is required at setup. |
| R-08-18 | When a block starts, only that block freezes; unstarted blocks on the day remain editable. |
| R-08-19 | Student edits may exceed the daily-minutes target with no warning. Auto-generation respects the target. |
| R-08-20 | Missed blocks stay historical. "Do it now" creates a new block today. |
| R-08-21 | `llm_v1`: no columns, no code, no config values; Appendix A only. |
| R-08-22 | Guardians do not see target score. |
| R-08-24 | Progress is derived by the allocator from immutable engine activity; nothing about completion is stored, matched or reconciled. |
| R-08-25 | **Streak = platform-wide activity.** A local day counts when any engine shows ≥1 completed unit. Premium students' non-study days are skipped, not broken. Free students: every day counts. |
| R-08-26 | NULL mastery on a mixed profile = neutral weight; all-NULL = balanced cold start. |
| R-08-27 | Optional full-length test weekday collected at setup. |
| R-08-28 | No single progress percentage at launch; facts only. Rings (completion, workload, review) are post-launch and buildable on the allocator without schema change. |
| R-08-29 | Scope overlap is a formula property: each engine activity unit is consumed at most once, allocated to blocks in display order. |
| R-08-30 | Weekly regeneration is anchored to Monday permanently; not configurable. |

---

## 4. Cross-Document Seam Table

Verified against production (read-only) 2026-09-16 unless FORWARD_REF.

| Seam | Owner | Exact mechanism consumed | Calendar-side contract |
|---|---|---|---|
| Entitlement gate | Doc 01 §1623 / `EntitlementService` | `calendar_access` | Every route; server is the authority, RLS is defense in depth (§16). |
| Entitlement predicate | Doc 01 | `public.entitlement_active(uuid)` | Guardian gate and RLS. |
| Guardian link | Doc 01 | `guardian_links(status)` | Guardian read requires `active` ∧ `entitlement_active(student)`. |
| Timezone names | PostgreSQL | `pg_timezone_names` | Route validation of the IANA name. |
| Practice sizing/timing | Doc 02B §13/§14/§41 | `practice_runtime_config.session_presets`, `max_session_count_premium`, `target_seconds_per_question` | Practice adapter `allowedPlanSizes`, `estimateDuration`. |
| Practice create / items | Doc 02B §14 | `practice_sessions(...)`, `practice_session_items(question_section, question_domain, question_skill, answered_at)` | Adapter create; counter reads items. |
| Review due / create / items | Doc 02B §16 | `review_schedule(next_review_at, status)`; `review_sessions(source_origin, client_instance_id)`; the canonical finalized Review activity timestamp on `review_session_items`, verified under G-08-03 | Review adapter; due-by-date; counter reads items. |
| Exam durations | Doc 02B §41 | `exam_runtime_config.rw_section_duration_seconds`, `math_section_duration_seconds`, `break_duration_seconds` | Exam adapter `estimateDuration` = sum, read not restated. |
| Exam create / state / progress | Doc 04A | `full_length_exam_sessions` + state machine + Doc 04's progress presentation — **FORWARD_REF, absent in prod** | Exam adapter; G-08-02. |
| Domain mastery | Doc 05B | `student_domain_mastery.mastery_level` | Weights (§11.3). |
| Domain importance | Doc 05 Parent / 04B | blueprint or importance weight per domain **if one is canonically owned** | Consumed if it exists, else all domains equal (§11.3; open item 24.6). |
| Diagnostic state | Doc 02B / 05 | `student_diagnostic_states.state` | Recommendation card only (§17). |
| Config doctrine | Doc 01A Part I | `*_runtime_config` shape | `calendar_runtime_config` (§21). |
| Idempotency | Doc 01A Part IV | `IdempotencyService` (absent) | `calendar_mutation_ledger` interim. |
| Observability | Doc 01A Part II | logger, correlation ids, redaction | §18. |
| Rate limiting | Doc 01A Part V | `RateLimitLedger` | Regenerate routes. |
| Jobs | Doc 06C | registry, dead-letter, owners | Weekly regen job. |
| Account deletion | Doc 05D §10 | deletion cascade | Calendar tables added (SCL-08-A). |
| Streak consumer | Doc 02B practice UI | — | Streak read model owned here, consumed by practice page (SCL-08-E). |
| Analytics | Doc 07 | — FORWARD_REF | §18 events; `calendar_launch_rate`. |

---

## 5. Core Invariants (INV-08-*) with Proving Mechanisms

| ID | Invariant | Proving mechanism |
|---|---|---|
| INV-08-01 | The calendar never selects questions, writes mastery, writes any engine table, or passes an engine a parameter its create route does not accept. | CI grep gate; launch payload ⊆ engine create schema test. |
| INV-08-02 | Every engine launched from the calendar satisfies the adapter contract (§9.1). | `calendar.launch-contract.<engine>.test.ts` per engine; `enabled_block_types` cannot name an engine without one. |
| INV-08-03 | A block with a launch row is never removed from, or altered on, any version of its date. A date with `is_user_override=true` is never owned by a non-student version. | Validator V-12; replay tests; plants. |
| INV-08-04 | In `planner_mode='custom'` no non-student trigger writes anything. | Weekly job over a custom student writes zero rows. |
| INV-08-05 | `calendar_plan_versions`, `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches` have no runtime UPDATE/DELETE path: grants revoked, RLS denies, no RPC exposes them. Account deletion cascades through FK. | Grant/RLS tests; RPC inventory test; cascade test. |
| INV-08-06 | `deterministic_v1` is a pure function of its snapshot and reads **nothing else** — no config table, no adapter call. | 50-snapshot parity replayed with all runtime config tables mocked to different values; plant by letting the generator read a live config. |
| INV-08-07 | Every plan passes the validator (§10.3) under its mode before persistence. | Per-rule tests; mode tests. |
| INV-08-08 | Progress is derived from immutable inputs only (plan rows; engine finalized item columns per Doc 02B §26). No progress, completion, or attribution is ever stored. | Schema test (no such columns/tables); determinism test: same fixtures → same progress across two reads. |
| INV-08-09 | Every calendar mutation is idempotent via `idempotency_key`. | Replay tests; ledger PK. |
| INV-08-10 | No calendar response contains question content, answers, or explanations. | Response schema tests. |
| INV-08-11 | Every calendar product route under `/api/calendar` and every guardian calendar route enforces `calendar_access` server-side; the route is the authority. `/api/me/streak` is explicitly exempt (R-08-25, INV-08-20). | Denial tests on every calendar route; presence test that the streak route has no entitlement check. |
| INV-08-12 | Guardian access is read-only, via the guardian route only; no guardian grant on calendar tables. | Route inventory; RLS test as guardian returns zero rows. |
| INV-08-13 | Every plan change not initiated by the student is surfaced with its trigger; student edits never mask it. | `latest_unacknowledged_nonstudent_change` fixture test. |
| INV-08-14 | No plan-shaping numeric literal in calendar code. | Constants gate scoped to `calendar/**`. |
| INV-08-15 | All local-date computations use `student_study_profile.timezone`; no timezone literal in calendar code. | Grep gate; two-zone derivation test. |
| INV-08-16 | Every calendar view is `security_invoker = true`. | Catalog test; cross-student read returns zero. G-08-09 (PG ≥ 15). |
| INV-08-17 | Version numbers are allocated under a per-student row lock. | Two-transaction test. |
| INV-08-18 | A block has at most one **live** engine session at a time; it may be launched again after that session is terminal. | Engine idempotency key `calendar:block:<block_id>:<launch_sequence>`; handler checks `adapter.progress(last launch).lifecycle` before creating; race test returns one session to both callers; continuation test creates a second session only after abandonment. |
| INV-08-19 | **Calendar non-authority.** No engine, mastery writer, KPI, entitlement decision, or learning-event path depends on a calendar block or launch existing. Calendar association is downstream metadata only. | CI gate: no non-calendar module imports `calendar/**`; engine create routes accept the calendar key as an optional opaque idempotency key with no calendar semantics. |
| INV-08-20 | **Platform activity streak.** Streak eligibility derives exclusively from canonical engine activity; calendar launch, block completion, plan adherence, and `calendar_access` are never prerequisites. | Streak service has no calendar dependency (CI grep); free-student fixture earns a streak day; `GET /api/me/streak` has no entitlement gate (asserted). |
| INV-08-21 | **Unit conservation.** An engine activity unit contributes to at most one block on its local date; progress + extra work never exceed recorded activity. | Allocator test: overlapping scopes (ALG-20 + ALG/LIN-10 against 20 items) sum to 20; plant by removing the consumed-set. |
| INV-08-22 | Cross-student integrity is relational: every calendar row's `student_id` is FK-bound to its parent's `student_id`. | Insert a dates/blocks/memberships/launches row with a mismatched `student_id` → FK violation (test per table). |

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
**Current plan** for a date — the memberships of the highest accepted version owning that date. A cleared day is an owned date with zero memberships; its `is_user_override` lives on the plan-date row, not on blocks.
**Progress** — §13. The day's engine activity units are allocated, each at most once, to blocks in display order by scope match, capped at target (R-08-29).

**Block types and scopes:**

| `block_type` | Engine | Scope | Target unit |
|---|---|---|---|
| `practice` | practice | `section`, `domain`, `skill_codes?` | questions (preset sizes) |
| `review` | review | none (the due queue is the scope) | due items (1 … `review_block_max`) |
| `full_length` | exam | `form_id?` (Doc 04 rotation when NULL) | 1 exam |

---

## 7. Schema (DDL)

Three places (migration, prod by owner, genesis). RLS identity `current_student_id()` / `is_admin()` (Doc 01; G-08-08). Views `WITH (security_invoker = true)`.

### 7.1 `student_study_profile`
```sql
CREATE TABLE public.student_study_profile (
  student_id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  timezone              text NOT NULL,                        -- IANA, validated at the route against pg_timezone_names
  target_exam_date      date,                                 -- nullable; route enforces >= local today
  target_score          integer CHECK (target_score BETWEEN 400 AND 1600 AND target_score % 10 = 0),
  study_days_mask       smallint NOT NULL CHECK (study_days_mask BETWEEN 1 AND 127),   -- bit i = Postgres DOW i (0=Sun)
  daily_minutes         integer NOT NULL CHECK (daily_minutes BETWEEN 5 AND 600),       -- real bounds from config at the route
  full_length_weekday   smallint CHECK (full_length_weekday BETWEEN 0 AND 6),           -- nullable = no automatic exams
  planner_mode          text NOT NULL DEFAULT 'auto' CHECK (planner_mode IN ('auto','custom')),
  setup_completed_at    timestamptz,
  last_acknowledged_nonstudent_version_no integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT setup_requires_target_score CHECK (setup_completed_at IS NULL OR target_score IS NOT NULL)
);
```
The only calendar table updated at runtime (profile edits; acknowledgement). Timezone is captured once at setup from `Intl.DateTimeFormat().resolvedOptions().timeZone`; if the browser later reports a different zone the UI offers "Update your study calendar timezone?" — never silent (§17.3).

### 7.2 `calendar_plan_versions` (append-only)
```sql
CREATE TABLE public.calendar_plan_versions (
  plan_version_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version_no            integer NOT NULL,
  generator             text NOT NULL DEFAULT 'deterministic_v1' CHECK (generator IN ('deterministic_v1')),
  generator_version     text NOT NULL,
  trigger               text NOT NULL CHECK (trigger IN
                          ('setup','profile_change','weekly','student_refresh','post_exam','day_edit','day_regenerate','day_reset','do_it_now','rollback')),
  initiated_by          text NOT NULL CHECK (initiated_by IN ('student','system','admin')),
  input_snapshot        jsonb NOT NULL,
  input_snapshot_hash   text NOT NULL,
  constants_snapshot    jsonb NOT NULL,
  validator_result      text NOT NULL CHECK (validator_result IN ('accepted','rejected')),
  validator_detail      jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, version_no),
  UNIQUE (plan_version_id, student_id)                        -- composite FK target (INV-08-22)
);
```

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
  section               text CHECK (section IN ('M','RW')),
  domain                text,
  skill_codes           text[],
  form_id               uuid,
  target_count          integer NOT NULL CHECK (target_count >= 1),
  source                text NOT NULL CHECK (source IN ('auto','student','post_exam')),
  derived_from_block_id uuid,
  explanation_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, student_id),
  UNIQUE (block_id, student_id, scheduled_date),
  FOREIGN KEY (derived_from_block_id, student_id) REFERENCES public.calendar_blocks(block_id, student_id),   -- lineage is same-student (INV-08-22)
  FOREIGN KEY (created_in_version_id, student_id) REFERENCES public.calendar_plan_versions(plan_version_id, student_id),
  CHECK (
    (block_type = 'practice'    AND section IS NOT NULL AND domain IS NOT NULL AND form_id IS NULL) OR
    (block_type = 'review'      AND section IS NULL AND domain IS NULL AND skill_codes IS NULL AND form_id IS NULL) OR
    (block_type = 'full_length' AND section IS NULL AND domain IS NULL AND skill_codes IS NULL AND target_count = 1)
  )
);
```
No ordinal, no override flag, no status: order is membership, override is the plan date, status is derived.

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
The composite FK to `calendar_blocks(block_id, student_id, scheduled_date)` makes "a block never moves dates" and "same student" relational facts, not RPC promises (INV-08-22).

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
A cleared day appears with `block_id NULL` and its override flag intact.

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
A block may be launched more than once over its life (12/20 then abandoned → `Continue` starts a second session); at most one **live** session at a time (INV-08-18, §15.1). Used for `Resume`/`Continue` and `calendar_launch_rate` only. Never for progress.

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
A replayed key returns the stored response and writes nothing. Retired when Doc 01A Part IV `IdempotencyService` ships (G-08-04); the client contract does not change.

### 7.9 `calendar_runtime_config` and `calendar_runtime_config_history`
Shape identical to `practice_runtime_config` (Doc 01A Part I doctrine; prod columns verified: `key, value jsonb, value_type, min_value, max_value, allowed_values, owner, description, environment, updated_at, updated_by_profile_id`), with the same history table and change trigger the other `*_runtime_config` tables use. Keys and launch values in §21. Read only through the runtime-config accessor.

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
`REVOKE UPDATE, DELETE` on the five plan/launch tables from `authenticated`, `anon`; RLS with no UPDATE/DELETE policy; the four write RPCs INSERT only. No trigger, no GUC: account deletion cascades through FKs untouched.

### 7.12 Access boundary and RLS
**Client access.** Calendar reads and mutations are available only through authenticated server API routes (§15). `authenticated` and `anon` have no INSERT/UPDATE/DELETE grants on any calendar table and **no EXECUTE grant** on calendar write RPCs (`calendar_persist_version`, `calendar_link_launch`); those are callable only by the trusted server DB role after the route's auth, role and entitlement checks. No raw SELECT surface is exposed to clients: the product read model is the server's.
**RLS** is defense in depth, not the authorization boundary: student-scoped SELECT policies on `student_study_profile`, `calendar_plan_versions` (through a narrowed view excluding `input_snapshot` and `constants_snapshot`), `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches`, and `calendar_current_plan`; no policies of any kind for guardians (§16); explicit admin SELECT policies. `calendar_mutation_ledger`, `calendar_job_runs`, and the config tables have no client policies at all.

---

## 8. Student Inputs and Derivations

### 8.1 Setup
| Field | Type | Bounds | Stored |
|---|---|---|---|
| Timezone | auto-captured, editable | `pg_timezone_names` | `timezone` |
| Target exam date | date or "not yet" | ≥ local today … +`target_exam_date_max_days` | `target_exam_date` |
| Target score | integer step 10, required | 400–1600 | `target_score` |
| Study days | weekday chips, ≥1 | — | `study_days_mask` |
| Time per day | chips from `daily_minutes_presets` | `daily_minutes_min … max` | `daily_minutes` |
| Full-length test day | weekday chip or "I'll add them myself" | — | `full_length_weekday` (R-08-27) |

### 8.2 Local dates
`today` is in `profile.timezone`. Every planned date carries the timezone in force when it was planned (`calendar_plan_dates.timezone`); the allocator converts engine UTC timestamps with **that date's own timezone**, never today's profile value, so a later timezone change cannot move historical activity between days. Changing the profile timezone regenerates future unlocked dates (which take the new zone); history is untouched.

### 8.3 Minutes are the planning currency
The generator budgets **minutes** (R-08-03: student states time). Each adapter converts minutes ↔ its own unit; blocks store units. Nothing stores minutes; the UI derives "~30 min" via the adapter.

---

## 9. Engine Adapters — Planning, Launch, Progress

### 9.1 Adapter contract (INV-08-02, R-08-15)
```ts
type CalendarEngineAdapter = {
  engine: "practice" | "review" | "full_length";
  allowedPlanSizes(ctx): number[];                 // sizes the generator/editor may use, in the engine's unit
  estimateSeconds(size: number): number;           // for budgeting and "~N min" display
  create(block, size: number, ctx: { client_instance_id; platform; idempotency_key }): Promise<{ session_id: string; next: string }>;   // size = this launch's size, not the block target
  activityUnits(student_id, localDate, tz): Promise<ActivityUnit[]>;     // atomic units for the allocator (§13); the engine owner defines each unit's local-date rule
  nextLaunchSize(block, remaining: number): number;                     // a size the engine's create contract accepts for the remaining work
  progress(session_id): Promise<{ lifecycle: "active"|"completed"|"abandoned"; presentation?: { label: string; ratio?: number } }>;  // for Resume / exam UI
  scopeOf(block): EngineScope;                     // what the allocator matches units against
  matches(unit: ActivityUnit, scope: EngineScope): boolean;   // engine-owned scope compatibility
  editorFields(): EditorField[];                   // engine-specific day-editor controls (§17.2)
};
type ActivityUnit = { engine: "practice"|"review"|"full_length"; unit_id: string;     // identity = (engine, unit_id)
                      occurred_at: string; local_date: string;
                      section?: "M"|"RW"; domain?: string; skills: string[]; form_id?: string };
```
A contract test per engine plants each method. `enabled_block_types` may not name an engine without a passing test.

### 9.2 Practice adapter
- `allowedPlanSizes` → `practice_runtime_config.session_presets`, ceiling `max_session_count_premium`.
- `estimateSeconds(n)` → `n × target_seconds_per_question`.
- `create(block, size)` → `practice-canonical.ts` create: `mode='structured'`, `filters={section, domain, skill_codes?}`, `target_count = size`, `platform`, `client_instance_id`, and `ctx.idempotency_key` forwarded unchanged (SCL-08-D: session-create idempotency by key). Adapters never construct the key; `CalendarLaunchService` is its sole owner (§15.1).
- `activityUnits(date)` → one unit per `practice_session_items` row with `answered_at IS NOT NULL` and `(answered_at AT TIME ZONE $tz)::date = $date`, carrying `question_section`, `question_domain`, and `skills = question_skill IS NULL ? [] : [question_skill]` (Doc 02B items carry one skill). The answered-item date is Doc 02B's canonical practice truth.
- `matches(unit, scope)` → `unit.engine = 'practice'`, section and domain equal; if `scope.skill_codes` is set, `unit.skills ∩ scope.skill_codes ≠ ∅`.
- `nextLaunchSize(block, remaining)` → smallest preset ≥ `remaining`, capped at `max_session_count_premium` (Practice's create contract decides valid sizes, not the calendar).
- `editorFields` → Section, Domain, Skill (optional), Questions.

### 9.3 Review adapter
- `allowedPlanSizes` → `1 … min(due_through_date, review_block_max)` (review has no presets; Doc 02B §16 is queue-based).
- `estimateSeconds(n)` → `n × review_estimated_seconds_per_item` (calendar-owned until Doc 02B claims it — SCL-08-F).
- `create(block, size)` → review session create with `source_origin='calendar'`, `client_instance_id`, `ctx.idempotency_key` forwarded unchanged (SCL-08-B); the review surface shows "Clear N due" from the block.
- `activityUnits(date)` → one unit per finalized `review_session_items` row on the local date, using the exact canonical Review activity timestamp and ownership join verified under G-08-03 (Doc 08 does not invent the column). `matches` → `unit.engine = 'review'`. `nextLaunchSize` → `remaining`; the review surface shows "Clear N due" with `N = size`. No terminal state needed.
- `editorFields` → Items to clear.

### 9.4 Full-length adapter (FORWARD_REF, G-08-02)
- `allowedPlanSizes` → `[1]`.
- `estimateSeconds` → `rw_section_duration_seconds + math_section_duration_seconds + break_duration_seconds` (Doc 02B §41 / Doc 04A).
- `create(block, size)` → Doc 04A create with `form_id` or Doc 04 rotation, `client_instance_id`, `ctx.idempotency_key` forwarded unchanged.
- `activityUnits(date)` → one unit per exam Doc 04A reports as complete **on that local date under Doc 04's own activity-date rule** (a cross-midnight exam's day is Doc 04's decision), carrying `form_id`. `matches(unit, scope)` → `unit.engine = 'full_length'` and (`scope.form_id IS NULL` or `unit.form_id = scope.form_id`). `nextLaunchSize` → 1.
- `progress` → Doc 04's own presentation ("Module 2 of 4", ratio) — the calendar renders it, never computes it.
- `editorFields` → Date only.

---

## 10. Generator Contract and Validator

### 10.1 Input snapshot (canonical, sorted keys, hashed)
```ts
type PlanInput = {
  student_id: string;
  generated_for: { dates: string[] };
  profile: { timezone; target_exam_date; target_score; study_days_mask; daily_minutes; full_length_weekday; planner_mode };
  mastery: Array<{ section; domain; mastery_level: 1|2|3|4|5|null }>;          // 8 rows
  domain_importance: Record<string, number> | null;                              // §4 seam; null → equal
  review_due_by_date: Array<{ date: string; due_count: number }>;               // from review_schedule, local dates
  exams: { last_completed_local_date: string | null; weak_domains_from_last_exam: string[];
           cadence_anchor_date: string | null };   // first `full_length_weekday` on/after the local date of setup_completed_at; null when no weekday is set
  started_blocks_by_date: Record<string, Array<{ block_id: string; display_ordinal: number }>>;   // must be carried (V-12)
  enabled_block_types: string[];
  engine_planning: {                                                             // every resolved foreign value, snapshotted by the builder
    practice: { allowed_sizes: number[]; seconds_per_unit: number; max_size: number };
    review:   { max_size: number; seconds_per_unit: number };
    full_length: { estimated_seconds: number };
  };
  constants: Record<string, unknown>;                                            // calendar_runtime_config snapshot
};
```
The **builder** reads canonical owners (practice/review/exam configs, adapters, mastery, review schedule) immediately before generation and freezes them here. The **generator** reads only `PlanInput` — no config table, no adapter call (INV-08-06). Replaying a stored snapshot months later reproduces the plan even if Practice has since changed `target_seconds_per_question`.

### 10.2 Output shape
```ts
type PlanOutput = {
  generator_version: string;
  dates: Array<{ scheduled_date: string; is_user_override: boolean;
                 members: Array<{ kind: "created"; block: NewBlock; } | { kind: "carried"; block_id: string }> }>;  // display order = array order
};
```

### 10.3 Validator — invoked with a mode
`validatePlan({ mode: 'generated' | 'student_edit' | 'do_it_now' | 'rollback', input, output })`.

| Rule | Mode | Assertion |
|---|---|---|
| V-01 | all | Every date ∈ `generated_for.dates`; none < local today. |
| V-02 | generated | Practice/review created blocks on study days; `full_length` only on `full_length_weekday`. |
| V-03 | all | `block_type` ∈ `enabled_block_types`. |
| V-04 | all | practice: `target_count` ∈ `engine_planning.practice.allowed_sizes`; review: `1 ≤ target_count ≤ engine_planning.review.max_size`; full_length: `target_count = 1`. |
| V-05 | generated | Per date, Σ `target × engine_planning.<engine>.seconds_per_unit` over created practice+review ≤ `daily_minutes × 60`; an exam date carries no other created blocks. **Not applied to student_edit.** |
| V-06 | all | `domain` canonical and matches `section`. |
| V-07 | all | `skill_codes` ⊆ registry for the domain. |
| V-08 | all | Display order contiguous from 1. |
| V-09 | generated | `explanation_key` ∈ §17.6 set. |
| V-10 | all modes creating a review block | `target_count` ≤ canonical review availability for that date (`review_due_by_date` through the date, minus review already planned on earlier dates). Generated plans additionally apply the cumulative horizon reservation. `do_it_now` clamps a copied review target to today's availability rather than copying the missed block's size. |
| V-11 | all | `full_length` created over the horizon ≤ `max_full_length_per_horizon`. |
| V-12 | all incl. rollback | Every id in `started_blocks_by_date[date]` appears as a `carried` member of that date. |
| V-13 | all | Every carried id is an existing block of this student with the same `scheduled_date`. |
| V-14 | generated, do_it_now | Non-student modes never own a date whose current plan-date row has `is_user_override=true`. `do_it_now` carries the date's current override flag unchanged. |

A rejection under `generated` is a bug and pages; the prior plan stands.

---

## 11. `deterministic_v1` — Time-Budgeted Smooth Weighted Allocation

**Status: LOCKED algorithm.** The launch values in §21 are approved initial defaults, tunable only through `calendar_runtime_config` governance (Doc 02B §33 pattern); changing a value is an operational act, changing a step is a change record.

### 11.1 Per-date budget
`B = daily_minutes × 60` seconds.

### 11.2 Review reservation (review enabled)
`due = cumulative review_due_by_date through this date − review already created on earlier horizon dates`. `R = min(due, engine_planning.review.max_size, floor(review_share_max × B / engine_planning.review.seconds_per_unit))`. If `R ≥ 1` create one review block of `R`. `B_rem = B − R × engine_planning.review.seconds_per_unit`. Review first (Doc 02B §16).

### 11.3 Domain weights
`w_d = weight_by_level[L_d] × importance_d`. Launch `weight_by_level = {1:5, 2:4, 3:3, 4:2, 5:1}`; `L_d = NULL` → `null_level_weight` (launch 3 — neutral exploration, R-08-26); all eight NULL → all equal (balanced cold start, `cold_start`). `importance_d` from the §4 seam, else 1. Post-exam: `w_d ×= post_exam_multiplier` for `weak_domains_from_last_exam` within `post_exam_emphasis_days`.

### 11.4 Practice blocks
`Pq = floor(B_rem / engine_planning.practice.seconds_per_unit)` → greedy split over `engine_planning.practice.allowed_sizes` (largest preset ≤ remaining; drop remainder < min preset). Domains dealt by **smooth weighted round-robin** with cursor persisting across the horizon: `current[d] += w_d ∀d; d* = argmax current (ties → canonical_domain_order); current[d*] −= Σw`. `skill_codes` NULL (engine ranks skills, Doc 02B §15).

### 11.5 Full-length placement — precedence
Only if `full_length` enabled and `full_length_weekday` set:
1. **Final rehearsal** — if `target_exam_date` set, reserve the last `full_length_weekday` that is ≥ `final_exam_lead_days` before it (if inside the horizon).
2. **Minimum gap** — no exam within `full_length_min_gap_days` after `exams.last_completed_local_date` or after any exam already placed.
3. **Cadence** — a `full_length_weekday` date `C` is a cadence candidate iff `days_between(cadence_anchor_date, C) mod full_length_interval_days = 0`. The anchor is derived deterministically (first `full_length_weekday` on/after the local date of `setup_completed_at`; re-derived only when the student changes the weekday), so successive weekly regenerations select the same recurrence rather than the first eligible weekday of each new horizon. Place candidates where 2 holds and the date isn't the rehearsal.
4. **Cap** — stop at `max_full_length_per_horizon`.
An exam date gets no other created blocks (its duration exceeds any daily budget by construction).

### 11.6 Explanation keys
`weak_domain`, `maintain_strength`, `cold_start`, `exploring`, `review_due`, `post_exam_focus`, `exam_cadence`, `final_rehearsal`.

---

## 12. Regeneration Lifecycle, Overrides, Block-Level Freeze

### 12.1 Triggers
| Trigger | `initiated_by` | Dates owned | Mode |
|---|---|---|---|
| `setup` | student, on first entitled calendar open after setup completes | horizon | any |
| `profile_change` | student | future, non-overridden | auto (custom: offered) |
| `weekly` | system | future non-overridden dates in the horizon | auto only |
| `student_refresh` | student | future, non-overridden | any |
| `post_exam` | system | future, non-overridden | auto only |
| `day_edit` | student | that date (sets `is_user_override`) | any |
| `day_regenerate` / `day_reset` | student | that date (clears override) | any |
| `do_it_now` | student | today (override flag carried unchanged) | any |
| `rollback` | admin | any future dates; **must carry started blocks** (V-12) | admin |

### 12.2 Protected state
Past dates: never owned, never edited (409). Started blocks: carried on any later version of their date, unchanged. Overridden dates: never owned by non-student versions.

### 12.3 Version allocation (INV-08-17)
`calendar_persist_version` RPC: `SELECT 1 FROM student_study_profile WHERE student_id=$1 FOR UPDATE` → `version_no = COALESCE(MAX,0)+1` → insert version, plan dates, blocks, memberships → commit.

### 12.4 Day edit
Client sends the full desired member list for the date (created specs + carried ids); server injects started blocks if omitted, validates in `student_edit` mode, persists with `is_user_override=true`. No budget check, no warning (R-08-19). Empty list = cleared day, override kept.

### 12.5 Weekly job
Runs every `weekly_job_interval_minutes`. For each `auto` student with active `calendar_access`: generate iff **no accepted horizon-refresh version** — `trigger ∈ {setup, profile_change, weekly, student_refresh, post_exam}` — was created in the student's current local ISO week (Monday-anchored, R-08-30). Day-scoped versions (`day_edit`, `day_regenerate`, `day_reset`, `do_it_now`) never suppress the weekly run. Setup on Wednesday means the first weekly run is the following Monday. "Once per local week," never "at 00:00". Per-student transaction; failures → `calendar_job_runs` + Doc 06C dead-letter; safe to rerun.

### 12.6 "Do it now"
Missed block → `calendar_do_it_now(block_id)`: one version owning today, carrying today's members and override flag, appending one created block with the same scope, `source='student'`, `derived_from_block_id` (a review block's `target_count` is clamped to today's canonical availability, V-10).

### 12.7 Acknowledgement (INV-08-13)
`latest_unacknowledged_nonstudent_change` = highest version with `initiated_by <> 'student'` **and `validator_result='accepted'`** and `version_no > last_acknowledged_nonstudent_version_no`.

---

## 13. Progress Model — The Allocator (R-08-24, R-08-29)

One pure function in `packages/shared/src/calendar/allocate.ts`, run at read time:

```
units  = ∪ adapter.activityUnits(student, D, tz = calendar_plan_dates.timezone of the owning version for D) over enabled engines,
         identity (engine, unit_id); sorted by (occurred_at, engine, unit_id)   -- immutable engine facts
blocks = current members of D in display order
for b in blocks:
    need = b.target_count
    for u in units (unconsumed, u.engine = engineOf(b), adapter.matches(u, scopeOf(b))):
        consume u → b; need −= 1; stop when need = 0
actual(b) = units consumed by b
extra(D)  = unconsumed units, grouped by (engine, section, domain)
```

```
progress(b) = actual(b) / target(b)
status(b)   = completed   if actual = target
            | partial     if 0 < actual < target
            | in_progress if a launch exists whose adapter.progress().lifecycle = 'active' and actual = 0
            | missed      if D < today and actual = 0
            | scheduled   otherwise
```

Properties: inputs are immutable plan rows and finalized engine outcome columns (INV-08-08); each unit is consumed once (INV-08-21), so overlapping scopes cannot inflate progress — ALG-20 followed by ALG/LIN-10 against 20 Algebra items yields 20/20 and 0/10, and the reverse order yields 10/10 and 10/20; two 10s satisfy a 20; a 20 satisfies two 10s; 30 against 20 = 20/20 + 10 extra; midnight splits by item date; review needs no lifecycle; a full-length counts 1 on the date Doc 04 assigns it. Display order is the only tiebreak and it is stored, so the result is a deterministic function of stored facts.

## 14. Derived State — Day, Extra Work, Streak, Facts

| Derived | Rule |
|---|---|
| `day.blocks[]` | current members in display order with `target`, `actual`, `progress`, `status`, adapter presentation (e.g. "Module 2 of 4"). |
| `day.extra_work[]` | `{engine, section?, domain?, count}` per §13 extra. |
| `day.status` | `rest` (non-study day, no blocks, no activity) · `complete` (all blocks completed) · `partial` (any progress) · `missed` (past, none) · `today` · `upcoming`; a rest day with activity shows its extra work. |
| **Facts** (R-08-28, no percentage) | per range: blocks completed / partial / missed; questions completed (practice+review, from the counter); full-length tests completed; extra questions. Same facts for guardian. |
| `streak` (R-08-25 B, INV-08-20) | Platform-wide. `active_day(D)` = any engine has ≥1 activity unit on `D`. Counting back from today: today is neutral until active. **Skip rule (operational form of R-08-25):** `D` is skipped (neither counts nor breaks) iff the student held `calendar_access` on `D` **and** their study-day schedule in force on `D` marks it a non-study day. Tier-on-date comes from Doc 01's entitlement-history surface (SCL-08-E; until it exists G-08-11 withholds `longest`); schedule-on-date is the `study_days_mask` in the `input_snapshot` of the plan version that owned `D`, else the profile's mask if setup was complete on `D`, else no skip. Free-on-`D` days always count. **Activity-day timezone for the streak** is platform-wide and tier-independent: `student_study_profile.timezone` where a profile exists, otherwise the student-local timezone Doc 01 records at signup (SCL-08-H); never a Chicago fallback. Until SCL-08-H lands, G-08-12 applies. `current` and `longest` (365-day window). Pure math `computeActivityStreak(input)` in `packages/shared/src/streak.ts`; IO in `server/services/activity-streak.ts` (`getStudentActivityStreak(student_id)`), exposed as `GET /api/me/streak` **without** `calendar_access`; rendered in the calendar header and the practice page (SCL-08-E). |
| `calendar_launch_rate` (Doc 07 only) | blocks with a launch row ÷ blocks. Never on a surface. (Renamed from `adherence`.) |

Rings (post-launch, R-08-28): each ring is a daily target vs the same counter — questions vs `Σ target`, minutes vs `daily_minutes` via `estimateSeconds`, review vs due. No schema change needed.

---

## 15. API Surface

Calendar handlers: auth → role → `canAccessFeature('calendar_access')` → Zod → domain → serialize. Streak handler: auth → student role → Zod → activity-streak service → serialize (no entitlement check). All workflow lives in application services (`server/services/calendar/*`); handlers delegate and never own logic; the DB never calls an engine.

| Method + path | Role | Body | Returns | Idempotency |
|---|---|---|---|---|
| GET `/api/calendar` | student | `?from&to` (local, default today…+13) | `{ profile, days[], facts, streak, latest_unacknowledged_nonstudent_change, diagnostic_state, projection?, device_timezone_mismatch? }` | — |
| PUT `/api/calendar/profile` | student | fields + key | `{ profile, version_no? }` | key |
| POST `/api/calendar/plan/regenerate` | student | key | `{ version_no }` | key + rate limit |
| POST `/api/calendar/days/:date/regenerate` · `/reset` | student | key | `{ version_no }` | key + rate limit |
| PUT `/api/calendar/days/:date` | student | `{ members[], idempotency_key }` | `{ version_no, day }` | key |
| POST `/api/calendar/blocks/:id/launch` | student | `{ client_instance_id, platform }` | `{ engine, session_id, next, resumed }` | engine key (§15.1) |
| POST `/api/calendar/blocks/:id/do-it-now` | student | key | `{ version_no, block }` | key |
| POST `/api/calendar/acknowledge` | student | `{ version_no }` | `{ ok }` | monotonic |
| GET `/api/me/streak` | student (any tier) | — | `{ current: number | null; longest: number | null; history_complete: boolean }` — `longest` is `null` until G-08-11 clears; `current` is `null` for students with no timezone source until G-08-12 clears; `history_complete=false` while either gate is open; same shape wherever streak is embedded — **no `calendar_access` check** (INV-08-20) | — |
| GET `/api/guardian/students/:id/calendar` | guardian | `?from&to` | `{ days[], facts, streak }` — no profile, controls, or explanation copy | — |

### 15.1 Launch — `CalendarLaunchService.launch(block_id, ctx)` (INV-08-18)
Handler does auth, entitlement, parse, then delegates. The service: 1. load block; 409 unless `scheduled_date = local today` (past → `Do it now`; future → view-only; studying ahead happens directly in the engines and shows as today's actual/extra work); 3. load the block's latest launch (highest `launch_sequence`); if `adapter.progress(session).lifecycle = 'active'` → return it, `resumed=true`; 4. `remaining = target − actual` from the allocator; if `remaining = 0` → 409 `already_complete`; `size = adapter.nextLaunchSize(block, remaining)`; `seq = last_sequence + 1`; `adapter.create(block, size, { client_instance_id, platform, idempotency_key: 'calendar:block:<block_id>:<seq>' })` — the engine returns the existing session for a repeated key; 5. `calendar_link_launch(block_id, seq, engine, session_id)` RPC (INSERT; PK `(block_id, launch_sequence)` — on conflict return the existing row); 6. return. A crash between 4 and 5 is healed by the retry using the same `seq` and key. Two concurrent first launches compute the same `seq` and key → one engine session (INV-08-18).

Errors: 400 · 401 · 402 (shared CTA payload) · 403 guardian gate · 404 · 409 past date / editing a started block · 429 · 500 (ERROR log, correlation id).

---

## 16. Entitlement, Roles, Guardian Read

The route is the authority (INV-08-11); RLS is defense in depth . Student premium: full surface; free: 402 CTA; lapse: 402, rows retained. Guardian: server route only, `guardian_links.status='active' ∧ entitlement_active(student)` via Doc 01's check, service-role read, sanitized read model (no profile, no target score — R-08-22, no explanation copy, no controls); no guardian grants on calendar tables (INV-08-12). Admin: explicit read; rollback via the persist RPC with V-12 enforced.

---

## 17. UI Contract

Today-first; one primary action per row; no month grid; engine-specific rows and editor forms.

### 17.1 Layout — `/calendar`
1. **Header** — streak (platform-wide), "SAT in 41 days" / "Add a date", target score with Doc 05C projection when present (student only), settings.
2. **Recommendation card** (when diagnostic not `baseline_ready`) — "Recommended first: complete your diagnostic" with one button. **The plan beneath stays fully active**.
3. **Today card** — rows by engine: practice "Algebra · 20 questions · ~30 min · 12 / 20"; review "Review · 7 due items · 3 / 7"; full-length "Full-length SAT · Module 2 of 4". One button each: `Start` / `Resume` / `Done ✓`. Rest day: "Rest day — next study day Thursday" + `Study anyway`. **Extra work** list beneath when present.
4. **Week strip + day list** — 14 chips with per-block status dots; tap to expand; past days read-only, `Missed` rows offer `Do it now`, partial rows show counts; future days show blocks without launch buttons.
5. **Facts strip** (bottom, 14-day) — "7 of 9 blocks complete · 1 partial · 1 missed · 74 questions · 1 full test · 18 extra".

### 17.2 Day editor — engine-specific forms
Row per member. Practice: Section, Domain, Skill (optional), Questions (presets, "~N min"). Review: Items to clear (1…due). Full-length: date only (form assigned by Doc 04). Started members locked with a glyph. `Add` chooses the engine first. Footer: `Save day` / `Regenerate day` / `Reset to auto`. Planned-time readout, no warning, no disable.

### 17.3 Settings sheet
Timezone (detected; `Change`), exam date, target score, study days, time per day, full-length test day, `Auto plan` toggle, `Refresh plan`. If `device_timezone_mismatch` is set: "Your device is now on America/New_York. Update your study calendar timezone?" — student chooses; never silent.

### 17.4 Plan-updated banner (INV-08-13)
Shown when `latest_unacknowledged_nonstudent_change` is non-null: "Your plan was refreshed for the week" / "…after your exam" / "…was restored by support" (trigger → copy map). Dismiss acknowledges that `version_no`.

### 17.5 States
Loading (skeleton of the regions); pre-setup (setup sheet opens over a greyed sample week labelled "Preview"); 402 (premium CTA component in the Today slot); error (inline retry, never a blank page); rest day; all-done ("That's today — nice." with next study day); past day (read-only); timezone mismatch (settings prompt, §17.3).

### 17.6 "Why this block" copy (student only)
Info icon per block; copy keyed by `explanation_key`:

| key | copy |
|---|---|
| `weak_domain` | "One of your weaker areas right now." |
| `maintain_strength` | "You're strong here — a short set keeps it sharp." |
| `exploring` | "We haven't seen enough of this yet — a short set tells us more." |
| `cold_start` | "We're still learning where you stand — this balances the sections." |
| `review_due` | "Questions you missed earlier are due for a retry." |
| `post_exam_focus` | "Your last exam pointed here." |
| `exam_cadence` | "A full-length every two weeks keeps you test-ready." |
| `final_rehearsal` | "Your last full rehearsal before test day." |

Guardian view renders no info icons.

### 17.7 Interaction rules
- `Start`/`Continue`/`Resume` disable until navigation; the service's idempotency handles double-taps.
- Server state via TanStack Query; refetch on route focus; no polling; local UI state only for sheet open/closed and selected chip.
- No `window.prompt`, no raw `fetch` in components, no derived state in `useEffect` (Coding Standards §11).
- Mobile-first at 390px; sheets not modals; the Today card and week strip fit one viewport.
- Components: `CalendarPage`, `CalendarHeader`, `RecommendationCard`, `TodayCard`, `BlockRow` (practice/review/full-length variants), `ExtraWorkList`, `WeekStrip`, `DayChip`, `DayList`, `DayEditorSheet` (engine-specific forms), `SettingsSheet`, `PlanUpdatedBanner`, `FactsStrip`, `DoItNowButton`, `PremiumGate` (existing). Hooks: `useCalendar`, `useLaunchBlock`, `useEditDay`, `useRegenerate`, `useStudyProfile`, `useDoItNow`, `useStreak`. Domain logic imported from `packages/shared/src/calendar/`, never inlined.

---

## 18. Observability, Events, Failure Modes

Events (Doc 01A Part II conventions): `calendar.setup_completed`, `calendar.plan_generated {trigger, initiated_by, validator_result, created_count, carried_count}`, `calendar.plan_rejected {rule_ids}`, `calendar.day_edited`, `calendar.day_reset`, `calendar.block_launched {engine, resumed}`, `calendar.do_it_now`, `calendar.plan_acknowledged`, `calendar.timezone_changed`, `calendar.job_run {job, outcome}`. Never logged: scope beyond type, target score, timezone, bodies. Metrics: generation latency; `generated`-mode rejections (alert > 0); job outcomes (06C); launch rate per engine.

| Failure | Handling |
|---|---|
| Engine create fails | No link; 502 retry; block `scheduled`. |
| Created but link failed | Retry → same engine key → same session → link. |
| Two tabs launch | Both compute the same `launch_sequence` and engine key; the engine returns one session; `PK(block_id, launch_sequence)` + `UNIQUE(engine, engine_session_id)` admit one link; the second caller gets `resumed=true`. |
| Job vs student edit | Row lock; V-12 keeps started blocks; higher version wins. |
| `generated` rejection | Page; prior plan stands. |
| Late engine write | Counter reflects it on next read; nothing to repair. |
| Timezone change | Future dates regenerate; past untouched; prompt, never silent. |
| Entitlement lapse / link revoked | 402 / 403; nothing deleted. |
| Missing config | Loud failure at accessor. |
| Account deletion | FK cascade; no trigger in the way. |

---

## 19. Testing, CI Gates, Plants

| Area | Tests |
|---|---|
| Anti-leak | Response schema tests on every route: no `question_*`, no answers, no explanations (INV-08-10). |
| Entitlement | Free student 402; lapsed 402; guardian no-link 403; guardian link-but-student-free 403; admin read ok (INV-08-11). |
| Guardian | No guardian mutation route exists (inventory test); guardian role SELECT on calendar tables returns zero rows (INV-08-12). |
| Views | `security_invoker` catalog check; cross-student zero rows. |
| Immutability | UPDATE/DELETE rejected by grant and RLS; RPC inventory INSERT-only; deletion cascade succeeds. |
| Idempotency / concurrency | Route replays; version allocation two-txn; launch race → one session. |
| Override / freeze | Non-student version never owns an overridden date; V-12 rejects a version dropping a started block; cleared day keeps override. |
| Generator | 50-snapshot parity; SWRR fixture §22.1; cold start; mixed-NULL neutral weight; exam precedence fixture (rehearsal vs cadence vs gap); cadence stability fixture: two consecutive weekly regenerations select the same exam dates. |
| Validator | One test per rule × applicable modes; V-02/V-05 asserted not to fire in `student_edit`. |
| Adapters | Contract test per engine; `activityUnits` fixtures: midnight split (LA), skill-scoped, two 10s vs one 20, 30 vs 20. |
| Allocator | Overlapping scopes conserve units (INV-08-21) in both orders; same-scope allocation in display order; extra work off-scope; determinism across two reads. |
| Launch continuation | Abandoned 12/20 → `Continue` creates session 2 with `nextLaunchSize`; live session → `Resume`; complete block → 409. |
| Ownership FKs | Mismatched `student_id` rejected on dates, blocks, memberships, launches (INV-08-22). |
| Weekly freshness | Setup Wed → no weekly until Mon; `day_edit`/`do_it_now` Mon → weekly still runs; `student_refresh`/`profile_change` Tue → no second weekly that week. |
| Streak | `computeActivityStreak` pure fixtures: free day counts; premium rest day skipped; schedule and timezone from the owning version's plan date, not the current profile; today neutral. Service test: `GET /api/me/streak` has no entitlement gate; `current: null` for a student with no timezone source. |
| Constants / timezone | Literal gates; two-zone derivations. |
| UI | Engine-specific rows and editor forms; started row locked; no Save disable; recommendation card doesn't dim plan; banner logic; `Do it now` only on missed. |
| CI | Postgres suites exit 1 on `skipped`. |

---

## 20. Forward References, Deploy Gates, Audit Rule

| ID | Gate | Clears when |
|---|---|---|
| G-08-01 | Practice create honours structured filters, `target_count`, and an opaque idempotency key (SCL-08-D) | CC verifies at brief time |
| G-08-02 | Doc 04A tables, create route, terminal states, progress presentation in prod | Doc 04 wave |
| G-08-03 | `review_schedule` SM-2 writer live; review create accepts `source_origin='calendar'` + key (SCL-08-B); **exact canonical Review activity timestamp, ownership join, and finalized-unit predicate verified against the installed schema** — the adapter consumes that field, Doc 08 does not name one | Review wave |
| G-08-04 | Doc 01A `IdempotencyService` | ledger retirement |
| G-08-05 | Doc 06C registry entry for the weekly job | 06C runbook |
| G-08-06 | SCL-08-A applied (05D cascade list) | SCL applied |
| G-08-07 | Doc 07 consumes §18 events and `calendar_launch_rate` | Doc 07 |
| G-08-08 | `current_student_id()` / `is_admin()` verified | migration |
| G-08-09 | Production PostgreSQL major version ≥ 15 (`security_invoker`) | verified before migration |
| G-08-10 | Domain importance seam resolved (owned by Doc 05/04B or declared absent) | SCL-08-G ruling |
| G-08-12 | Doc 01 records a student-local timezone for every student at signup (SCL-08-H); until then students without a study profile receive `current: null, history_complete: false` from `/api/me/streak` | SCL-08-H |
| G-08-11 | Doc 01 supplies tier-on-date (entitlement history) for the streak skip rule; until then the streak response carries `longest: null, history_complete: false` and `current` is computed over the trailing window where tier is known | SCL-08-E |

**Audit rule:** any Doc 08 line restating a number or mechanism owned by 01/01A/02B/04/05/06 is a defect; every foreign constant appears only as a reference with its prod value in parentheses.

---

## 21. Runtime Constants Catalog — `calendar_runtime_config`

| Key | Launch | Min | Max | Owner | Use |
|---|---|---|---|---|---|
| `generator` | `deterministic_v1` | — | — | Product | §10 |
| `enabled_block_types` | `["practice","review","full_length"]` | — | — | Product | V-03 (each also gated by contract test) |
| `horizon_days` | 14 | 7 | 28 | Product | §12 |
| `weekly_job_interval_minutes` | 60 | 15 | 360 | Engineering | §12.5 (week anchor is Monday, not configurable — R-08-30) |
| `daily_minutes_min` / `_max` | 15 / 180 | 5 / 60 | 60 / 600 | Product | §8.1 |
| `daily_minutes_presets` | `[15,30,45,60,90,120]` | — | — | Product | §8.1 |
| `target_exam_date_max_days` | 540 | 30 | 730 | Product | §8.1 |
| `review_share_max` | 0.5 | 0 | 1 | Product | §11.2 |
| `review_block_max` | 30 | 1 | 100 | Product | §9.3 |
| `review_estimated_seconds_per_item` | 120 | 30 | 600 | Product | §9.3 (SCL-08-F) |
| `weight_by_level` | `{"1":5,"2":4,"3":3,"4":2,"5":1}` | — | — | Product | §11.3 |
| `null_level_weight` | 3 | 1 | 5 | Product | §11.3 (R-08-26) |
| `post_exam_emphasis_days` / `post_exam_multiplier` | 7 / 2 | 0 / 1 | 30 / 5 | Product | §11.3 |
| `full_length_interval_days` / `_min_gap_days` / `final_exam_lead_days` | 14 / 7 / 7 | 7 / 1 / 3 | 42 / 21 / 21 | Product | §11.5 |
| `max_full_length_per_horizon` | 2 | 0 | 4 | Product | V-11 |
| `canonical_domain_order` | 8 codes (verify vs Doc 05 Parent) | — | — | Product | SWRR ties |

Read, not duplicated: `practice_runtime_config.{session_presets, max_session_count_premium, target_seconds_per_question}`, `exam_runtime_config.{rw_section_duration_seconds, math_section_duration_seconds, break_duration_seconds}`. `quota_reset_timezone` is not read.

---

## 22. Worked Examples

### 22.1 Time budget + SWRR (parity fixture)
Mon–Fri, 45 min (`B=2700s`), review disabled → `Pq = floor(2700/90) = 30` → `[20,10]`. Weights (levels Alg 1, AdvM 2, PSDA 4, GT 5, II 3, CS 2, EOI 3, SEC NULL→3): Alg 5, AdvM 4, PSDA 2, GT 1, II 3, CS 4, EOI 3, SEC 3 (`W=25`). SWRR first 20: computed by the parity fixture from these weights; SEC now `exploring` rather than leading.

### 22.2 Review reservation
Same student, review enabled, 9 due Tuesday: `R = min(9, 30, floor(0.5×2700/120)=11) = 9` → "Review · 9 due · ~18 min"; `B_rem = 2700 − 1080 = 1620` → `Pq = 18` → `[15]` practice.

### 22.3 Counter
Tuesday: ALG 20, CS 10. Student launches ALG (12 answered, abandons) → `12/20 partial`. Later, from the practice page, ALG 10 → ALG actual 22 → `20/20` + extra "+2 Algebra". Then EOI 15 → extra "+15 Expression of Ideas". CS `0/10`. Facts: 1 complete, 1 missed (after the day), 37 questions, 17 extra.

### 22.4 Midnight (LA)
Session starts Sunday 23:50, 8 answered before midnight, 12 after. Sunday counts 8, Monday 12 — by item `answered_at`.

### 22.5 Edit around a started block
Thursday members: [SEC 10 (1), ALG 20 started (2), PSDA 10 (3)]. Edit → new version owns Thursday: [SEC→II 10 created (1), ALG carried (2), PSDA removed]. ALG's position and identity unchanged.

### 22.6 Exam precedence
Exam date 7 Nov, `full_length_weekday=6` (Sat), horizon 26 Oct–8 Nov: rehearsal = Sat 31 Oct (last Saturday ≥ 7 days before 7 Nov); 26 Oct is a Monday, so the first Saturday in the horizon is 31 Oct, which is the rehearsal; the next cadence Saturday (14 Nov) is outside the horizon. One exam placed, `final_rehearsal`.

---

## 23. Open Items and SCLs

1. **SCL-08-A** — Doc 05D §10 cascade list gains, by name: `student_study_profile`, `calendar_plan_versions`, `calendar_plan_dates`, `calendar_blocks`, `calendar_plan_block_memberships`, `calendar_block_launches`, `calendar_mutation_ledger`, `calendar_job_runs`. (`calendar_runtime_config` and its history are not student-owned.) No GUC needed.
2. **SCL-08-B** — Doc 02B review seam: `source_origin='calendar'`, opaque idempotency key on create, "Clear N due" header.
3. **SCL-08-D** — Doc 02B practice session-create accepts an opaque idempotency key.
4. **SCL-08-E** — Platform activity streak: owned by Doc 08 §14, served by `GET /api/me/streak` with no `calendar_access` gate, consumed by the practice page; **asks Doc 01 for a canonical tier-on-date read** so R-08-25's free/premium distinction is evaluated per historical day.
5. **SCL-08-F** — `review_estimated_seconds_per_item`: calendar-owned until Doc 02B claims a review timing constant.
6. **SCL-08-H** — Doc 01 records a student-local IANA timezone for every student at signup (browser-captured, editable) as the platform-wide activity-day timezone; `student_study_profile.timezone` is initialized from it.
7. **SCL-08-G** — Does any locked doc own a per-domain importance/blueprint weight? If Doc 05 Parent's macro-average implies equal domains, declare absent and the seam returns null.
8. Domain codes in `canonical_domain_order` verified at migration.

---

## 24. Change Record

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-09-16 | Locked. Promoted from PDF-07 and revised to owner rulings. |

---

## Appendix A — Future Generator Contract (feature state only)

Feature state only — no columns, no code, no config values ship for this at launch (R-08-21). Interface: `generate(input: PlanInput): PlanOutput`, identical to `deterministic_v1`. A future `llm_v1` implements it, is validated in `generated` mode exactly as `deterministic_v1` is, and falls back to `deterministic_v1` on rejection. Enabling it is a CHECK-constraint widening on `generator` plus whatever audit columns that migration adds, and a `calendar_runtime_config.generator` write. Model stack, cost caps, and orchestration are Doc 03's. Determinism is not required of it; auditability and INV-08-13 are. **Rings (R-08-28):** completion ring = Σ actual / Σ target on blocks; workload ring = Σ `actual × seconds_per_unit` / `daily_minutes×60`; review ring = review actual / due — all from the counter, no schema change.

*End of Doc 08 V1.0 — LOCKED.*
