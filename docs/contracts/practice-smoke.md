# Practice Post-Unlock Smoke (Canonical Runtime)

Purpose: evidence-backed smoke to confirm Practice unlock is safe and contract-compliant.

Scope: UI trigger, backend routes, and DB persistence for canonical practice runtime.

Hard gates:
- `practice_session_items` must exist before any question is served.
- No runtime reads from `questions` after session creation.
- Resume must reuse persisted session items and order.

## Preconditions
- Practice hard-kill guard removed.
- Full-length + Review remain hard-killed.
- Only canonical practice runtime routes are mounted.

## Runtime route map
- POST `/api/practice/sessions` (create session + materialize)
- GET `/api/practice/sessions/:sessionId/next?client_instance_id=...` (serve)
- POST `/api/practice/answer` (submit)
- POST `/api/practice/sessions/:sessionId/terminate` (optional)

## Smoke steps (record evidence)
1. **Create session**
   - UI: start a practice session from `/practice`.
   - API: POST `/api/practice/sessions`.
   - Evidence: `sessionId`, `requestId`, response status.

2. **Confirm materialization**
   - DB: `SELECT count(*) FROM practice_session_items WHERE session_id = '<sessionId>';`
   - Evidence: count > 0, timestamps for created rows.

3. **Serve first item**
   - API: GET `/api/practice/sessions/:sessionId/next?...`.
   - Evidence: item payload contains persisted `practice_session_items.id`, `option_order`, and question snapshot fields.
   - Gate: if no `practice_session_items` rows exist, runtime must fail closed (no fallback).

4. **Submit answer**
   - API: POST `/api/practice/answer` with `session_id` + `session_item_id`.
   - Evidence: item status updated, `answered_at` set, and `answer_attempts` row created.
   - DB: `SELECT status, answered_at FROM practice_session_items WHERE id = '<sessionItemId>';`

5. **Resume same session**
   - UI: leave and return to the same session (refresh or reopen).
   - API: GET `/api/practice/sessions/:sessionId/next?...` again.
   - Evidence: same session id, persisted ordering, no re-materialization.

6. **Raw-bank guard**
   - Evidence source: server query logs or DB audit logs.
   - Assertion: no runtime SELECTs from `questions` after step 1 completes.

## Evidence template
```
Date:
Environment:
User:
SessionId:
ClientInstanceId:

1) Create session
- requestId:
- status:
- response snippet:

2) Materialization proof
- practice_session_items count:
- sample item id(s):
- created_at:

3) Serve first item
- requestId:
- status:
- session_item_id:
- option_order present: yes/no

4) Submit answer
- requestId:
- status:
- practice_session_items.status:
- answer_attempts row id:

5) Resume
- requestId:
- status:
- session_item_id (same session):
- ordering unchanged: yes/no

6) Raw-bank guard
- evidence source:
- questions table reads after materialization: none
```
