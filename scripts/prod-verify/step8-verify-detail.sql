-- ============================================================================
-- STEP 8 DETAIL — per-student rollup across the recomputed profiles
-- ============================================================================
-- READ-ONLY. One statement. Run alongside step8-verify.sql.
--
-- One row per student with answered items. Expect four rows:
--   3f18cbe2  62 answered   c3c97b64  14      f95b29f3   7      0ebe43d9   1
--
-- HOW TO READ IT
--   answered_items > 0 with skill_rows = 0     the backfill did not reach this student
--   skill_rows > 0 with domain_rows = 0        refresh_domain_mastery is failing
--   domain_rows > 0 with projected_mid NULL    EXPECTED below the Q4 gate. The gate
--                                              needs all EIGHT canonical (section,
--                                              domain) pairs at >= mastery_min_events()
--                                              events, across BOTH sections. Only
--                                              3f18cbe2 clears it; the other three
--                                              correctly show NULL.
--   backfill_stamped = 0                       rows exist but not from the recompute
--
--   audit_rows is expected to be 0 for every student after a pure backfill —
--   only apply_mastery_event writes that table, and the backfill replays history
--   through recompute_skill_mastery instead of emitting events. See the header of
--   step8-verify.sql for the full call-path reasoning before "fixing" it.
--
-- This file deliberately does NOT query mastery_derivation_gaps. That view is
-- created by migration 20260816020000, which is NOT currently applied to
-- production — referencing it fails at PARSE time with 42P01 and makes the whole
-- file unrunnable. step8-verify.sql reports whether the detector is deployed.
-- ============================================================================

SELECT
  pi.user_id                                                                  AS student_id,
  count(*) FILTER (WHERE pi.status = 'answered')                              AS answered_items,
  (SELECT count(*) FROM public.student_skill_mastery sm
    WHERE sm.student_id = pi.user_id)                                         AS skill_rows,
  (SELECT count(*) FROM public.student_domain_mastery dm
    WHERE dm.student_id = pi.user_id)                                         AS domain_rows,
  (SELECT count(*) FROM public.student_domain_mastery dm
    WHERE dm.student_id = pi.user_id
      AND dm.event_count_total >= public.mastery_min_events())                AS domains_at_gate,
  (SELECT max(sp.projected_score_mid) FROM public.student_section_projections sp
    WHERE sp.student_id = pi.user_id AND sp.section = 'M')                    AS projected_mid_m,
  (SELECT max(sp.projected_score_mid) FROM public.student_section_projections sp
    WHERE sp.student_id = pi.user_id AND sp.section = 'RW')                   AS projected_mid_rw,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log ral
    WHERE ral.student_id = pi.user_id
      AND ral.triggered_by = 'backfill_recompute')                            AS backfill_stamped,
  (SELECT count(*) FROM public.mastery_event_audit_log al
    WHERE al.student_id = pi.user_id)                                         AS audit_rows,
  (SELECT count(*) FROM public.student_projection_refresh_state rs
    WHERE rs.student_id = pi.user_id)                                         AS refresh_state_rows
FROM public.practice_session_items pi
WHERE pi.status = 'answered' AND pi.user_id IS NOT NULL
GROUP BY pi.user_id
ORDER BY count(*) DESC;
