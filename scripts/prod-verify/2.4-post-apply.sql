-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816020000_mastery_derivation_gap_detection
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- Run after `supabase db push` applies 20260816020000. See
-- MIGRATION-HISTORY-REPAIR.md step 5.
--
-- ============================================================================
-- WHY THIS FILE DID NOT EXIST UNTIL NOW — AND WHY THAT MATTERED
-- ============================================================================
-- 20260816020000 landed in commit 2ab98bb (PR #589) with a CI gate but no
-- operator-facing artifact: no prod-verify file and no entry in the run-order
-- table. It was therefore never on the list of things to apply, and it never was
-- applied. mastery_derivation_gaps did not exist on production for a week, and the
-- files that referenced it failed with 42P01.
--
-- A migration with a CI gate and no operator artifact is a migration nobody will
-- remember to apply. This file closes that specific hole; the run-order entry in
-- README.md closes the general one.
--
-- ============================================================================
-- WHAT IT CHECKS — every object the migration creates
-- ============================================================================
--   gaps_view_present            public.mastery_derivation_gaps
--   summary_view_present         public.mastery_derivation_gap_summary
--   ledger_present               public.mastery_derivation_gap_ledger
--   ledger_rls_enabled           RLS ON — genesis gate A.4 requires it on every
--                                public table, and it is the easiest statement to
--                                skip in a manual apply
--   ledger_index_present         idx_mastery_gap_ledger_observed_at
--   record_fn_present            public.record_mastery_derivation_gap()
--   grants_ok                    service_role can read both views and read+insert
--                                the ledger; PUBLIC can do none of it
--   gaps_query_ok                the view actually EXECUTES. A view can be created
--                                over a valid plan and still fail at run time; and
--                                the whole point of the detector is being able to
--                                read it.
--   open_gaps                    current gap count. Expect 0 — but this is
--                                REPORTED, not asserted: see below.
--
-- ============================================================================
-- WHY open_gaps IS NOT PART OF THE VERDICT
-- ============================================================================
-- A non-zero gap count is a real finding about the DATA, not a failure of this
-- MIGRATION. Folding it into the verdict would make a correct deployment look
-- broken, and would push whoever sees it toward "fix the count" rather than
-- "understand the gap".
--
-- Deployment success and invariant health are two different questions. This file
-- answers the first and reports the second. If open_gaps > 0 after Step 8 and a
-- proven live path, that is worth investigating on its own terms — start with
-- mastery_derivation_gap_summary, which groups by student and source kind.
--
-- EXPECTED
--   every *_present / *_ok column = true
--   open_gaps                     = 0 (reported, not asserted)
--   verdict = 'OK — gap detector deployed; views, ledger, function and grants all present'
-- ============================================================================

WITH facts AS (
  SELECT
    (to_regclass('public.mastery_derivation_gaps') IS NOT NULL)            AS gaps_view_present,
    (to_regclass('public.mastery_derivation_gap_summary') IS NOT NULL)     AS summary_view_present,
    (to_regclass('public.mastery_derivation_gap_ledger') IS NOT NULL)      AS ledger_present,

    COALESCE((SELECT c.relrowsecurity FROM pg_class c
               WHERE c.oid = to_regclass('public.mastery_derivation_gap_ledger')), false)
                                                                          AS ledger_rls_enabled,

    EXISTS (SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename  = 'mastery_derivation_gap_ledger'
               AND indexname  = 'idx_mastery_gap_ledger_observed_at')      AS ledger_index_present,

    EXISTS (SELECT 1 FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'record_mastery_derivation_gap')             AS record_fn_present
),
grants AS (
  SELECT
    (
      has_table_privilege('service_role', 'public.mastery_derivation_gaps', 'SELECT')
      AND has_table_privilege('service_role', 'public.mastery_derivation_gap_summary', 'SELECT')
      AND has_table_privilege('service_role', 'public.mastery_derivation_gap_ledger', 'SELECT')
      AND has_table_privilege('service_role', 'public.mastery_derivation_gap_ledger', 'INSERT')
      AND NOT has_table_privilege('public', 'public.mastery_derivation_gaps', 'SELECT')
      AND NOT has_table_privilege('public', 'public.mastery_derivation_gap_summary', 'SELECT')
      AND NOT has_table_privilege('public', 'public.mastery_derivation_gap_ledger', 'SELECT')
    )                                                                     AS grants_ok
),
runtime AS (
  -- Executes the view rather than merely confirming it exists. This file is only
  -- ever run AFTER the migration applied, so referencing the view by name is safe
  -- here — unlike step8-verify.sql, which must survive the detector being absent.
  SELECT
    count(*)                                                              AS open_gaps,
    true                                                                  AS gaps_query_ok
  FROM public.mastery_derivation_gaps
)
SELECT
  f.gaps_view_present,
  f.summary_view_present,
  f.ledger_present,
  f.ledger_rls_enabled,
  f.ledger_index_present,
  f.record_fn_present,
  g.grants_ok,
  r.gaps_query_ok,
  r.open_gaps,
  CASE
    WHEN NOT f.gaps_view_present
      THEN 'STOP — mastery_derivation_gaps is missing; the migration did not apply'
    WHEN NOT f.summary_view_present
      THEN 'STOP — mastery_derivation_gap_summary is missing'
    WHEN NOT f.ledger_present
      THEN 'STOP — mastery_derivation_gap_ledger is missing'
    WHEN NOT f.ledger_rls_enabled
      THEN 'STOP — RLS is NOT enabled on mastery_derivation_gap_ledger; genesis gate A.4 requires it on every public table'
    WHEN NOT f.ledger_index_present
      THEN 'STOP — idx_mastery_gap_ledger_observed_at is missing'
    WHEN NOT f.record_fn_present
      THEN 'STOP — record_mastery_derivation_gap() is missing'
    WHEN NOT g.grants_ok
      THEN 'STOP — grants do not match: service_role needs SELECT on both views and SELECT+INSERT on the ledger, and PUBLIC must have none'
    ELSE 'OK — gap detector deployed; views, ledger, function and grants all present'
  END                                                                     AS verdict
FROM facts f CROSS JOIN grants g CROSS JOIN runtime r;
