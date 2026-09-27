# Calendar ← Full-Length: Seam Handoff

**For:** the full-length exam team
**From:** the calendar vertical (Doc 05F)
**Date:** 2026-09-23 · **revised 2026-09-24** against Doc 05F V1.0 §7.13 and §9.4
**Status:** the calendar side is built and shipped. Nothing below asks you to change the calendar.

Modelled on the review team's own seam handoff, which is the document that made the review
integration a two-day job instead of a two-week one. Same shape: what you must satisfy, what
already works, what does not exist yet, and the single condition that closes the gate.

Every claim carries a `file:line`. Where a thing does not exist, that is stated as plainly as
where it does — an absent dependency discovered during implementation costs more than one
named here.

**Revision of 2026-09-24.** This document was written the same day Doc 05F consolidated to V1.0
and went to press against the draft. §9.4 and §7.13 as locked say three things this document did
not carry, and every one of them is a field or a function you have to write: `form_id` on two
methods, `presentation` on `progress`, and the exam-review seam's scope shape. They are in §1.3
below, and the §1 table now names them. Four `Lyceon_Doc_05F.md:NNN` citations had also drifted
off their lines in the consolidation; they are re-anchored. Nothing about the contract itself
changed — only what this document told you about it.

---

## 1. The §9.1 adapter contract — five methods

`server/services/calendar/adapters/types.ts:83` defines `CalendarEngineAdapter`. Satisfy it and
the calendar will launch, size, date and resume your sessions with no further change.

| method           | signature                                                     | line   | what the calendar does with it                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`         | `CalendarEngine`                                              | `:84`  | Must equal the block type: `"full_length"`.                                                                                                                                                                                                                                                                                                                                                                       |
| `create`         | `(block, size, ctx) => Promise<EngineCreateResult>`           | `:90`  | One launch of one block. `size` is **THIS launch's** size, not `block.target_count` — for exams they are both 1, but the distinction is the contract's, not a coincidence you may rely on. §9.4 fixes what an exam `create` takes: **by `form_id`, or by Doc 04's own rotation, with the idempotency key forwarded** — `block.scope` is `{ form_id: string \| null }` and the null branch is the rotation branch. |
| `activityUnits`  | `(studentId, localDate, timeZone) => Promise<ActivityUnit[]>` | `:125` | The atomic units the §13 allocator consumes. One per completed exam on that student-local date, **carrying its `form_id`** (§9.4).                                                                                                                                                                                                                                                                                |
| `resumeHref`     | `(sessionId) => string`                                       | `:152` | The client route that opens ONE session. **Pure and synchronous** — a route, not a lookup.                                                                                                                                                                                                                                                                                                                        |
| `progress`       | `(sessionId) => Promise<EngineLifecycle \| null>`             | `:155` | `"active" \| "completed" \| "abandoned" \| null`, plus an optional `presentation: { label, ratio? }`. §9.4: the presentation is **Doc 04's own**, "which the calendar renders and never computes" — so whatever an exam's progress reads like on your surfaces is what it reads like on the block card. Drives Resume and §13's `in_progress`.                                                                    |
| `nextLaunchSize` | `(block, remaining) => Promise<number>`                       | `:158` | A size your create contract accepts for the work outstanding. Return `1`. **Note a spec/code divergence, flagged not fixed:** §9.1's type block (`Lyceon_Doc_05F.md:469`) writes this synchronous — `nextLaunchSize(block, remaining: number): number` — where `types.ts:158` returns a `Promise`. Write against the code; both live adapters already do.                                                         |

### 1.1 `resumeHref` is newer than the rest — read this one

Added 2026-09-23 after a production defect. The launch service's resume branch used to build
`/practice/session/<id>` itself, for **every** engine, so a student resuming a live review block
landed on practice's page carrying a review session id (a 404). The fix removed the service's
ability to know a path at all: it now asks the adapter on both branches
(`server/services/calendar/launch-service.ts:195` for resume, `:272` for create).

**What this means for you:** you cannot get the destination wrong by forgetting something. You
either supply `resumeHref` or you do not compile. But you must make it agree with the `next` your
own `create` returns — both contract test files assert `create`'s `next` **is**
`resumeHref(session_id)`, the same function rather than two strings that happen to match
(`tests/ci/calendar.launch-contract.practice.ci.test.ts`, `…review.test.ts`).

The current stub **throws** from `resumeHref` (`adapters/stub.ts:69-81`), deliberately: an engine
with no sessions has no session route, and returning the landing page `/full-test` would be a
route that does not open the session — the exact lie the method exists to prevent. Replace the
throw with your real route when `create` starts succeeding.

### 1.2 `activityUnits` — the timestamp rule is not negotiable

`adapters/types.ts:125-148`. Both live engines window and date activity on the **`occurred_at`
column**, never on an `answered_at`-style column, because both item tables CHECK it:

```sql
CHECK (status <> ALL (ARRAY['answered','skipped']) OR occurred_at IS NOT NULL)
```

Owner ruling 2026-09-22, recorded as addendum item 34. Whatever your completion table is, the
calendar needs a column the schema **guarantees** on every row this contract can return. A
nullable column that today's writers happen to always populate is not that, and a row that
lands without it drops out of the window in silence and is reported to the student as "you did
nothing today".

Doc 05F §9.4 additionally says a cross-midnight exam's activity date is **Doc 04's decision**,
not the calendar's. Tell us which date you report and we will use it; do not expect the calendar
to re-derive it.

---

### 1.3 What Doc 05F §9.4 fixes that the contract type alone does not say

`Lyceon_Doc_05F.md:504-506` is eight lines and three of them are requirements on you. Read it
next to `types.ts`; the type says what compiles, §9.4 says what is correct.

- **`form_id` travels on both ends.** `create` is "by `form_id` or Doc 04 rotation with the key
  forwarded", and `activityUnits` returns "one unit per exam Doc 04 reports complete on that
  local date … **carrying `form_id`**". The calendar already stores the block-side half: a
  full-length block's `scope` is `{ "form_id": string | null }`, and the CHECK requires the KEY to
  be present while allowing the VALUE to be JSON null — `scope ?& ARRAY['form_id']`, exactly one
  key (`packages/shared/src/calendar/scope.ts:259-265`; §7.4's column comment,
  `20260917130000_calendar_v1.sql:315`, carries the same). So `null` is a value that means
  rotation, not a field somebody forgot.
  **The matcher is already written, so this is not a future requirement — it is a live one.**
  `packages/shared/src/calendar/allocate.ts:182-183`: "§9.4: a null `form_id` means Doc 04
  rotation picked the form, so any exam counts", over the predicate
  `block.scope.form_id === null || unit.form_id === block.scope.form_id`.
  An `ActivityUnit` whose `form_id` does not match a form-pinned block is attributed to no block;
  one that arrives `undefined` matches nothing but a null scope.
- **The cross-midnight rule is Doc 04's, explicitly.** "one unit per exam Doc 04 reports complete
  on that local date **under Doc 04's own activity-date rule**". The calendar does not re-derive
  it and will not second-guess it — see §1.2.
- **The exam-review seam has a shape, and it is already the review block's.** §9.4 names it:
  `{"mode":"session","source_engine":"full_length","source_session_id"}` as the `scope` of a
  review block, "plus a per-exam missed count and weak-domain list for sizing and emphasis". That
  is F-2 below, stated as data rather than as a gap. The review scope schema is a discriminated
  union on `mode`, and the `session` arm is the one that exists for you.
- **The stub's exact behaviour is now spec, not just code.** §9.4 restates the fail-open shape
  (`create` returns `{ok:false, reason:'engine_unavailable'}` as data, `activityUnits` `[]`,
  `progress` `null`, control says "Coming soon" and never calls launch) and the builder's
  `full_length_weekday` nulling. Both are in §2 and §4 below. They were migration facts when this
  document was written; they are contract now, which means changing them is a spec change.

## 2. The stub you are replacing, and the test that must not change

**The stub:** `server/services/calendar/adapters/stub.ts:104` —
`export const fullLengthAdapter = makeUnavailableAdapter("full_length")`. It fails **open**:
`create` returns `{ok:false, reason:"engine_unavailable"}` as DATA (`:55`), never a throw, so the
calendar still renders a plan containing exam blocks while the engine does not exist. `progress`
returns `null` (`:86`) so a block never reads as in-progress, and `activityUnits` returns `[]`.

**The test:** `tests/ci/calendar.launch-contract.full_length.test.ts:52`, eight cases.

> **This file must pass unchanged once `create` succeeds — with one edit and one only:** case
> (2) at `:58` asserts `create` declines. Invert that assertion. Every other case states
> something that is true of a real engine too, and the review team's equivalent file is the
> precedent: when review shipped, the stub half was deleted and the five contract items were
> asserted against the real adapter with `create` succeeding, and nothing else in the file moved
> (`calendar.launch-contract.review.test.ts:10-13` records exactly that).

Add, to match what review now carries: the create/resume landing assertions via
`tests/helpers/launch-landing.ts`, PG-backed and behind `scripts/ci/vitest-summary-gate.mjs` so a
skipped half cannot read green.

---

## 3. What the calendar needs from exams and does NOT have

These are the gaps. None is a calendar defect; each is something the exam engine must expose.

| #       | what                                                                                                                  | where the calendar wants it                                                                                                                                                                                                                                                                             | today                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-1** | **A terminal state.** `progress()` must distinguish `completed` from `abandoned` from still-`active`.                 | `adapters/types.ts:155`; §13 uses it for `in_progress` and the launch service's resume branch uses it to decide whether to hand back a live session (`launch-service.ts:183`).                                                                                                                          | **Absent.** Doc 05F §9.4 marks the whole exam create/state/progress surface FORWARD_REF, and `Lyceon_Doc_05F.md:147` — the §4 seam row — says the exam session tables, terminal states and Doc 04 progress presentation are **"FORWARD_REF, absent in prod"**. |
| **F-2** | **Per-exam `missed_count` and weak domains**, so an exam-review block can be _sized_ and _aimed_ rather than guessed. | `PlanInput.exams` — `Lyceon_Doc_05F.md:521`, whose five fields are `last_completed_local_date`, `days_since_exam`, `missed_count`, `reviewed`, `weak_domains[]`. (V1.0 renamed the last one: it is `weak_domains[]`, **not** `weak_domains_from_last_exam`.) §9.4 pairs it with the seam scope of §1.3. | **Absent.** The field exists in the input type; nothing populates it. Until it does, `exam_review_placeholder` is planned instead of a sized `exam_review` (see §4).                                                                                           |
| **F-3** | **An activity surface** carrying `occurred_at` and a `status`, queryable by student and local-date window.            | `activityUnits` (§1.2 above).                                                                                                                                                                                                                                                                           | **Absent.** The stub returns `[]`, so an exam block reads `0 / 1` forever and never completes.                                                                                                                                                                 |

**F-1 and F-3 are the blocking pair.** Without F-1 a launched exam can never finish; without F-3
it never counts as done. F-2 degrades quality rather than blocking: the calendar already has a
defined behaviour without it.

---

## 4. What the calendar already does for exams — no work required

All of this is live and needs nothing from you. It is listed so you do not rebuild it.

- **Cadence placement.** `calendar_place_full_lengths` (`supabase/migrations/20260917130000_calendar_v1.sql`) places exams from `full_length_every_n_occurrences` and `full_length_min_gap_days`, anchored on the first `full_length_weekday` on or after the local date of `setup_completed_at` (`Doc_05F_formula_sheet.md:29`, step 2 clause (4); `cadence_anchor_date` is the migration's name for it and appears in no locked document). §7.13 lists the function as **`pure, IMMUTABLE` — "Exam placement, shared by both generators so the precedence rules have one implementation"**, so `deterministic_v1` and `fallback_v1` cannot disagree about where an exam goes, and any change to placement is one function.
- **Lead window.** `final_exam_lead_days` and `max_full_length_per_horizon` bound how close to the target exam date a full-length may sit, and how many fit in one 14-day horizon. Both are `calendar_runtime_config` rows, gate C-01.
- **Taper.** `taper_days` and `taper_ratio_bp` lighten the days before the real test so the student arrives rested. Live, config-driven.
- **Exam review on the next study day.** An exam day holds nothing else, and the day after carries a review of what was missed. With F-2 absent this is planned as `exam_review_placeholder`, whose §17.6 copy is honest about it — "Going over what you missed on your last practice test" — rather than claiming a precision the calendar does not have. Copy is ruled in addendum item 16R.
- **The builder nulls `full_length_weekday` while the flag is off.** `20260925000000_calendar_input_honours_enabled_types.sql`. This is load-bearing and worth understanding before you flip anything: the generator derives exam dates from that one weekday, so nulling it means no exam date, which means the "an exam day holds nothing else" branch never fires and the `exam_review_placeholder` that branch reserves is never charged to the day's budget. Before this migration, a disabled engine **spent** the day's seconds on a block that was then filtered out of the output — an empty Saturday and a 10-question Monday in production. Addendum item, Brief 6 Step 1.

---

## 5. G-08-02 — the one condition that closes it

`Doc_05F_formula_sheet.md:138` and the change record both state it. The gate closes when **both**
hold, in this order:

1. **`tests/ci/calendar.launch-contract.full_length.test.ts` passes against the REAL engine** —
   not the stub, not a mock — with `create` succeeding, PG-backed, behind
   `vitest-summary-gate.mjs` so a skipped half cannot read as a pass.
2. **`full_length` is added to `enabled_block_types`**, as a **separate migration, authored last**
   and applied by the owner.

**Step 2 is its own migration and its own commit.** Review's flag flip was
`20260928000000_calendar_enable_review_block_type.sql`, the last commit of PR #825, deliberately
separated so the engine work can be reviewed and merged while the flag stays off, and so the flip
can be reverted without reverting the engine. Do the same.

**What the flag physically changes is one function.** §7.13 lists
`calendar_plan_to_output(plan, generator_version, enabled_block_types)` as "Generator days → §10.2
`PlanOutput`, **filtered to enabled engines**". The generator still places your exams either way;
that filter is what drops them before they are written. Validator rule V-03 (`block_type ∈
enabled_block_types`) is the second half — it runs in every mode, so a hand-edited day naming
`full_length` is refused for the same reason until the flip. Between them, nothing else in the
plan path branches on the flag, and that is why the flip is safely its own migration.

**Every generator function is integer-only** (§7.13's closing line): ratios are basis points and
there is no float in the formula path, so PL/pgSQL truncation and the oracle's floor division
agree. If your integration adds a `calendar_runtime_config` constant, it is an integer or a
basis-point integer — never a numeric.

The current value is `["practice","review"]`. `full_length` is absent **because its adapter is a
stub** — the launch control reads "Coming soon", is disabled, and never calls launch, because
asking and being refused is a worse experience than a control that tells the truth
(`client/src/features/calendar/api/launch.ts`, `isLaunchable`).

---

## 6. Two things that will bite you, from the review integration

Both cost real time on the review vertical. Neither is obvious from the contract.

1. **A `timestamptz` is a `string` over PostgREST and a `Date` over node-postgres.** Review's
   adapter copied practice's `typeof !== "string"` guard, which silently dropped **every** row
   when the transport changed and reported it as "the student did nothing today". Narrow the
   boundary with `toIsoTimestamp` (`server/services/calendar/adapters/local-day.ts`) rather than a
   `typeof` check. This was found only because the contract test ran against a real database.

2. **A CI step that runs your contract test without a PG service container will skip the real
   half and exit 0.** Review's step did exactly that for weeks: 9 passed, 6 skipped, green from
   the outside, and every claim the real half existed to prove was unproven. Give your step the
   `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` env **and** the summary gate; `set -euo pipefail` so
   the gate's exit code is the step's.

---

## 7. Where to look first

```
server/services/calendar/adapters/types.ts        the contract, with the reasoning inline
server/services/calendar/adapters/review.ts       the closest working example — read this one
server/services/calendar/adapters/stub.ts:104     what you are replacing
server/services/calendar/launch-service.ts        §15.1: who calls you, in what order, and why
tests/ci/calendar.launch-contract.full_length.test.ts   the test that must pass
tests/helpers/launch-landing.ts                   the landing assertions to add
docs/plans/Doc_05F_Change_Record_Addendum.md      every owner ruling since 1.0, items 1-38
```

Read `adapters/review.ts` before writing anything. It is the second engine to satisfy this
contract, so it is the one whose shape is a template rather than an accident — practice predates
the contract and carries decisions the contract later generalised.
