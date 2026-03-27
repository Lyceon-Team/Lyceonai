# Review Unlock Smoke (Three-Mode Canonical Runtime)

Purpose: confirm all three review modes are served from persisted session outcomes only and remain fail-closed without raw-bank fallback.

Scope: UI trigger, backend routes, and DB persistence for canonical review runtime.

Hard gates:
- All three modes must work end-to-end:
  - `all_past_mistakes`
  - `by_practice_session`
  - `by_full_length_session`
- No review runtime reads from raw `questions`.
- Review remains hard-killed until review tables exist in live DB.

## Preconditions
- Review hard-kill guard still enabled until DB is ready.
- Review tables are present (see DB verification).

## Runtime route map
- GET `/api/review-errors` (summary queue; mode-aware)
  - `?mode=all_past_mistakes`
  - `?mode=by_practice_session&practice_session_id=<uuid>`
  - `?mode=by_full_length_session&full_length_session_id=<uuid>`
- POST `/api/review-errors/sessions` (start session; mode-aware)
- GET `/api/review-errors/sessions/:sessionId/state`
- POST `/api/review-errors/attempt`

## Smoke sequence (record evidence)
1. **All past mistakes summary**
   - API: GET `/api/review-errors?mode=all_past_mistakes`
   - Evidence: summary + queue from persisted attempt snapshots only.
   - Gate: no raw `questions` read.

2. **By practice session summary**
   - API: GET `/api/review-errors?mode=by_practice_session&practice_session_id=<uuid>`
   - Evidence: only attempts from that session.
   - Gate: missing `practice_session_id` returns 400.

3. **By full-length session summary**
   - API: GET `/api/review-errors?mode=by_full_length_session&full_length_session_id=<uuid>`
   - Evidence: only attempts from that full-length session.
   - Gate: missing `full_length_session_id` returns 400.

4. **Start session (each mode)**
   - API: POST `/api/review-errors/sessions`
   - Body: `{ mode, filter, practice_session_id | full_length_session_id, client_instance_id, idempotency_key }`
   - Evidence: `review_sessions` row created; `review_session_items` materialized; first item served.

5. **Submit + advance**
   - API: POST `/api/review-errors/attempt`
   - Evidence: `review_error_attempts` row created, `review_session_items.status` updated, event logged.

6. **Resume**
   - API: GET `/api/review-errors/sessions/:sessionId/state`
   - Evidence: same served item and option tokens, no re-materialization.

## Evidence template
```
Date:
Environment:
User:
Mode:
SessionId:
ClientInstanceId:

1) Summary
- requestId:
- status:
- reviewQueue length:
- summary.sessionMode:
- summary.sessionId:

2) Start session
- requestId:
- status:
- review_sessions.id:
- review_session_items count:

3) Submit
- requestId:
- status:
- review_error_attempts id:
- review_session_items.status:

4) Resume
- requestId:
- status:
- currentItem.id:
- option_token_map stable: yes/no

5) Raw-bank guard
- evidence source:
- questions table reads: none
```
