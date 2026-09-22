# Review Smoke — Queue Runtime (three pool modes)

Purpose: confirm the review vertical works end to end against production — a practice
miss reaches the queue, a review session serves it, and the outcome moves the queue the
right way.

Scope: the review API (R3) and the two database triggers (R2). No UI (R4), no calendar
(R5).

Rewritten 2026-09-21 for the rebuilt vertical. The previous version described the
pre-R1 design — `/api/review-errors`, SM-2 scheduling, a runtime hard-kill guard, and
review "derived from persisted attempt snapshots". None of that exists: R1 deleted the
runtime, R2 replaced the schema, and ruling 19 has content come from the
`servable_questions` join at prefill.

## Hard gates

- All three pool modes work end to end: `queue`, `session`, `filter`.
- **No review runtime reads raw `questions`.** The only source is `servable_questions`
  (published, not issue-flagged). Enforced statically by
  `tests/ci/runtime-materialization-law.ci.test.ts`.
- **Anti-leak:** create, state and next never carry `correct_answer` or `explanation`.
  Both are `null` pre-submit; the answer response reveals them.
- **Nothing but a trigger writes the queue.** `review_schedule` and
  `review_error_attempts` have no API writer. If a smoke run shows an API-side write,
  stop — that is the defect R2 was built to make impossible.
- Review is free: no entitlement check, no daily quota (ruling 10).

## Preconditions

- R2's migration (`20260921000000_review_queue_runtime.sql`) applied.
- A test student with at least one practice miss or skip already in the queue.
- `review_schedule` has at least one `active` row for that student whose question is
  still servable.

## Route map

| Method | Path | Notes |
|---|---|---|
| GET | `/api/review/pool?tz=<IANA>` | Counts + past sessions for the pickers. Invalid `tz` → UTC, logged, never 500. |
| GET | `/api/review/sessions/open` | `created` and `active` only — abandoned and completed never appear (ruling 17). |
| POST | `/api/review/sessions` | Body `{ mode, filters, client_instance_id?, idempotency_key?, target_count? }`. |
| POST | `/api/review/sessions/:sessionId/resume` | |
| POST | `/api/review/sessions/:sessionId/terminate` | |
| POST | `/api/review/sessions/:sessionId/calculator-state` | |
| GET | `/api/review/sessions/:sessionId/next?client_instance_id=…` | |
| GET | `/api/review/sessions/:sessionId/state` | |
| POST | `/api/review/answer` | |
| POST | `/api/review/sessions/:sessionId/skip` | |

`filters` by mode: `queue` → `{}`; `session` → `{ source_engine, source_session_id }`;
`filter` → `{ sections?, domains?, skills?, difficulties? }`.

## Smoke sequence (record evidence)

1. **Pool summary.** `GET /api/review/pool?tz=America/Chicago`.
   Evidence: `total`, the three facet arrays, and at least one entry in `sessions` with
   a local date/time. Gate: `timezoneFallback` is `false` for a real zone and `true`
   with `timezone: "UTC"` for a junk one — and the junk one is still a 200.

2. **Create, queue mode.** `POST /api/review/sessions` with `{ "mode": "queue" }`.
   Evidence: `review_sessions` row with `mode='queue'`, `status='created'`;
   `review_session_items` count equals the pool size; item 1 is already `served`;
   every item has a non-null `queue_entry_id`.
   Gate: the item ordinals follow `queued_at` then `question_id` — oldest first.

3. **Create replay.** Repeat step 2 with the same `idempotency_key`.
   Evidence: the same `sessionId`, `replayed: true`, and no new items.

4. **Next.** `GET .../next?client_instance_id=…`.
   Evidence: `question.correct_answer` is `null`, `question.explanation` is `null`, and
   `question.options[].id` are opaque `opt_…` tokens with no A–D letter anywhere in the
   payload. Gate: any answer-bearing field here fails the smoke outright.

5. **Wrong answer.** `POST /api/review/answer` with a deliberately wrong option.
   Evidence: response reveals `correctOptionId` (or `correctAnswer` for a grid-in) and
   `explanation`; a `review_error_attempts` row exists whose `id` EQUALS the
   `review_session_items.id`; the old `review_schedule` row is `superseded` with
   `closed_at` set, and a NEW `active` row exists for the same question with a strictly
   later `queued_at` (back of the line, ruling 7).

6. **Correct answer.** Answer the next item correctly.
   Evidence: an attempt row, and the question's `review_schedule` row is `graduated`
   with `closed_by_item_id` equal to the item id. No new active row.

7. **Skip.** `POST .../skip`.
   Evidence: **no** `review_error_attempts` row for that item, and the question is
   requeued with `source_outcome='skipped'` (ruling 16, R2 check 7).

8. **Mastery.** `SELECT * FROM canonical_mastery_events(...)` for the student.
   Evidence: the review answers appear with `source_family='review'`,
   `event_source_kind='review_error_attempt'`, and `event_id` equal to the review item
   id. Gate: no duplicate event ids between the practice and review branches.

9. **Session mode.** Create with
   `{ "mode": "session", "filters": { "source_engine": "practice", "source_session_id": "<uuid>" } }`.
   Evidence: the pool contains only questions this student queued from that session and
   which are still open — including one missed there, graduated, and missed again.

10. **Filter mode.** Create with `{ "mode": "filter", "filters": { "sections": ["M"] } }`.
    Evidence: every item is section M. Gate: an empty selection returns **422**
    `REVIEW_POOL_EMPTY`, not 500, and creates no session row.

11. **Ownership.** Repeat steps 4 and 5 as a second student against the first
    student's `sessionId`. Evidence: 404 on both — not 403, which would confirm the id.

## Evidence template

```
Date:
Environment:
Student:
Timezone tested:

1) Pool summary        total:            fallback:
2) Create (queue)      sessionId:        items:          first item status:
3) Replay              same sessionId:   replayed:
4) Next                correct_answer:   explanation:    option ids:
5) Wrong answer        attempt id == item id:   superseded row:   new active queued_at:
6) Correct answer      graduated row:    closed_by_item_id:
7) Skip                attempt rows for item (expect 0):    requeued outcome:
8) Mastery             source_family:    event_id == item id:
9) Session mode        pool size:        all from source session:
10) Filter mode        all section M:    empty-selection status (expect 422):
11) Ownership          cross-student next / answer (expect 404 / 404):
```
