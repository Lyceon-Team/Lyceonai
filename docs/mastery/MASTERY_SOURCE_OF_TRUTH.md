# Mastery Source of Truth

## Canonical Writer
- Canonical runtime mastery write choke point:
  - DB RPC: `public.apply_learning_event_to_mastery(...)`
  - App wrapper: `apps/api/src/services/mastery-write.ts#applyLearningEventToMastery`
- All mastery-affecting runtime flows call the DB RPC:
  - `server/routes/practice-canonical.ts`
  - `server/routes/review-session-routes.ts`
  - `apps/api/src/services/fullLengthExam.ts`

## Canonical Runtime Tables (Derived Truth)
- Canonical KPI rollup: `public.student_kpi_rollups_current`
- Canonical skill mastery state: `public.student_skill_mastery`
- Canonical domain rollup: `public.student_domain_mastery`
- Canonical section projections: `public.student_section_projections`

## Canonical Raw Truth (Source Family Tables)
- Practice: `public.practice_session_items`
- Review: `public.review_session_items` + `public.review_error_attempts`
- Full-length: `public.full_length_exam_questions` + `public.full_length_exam_responses`

## Canonical Event Taxonomy
Only these event values are accepted for mastery writes:
- `practice_pass`
- `practice_fail`
- `review_pass`
- `review_fail`
- `test_pass`
- `test_fail`

Fail-closed behavior:
- Unknown event types are rejected before any mastery table write.
- Missing canonical question id, section, skill, or difficulty bucket (1|2|3) is rejected.

## Runtime Writer Guarantees
- `apply_learning_event_to_mastery(...)` updates the canonical derived tables listed above.
- It does **not** write `student_question_attempts` in this pass.
- It does **not** call `upsert_cluster_mastery` (cluster is deprecated).
- Compatibility syncs (if any) must remain optional and non-canonical.

## Parallel Systems Status
- `student_kpi_counters_current`: compatibility-only legacy table.
- `student_kpi_snapshots`: compatibility/analytics snapshots only.
- `student_question_attempts`: legacy/inactive unless explicitly promoted.
- `user_competencies`, `competency_events`, `user_progress`: legacy, not active runtime mastery truth.

## Reader Alignment
- Mastery product-read surfaces derive from the canonical read layer in `apps/api/src/services/mastery-read.ts`.
- Mastery summaries/weakness readers derive from `student_skill_mastery` via the read layer.
- Domain/section rollups for product UI derive from `student_domain_mastery` and `student_section_projections`.
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
