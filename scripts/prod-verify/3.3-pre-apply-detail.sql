-- ============================================================================
-- 3.3 PRE-APPLY DETAIL — every abandoned session and the stamp it carries
-- ============================================================================
-- READ-ONLY listing. Companion to 3.3-pre-apply.sql, which carries the verdict.
-- Keep the output: it is the record of what abandoned_at was derived FROM, and the
-- only way to check the repair afterwards is against this list.
--
-- source_for_abandoned_at names which column the migration will read for each row.
-- ============================================================================

SELECT
  ps.id                                        AS session_id,
  ps.user_id                                   AS student_id,
  ps.mode,
  ps.completed_at,
  ps.last_activity_at,
  CASE
    WHEN ps.completed_at IS NOT NULL THEN 'completed_at (misplaced by the abandon path)'
    ELSE 'last_activity_at (no stamp was ever written)'
  END                                          AS source_for_abandoned_at,
  COALESCE(ps.completed_at, ps.last_activity_at) AS abandoned_at_will_become
FROM public.practice_sessions ps
WHERE ps.status = 'abandoned'
ORDER BY COALESCE(ps.completed_at, ps.last_activity_at), ps.id;
