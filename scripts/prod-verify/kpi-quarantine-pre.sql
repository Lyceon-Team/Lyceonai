-- ============================================================================
-- KPI QUARANTINE — PRE-APPLY VERIFICATION
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- Run this BEFORE applying
--   supabase/migrations/20260901000000_kpi_quarantine_excluded_count.sql
--
-- WHAT IT ESTABLISHES
--   1. The migration has not already been applied (both functions still RAISE,
--      neither KPI table carries excluded_event_count). Re-applying is harmless,
--      but a PRE that cannot tell you the state is not a pre-check.
--   2. Both canonical ingresses currently hold ZERO rows with NULL correct or
--      NULL occurred_at. This is the claim that makes the change safe to apply
--      at any time: with zero such rows, the amended functions produce byte-
--      identical output to the current ones, and excluded_event_count lands 0
--      on every row. The change is insurance, not a repair.
--   3. The seals that keep (2) true are present: the CHECK on
--      practice_session_items, and NOT NULL on both review_error_attempts
--      columns. If a seal is missing, (2) is a snapshot rather than a property.
--
-- VERDICT
--   PROCEED      — not yet applied, zero bad rows, seals intact.
--   PROCEED-DIRTY— not yet applied, but bad rows exist. Still safe to apply (the
--                  whole point is that those rows stop aborting mastery writes),
--                  and the POST file will then show a NON-ZERO excluded_event_count.
--                  Expected only if a new ingress has appeared.
--   ALREADY-APPLIED — both functions already quarantine. Run the POST file.
--   STOP-MIXED   — one function amended and the other not. Do not apply blind;
--                  a partial state means an earlier apply failed midway.
-- ============================================================================
SELECT
  (SELECT count(*) FROM public.practice_session_items
     WHERE status = 'answered' AND (is_correct IS NULL OR occurred_at IS NULL))          AS psi_bad_rows,
  (SELECT count(*) FROM public.review_error_attempts
     WHERE is_correct IS NULL OR occurred_at IS NULL)                                    AS rea_bad_rows,
  (SELECT count(*) FROM pg_catalog.pg_constraint
     WHERE conname = 'psi_resolved_requires_occurred_at')                                AS psi_check_present,
  (SELECT count(*) FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.review_error_attempts'::regclass
       AND attname IN ('is_correct','occurred_at') AND attnotnull AND NOT attisdropped)  AS rea_notnull_cols,
  (SELECT count(*) FROM pg_catalog.pg_attribute
     WHERE attrelid IN ('public.student_section_kpi'::regclass,'public.student_overall_kpi'::regclass)
       AND attname = 'excluded_event_count' AND NOT attisdropped)                        AS excluded_cols_present,
  (SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                     to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
       AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%')               AS fns_still_raising,
  CASE
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                            to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%') = 1
      THEN 'STOP-MIXED'
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                            to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%') = 0
      THEN 'ALREADY-APPLIED'
    WHEN (SELECT count(*) FROM public.practice_session_items
            WHERE status = 'answered' AND (is_correct IS NULL OR occurred_at IS NULL))
       + (SELECT count(*) FROM public.review_error_attempts
            WHERE is_correct IS NULL OR occurred_at IS NULL) > 0
      THEN 'PROCEED-DIRTY'
    ELSE 'PROCEED'
  END                                                                                    AS verdict;
