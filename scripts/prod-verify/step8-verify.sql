-- ============================================================================
-- STEP 8 ACCEPTANCE — did the recompute actually rebuild mastery?
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
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
--     recomputed provenance distinguishable from live event-time writes. A zero
--     here with mastery present means the rows came from somewhere else.
--
-- Per-student breakdown: run step8-verify-detail.sql.
-- ============================================================================

WITH census AS (
  SELECT
    (SELECT count(*) FROM public.student_skill_mastery)              AS skill_mastery_rows,
    (SELECT count(*) FROM public.student_domain_mastery)             AS domain_mastery_rows,
    (SELECT count(*) FROM public.student_projection_refresh_state)   AS projection_refresh_rows,
    (SELECT count(*) FROM public.student_section_projections)        AS projection_rows,
    (SELECT count(*) FROM public.mastery_event_audit_log)            AS audit_rows,
    (SELECT count(*) FROM public.mastery_derivation_gaps)            AS derivation_gaps,
    (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
      WHERE triggered_by = 'backfill_recompute')                     AS backfill_stamped_rows,
    -- the load-bearing one, scoped to the pinned profile
    (SELECT count(*) FROM public.student_section_projections sp
      JOIN public.profiles p ON p.id = sp.student_id
     WHERE p.id::text LIKE '3f18cbe2%')                              AS q4_projection_rows,
    (SELECT count(*) FROM public.student_domain_mastery dm
      JOIN public.profiles p ON p.id = dm.student_id
     WHERE p.id::text LIKE '3f18cbe2%')                              AS q4_domain_rows
)
SELECT
  c.skill_mastery_rows,
  c.domain_mastery_rows,
  c.projection_refresh_rows,
  c.projection_rows,
  c.audit_rows,
  c.derivation_gaps,
  0                                   AS derivation_gaps_expected,
  c.backfill_stamped_rows,
  c.q4_domain_rows,
  c.q4_projection_rows,
  CASE
    WHEN c.derivation_gaps > 0
      THEN 'STOP — derivation gaps remain; mastery is still not being emitted for some events'
    WHEN c.projection_refresh_rows = 0
      THEN 'STOP — projection refresh state empty; apply_mastery_event still never runs to completion'
    WHEN c.domain_mastery_rows = 0
      THEN 'STOP — no domain mastery; refresh_domain_mastery is still failing'
    WHEN c.backfill_stamped_rows = 0
      THEN 'STOP — no audit row stamped backfill_recompute; recomputed provenance was not recorded'
    WHEN c.q4_projection_rows = 0
      THEN 'STOP — 3f18cbe2 has no projection despite clearing the 05C Q4 gate'
    ELSE 'OK — mastery pipeline is emitting, rolling up, and projecting'
  END                                 AS verdict
FROM census c;
