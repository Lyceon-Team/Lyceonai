# Calendar ← Full-Length: Seam Handoff

**For:** the full-length exam team
**From:** the calendar vertical (Doc 05F)
**Date:** 2026-09-23
**Status:** the calendar side is built and shipped. Nothing below asks you to change the calendar.

Modelled on the review team's own seam handoff, which is the document that made the review
integration a two-day job instead of a two-week one. Same shape: what you must satisfy, what
already works, what does not exist yet, and the single condition that closes the gate.

Every claim carries a `file:line`. Where a thing does not exist, that is stated as plainly as
where it does — an absent dependency discovered during implementation costs more than one
named here.

---

## 1. The §9.1 adapter contract — five methods

`server/services/calendar/adapters/types.ts:83` defines `CalendarEngineAdapter`. Satisfy it and
the calendar will launch, size, date and resume your sessions with no further change.

| method           | signature                                                     | line   | what the calendar does with it                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `engine`         | `CalendarEngine`                                              | `:84`  | Must equal the block type: `"full_length"`.                                                                                                                                                |
| `create`         | `(block, size, ctx) => Promise<EngineCreateResult>`           | `:90`  | One launch of one block. `size` is **THIS launch's** size, not `block.target_count` — for exams they are both 1, but the distinction is the contract's, not a coincidence you may rely on. |
| `activityUnits`  | `(studentId, localDate, timeZone) => Promise<ActivityUnit[]>` | `:125` | The atomic units the §13 allocator consumes. One per completed exam on that student-local date.                                                                                            |
| `resumeHref`     | `(sessionId) => string`                                       | `:152` | The client route that opens ONE session. **Pure and synchronous** — a route, not a lookup.                                                                                                 |
| `progress`       | `(sessionId) => Promise<EngineLifecycle \| null>`             | `:155` | `"active" \| "completed" \| "abandoned" \| null`. Drives Resume and §13's `in_progress`.                                                                                                   |
| `nextLaunchSize` | `(block, remaining) => Promise<number>`                       | `:158` | A size your create contract accepts for the work outstanding. Return `1`.                                                                                                                  |

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

| #       | what                                                                                                                  | where the calendar wants it                                                                                                                                                                 | today                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-1** | **A terminal state.** `progress()` must distinguish `completed` from `abandoned` from still-`active`.                 | `adapters/types.ts:155`; §13 uses it for `in_progress` and the launch service's resume branch uses it to decide whether to hand back a live session (`launch-service.ts:183`).              | **Absent.** Doc 05F §9.4 marks the whole exam create/state/progress surface FORWARD_REF, and `Lyceon_Doc_05F.md:142` says `full_length_exam_sessions` + state machine are **"absent in prod"**. |
| **F-2** | **Per-exam `missed_count` and weak domains**, so an exam-review block can be _sized_ and _aimed_ rather than guessed. | `PlanInput.exams.weak_domains_from_last_exam` and `exams.missed_count/reviewed` — `Lyceon_Doc_05F.md:467-469`, and the change record lists `exams.missed_count/reviewed` as a 1.0 addition. | **Absent.** The field exists in the input type; nothing populates it. Until it does, `exam_review_placeholder` is planned instead of a sized `exam_review` (see §4).                            |
| **F-3** | **An activity surface** carrying `occurred_at` and a `status`, queryable by student and local-date window.            | `activityUnits` (§1.2 above).                                                                                                                                                               | **Absent.** The stub returns `[]`, so an exam block reads `0 / 1` forever and never completes.                                                                                                  |

**F-1 and F-3 are the blocking pair.** Without F-1 a launched exam can never finish; without F-3
it never counts as done. F-2 degrades quality rather than blocking: the calendar already has a
defined behaviour without it.

---

## 4. What the calendar already does for exams — no work required

All of this is live and needs nothing from you. It is listed so you do not rebuild it.

- **Cadence placement.** `calendar_place_full_lengths` (`supabase/migrations/20260917130000_calendar_v1.sql`) places exams from `full_length_every_n_occurrences` and `full_length_min_gap_days`, anchored on `cadence_anchor_date` — the first `full_length_weekday` on or after the local date of `setup_completed_at` (`Lyceon_Doc_05F.md:467`).
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
