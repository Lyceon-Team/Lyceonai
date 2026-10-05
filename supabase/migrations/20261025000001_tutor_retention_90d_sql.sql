-- ===========================================================================
-- Tutor retention, 90d tier — one SQL function, exact counts, cascades included
--
-- @spec [Doc-03_V1.1 §14.2 (tutor_instruction_assignments "90 days from creation";
--        tutor_instruction_exposures "90 days from creation"); owner rulings 2026-10-05 RS-04
--        (exposures are measured by shown_at — the table has no created_at) and RS-03 (the
--        built-in dry_run covers every tier correctly, or is removed)]
-- @implemented 2026-10-05
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: the 90d tier of POST /api/internal/retention/sweep deletes instruction
-- assignments created more than 90 days ago and exposures shown more than 90 days ago. Deleting
-- an assignment cascades every exposure of it (ON DELETE CASCADE on assignment_id), including one
-- shown inside the window. The PostgREST version could neither count those nor report them, so
-- its dry run under-counted what the live run removed. This function counts and deletes with
-- the same predicate:
--   assignments  created_at < cutoff
--   exposures    shown_at   < cutoff  OR  their assignment is in the set above
--
-- expected outcome: the dry run returns, per table, exactly the rows the live run deletes. The
-- live run returns the rows it actually deleted (GET DIAGNOSTICS), in the same shape.
--
-- trade-offs:
--  - The rule lives here, not in TypeScript (server/services/retention-sweep.ts `sweep90d` calls
--    this by RPC), for the same reason as the 7d tier (20261025000000): one statement set in one
--    transaction, which PostgREST cannot express.
--  - The cutoff is the database clock, as for the 7d tier.
--  - Exposures are deleted explicitly before the assignments, so the cascade finds nothing left
--    and the reported exposure count is the true one.
--  - Unbounded, as the tier always was. The dry run exists so Karl approves the counts first.
--
-- edge cases:
--  - Re-running is safe: deleted rows no longer match.
--  - Rows of a live conversation are in scope; this tier is about age, not conversation state.
--  - SECURITY DEFINER, revoked from PUBLIC, anon and authenticated; only service_role executes
--    (scripts/ci/secdef-exposure.sql).
--
-- rollback (exact: the function did not exist before this file; the route then fails the 90d
-- tier closed with `rpc_failed`):
--   DROP FUNCTION IF EXISTS public.sweep_tutor_instruction_retention(boolean);
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sweep_tutor_instruction_retention(p_dry_run boolean)
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
  v_cutoff  timestamptz := now() - interval '90 days';
  v_assign  integer;
  v_expose  integer;
BEGIN
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'sweep_tutor_instruction_retention: p_dry_run must not be null'
      USING ERRCODE = '22023';
  END IF;

  IF p_dry_run THEN
    SELECT count(*)::integer INTO v_assign
      FROM public.tutor_instruction_assignments a
     WHERE a.created_at < v_cutoff;

    SELECT count(*)::integer INTO v_expose
      FROM public.tutor_instruction_exposures e
     WHERE e.shown_at < v_cutoff
        OR EXISTS (SELECT 1 FROM public.tutor_instruction_assignments a
                    WHERE a.id = e.assignment_id AND a.created_at < v_cutoff);
  ELSE
    DELETE FROM public.tutor_instruction_exposures e
     WHERE e.shown_at < v_cutoff
        OR EXISTS (SELECT 1 FROM public.tutor_instruction_assignments a
                    WHERE a.id = e.assignment_id AND a.created_at < v_cutoff);
    GET DIAGNOSTICS v_expose = ROW_COUNT;

    DELETE FROM public.tutor_instruction_assignments a
     WHERE a.created_at < v_cutoff;
    GET DIAGNOSTICS v_assign = ROW_COUNT;
  END IF;

  swept_table := 'tutor_instruction_assignments'; deleted_count := v_assign; cutoff := v_cutoff;
  RETURN NEXT;
  swept_table := 'tutor_instruction_exposures';   deleted_count := v_expose; cutoff := v_cutoff;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sweep_tutor_instruction_retention(boolean) IS
  'Doc 03 §14.2 / owner rulings 2026-10-05 RS-03, RS-04: the 90d tier. Deletes instruction assignments created more than 90 days ago and exposures shown more than 90 days ago or belonging to such an assignment. p_dry_run counts the same rows without deleting. One row per table, with the cutoff.';

REVOKE ALL ON FUNCTION public.sweep_tutor_instruction_retention(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_tutor_instruction_retention(boolean) TO service_role;

COMMIT;
