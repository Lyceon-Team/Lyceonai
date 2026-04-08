# Review Source of Truth

## Canonical Runtime Files
- `server/index.ts`
- `server/routes/questions-runtime.ts`
- `server/routes/review-session-routes.ts`
- `server/services/review-queue.ts`
- `apps/api/src/services/studentMastery.ts`

## Canonical Data Sources
- Mistake queue eligibility:
  - `public.practice_session_items` (practice misses/skips)
  - `public.full_length_exam_responses` joined to completed sessions (full-test misses)
- Recovery outcomes:
  - `public.review_error_attempts`
- Session lifecycle:
  - `public.review_sessions`
  - `public.review_session_items`
  - `public.review_session_events`
- Mastery writer:
  - `public.apply_learning_event_to_mastery(...)`

## Deterministic Queue Rules
- Queue is server-built and student-scoped.
- Latest state per canonical question identity wins.
- Only unresolved misses/skips enter session materialization.
- Recovered items are excluded when latest review attempt is correct.
- Stable order:
  1. latest attempt timestamp desc
  2. source tie-break (`full_test` then `practice`)
  3. question id asc
  4. attempt id asc

## Session Materialization Rules
- Start route materializes queue once into `review_session_items` ordinals.
- Replay returns existing active session and item ledger.
- Refresh/state does not rebuild queue or reorder items.
- Served-item truth is persisted (`status='served'`).
- Current runtime materializes `retry_mode='same_question'`; similar-question substitution is deferred.

## Locked Review + Tutor Semantics
- Review outcomes only: `review_pass`, `review_fail`.
- Tutor-only interaction writes no mastery.
- Tutor + retry does not emit mastery in this model.

## Security + Visibility Boundaries
- Review writes are student-scoped.
- Guardian surfaces remain summary-only and must not expose question-level review internals.
- Pre-submit payload remains anti-leak safe.
