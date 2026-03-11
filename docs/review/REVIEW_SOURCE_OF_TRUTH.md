# Review Source of Truth

## Canonical Runtime Routes and Services
- `GET /api/review-errors`
  - Mounted in `server/index.ts`.
  - Handler: `apps/api/src/routes/questions.ts#getReviewErrors` (via `server/routes/legacy/questions.ts`).
  - Purpose: build review queue from prior **practice** misses/skips (origin context only).
- `POST /api/review-errors/attempt`
  - Mounted in `server/index.ts`.
  - Handler: `server/routes/review-errors-routes.ts#recordReviewErrorAttempt`.
  - Purpose: server-grade retry, enforce review eligibility, emit canonical mastery events.
- `POST /api/tutor/v2`
  - Mounted in `server/index.ts`.
  - Handler: `server/routes/tutor-v2.ts` + `apps/api/src/lib/tutor-log.ts`.
  - Purpose: log tutor open/interactions (`tutor_interactions`) only; no direct mastery writes.
- Canonical mastery writer
  - `apps/api/src/services/mastery-write.ts#applyMasteryUpdate` is the only mastery write path.

## Canonical Event Taxonomy Mapping
- `PRACTICE_SUBMIT`: practice answer submission (`server/routes/practice-canonical.ts`).
- `REVIEW_PASS`: review retry graded correct (`server/routes/review-errors-routes.ts`).
- `REVIEW_FAIL`: review retry graded incorrect (`server/routes/review-errors-routes.ts`).
- `TUTOR_HELPED`: tutor-verified review retry graded correct (emitted only alongside `REVIEW_PASS`).
- `TUTOR_FAIL`: tutor-verified review retry graded incorrect (emitted only alongside `REVIEW_FAIL`).
- `TUTOR_VIEW`: tutor open/view semantic only; no mastery rollup mutation.

## Tutor Verification Interaction
- Tutor and review are separate semantics.
- Tutor opens are recorded to `tutor_interactions` and do not move mastery.
- `POST /api/review-errors/attempt` first enforces review eligibility from prior failed/skipped `answer_attempts`.
- Tutor contribution is allowed only when tutor context is verified for the same canonical question after the source failed attempt timestamp.
- Verified tutor retry emits paired canonical events:
  - Correct retry: `REVIEW_PASS` + `TUTOR_HELPED`.
  - Incorrect retry: `REVIEW_FAIL` + `TUTOR_FAIL`.

## Mastery, KPI, and Calendar Integration
- Mastery writes
  - All events are persisted through `applyMasteryUpdate` to `student_question_attempts` with `event_type`.
  - No review/tutor path bypasses canonical event taxonomy.
- KPI consumption
  - `server/services/kpi-truth-layer.ts` counts canonical events only:
    - included: `PRACTICE_SUBMIT`, `REVIEW_PASS`, `REVIEW_FAIL`
    - excluded: `TUTOR_HELPED`, `TUTOR_FAIL`, `TUTOR_VIEW`
  - Legacy rows without `event_type` are treated as historical practice rows.
- Calendar consumption
  - `apps/api/src/routes/calendar.ts` and `server/routes/guardian-routes.ts` day-level attempt/accuracy rollups use the same canonical include/exclude policy as KPI.

## Deprecated / Quarantined Legacy Paths
- `apps/api/src/routes/progress.ts#recordReviewAttempt`
  - Legacy competency-event writer, not mounted by `server/index.ts` for runtime review submission.
  - Quarantined from canonical mastery/event flow.
- Queue origin semantics in `getReviewErrors`
  - `reviewQueue.originOutcome`/`reviewQueue.outcome` describe prior **practice** outcomes only.
  - They are not canonical review mastery outcomes.
