-- ===========================================================================
-- Operational-log retention — the 90-day catch-all, given a mechanism
--
-- @spec [Privacy Policy v3 §6.7 ("Where we keep operational records that
--        include information about you and are not listed above, we keep them
--        for no more than 90 days"); Doc-06D_V1.0 §9 (a retention rule without
--        a mechanism is retention drift); Doc-01_V8 §5.1 (90-day security
--        forensics window); SCL-101]
-- @implemented 2026-09-21
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: v3 §6.7 published a 90-day ceiling on operational records
-- that name you and are not covered by one of the ten enumerated categories.
-- SCL-101 recorded that sentence as a BUILD COMMITMENT with nothing behind it.
-- This is the thing behind it.
--
-- expected outcome: four identity-bearing operational tables lose rows older
-- than 90 days, oldest first, bounded per call, on the daily retention pass.
--
-- trade-offs:
--  - ONE sweep function over a table-driven list, not four near-identical
--    functions. `sweep_notification_retention` is the shape being followed —
--    a window function that owns the number, a sweep that reports counts AND
--    the cutoff — but four copies of it would be four places for the rule to
--    drift. The list is a literal array of (table, time column) pairs; adding
--    a fifth table is one line, and the function needs no edit.
--  - The per-table time column is NAMED here rather than guessed, because the
--    four tables disagree and the wrong guess silently sweeps nothing:
--      usage_rate_limit_ledger      created_at    row birth
--      rate_limit_ledger            window_end    the window this row is about
--      tutor_turn_metrics           recorded_at   row birth
--      tutor_context_resolution_log resolved_at   row birth
--    `rate_limit_ledger` is the one that is not row birth. It has no
--    created_at; its `updated_at` moves on every increment, so a bucket under
--    continuous load would never age out. `window_end` is fixed when the row
--    is written and is what "this record is 90 days old" actually means.
--  - The batch bound is per TABLE, not per call, so one busy table cannot
--    starve the other three of their budget.
--
-- edge cases:
--  - A zero-row sweep returns a row per table with deleted_count 0 and the
--    cutoff it used, so a run that found nothing is distinguishable in the
--    logs from a run that never happened. That distinction is the whole point:
--    Vercel's cron registration cannot be read back from tooling.
--  - Re-running is safe; already-deleted rows no longer match the predicate.
--  - The function is SECURITY DEFINER and revoked from PUBLIC, matching every
--    other sweep in this schema. Only service_role may call it.
-- ===========================================================================

-- ── 1. The window — one definition, in SQL, and only here ──────────────────

CREATE OR REPLACE FUNCTION public.operational_log_retention_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 90;
$$;

COMMENT ON FUNCTION public.operational_log_retention_days() IS
  'Privacy Policy v3 §6.7: the ceiling on operational records not covered by an enumerated category, in days. THE single definition; the sweep reads it.';

-- ── 2. The sweep ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_operational_log_retention(p_batch_size integer)
RETURNS TABLE (
  swept_table   text,
  deleted_count integer,
  cutoff        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- (table, time column). The ONLY place the set is written down.
  v_targets CONSTANT text[][] := ARRAY[
    ['usage_rate_limit_ledger',      'created_at'],
    ['rate_limit_ledger',            'window_end'],
    ['tutor_turn_metrics',           'recorded_at'],
    ['tutor_context_resolution_log', 'resolved_at']
  ];
  v_cutoff  timestamptz;
  v_tbl     text;
  v_col     text;
  v_deleted integer;
  i         integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_operational_log_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - make_interval(days => public.operational_log_retention_days());

  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_tbl := v_targets[i][1];
    v_col := v_targets[i][2];

    -- ctid is the only key every one of these tables shares: rate_limit_ledger
    -- has a composite primary key and no id column, so a DELETE ... WHERE id IN
    -- (...) would not compile against it. Deleting by ctid within one statement
    -- is safe here because the subselect and the delete see the same snapshot.
    EXECUTE format(
      'WITH doomed AS (
         SELECT t.ctid FROM public.%I t
          WHERE t.%I < $1
          ORDER BY t.%I ASC
          LIMIT $2
       ), gone AS (
         DELETE FROM public.%I d WHERE d.ctid IN (SELECT doomed.ctid FROM doomed)
         RETURNING 1
       )
       SELECT count(*)::integer FROM gone',
      v_tbl, v_col, v_col, v_tbl
    )
    INTO v_deleted
    USING v_cutoff, p_batch_size;

    swept_table   := v_tbl;
    deleted_count := v_deleted;
    cutoff        := v_cutoff;
    RETURN NEXT;   -- emitted even when v_deleted = 0; see the edge-case note.
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sweep_operational_log_retention(integer) IS
  'Privacy Policy v3 §6.7 / SCL-101: deletes rows older than operational_log_retention_days() from the four identity-bearing operational tables, oldest first, at most p_batch_size per table per call. Returns one row per table INCLUDING zero-row tables, with the cutoff, so every run is loggable.';

REVOKE ALL ON FUNCTION public.operational_log_retention_days()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_operational_log_retention(integer)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operational_log_retention_days()         TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_operational_log_retention(integer) TO service_role;
