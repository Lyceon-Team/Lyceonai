-- ============================================================================
-- DIAGNOSTIC PROJECTION — BACKFILL + REPORT (writes). Run AFTER
-- supabase/migrations/20261106010000_diagnostic_projection.sql is applied.
-- ============================================================================
-- @spec [SCL-236; owner ruling 2026-10-16 (5: "Backfill every student who has completed the
--        diagnostic"); brief step 7 ("Report the old baseline next to the new value for each")]
--        | @implemented [2026-10-17]
--
-- WRITES to public.student_diagnostic_projections only, and only through
-- public.diagnostic_projection_repair — the same function the daily sweep runs, so the backfill
-- and the sweep cannot disagree. Each completed diagnostic's projection is computed from THAT
-- SESSION'S ANSWERS ONLY (never the live projection, never later practice). Touches no session,
-- no mastery row, no live projection, and no old diagnostic_baseline snapshot (those stay as
-- audit history).
--
-- HOW TO RUN: paste the whole file into the SQL console. Two statements; the report is the last.
-- IDEMPOTENT: a stored projection is write-once (ON CONFLICT DO NOTHING inside the repair), so a
-- second run stores nothing and reports the same values. Re-running is safe.
--
-- READING THE REPORT (one row per student with a completed diagnostic):
--   old_baseline_*  the diagnostic_baseline snapshot captured by the retired path (a copy of the
--                   live projection at completion), NULL where none was ever captured
--   new_*           the stored diagnostic projection, from the diagnostic's answers only
--   status          computed | insufficient_evidence (a skipped question left a domain under the
--                   evidence gate: stored, no numbers — ruling D1 = (a))
--   state           student_diagnostic_state() — every row should read baseline_ready
--   verdict         STORED | STORED_INSUFFICIENT | MISSING (a MISSING row is a repair failure:
--                   check the WARNING lines of statement 1)
-- ============================================================================

SELECT public.diagnostic_projection_repair(1000) AS repair_result;

SELECT
  split_part(p.email, '@', 1)                                        AS student,
  ps.completed_at                                                    AS diagnostic_completed_at,
  ob.m_mid                                                           AS old_baseline_math,
  ob.rw_mid                                                          AS old_baseline_rw,
  ob.m_mid + ob.rw_mid                                               AS old_baseline_total,
  dm.projected_score_mid                                             AS new_math,
  dm.projected_score_low || '-' || dm.projected_score_high           AS new_math_range,
  drw.projected_score_mid                                            AS new_rw,
  drw.projected_score_low || '-' || drw.projected_score_high         AS new_rw_range,
  dm.projected_score_mid + drw.projected_score_mid                   AS new_total,
  dm.answered_count + drw.answered_count                             AS answered,
  COALESCE(dm.status, 'none')                                        AS status,
  public.student_diagnostic_state(ps.user_id)                        AS state,
  CASE
    WHEN dm.status IS NULL OR drw.status IS NULL                     THEN 'MISSING'
    WHEN dm.status = 'computed' AND drw.status = 'computed'          THEN 'STORED'
    ELSE                                                                  'STORED_INSUFFICIENT'
  END                                                                AS verdict
FROM public.practice_sessions ps
JOIN public.profiles p ON p.id = ps.user_id
LEFT JOIN LATERAL (
  SELECT
    max(sn.projected_score_mid) FILTER (WHERE sn.section = 'M')  AS m_mid,
    max(sn.projected_score_mid) FILTER (WHERE sn.section = 'RW') AS rw_mid
  FROM public.student_section_projection_snapshots sn
  WHERE sn.student_id    = ps.user_id
    AND sn.snapshot_kind = 'diagnostic_baseline'
) ob ON true
LEFT JOIN public.student_diagnostic_projections dm
  ON dm.practice_session_id = ps.id AND dm.section = 'M'
LEFT JOIN public.student_diagnostic_projections drw
  ON drw.practice_session_id = ps.id AND drw.section = 'RW'
WHERE ps.mode = 'diagnostic'
  AND ps.status = 'completed'
  AND ps.user_id IS NOT NULL
ORDER BY ps.completed_at NULLS LAST, ps.id;
