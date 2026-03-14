# Review Runtime Contract

## Canonical Mounted Runtime
- Route mount: `server/index.ts`
  - `GET /api/review-errors` -> `server/routes/questions-runtime.ts#getReviewErrors`
  - `POST /api/review-errors/sessions` -> `server/routes/review-session-routes.ts#startReviewErrorSession`
  - `GET /api/review-errors/sessions/:sessionId/state` -> `server/routes/review-session-routes.ts#getReviewErrorSessionState`
  - `POST /api/review-errors/attempt` -> `server/routes/review-session-routes.ts#submitReviewSessionAnswer`

## Canonical Tables
- Eligibility source:
  - `public.answer_attempts`
  - `public.full_length_exam_responses` joined to completed `public.full_length_exam_sessions`
- Review lifecycle truth:
  - `public.review_sessions`
  - `public.review_session_items`
  - `public.review_session_events`
- Review outcome ledger:
  - `public.review_error_attempts`
- Mastery writer:
  - `apps/api/src/services/mastery-write.ts#applyMasteryUpdate`

## Session + Item Lifecycle
- Session state machine: `created -> active -> completed` with `abandoned` terminal branch.
- Queue is materialized once at session start from canonical unresolved misses.
- `review_session_items` preserves deterministic ordinal ordering.
- Exactly one served unresolved item per active session (`status='served'`).
- Resume uses `GET /state`; refresh does not rematerialize or reorder items.

## Submit Contract
- Submit is anchored to `review_session_item_id` and `session_id`.
- Server validates session ownership and served-item lock state.
- Duplicate submit is idempotent via `client_attempt_id` and served-item lock.
- Duplicate submit returns prior authoritative result and does not double-write mastery.
- Correct submit emits `REVIEW_PASS`; incorrect submit emits `REVIEW_FAIL`.
- Tutor context can add `TUTOR_HELPED`/`TUTOR_FAIL`; tutor-only interaction emits no mastery write.

## Anti-Leak Contract
- Pre-submit state payload returns question with:
  - `correct_answer: null`
  - `explanation: null`
  - opaque option ids (no canonical key exposure)
  - no canonical question identifiers in the student payload
- Option token mapping remains server-only (`review_session_items.option_token_map`).
- Post-submit response may reveal correctness, answer text, and explanation.

## Multi-Tab + Ownership
- Session progression is bound to `client_instance_id` when present.
- Conflicting client instance receives deterministic `409` conflict.
- Non-owner session access is denied.

## Observability Contract
- Canonical event trail (`review_session_events`):
  - `review_session_opened`
  - `review_item_served`
  - `review_answer_submitted`
  - optional `tutor_opened`
  - optional `tutor_response_served`
  - `mastery_event_emitted`
  - `review_session_completed`
