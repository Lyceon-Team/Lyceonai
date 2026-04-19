# Practice Contract

## Canonical tables

- `practice_sessions`
- `practice_session_items`

## Creation flow

When a student starts practice:

1. create one `practice_sessions` row
2. persist the exact session spec on that row:
   - user
   - section
   - domain
   - skill
   - difficulty
   - requested question count
   - other filters
3. use the source bank only once to select the candidate questions
4. materialize those selected questions into `practice_session_items`
5. assign each item:
   - `practice_session_id`
   - question reference
   - display order
   - runtime snapshot fields
   - option ordering / token mapping if used
   - answer-state fields

## Runtime flow

After creation, practice runtime must read only from:

- `practice_sessions`
- `practice_session_items`

Not from `questions`.

## Answer flow

When the student answers:

- update the session-owned answer state
- unanswered means no user answer / unresolved item state
- answered means the session item now has user answer and correctness/result state

## Resume flow

When the student comes back:

- load the same `practice_session`
- load the same `practice_session_items`
- resume from the persisted order/state
- do not re-pick questions

## Review flow

Practice review must come from persisted session-owned wrong/missed items.

Allowed review modes:

- review by specific practice session
- review across all past practice mistakes

## Session-item truth rule

`practice_session_items` must be able to answer:

- what question was served
- in what order
- what the student answered
- whether it was correct/wrong
- whether it is unanswered
- what explanation/correct-answer snapshot applies
- what option order/tokenization the student saw

## Runtime disable behavior (locked)

When practice runtime is contract-disabled:

- backend returns terminal `503` with code `PRACTICE_RUNTIME_DISABLED_BY_CONTRACT`
- response is emitted before any legacy runtime logic, fallback, or DB-dependent runtime branching
- frontend treats it as terminal-disabled:
  - no auto-retry
  - no polling retry
  - no repeated toast spam
  - no spinner loops

## Unlock acceptance gates

- runtime serve/resume/progression reads only `practice_session_items` (plus `practice_sessions` header state)
- answer writes persist session-owned answer state in `practice_session_items`
- mastery writes are emitted via `apply_learning_event_to_mastery(...)` to canonical derived tables
- if materialized items are missing after session creation, runtime fails closed with explicit contract error (no regeneration fallback)
