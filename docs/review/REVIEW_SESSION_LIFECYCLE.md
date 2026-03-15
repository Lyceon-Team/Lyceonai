# Review Session Lifecycle

## State Machine
- `created`
- `active`
- `completed`
- `abandoned`

Canonical progression:
- start/replay creates or reuses one active session
- queue materialized as ordered `review_session_items`
- one item is `served` at a time
- submit/skip resolves current item (`answered` or `skipped`)
- next queued item is promoted to `served`
- when all items resolve, session becomes `completed`

## Route Flow
1. `POST /api/review-errors/sessions`
- validates auth/ownership context
- derives deterministic unresolved queue from canonical misses
- creates or replays one active session
- materializes ordered `review_session_items`

2. `GET /api/review-errors/sessions/:sessionId/state`
- validates ownership
- enforces `client_instance_id` conflict semantics
- returns server-owned current ordinal and served item
- returns anti-leak question payload with opaque option ids

3. `POST /api/review-errors/attempt`
- validates ownership + active served item
- idempotent by served-item state and `client_attempt_id`
- writes one review attempt outcome
- emits mastery events via canonical mastery writer
- advances next served item or completes session

## Similar-Question Substitution
- Current canonical runtime uses `retry_mode = same_question` only.
- `similar_question` substitution is intentionally deferred and must remain deterministic + logged when introduced.

## Anti-Leak Split
- pre-submit state payload:
  - no `correct_answer`
  - no explanation
  - no canonical answer-key mapping
- post-submit payload:
  - correctness
  - answer text / explanation (allowed)

## Observability Sequence
- `review_session_opened`
- `review_item_served`
- `review_answer_submitted`
- optional `tutor_opened`
- optional `tutor_response_served`
- `mastery_event_emitted`
- `review_session_completed`