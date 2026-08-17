-- ============================================================================
-- 3.3 POST-APPLY — 20260817020000 (abandoned_at; BUG-4 sealed)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- Three properties, and all three are needed:
--   repaired   no abandoned row still carries completed_at
--   complete   every abandoned row HAS an abandoned_at (a repair that skipped rows
--              would satisfy the first property by doing nothing)
--   sealed     the CHECK exists, so the next writer cannot undo either
--
-- NEGATIVE CONTROL. completed sessions must be untouched: the repair predicate is
-- status='abandoned', and a widened one would clear completed_at from genuinely
-- completed work — silent, unrecoverable, and invisible to the first two
-- properties. completed_missing_completed_at is that control.
--
-- EXPECTED
--   column_present = 1, constraint_present = 1
--   abandoned_with_completed_at = 0
--   abandoned_without_abandoned_at = 0
--   completed_missing_completed_at = 0    <- the negative control
--   verdict = 'OK — 20260817020000 applied; abandoned rows repaired and sealed, completed sessions untouched'
-- ============================================================================

SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions'
      AND column_name = 'abandoned_at')                            AS column_present,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'practice_sessions_abandoned_not_completed')   AS constraint_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'practice_sessions_abandoned_not_completed')   AS constraint_definition,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned')                                    AS abandoned_total,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned' AND completed_at IS NOT NULL)       AS abandoned_with_completed_at,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned' AND abandoned_at IS NULL)           AS abandoned_without_abandoned_at,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'completed' AND completed_at IS NULL)           AS completed_missing_completed_at,
  CASE
    WHEN (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'practice_sessions'
             AND column_name = 'abandoned_at') = 0
      THEN 'STOP — abandoned_at is absent; 20260817020000 did not apply'
    WHEN (SELECT count(*) FROM pg_constraint
           WHERE conname = 'practice_sessions_abandoned_not_completed') = 0
      THEN 'STOP — the CHECK is absent; the rows may be repaired but nothing stops the next write reintroducing BUG-4'
    WHEN (SELECT count(*) FROM public.practice_sessions
           WHERE status = 'abandoned' AND completed_at IS NOT NULL) > 0
      THEN 'STOP — an abandoned row still carries completed_at'
    WHEN (SELECT count(*) FROM public.practice_sessions
           WHERE status = 'abandoned' AND abandoned_at IS NULL) > 0
      THEN 'STOP — an abandoned row has no abandoned_at; the repair skipped it'
    WHEN (SELECT count(*) FROM public.practice_sessions
           WHERE status = 'completed' AND completed_at IS NULL) > 0
      THEN 'STOP — NEGATIVE CONTROL FAILED: a COMPLETED session lost its completed_at. The repair predicate reached beyond abandoned rows.'
    ELSE 'OK — 20260817020000 applied; abandoned rows repaired and sealed, completed sessions untouched'
  END                                                              AS verdict;
