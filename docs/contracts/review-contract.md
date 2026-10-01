# Review Contract

Rewritten 2026-09-21 (R3). The previous version described the pre-R1 design and is
wrong in its core principle, not merely its details — see "What changed" at the end.

## Core principle

**Review is practice with a different pool.**

Every behaviour is copied from practice unless the ruled plan §2 lists it as a
difference. Anything not in §2 that differs from practice is a defect, not a variation.

## The queue

A student answers a practice question **wrong or skips it**, and a database trigger
puts it in `review_schedule`, recording where it came from: engine, session, item, and
whether it was a miss or a skip.

- One row per miss or skip. A new one supersedes the question's open entry, so **at
  most one entry per question is open** (`uq_review_schedule_open_question`).
- A correct practice answer never touches the queue.
- A correct review answer **graduates** the question — it leaves the queue.
- A wrong or skipped review answer **requeues** it at the back of the line, with source
  `review` and a strictly later `queued_at`.

`review_schedule` and `review_error_attempts` have exactly two writers, both triggers
(`trg_practice_item_enqueue_review`, `trg_review_item_resolve`). **The API never writes
either table.** The attempt row is written with `id` equal to the review item's id, and
that id is the mastery event id.

## Pool modes

| Mode | Pool |
|---|---|
| `queue` | every open entry |
| `session` | entries from one past session (practice, review, or full-length once it exists) that are still open |
| `filter` | open entries narrowed by section, domain, skill or difficulty, with practice's predicate |

In every mode the open entries are **joined to `servable_questions`**, ordered by
`queued_at` then `question_id`, and the whole result is prefilled into the session at
creation — or the first `target_count` rows when the calendar asks for a size.

## Where content comes from

**Content and metadata come from the `servable_questions` join at prefill, exactly as
practice does.** The queue stores no question metadata: the join is on a primary key,
so it is not a failure mode, and a stored copy could go stale (ruling 19).

A retired or issue-flagged question keeps its queue entry and simply stops being
poolable (ruling 18). **No review code reads the raw `questions` table** — statically
enforced by `tests/ci/runtime-materialization-law.ci.test.ts`.

Once an item is snapshotted it is immutable, as in practice: a question retired
mid-session is still served from the snapshot for the life of that session.

## Anti-leak

Pre-submit payloads — create, state, next — carry `correct_answer: null` and
`explanation: null`, and options as opaque per-serve tokens. The canonical A–D letter
never leaves the server. Post-submit, the answer response reveals the correct answer
and the explanation.

This is a property of one function, `toStudentSafeQuestionDTO`, not of individual
fields. Adding a field to a review response means checking it against that chokepoint,
not around it.

## Entitlement and quota

**Review is free and unlimited** (ruling 10). No entitlement check, no daily quota.

The concurrent-session cap is not a quota: it is a resource guard, counted separately
from practice's but read from practice's configured value so the two cannot drift.

## Mastery

Review answers call `applyMasteryEvent` with `sourceFamily: "review"`,
`eventSourceKind: "review_error_attempt"`, and **the review item's id as the event id**
(ruling 11). Emission is warn-and-continue: the answer and the attempt row are already
persisted, and mastery is a downstream consumer.

**A review skip emits no mastery event**, mirroring practice, where
`canonical_mastery_events`' practice branch reads `status = 'answered'` only. A student
can therefore skip the same question indefinitely with no mastery signal — a known
post-launch policy candidate, recorded in the ruled plan §6, not a defect.

## LISA

Out of review at launch (ruling 9). `review_error_attempts.used_tutor` is written
`false` by the trigger and nothing in review reads or writes `tutor_messages`.

## Lifecycle

Resumable by id, several sessions open at once, and inactivity abandonment by a 7-day
cron sweep mirroring practice's. **Abandoned and completed sessions never appear in the
open-sessions list** (ruling 17). Abandoning a session leaves its queue entries open —
the questions come back in the next session's pool.

## What changed, and why the old contract was wrong

The previous version said review "is derived from persisted session outcomes" and "not
from a fresh raw `questions` lookup". Half of that survives: review still never reads
raw `questions`. The other half is now false — review does **not** reconstruct content
from persisted attempt snapshots. It reads `servable_questions` at prefill, which is
what ruling 19 decided and what makes the publish gate apply to a re-served miss.

Also gone: the `/api/review-errors` routes, the three `all_past_mistakes` /
`by_practice_session` / `by_full_length_session` mode names, SM-2 scheduling, and the
`REVIEW_RUNTIME_DISABLED_BY_CONTRACT` hard-kill guard. R1 deleted the runtime that
served them and R2 replaced the schema underneath.
