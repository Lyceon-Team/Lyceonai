-- ============================================================================
-- STEP 8 ACCEPTANCE — did the recompute actually rebuild mastery?
-- ============================================================================
-- READ-ONLY. Run after step8-recompute.sql.
--
-- THE LOAD-BEARING ASSERTION (owner ruling 2026-08-16)
--   Profile 3f18cbe2 has 8 domains x 5 events, which clears Doc 05C's Q4 hard
--   gate. A projection MUST materialize for that student. If it does not,
--   something else is still broken and this workstream is NOT done. Row counts
--   being non-zero elsewhere is necessary but not sufficient — the projection is
--   the end-to-end proof that the whole chain ran, because it sits at the far end
--   of it: skill -> domain -> 4 KPI -> projection.
--
-- ALSO ASSERTED
--   * zero derivation gaps remain (the Step 2.4 detector agrees)
--   * domain mastery is non-empty
--   * projection refresh state is non-empty — bump_projection_refresh_counter is
--     the final statement of apply_mastery_event, so a row here is proof the
--     function ran to completion. It had 0 rows for the entire outage.
--   * audit rows are stamped triggered_by = 'backfill_recompute', keeping
--     recomputed provenance distinguishable from live event-time writes
--
-- USAGE: psql -f scripts/prod-verify/step8-verify.sql
-- ============================================================================

\pset footer off
\echo '=== STEP 8 ACCEPTANCE ==='

SELECT
  (SELECT count(*) FROM public.student_skill_mastery)              AS skill_mastery_rows,
  (SELECT count(*) FROM public.student_domain_mastery)             AS domain_mastery_rows,
  (SELECT count(*) FROM public.student_projection_refresh_state)   AS projection_refresh_rows,
  (SELECT count(*) FROM public.student_section_projections)        AS projection_rows,
  (SELECT count(*) FROM public.mastery_event_audit_log)            AS audit_rows,
  (SELECT count(*) FROM public.mastery_derivation_gaps)            AS derivation_gaps,
  0                                                                AS derivation_gaps_expected;

\echo ''
\echo '--- LOAD-BEARING: projection for 3f18cbe2 (8 domains x 5 events clears the 05C Q4 gate) ---'

SELECT
  p.id AS student_id,
  (SELECT count(*) FROM public.student_domain_mastery dm WHERE dm.student_id = p.id)   AS domain_mastery_rows,
  (SELECT count(*) FROM public.student_projection_refresh_state rs WHERE rs.student_id = p.id) AS refresh_state_rows,
  (SELECT count(*) FROM public.student_section_projections sp WHERE sp.student_id = p.id)      AS projection_rows,
  CASE
    WHEN (SELECT count(*) FROM public.student_section_projections sp WHERE sp.student_id = p.id) > 0
      THEN 'OK — projection materialized'
    ELSE 'STOP — no projection despite clearing the 05C Q4 gate; the chain is still broken'
  END AS verdict
FROM public.profiles p
WHERE p.id::text LIKE '3f18cbe2%';

\echo ''
\echo '--- per-student rollup across the four recomputed profiles ---'

SELECT
  pi.user_id AS student_id,
  count(*) FILTER (WHERE pi.status = 'answered')                                          AS answered_items,
  (SELECT count(*) FROM public.mastery_event_audit_log al WHERE al.student_id = pi.user_id) AS audit_rows,
  (SELECT count(*) FROM public.student_skill_mastery sm WHERE sm.student_id = pi.user_id)   AS skill_rows,
  (SELECT count(*) FROM public.student_domain_mastery dm WHERE dm.student_id = pi.user_id)  AS domain_rows,
  (SELECT count(*) FROM public.student_section_projections sp WHERE sp.student_id = pi.user_id) AS projections
FROM public.practice_session_items pi
WHERE pi.status = 'answered' AND pi.user_id IS NOT NULL
GROUP BY pi.user_id
ORDER BY count(*) DESC;

\echo ''
\echo '--- provenance: recomputed audit rows must be stamped backfill_recompute ---'

SELECT triggered_by, count(*) AS n
FROM public.mastery_domain_refresh_audit_log
GROUP BY triggered_by
ORDER BY triggered_by;

\echo ''
\echo '--- remaining derivation gaps (expect none) ---'

SELECT student_id, event_source_kind, count(*) AS gap_count
FROM public.mastery_derivation_gaps
GROUP BY student_id, event_source_kind
ORDER BY count(*) DESC;

\echo ''
\echo '--- overall verdict ---'

SELECT CASE
  WHEN (SELECT count(*) FROM public.mastery_derivation_gaps) > 0
    THEN 'STOP — derivation gaps remain; mastery is still not being emitted for some events'
  WHEN (SELECT count(*) FROM public.student_projection_refresh_state) = 0
    THEN 'STOP — projection refresh state empty; apply_mastery_event still never runs to completion'
  WHEN (SELECT count(*) FROM public.student_domain_mastery) = 0
    THEN 'STOP — no domain mastery; refresh_domain_mastery is still failing'
  WHEN NOT EXISTS (
        SELECT 1 FROM public.student_section_projections sp
         JOIN public.profiles p ON p.id = sp.student_id
        WHERE p.id::text LIKE '3f18cbe2%')
    THEN 'STOP — 3f18cbe2 has no projection despite clearing the 05C Q4 gate'
  ELSE 'OK — mastery pipeline is emitting, rolling up, and projecting'
END AS overall_verdict;
