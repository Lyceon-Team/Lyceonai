-- ============================================================================
-- 3.4 POST-APPLY — 20260817030000 (student_baseline_pending)
-- ============================================================================
-- READ-ONLY. One statement. The verdict is the only result.
--
-- The view feeds GET /api/internal/baseline-pending-sweep, which alerts when a
-- student has been waiting more than 24h for a baseline. This file EXECUTES the
-- view rather than only confirming it exists — a view that parses and then fails
-- at run time (a renamed column upstream, a lost grant) is indistinguishable from
-- a healthy one until the alert is the thing that is broken.
--
-- stale_students IS REPORTED BUT DELIBERATELY NOT IN THE VERDICT.
-- A non-zero count is a finding about the DATA, not a failure of this MIGRATION.
-- Production is expected to show at least one until baseline-repair.sql has run —
-- that student is the reason this workstream exists. Folding it into the verdict
-- would make a correct deployment read as broken and push the reader toward
-- "make the number zero" instead of "read baseline-repair-preview.sql".
--
-- EXPECTED
--   view_present = 1, service_role_can_read = true
--   pending_students >= 0, stale_students >= 0   (informational)
--   verdict = 'OK — 20260817030000 applied; the staleness surface reads'
-- ============================================================================

SELECT
  (SELECT count(*) FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'student_baseline_pending')  AS view_present,
  (SELECT has_table_privilege('service_role', 'public.student_baseline_pending', 'SELECT'))
                                                                           AS service_role_can_read,
  (SELECT count(*) FROM public.student_baseline_pending)                   AS pending_students,
  (SELECT count(*) FROM public.student_baseline_pending
    WHERE pending_seconds >= 86400)                                        AS stale_students,
  (SELECT max(pending_seconds) FROM public.student_baseline_pending)       AS oldest_pending_seconds,
  (SELECT count(*) FROM public.student_baseline_pending
    WHERE pending_seconds IS NULL)                                         AS rows_with_unknown_age,
  CASE
    WHEN (SELECT count(*) FROM pg_views
           WHERE schemaname = 'public' AND viewname = 'student_baseline_pending') = 0
      THEN 'STOP — student_baseline_pending is absent; 20260817030000 did not apply'
    WHEN NOT (SELECT has_table_privilege('service_role', 'public.student_baseline_pending', 'SELECT'))
      THEN 'STOP — service_role cannot read the view; the scheduled alert will 500 on every run'
    WHEN (SELECT count(*) FROM public.student_baseline_pending
           WHERE pending_seconds IS NULL) > 0
      THEN 'STOP — a pending row has no age. The alert treats an unknown age as not stale, so those students would never be flagged.'
    ELSE 'OK — 20260817030000 applied; the staleness surface reads'
  END                                                                      AS verdict;
