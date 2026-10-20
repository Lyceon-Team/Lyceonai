-- ============================================================================
-- 3.2 POST-APPLY DETAIL — who is in which diagnostic state
-- ============================================================================
-- READ-ONLY listing. Companion to 3.2-post-apply.sql, which carries the verdict.
-- Run this when the verdict says STOP, or to record the state distribution before
-- and after diagnostic-projection-backfill.sql (SCL-236; it replaced baseline-repair.sql).
--
-- Reading it: a student in baseline_pending finished the diagnostic and has no
-- usable baseline. If diagnostic_finished_at is days ago, they are the population
-- /api/internal/baseline-pending-sweep now REPAIRS (diagnostic_projection_repair), and
-- diagnostic-projection-backfill.sql runs the same repair by hand. Since SCL-236 the stored
-- diagnostic projection is computed from the diagnostic's own answers, so it no longer waits on
-- the live projection.
-- ============================================================================

SELECT
  s.student_id,
  s.state,
  s.completed_diagnostic_count,
  s.in_flight_diagnostic_count,
  s.diagnostic_finished_at,
  s.baseline_scored_sections,
  s.baseline_captured_at
FROM public.student_diagnostic_states s
ORDER BY
  CASE s.state
    WHEN 'baseline_pending' THEN 0
    WHEN 'in_progress'      THEN 1
    WHEN 'baseline_ready'   THEN 2
    ELSE 3
  END,
  s.diagnostic_finished_at NULLS LAST,
  s.student_id;
