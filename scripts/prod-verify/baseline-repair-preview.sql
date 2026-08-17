-- ============================================================================
-- BASELINE REPAIR PREVIEW — which students are owed a diagnostic baseline?
-- ============================================================================
-- READ-ONLY. One statement. Run this BEFORE baseline-repair.sql and keep the
-- output — it is the record of who was repaired and with what numbers.
--
-- WHY ANYONE IS OWED ONE
--   captureDiagnosticBaseline (server/routes/practice-canonical.ts:2984-2997)
--   requires BOTH sections to have a non-NULL projected_score_mid. If fewer than
--   two are non-NULL it logs baseline_skipped_evidence_gate and RETURNS, writing
--   nothing — and the call site treats that as non-fatal. Capture fires only at
--   the instant the diagnostic completes. There is no retry.
--
--   During the mastery outage every projection was all-NULL, so the capture was
--   skipped while the session was still marked 'completed'. The result is a
--   student who finished a diagnostic, has no baseline row, and therefore reads as
--   estimateStatus='no_baseline' forever — permanently prompted to take a
--   diagnostic they already took.
--
-- WHAT `repairable` MEANS HERE
--   A student is repairable when ALL of:
--     * they have a completed diagnostic session
--     * they have NO diagnostic_baseline snapshot for either section
--     * their CURRENT live projection has a non-NULL projected_score_mid in BOTH
--       sections — i.e. the evidence gate that failed at completion time now passes
--
--   The third condition is why this is a repair and not a fabrication. The
--   baseline is copied from the projection the mastery pipeline computed; nothing
--   is invented. A student whose projection is still all-NULL is NOT repairable and
--   must not be given a baseline — they belong in baseline_pending until the
--   pipeline produces real numbers.
--
-- EXPECTED: one row per student with a completed diagnostic. repairable=true is
-- the set baseline-repair.sql will write.
-- ============================================================================

SELECT
  p.id                                                              AS student_id,
  (SELECT count(*) FROM public.practice_sessions ps
    WHERE ps.user_id = p.id AND ps.mode = 'diagnostic'
      AND ps.status = 'completed')                                  AS completed_diagnostics,
  (SELECT count(*) FROM public.student_section_projection_snapshots sn
    WHERE sn.student_id = p.id
      AND sn.snapshot_kind = 'diagnostic_baseline')                 AS existing_baseline_rows,
  (SELECT sp.projected_score_mid FROM public.student_section_projections sp
    WHERE sp.student_id = p.id AND sp.section = 'M')                AS live_mid_m,
  (SELECT sp.projected_score_mid FROM public.student_section_projections sp
    WHERE sp.student_id = p.id AND sp.section = 'RW')               AS live_mid_rw,
  (
    (SELECT count(*) FROM public.student_section_projection_snapshots sn
      WHERE sn.student_id = p.id
        AND sn.snapshot_kind = 'diagnostic_baseline') = 0
    AND (SELECT sp.projected_score_mid FROM public.student_section_projections sp
          WHERE sp.student_id = p.id AND sp.section = 'M') IS NOT NULL
    AND (SELECT sp.projected_score_mid FROM public.student_section_projections sp
          WHERE sp.student_id = p.id AND sp.section = 'RW') IS NOT NULL
  )                                                                 AS repairable
FROM public.profiles p
WHERE EXISTS (
  SELECT 1 FROM public.practice_sessions ps
   WHERE ps.user_id = p.id
     AND ps.mode = 'diagnostic'
     AND ps.status = 'completed'
)
ORDER BY p.id;
