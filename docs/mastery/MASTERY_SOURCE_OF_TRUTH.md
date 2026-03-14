# Mastery Source of Truth

## Canonical Table
- Canonical runtime mastery state is stored in `student_skill_mastery`.
- `student_cluster_mastery` is a canonical secondary rollup updated by the same write choke point.
- Raw attempt history is stored in `student_question_attempts`.

## Canonical Writer
- The only runtime mastery writer is:
  - `apps/api/src/services/mastery-write.ts`
  - function: `applyMasteryUpdate(...)`
- This choke point validates event type, logs raw attempt, and applies mastery rollups through:
  - `upsert_skill_mastery`
  - `upsert_cluster_mastery`

## Event Taxonomy
- `PRACTICE_SUBMIT`:
  - Source: `server/routes/practice-canonical.ts` answer submit flow.
  - Weight: baseline.
- `DIAGNOSTIC_SUBMIT`:
  - Source: `apps/api/src/routes/diagnostic.ts`.
  - Weight: stronger than practice.
- `FULL_LENGTH_SUBMIT`:
  - Source: `apps/api/src/services/fullLengthExam.ts` module submission flow.
  - Weight: highest trust.
- `REVIEW_PASS` / `REVIEW_FAIL`:
  - Source: `server/routes/review-session-routes.ts` submit flow.
  - Emitted only from served review session items.
- `TUTOR_HELPED` / `TUTOR_FAIL`:
  - Source: `server/routes/review-session-routes.ts` only when tutor context is verified alongside review retry.
  - Never emitted from tutor-only opens.
- `TUTOR_VIEW`:
  - Source meaning: tutor open/view interaction.
  - Mastery effect: no rollup mutation.
## Deprecated and Derived Paths
- Deprecated as runtime mastery writers:
  - `user_competencies` writes (removed from active runtime).
  - `user_progress` as learning-state reader (retired from tutor profile derivation).
- Retained as derived/reporting-only:
  - `competency_events` in `apps/api/src/routes/progress.ts`.
- Canonical-derived reader helper:
  - `apps/api/src/services/mastery-derived.ts`
  - Used by weak-area/progress readers and tutor profile competency mapping.

## Reader Migration Notes
- Weak-area readers now derive from `student_skill_mastery` via `getDerivedWeaknessSignals(...)`.
- Tutor profile competency map now derives from `student_skill_mastery` (not `user_progress`).
- Adaptive weak-question selection reads canonical-derived weakness aliases from `student_skill_mastery`.
- Guardian weakness rollups now use canonical-derived mastery signals.

## DB Cleanup Needed
- Optional but recommended after soak period:
1. Freeze legacy tables to reporting-only by revoking app write privileges for:
   - `user_competencies`
   - `user_progress`
2. Backfill any reporting dependencies from canonical tables/views if needed.
3. Drop or archive legacy tables once dashboards/readers are fully migrated.
4. Keep `competency_events` only if reporting needs it; otherwise archive and remove.
