-- ============================================================================
-- 4.1 POST-APPLY — 20260818000000 (the backfill is not a gap)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- Before this migration the detector reported 84 gaps out of 91 answered items:
-- every item the Step 8 backfill rebuilt. backfill_recompute_student writes no
-- per-event audit row, so "correctly rebuilt" and "never derived" looked
-- identical to the view.
--
-- WHAT THE VERDICT IS ABOUT
--   The MIGRATION, not the data. It asserts that both branches of the view carry
--   the backfill exclusion — checked against pg_get_viewdef, so a partial apply
--   that fixed the practice branch and left the review branch alone is caught.
--
-- WHY open_gaps IS REPORTED BUT NOT IN THE VERDICT
--   A non-zero count after this applies is a finding about the DATA — a genuinely
--   un-emitted event, which is exactly what the detector is for. Folding it into
--   the verdict would make a correct deployment read as broken and push the reader
--   toward silencing the number instead of investigating it.
--
-- EXPECTED (production, 2026-08-18)
--   practice_branch_excludes_backfill = true
--   review_branch_excludes_backfill   = true
--   answered_items       = 91   (unchanged by this migration)
--   live_audit_rows      = 7    (unchanged)
--   open_gaps            = 0    was 84
--   verdict = 'OK — 20260818000000 applied; both branches exclude backfilled events'
--
-- If open_gaps is non-zero, run 2.4-post-apply.sql's listing and treat each row as
-- a real un-emitted event before touching this view again.
-- ============================================================================

SELECT
  (SELECT count(*) FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gaps')     AS view_present,
  (SELECT (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ral.student_id = pi.user_id%')
     AND (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%pi.occurred_at <= ral.applied_at%'))
                                                                             AS practice_branch_excludes_backfill,
  (SELECT (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ral.student_id = ra.student_id%')
     AND (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ra.occurred_at <= ral.applied_at%'))
                                                                             AS review_branch_excludes_backfill,
  (SELECT count(*) FROM public.practice_session_items WHERE status = 'answered')
                                                                             AS answered_items,
  (SELECT count(*) FROM public.mastery_event_audit_log)                      AS live_audit_rows,
  (SELECT count(*) FROM public.mastery_domain_refresh_audit_log
    WHERE triggered_by = 'backfill_recompute')                               AS backfill_audit_rows,
  (SELECT count(*) FROM public.mastery_derivation_gaps)                      AS open_gaps,
  CASE
    WHEN (SELECT count(*) FROM pg_views
           WHERE schemaname = 'public' AND viewname = 'mastery_derivation_gaps') = 0
      THEN 'STOP — mastery_derivation_gaps is absent; 20260818000000 did not apply'
    WHEN NOT (SELECT (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ral.student_id = pi.user_id%')
                 AND (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%pi.occurred_at <= ral.applied_at%'))
      THEN 'STOP — the PRACTICE branch does not exclude backfilled events; the old definition is still live'
    WHEN NOT (SELECT (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ral.student_id = ra.student_id%')
                 AND (pg_get_viewdef('public.mastery_derivation_gaps'::regclass) LIKE '%ra.occurred_at <= ral.applied_at%'))
      THEN 'STOP — the REVIEW branch does not exclude backfilled events; only half the migration is live'
    ELSE 'OK — 20260818000000 applied; both branches exclude backfilled events'
  END                                                                        AS verdict;
