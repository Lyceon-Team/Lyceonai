-- ============================================================================
-- STEP 8 DETAIL — per-student rollup across the recomputed profiles
-- ============================================================================
-- READ-ONLY. One statement. Run alongside step8-verify.sql.
--
-- One row per student with answered items. Expect four rows:
--   3f18cbe2  62 answered   c3c97b64  14      f95b29f3   7      0ebe43d9   1
--
-- HOW TO READ IT
--   answered_items > 0 with audit_rows = 0   emission never ran for that student
--   audit_rows > 0 with domain_rows = 0      refresh_domain_mastery is failing
--   domain_rows > 0 with projections = 0     expected below the 05C Q4 gate; only
--                                            3f18cbe2 clears it, so only that row
--                                            MUST show a projection
--   backfill_stamped = 0                     rows exist but not from the recompute
-- ============================================================================

SELECT
  pi.user_id                                                                  AS student_id,
  count(*) FILTER (WHERE pi.status = 'answered')                              AS answered_items,
  (SELECT count(*) FROM public.mastery_event_audit_log al
    WHERE al.student_id = pi.user_id)                                         AS audit_rows,
  (SELECT count(*) FROM public.student_skill_mastery sm
    WHERE sm.student_id = pi.user_id)                                         AS skill_rows,
  (SELECT count(*) FROM public.student_domain_mastery dm
    WHERE dm.student_id = pi.user_id)                                         AS domain_rows,
  (SELECT count(*) FROM public.student_projection_refresh_state rs
    WHERE rs.student_id = pi.user_id)                                         AS refresh_state_rows,
  (SELECT count(*) FROM public.student_section_projections sp
    WHERE sp.student_id = pi.user_id)                                         AS projections,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log ral
    WHERE ral.student_id = pi.user_id
      AND ral.triggered_by = 'backfill_recompute')                            AS backfill_stamped,
  (SELECT count(*) FROM public.mastery_derivation_gaps g
    WHERE g.student_id = pi.user_id)                                          AS derivation_gaps
FROM public.practice_session_items pi
WHERE pi.status = 'answered' AND pi.user_id IS NOT NULL
GROUP BY pi.user_id
ORDER BY count(*) DESC;
