# Lyceon — Review Vertical: Ruled Plan

**Date:** 2026-09-21 (last updated 2026-09-22)
**Status:** Ruled by the owner. The review vertical's record of rulings. **This is a working plan, not a spec:** Doc 02B and Doc 05F are amended only through the spec change log (SCL-109 to SCL-118).
**Principle:** **Review is practice with a different pool.** Every behaviour is copied from practice unless it appears in §2. Anything not in §2 that differs from practice is a defect.

**Test rule:** tests follow rulings. When a ruling changes behaviour, the tests that encode the old behaviour are rewritten in the same PR to assert the new one. A test failing because code broke means the code gets fixed. We never build to satisfy a test.

**Skip rule:** no new skip may exist that doesn't run somewhere. A Postgres test may skip in the `ci` job only if it is named in a Postgres-backed job (`practice-integration`) behind `vitest-summary-gate`, which fails on zero assertions.

---

## 1. The flow

1. A student answers a practice question **wrong or skips it**. A database trigger puts it in the review queue, recording where it came from: engine, session, item, and whether it was a miss or a skip.
2. The student opens review and picks a pool:
   - the whole queue;
   - one past session (practice, review, or full-length once that exists);
   - a section, domain or skill, using the same filters as practice.
3. That creates a review session, **prefilled with the whole pool**, oldest queue entry first. Serving, answering, skipping, resume and abandonment all work exactly as in practice.
4. Outcomes:
   - **Correct:** the question leaves the queue.
   - **Wrong or skipped:** it goes back into the queue, at the back of the line, with source `review`.

---

## 2. Every difference from practice

| # | Practice | Review |
|---|---|---|
| 1 | Pool: `servable_questions` filtered | Open queue entries joined to `servable_questions`, then the same filters |
| 2 | Modes: flow, structured, balanced, timed, diagnostic | `queue`, `session` (one past session), `filter` |
| 3 | Selection: random | Oldest `queued_at`, then `question_id` |
| 4 | Session size: presets, maximum 60 | The whole pool at creation, or the calendar's size |
| 5 | Answer written on the item only | The same CAS on the item. A trigger then writes the `review_error_attempts` row and moves the queue, in the same statement. |
| 6 | Mastery source `practice` | Mastery source `review`; event id = the review item's id |
| 7 | Free daily quota | None; review is free and unlimited |
| 8 | Owner column `user_id` | `student_id`. It stays, because renaming it breaks the deletion and anonymization functions. |
| 9 | Max concurrent sessions: 5 practice sessions | 5 review sessions, counted separately, reading practice's `max_concurrent_sessions` value so the two can't drift |

**Copied from practice unchanged:**
- the item snapshot, including skill = the first element of `skill_codes` (`mapGenesisQuestionRow`; `questions` has no scalar `skill` column);
- the Fisher–Yates A–D shuffle. **This is the same code: it is promoted to `packages/shared`, and both engines import it.**
- grading;
- skip;
- CAS idempotency via `client_attempt_id`;
- session-create idempotency: the opaque key stored in `filters` as `session_start_idempotency_key`, replayed against open sessions (`practice-canonical.ts:1311-1341`, `:1501`). This satisfies SCL-08-D as written. It is neither durable past session close nor atomic under concurrent creates, same as practice; accepted by ruling.
- resume, and the open-sessions list;
- inactivity abandonment: practice's **7-day cron sweep** (`stale-session-sweep.ts:38`, ruling Q4), mirrored by a review sweep. Practice's sweep function is not reused as-is, because it carries a diagnostic exclusion review doesn't need. (The `inactivity_timeout_hours = 24` config key has no consumer.)
- the URL shape, `/review/session/:sessionId`;
- CSRF and the client-instance id.

---

## 3. Rulings

| # | Ruling |
|---|---|
| 1 | Delete the old review layer: TypeScript, runtime gate, UI, four mock tests. |
| 2 | **Practice misses and practice skips both enter the queue.** This reverses Doc 02B §16 ("skipped questions do not enter review"). |
| 3 | The practice writer is a trigger on the item's answered or skipped update, atomic with the CAS. |
| 4 | A correct review answer graduates the question. |
| 5 | Backfill existing practice misses and skips through the same queue function. |
| 6 | Full-length review works automatically once the exam vertical writes to the queue. There is no stub code. |
| 7 | Oldest first. A wrong or skipped review item requeues at the back. |
| 8 | All tables are altered in place, never dropped and recreated. |
| 9 | LISA is out at launch; `used_tutor` stays `false`. |
| 10 | Review is free. |
| 11 | Mastery via `applyMasteryEvent`, as in practice, with the item id as the event id. |
| 12 | Queue: one row per miss or skip. A new one supersedes the question's open entry; at most one entry per question is open. |
| 13 | A correct practice answer never touches the queue. |
| 14 | `next_review_at` becomes `queued_at`. Drop the SM-2 columns and `first_missed_session_id`. The calendar changes two lines in the same migration, as the calendar team agreed. |
| 15 | Prefill the whole pool (1a). The same question may sit in two open sessions (2). |
| 16 | Review skip requeues at the back (3). |
| 17 | Inactivity abandonment mirrors practice: a 7-day cron sweep. **Abandoned sessions never show in the UI**, and practice gets the same fix if it's small (4). |
| 18 | A retired question's queue entry is left alone. The servable join excludes it everywhere (5). |
| 19 | The queue stores no question metadata. Content and metadata come from the `servable_questions` join at prefill, as practice does. The join is on a primary key, so it isn't a failure mode, and a copy could go stale. |
| 20 | Session picker labels are computed at read time: day header, "Practice · 2:40 PM", mode and filters, "N to review". |
| 21 | `review_question_history` view for ML. Service role only. |

---

## 4. Layers

**Branching:** all work goes by PR into the `review` integration branch. When the vertical is in a good place, the owner audits and merges `review` into `main`. The expected-schema snapshot is regenerated from the union of both migration sets at that merge, not before.


| Brief | Layer | Depends on |
|---|---|---|
| R1 | Deletion | — |
| R2 | Database: mirror columns, queue function, two triggers, backfill, calendar lines, view | — |
| R3 | API: copy practice's routes and service code against review tables; pool query; shared shuffle; Zod in `packages/shared` | R2 deployed |
| R4 | UI: **share practice's loop** (`CanonicalPracticePage` + `useCanonicalPractice`) fed review's endpoints, with small differences as props; a **new review landing page** for the pool picker; open-sessions list with abandoned hidden, in both engines. Pre-build: count the practice-only branches in the loop. If they don't separate cleanly, stop and report. | R3 deployed |
| R5 | Calendar: the held items H1–H7 in `Brief_Calendar_Review_Seam.md`, landed once, together | R3, R4 |

**Status: COMPLETE (2026-09-22).**
- R1–R4.2 merged to `main`, deployed, and verified in production.
- SCL-109 to SCL-118 approved.
- The plan, the change-log entries and the citation corrections are all merged; `genesis-fresh-apply` green on `main`.
- **End-to-end verified in production, including the calendar path:** the calendar generated review blocks (scope `{"mode":"queue"}`, target 15), launched one with the key `calendar:block:<id>:1`, and review prefilled and served it. 85 queue entries from 85 practice misses and skips (three from live practice, not the backfill); 14 answered items, 14 attempts with `id` = item id, 14 mastery events; 78 active, 4 graduated, 15 superseded, with no duplicate open entry, no unservable active entry, and no answered item missing an attempt.
- Remaining: the owner's manual check of the ended-session URL redirect, and filing the Doc 05F §9.2 practice-bullet defect as an SCL (calendar-owned).
- Post-launch: LISA in review (the answer-withholding rule is written and marked deferred) and SM-2 spacing. Exams need only call `review_queue_record` for each miss or skip; "review a past session" then covers exams with no review-side change.

**Carried from R1 (PR #794):**
- **R2:** correct the false comment at `practice-canonical.ts:2416-2421`; delete `tmp/table_reference_audit.json`.
- **R3:**
  - restore the three `R3-PENDING` assertions: the anti-raw-bank rule in `runtime-materialization-law.ci.test.ts`, and the new review route added to `EMISSION_FILES` in `scripts/ci/mastery-emission-observability.mjs` in the same PR as the `applyMasteryEvent` call;
  - rewrite `docs/contracts/review-smoke.md` to the new modes;
  - update the exclusions comment at `tests/ci/tutor-output-serializer.contract.test.ts:502-505`.
- **R4:** add `/review` to `RETURN_PATH_ALLOWLIST` (`packages/shared/src/return-path.ts`) and to `client/public/robots.txt`.
- **Post-launch LISA wave:** restore the `tutor_interactions` assertion parked in `tutor-interactions.no-verbatim.contract.test.ts`.

---

## 5. Spec amendments

Logged in `SPEC_CHANGES_LOG.md` as `PROPOSED` (PR #827). The owner rules and applies them.

| SCL | Document | Amends |
|---|---|---|
| SCL-109 | Doc 02B §16 | The review engine as built |
| SCL-110 | Doc 02B §12 | Review free; tutor in review deferred |
| SCL-111 | Doc 02B §20, §21 | Tutor in review deferred, answer-withholding rule retained |
| SCL-112 | Doc 02B §22 | Review sessions resume like practice |
| SCL-113 | Doc 02B §8 | Review tables and writers as built |
| SCL-114 | Doc 02B, other sections | Incidental references to the old review model |
| SCL-115 | Doc 05F §4 | Seam table review row |
| SCL-116 | Doc 05F §9.3 | Review adapter: create, activity units, progress |
| SCL-117 | Doc 05F §20 | Gate G-08-03 |
| SCL-118 | Doc 05F §23 | SCL-08-B |

---

## 6. Findings for other owners

- **Production is ahead of every mergeable branch (2026-09-22).** The calendar's review adapter and its DDL (`20260925000000`, `20260928000000`) are applied in production but exist only on the open PR #825 branch. Production already has `enabled_block_types = ["practice","review"]`, the `servable_questions` join in `calendar_build_plan_input`, and 3 review blocks. If #825 is closed unmerged, no branch reproduces production.
- **The migration ledger is not authoritative.** `supabase_migrations.schema_migrations` holds 16 rows and stops at `20260624020000`, because DDL is applied by hand. `genesis-fresh-apply` is the only proof that a branch reproduces production.
- **Doc 05F §9.2:** the practice activity-unit bullet claims a `skills` field that `activityUnitSchema` (`.strict()`) has no room for. Same defect the review bullet had; 05F-owned.

- **Calendar:** the review launch-contract test exists (added 2026-09-18) but asserts against the stub adapter; the calendar team points it at the real review API (SCL-117). `review_estimated_seconds_per_item = 120` assumed LISA.
- **Practice:** Fisher–Yates is private (review's copy died with R1). R3 promotes it verbatim. Two dead Fisher–Yates bodies remain: `rng.ts:42` and `apps/api/src/services/exams/seeded.ts:10`. `SESSION_ITEM_SELECT` (`practice-canonical.ts:253-254`) omits `question_assets` and `question_estimated_time_seconds`, so practice serves `assets: null` on read-back.
- **Practice sweep:** `stale-session-sweep-gate.sh` is referenced in two places but doesn't exist, and `session-lifecycle-db-gate.sh` hand-copies the sweep predicate into SQL with nothing keeping the two in sync.
- **R2:** `review-queue-gates.sql` and its self-test weren't wired into any CI job. R3 wires them in. Practice's session-create idempotency lives in `filters` JSONB with no unique constraint, so concurrent creates with one key can both insert. The Doc 01A `idempotency_records` table exists with zero rows and no consumer.
- **Practice copy:** practice's guidance card says "runtime session truth" (engineering jargon on a student screen).
- **Practice data:** session mode is stored twice: the `mode` column and a copy inside `filters` (`practice-canonical.ts:1544`, `:1773`, `:1639`). R4.1 removed review's copy.
- **Practice UI:**
  - `useCanonicalPractice` de-duplicates creates through a module-global map (`:326`) that survives between tests. It made a test racy in R4.
  - Open-session rows rendered "Invalid DateTime" (`started_at` vs `created_at`); fixed in R4.
  - Three nav components have zero importers: `NavBar.tsx`, `navigation.tsx`, `progress-sidebar.tsx`.
- **CI:** the 192 Postgres-dependent tests skip in the `ci` job and run only where named in a service-backed job (`practice-integration`). A pg test not named in such a job runs nowhere.
- **Review skips:** a skip requeues but emits no mastery event (mirroring practice, where `canonical_mastery_events` reads only `status = 'answered'`). A student can skip the same question indefinitely with no mastery signal. Candidate for a post-launch policy.
- **Question bank:**
  - `questions-runtime.ts:217` uses a biased `Math.random()` shuffle.
  - `QUESTION_LIFECYCLE` omits `retired`.
- **Migrations:**
  - The `review_schedule.student_id` FK is CASCADE in production but no-action in the repo. R2 aligns them.
  - `20260817020000:16-18` cites `review_sessions` columns that never existed.
