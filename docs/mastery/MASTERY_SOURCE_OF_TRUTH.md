# Mastery Source of Truth

## Canonical Writer
- Canonical runtime mastery write choke point:
  - `apps/api/src/services/mastery-write.ts`
  - function: `applyMasteryUpdate(...)`
- All mastery-affecting runtime flows call this function:
  - `server/routes/practice-canonical.ts`
  - `server/routes/review-session-routes.ts`
  - `apps/api/src/services/fullLengthExam.ts`

## Canonical Runtime Tables
- Canonical attempt/event ledger: `public.student_question_attempts`
- Canonical skill mastery state: `public.student_skill_mastery`
- Canonical cluster rollup state: `public.student_cluster_mastery`

These are the active runtime equivalents of the locked conceptual model (`mastery_events`, `skill_mastery`).

## Canonical Event Taxonomy
Only these event values are accepted for mastery writes:
- `practice_pass`
- `practice_fail`
- `review_pass`
- `review_fail`
- `tutor_helped`
- `tutor_fail`
- `test_pass`
- `test_fail`

Fail-closed behavior:
- Unknown event types are rejected before any mastery table write.
- Missing canonical question id, section, or skill mapping is rejected.

## Runtime Writer Guarantees
- `applyMasteryUpdate(...)` inserts one row into `student_question_attempts`.
- The same call then updates rollups via:
  - `upsert_skill_mastery`
  - `upsert_cluster_mastery`
- No other active runtime path writes canonical mastery rollup tables directly.

## Parallel Systems Status
- `user_competencies`: legacy table, not active runtime mastery truth.
- `competency_events`: legacy/derived table family, not active runtime mastery truth.
- `user_progress`: deprecated parallel ledger, not active runtime mastery truth.

## Reader Alignment
- KPI/calendar event counting derives from `student_question_attempts` and canonical event filters in `apps/api/src/services/mastery-constants.ts`.
- Mastery product-read surfaces derive from the canonical read layer in `apps/api/src/services/mastery-read.ts`.
- Mastery summaries/weakness readers derive from `student_skill_mastery` via the read layer.
- Guardian mastery-adjacent surfaces remain summary-only and do not expose raw mastery score deltas or attempt-level internals.

## Mounted Route Ownership Audit
This audit is based on mounted routes in `server/index.ts` and is required before declaring canonical status.

- Canonical (student mastery surfaces):
`/api/me/mastery/summary`, `/api/me/mastery/skills`, `/api/me/mastery/weakest`, `/api/me/weakness/skills`, `/api/me/weakness/clusters`
- Canonical (guardian mastery-derived surfaces):
`/api/guardian/weaknesses/:studentId` (guardian-safe projection of student truth)
- Compatibility-only:
None for mastery product truth.
- Dead/disabled:
`/api/me/mastery/diagnostic` (intentionally returns 404).
