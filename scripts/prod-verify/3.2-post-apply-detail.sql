-- ============================================================================
-- 3.2 POST-APPLY DETAIL — who is in which diagnostic state
-- ============================================================================
-- READ-ONLY listing. Companion to 3.2-post-apply.sql, which carries the verdict.
-- Run this when the verdict says STOP, or to record the state distribution before
-- and after baseline-repair.sql.
--
-- Reading it: a student in baseline_pending finished the diagnostic and has no
-- usable baseline. If diagnostic_finished_at is days ago, they are the population
-- /api/internal/baseline-pending-sweep alerts on, and baseline-repair.sql is the
-- file that resolves them — provided their live projection is non-NULL. Check
-- baseline-repair-preview.sql before assuming it can.
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
