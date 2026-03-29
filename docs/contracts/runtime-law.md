# Lyceon Runtime Contract

## Core principle

For student runtime, the source of truth is always the **session layer**, never the raw bank.

The raw bank exists only to **materialize** a session before runtime begins.

After a session is created, everything must run from the persisted session-owned tables.

## Raw bank contract

### `questions` table rule

`questions` is a **source-bank/materialization table only**.

Allowed:

- pre-runtime selection
- candidate filtering
- counts/availability
- editorial/admin/reference tooling

Forbidden for mounted student runtime:

- practice delivery
- practice progression
- practice resume
- practice grading/runtime reads
- full-length delivery
- full-length adaptive runtime after persistence
- full-length scoring/runtime reads
- review delivery
- review reconstruction
- diagnostic delivery
- diagnostic progression
- any fallback

This is a hard invariant.

## No mixed-mode rule

There must be no half-and-half system.

That means:

- no direct runtime reads from `questions`
- no fallback to raw-bank delivery
- no duplicate parallel runtime logic
- no “legacy path if canonical path fails”
- no mix of old and new sources for the same runtime feature

For any mounted feature, there should be exactly one canonical runtime contract.

## Codex enforcement rule

Give Codex this exact law:

```markdown
## Lyceon runtime law

This is non-negotiable.

### Practice
Runtime source of truth:
- `practice_sessions`
- `practice_session_items`

Creation:
- create `practice_sessions`
- materialize selected questions into `practice_session_items`

Runtime:
- read only from `practice_session_items`
- update answer state against session-owned runtime records
- resume from persisted session-owned runtime records

Forbidden:
- any runtime read from `questions`
- any fallback to `questions`
- any mixed-mode delivery path

### Full-length
Runtime source of truth:
- `full_length_exam_sessions`
- `full_length_exam_modules`
- `full_length_exam_questions`
- `full_length_exam_responses`
- `full_length_exam_score_rollups`

Creation:
- create one session
- create four modules
- persist module-owned question sets
- module 2 logic must be driven from persisted results of module 1

Runtime:
- read only from persisted full-length session/module/item state
- resume from persisted full-length state

Forbidden:
- any runtime read from `questions`
- any fallback to `questions`
- any mixed-mode delivery/scoring/review path

### Review
Review must be derived from persisted session outcomes.

Supported:
- review by practice session
- review by full-length session
- review all past mistakes

Forbidden:
- reconstructing live review from raw `questions`
- mixed review sources that bypass persisted runtime state

### Raw bank
`questions` is allowed only for:
- pre-runtime materialization
- filtering/counts
- editorial/admin/reference tooling

If any mounted runtime path touches `questions`, classify it as a blocking violation.
```

## Additional locked requirements

- Add `docs/contracts/review-contract.md` so review has an explicit contract file, not just shared-law coverage.
- Contract-disable responses must be emitted before any legacy runtime logic, fallback, or DB-dependent runtime branching.
- Frontend must treat contract-disable `503` responses as terminal-disabled states:
  - no auto-retry
  - no polling retry
  - no repeated toast spam
  - no spinner loops
- Codex must enumerate the exact mounted routes covered by each kill domain and prove no runtime endpoint remains outside enforcement accidentally.
- Disabled-state UX copy must be standardized across practice, full-length, and review.

### Materialization law

- Raw `questions` access is permitted only in pre-runtime materialization paths during session/exam creation.
- If canonical persisted item rows are missing after creation, runtime must fail explicitly; fallback generation or raw-bank serving is forbidden.
- Resume, progression, grading, reporting, and review must never read from `questions`.

### Unlock rollback criteria

If post-unlock validation shows any of the following, the domain must be re-locked immediately:

- mounted runtime path reads from raw `questions`
- required canonical writes do not persist
- live-schema/RLS mismatch causes blocking errors
- resume/progression serves non-persisted state
- hidden fallback or mixed-mode runtime is detected
- Diagnostic runtime is hard-killed and must return terminal contract-disabled responses on `/api/me/mastery/diagnostic/*`.

## Final system statement

> **Runtime belongs to sessions, not to the question bank.**
