-- ============================================================================
-- 3.1 PRE-APPLY — safe to apply 20260817000000 (one completed diagnostic)?
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- The index makes a second COMPLETED diagnostic unrepresentable. Two different
-- things can stop it going on cleanly, and only one of them the migration can see
-- for itself:
--
--   (a) a student who ALREADY holds two completed diagnostics. The migration's own
--       preamble refuses on this and names them, so this file reports it early
--       rather than discovering it mid-apply.
--
--   (b) a student who holds one completed diagnostic AND an in-flight one. The
--       index builds fine over that. The damage arrives later: the fortieth answer
--       on the in-flight session tries to complete it, hits 23505, and surfaces to
--       the student as a 500 on their final answer. Per ruling Q1 the automated
--       sweep never touches diagnostics, so that session can then be neither
--       completed nor closed. A permanent zombie.
--
--   (b) is the reason this file exists. Production holds exactly one such student
--   (3f18cbe2, sessions 86b0dc8f completed and 18187611 active), and
--   scripts/prod-verify/resolve-duplicate-diagnostic.sql is what resolves it.
--   RUN THAT FIRST. This file is the check that it was run.
--
-- EXPECTED
--   students_with_two_completed = 0
--   students_completed_and_in_flight = 0   after resolve-duplicate-diagnostic.sql
--   verdict = 'OK — safe to apply 20260817000000'
--
-- If students_completed_and_in_flight is non-zero, STOP and run
-- resolve-duplicate-diagnostic-preview.sql to see who. Do not apply the index over
-- it: nothing breaks at apply time, which is exactly what makes it dangerous.
--
-- USAGE: paste into the SQL console.
-- ============================================================================

SELECT
  (SELECT count(*) FROM (
     SELECT ps.user_id
       FROM public.practice_sessions ps
      WHERE ps.mode = 'diagnostic' AND ps.status = 'completed'
        AND ps.user_id IS NOT NULL
      GROUP BY ps.user_id
     HAVING count(*) > 1) t)                                     AS students_with_two_completed,
  (SELECT count(*) FROM (
     SELECT ps.user_id
       FROM public.practice_sessions ps
      WHERE ps.mode = 'diagnostic' AND ps.user_id IS NOT NULL
      GROUP BY ps.user_id
     HAVING count(*) FILTER (WHERE ps.status = 'completed') > 0
        AND count(*) FILTER (WHERE ps.status IN ('created','active')) > 0) t)
                                                                 AS students_completed_and_in_flight,
  (SELECT count(*) FROM public.practice_sessions
    WHERE mode = 'diagnostic' AND status = 'completed')          AS completed_diagnostics_total,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'practice_sessions_one_completed_diagnostic_uq')
                                                                 AS index_already_present,
  CASE
    WHEN (SELECT count(*) FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'practice_sessions_one_completed_diagnostic_uq') > 0
      THEN 'ALREADY APPLIED — 20260817000000 is on; run 3.1-post-apply.sql instead'
    WHEN (SELECT count(*) FROM (
           SELECT ps.user_id FROM public.practice_sessions ps
            WHERE ps.mode = 'diagnostic' AND ps.status = 'completed'
              AND ps.user_id IS NOT NULL
            GROUP BY ps.user_id HAVING count(*) > 1) t) > 0
      THEN 'STOP — a student already holds two completed diagnostics; the migration will refuse. Resolve the surplus first.'
    WHEN (SELECT count(*) FROM (
           SELECT ps.user_id FROM public.practice_sessions ps
            WHERE ps.mode = 'diagnostic' AND ps.user_id IS NOT NULL
            GROUP BY ps.user_id
           HAVING count(*) FILTER (WHERE ps.status = 'completed') > 0
              AND count(*) FILTER (WHERE ps.status IN ('created','active')) > 0) t) > 0
      THEN 'STOP — a student holds a completed AND an in-flight diagnostic. The index would build, then strand that session on its final answer. Run resolve-duplicate-diagnostic.sql first.'
    ELSE 'OK — safe to apply 20260817000000'
  END                                                            AS verdict;
