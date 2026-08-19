-- ============================================================================
-- 3.3 PRE-APPLY — scope of the abandoned_at repair (20260817020000)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- The migration repairs every abandoned session and then seals the shape with a
-- CHECK. This file reports what it is about to touch, so the numbers are on the
-- record BEFORE the repair rather than reconstructed after it.
--
-- WHAT GETS REPAIRED
--   abandoned_with_completed_at  rows the buggy abandon path stamped. Their
--                                completed_at IS the moment of abandonment — wrong
--                                column, right timestamp — so it moves to
--                                abandoned_at and completed_at is cleared.
--   abandoned_without_any_stamp  rows with no completed_at at all. Their
--                                abandoned_at comes from last_activity_at. Exactly
--                                one such row is expected: the surplus diagnostic
--                                closed by resolve-duplicate-diagnostic.sql, which
--                                deliberately refuses to stamp completed_at.
--
-- There is no verdict that blocks here. Both numbers are legitimate inputs and the
-- migration handles both; the point is to know them. The one genuine STOP is a
-- migration that has already been applied, because re-reading this file then tells
-- you nothing about what it did.
--
-- EXPECTED (production, 2026-08-17, before apply)
--   column_already_present = 0
--   abandoned_without_any_stamp = 1   the resolved surplus diagnostic
--   verdict = 'OK — safe to apply 20260817020000'
--
-- Companion listing: 3.3-pre-apply-detail.sql
-- ============================================================================

SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions'
      AND column_name = 'abandoned_at')                            AS column_already_present,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned')                                    AS abandoned_total,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned' AND completed_at IS NOT NULL)       AS abandoned_with_completed_at,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'abandoned' AND completed_at IS NULL)           AS abandoned_without_any_stamp,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status = 'completed' AND completed_at IS NULL)           AS completed_missing_completed_at,
  (SELECT count(*) FROM public.practice_sessions
    WHERE status IN ('created','active') AND completed_at IS NOT NULL)
                                                                   AS in_flight_with_completed_at,
  CASE
    WHEN (SELECT count(*) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'practice_sessions'
             AND column_name = 'abandoned_at') > 0
      THEN 'ALREADY APPLIED — 20260817020000 is on; run 3.3-post-apply.sql instead'
    WHEN (SELECT count(*) FROM public.practice_sessions
           WHERE status IN ('created','active') AND completed_at IS NOT NULL) > 0
      THEN 'STOP — an in-flight session carries completed_at. The repair only touches status=abandoned, so this row keeps a completion stamp it never earned — the same defect, in a state the migration does not cover. Find out what wrote it before applying.'
    ELSE 'OK — safe to apply 20260817020000'
  END                                                              AS verdict;
