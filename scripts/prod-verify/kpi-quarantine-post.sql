-- ============================================================================
-- KPI QUARANTINE — POST-APPLY VERIFICATION
-- ============================================================================
-- READ-ONLY. One statement, one row. The last column is the verdict.
--
-- Run this AFTER applying
--   supabase/migrations/20260901000000_kpi_quarantine_excluded_count.sql
--
-- WHAT IT ESTABLISHES
--   1. Both columns landed, NOT NULL with DEFAULT 0.
--   2. NEITHER function raises KPI_HISTORICAL_DATA_INVALID any more, and BOTH
--      carry the quarantine filter. Both halves are checked because "no RAISE"
--      alone would also be true of a function that had simply stopped validating
--      — the failure this change must not be confused with.
--   3. The three untouched fail-closed surfaces are STILL fail-closed:
--      compute_mastery_for_entity, refresh_domain_kpi and refresh_skill_kpi must
--      each still raise. Mastery is the truth anchor; only the display surface
--      changed posture. A migration that relaxed all five would pass check (2)
--      and be a much larger change than the one that was reviewed.
--   4. No KPI row carries a non-zero excluded_event_count. Expected on a clean
--      database: with zero malformed rows there is nothing to exclude, so this
--      change produced no observable difference in output. A non-zero value is
--      not a failure of this migration — it is the migration reporting real
--      corrupt data, and is the signal to investigate the ingress that wrote it.
--
-- VERDICT
--   OK              — applied, both amended, the three anchors still fail-closed,
--                     zero exclusions observed.
--   OK-EXCLUSIONS   — applied and correct, but real rows are being excluded.
--                     Investigate: run kpi-quarantine-detail.sql.
--   STOP-NOT-APPLIED— the functions still raise. The migration did not land.
--   STOP-MIXED      — one function amended, the other not.
--   STOP-NO-COLUMNS — functions amended but a column is missing or nullable.
--   STOP-ANCHORS    — a fail-closed anchor stopped raising. This change must not
--                     have touched them. Do not proceed; re-read the diff.
--
-- WHY excluded_event_count IS READ THROUGH to_jsonb(t) AND NOT AS A COLUMN.
--   Postgres resolves column references at PARSE time, before any CASE branch runs. A
--   direct `WHERE excluded_event_count > 0` therefore makes this whole file fail with
--   `column does not exist` on a database where the migration has NOT been applied —
--   which is precisely the state STOP-NOT-APPLIED exists to report. The verdict would be
--   documented and unreachable. Reading the value out of the row as JSON keeps the
--   statement parseable against both schema versions, so the operator gets the verdict
--   instead of a stack trace. Do not "simplify" this back to a column reference.
-- ============================================================================
SELECT
  (SELECT count(*) FROM pg_catalog.pg_attribute
     WHERE attrelid IN ('public.student_section_kpi'::regclass,'public.student_overall_kpi'::regclass)
       AND attname = 'excluded_event_count' AND attnotnull AND NOT attisdropped)          AS excluded_cols_notnull,
  (SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                     to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
       AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%')                AS amended_fns_still_raising,
  (SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                     to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
       AND pg_get_functiondef(p.oid) LIKE '%correct IS NOT NULL AND%occurred_at IS NOT NULL%')
                                                                                          AS amended_fns_with_filter,
  (SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN (to_regprocedure('public.compute_mastery_for_entity(uuid,text,text,text,text)'),
                     to_regprocedure('public.refresh_domain_kpi(uuid,text,text,timestamptz)'),
                     to_regprocedure('public.refresh_skill_kpi(uuid,text,text,timestamptz)'))
       AND pg_get_functiondef(p.oid) LIKE '%HISTORICAL_DATA_INVALID%')                    AS anchors_still_failclosed,
  (SELECT count(*) FROM public.student_section_kpi t
     WHERE (to_jsonb(t)->>'excluded_event_count')::bigint > 0)                            AS section_rows_excluding,
  (SELECT count(*) FROM public.student_overall_kpi t
     WHERE (to_jsonb(t)->>'excluded_event_count')::bigint > 0)                            AS overall_rows_excluding,
  (SELECT coalesce(sum((to_jsonb(t)->>'excluded_event_count')::bigint),0)
     FROM public.student_overall_kpi t)                                                   AS total_events_excluded,
  CASE
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                            to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%') = 2
      THEN 'STOP-NOT-APPLIED'
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                            to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%KPI_HISTORICAL_DATA_INVALID%') = 1
      THEN 'STOP-MIXED'
    WHEN (SELECT count(*) FROM pg_catalog.pg_attribute
            WHERE attrelid IN ('public.student_section_kpi'::regclass,'public.student_overall_kpi'::regclass)
              AND attname = 'excluded_event_count' AND attnotnull AND NOT attisdropped) <> 2
      THEN 'STOP-NO-COLUMNS'
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.refresh_section_kpi(uuid,text,timestamptz)'),
                            to_regprocedure('public.refresh_overall_kpi(uuid,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%correct IS NOT NULL AND%occurred_at IS NOT NULL%') <> 2
      THEN 'STOP-NO-COLUMNS'
    WHEN (SELECT count(*) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (to_regprocedure('public.compute_mastery_for_entity(uuid,text,text,text,text)'),
                            to_regprocedure('public.refresh_domain_kpi(uuid,text,text,timestamptz)'),
                            to_regprocedure('public.refresh_skill_kpi(uuid,text,text,timestamptz)'))
              AND pg_get_functiondef(p.oid) LIKE '%HISTORICAL_DATA_INVALID%') <> 3
      THEN 'STOP-ANCHORS'
    WHEN (SELECT count(*) FROM public.student_section_kpi t
            WHERE (to_jsonb(t)->>'excluded_event_count')::bigint > 0)
       + (SELECT count(*) FROM public.student_overall_kpi t
            WHERE (to_jsonb(t)->>'excluded_event_count')::bigint > 0) > 0
      THEN 'OK-EXCLUSIONS'
    ELSE 'OK'
  END                                                                                     AS verdict;
