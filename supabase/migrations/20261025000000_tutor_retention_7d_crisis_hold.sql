-- ===========================================================================
-- Tutor retention, 7d tier — crisis-flagged conversations are never swept
--
-- @spec [Doc-03_V1.1 §14.2 (retention matrix: tutor_conversations "Active + 7 days
--        post-entitlement-loss"; "Crisis-flagged conversations | 180 days (extended for safety
--        review) | Manual purge by safety review queue owner after incident closure"), INV-03-19;
--        owner ruling 2026-10-05 RS-00 (a conversation is crisis-flagged when any
--        crisis_review_cases or crisis_review_events row links to it; the 7d tier never deletes
--        a flagged conversation, its cascade rows, or the student's memory summary while a
--        flagged conversation exists; purging those is manual)]
-- @implemented 2026-10-05
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- plain English: the 7d tier of POST /api/internal/retention/sweep used to hard-delete every
-- conversation soft-deleted more than 7 days ago, flagged or not. Deleting a conversation
-- cascades its messages and question links, and SETs NULL on the crisis case, event and audit
-- rows that point at it — so a crisis transcript the spec keeps for safety review was destroyed
-- by an automatic sweep. This function is the 7d tier now. It selects the expired conversations,
-- leaves out every one a crisis case or event links to, and deletes the rest in ONE statement
-- inside one transaction, so a flag cannot land between the check and the delete.
--
-- expected outcome: unflagged conversations soft-deleted more than 7 days ago are deleted with
-- their cascade rows; flagged ones stay, with every message; a student's memory summaries go only
-- when the student has no live conversation, no conversation still inside the 7-day recovery
-- window, and no flagged conversation at all.
--
-- trade-offs:
--  - The rule lives here, not in TypeScript: the route calls this function by RPC
--    (server/services/retention-sweep.ts `sweep7d`). PostgREST cannot express "delete these rows
--    unless another table references them" as one statement, and two statements would race a
--    new flag.
--  - The expired rows are locked (FOR UPDATE) before the flagged check, so a concurrent
--    `flag_conversation_for_crisis_review` (which updates the conversation row) waits for this
--    transaction; a flag written first is seen by the check.
--  - p_dry_run returns the same per-table counts without deleting (RS-03): conversations, every
--    table that cascades from them, and memory summaries. One row per table, including zero
--    counts, with the cutoff — the shape `retentionSweepRowSchema` already parses.
--  - Unbounded, as the 7d tier always was. The first run after a long outage deletes the whole
--    backlog; that is why the dry run exists and Karl approves its counts first.
--
-- edge cases:
--  - A flag on a conversation that is NOT soft-deleted is irrelevant here (live conversations
--    are never swept), but it still holds the student's memory summary.
--  - Re-running is safe: deleted rows no longer match.
--  - SECURITY DEFINER, revoked from PUBLIC, anon and authenticated; only service_role executes
--    (scripts/ci/secdef-exposure.sql).
--
-- rollback (exact: the function did not exist before this file; the route then fails the 7d tier
-- closed with `rpc_failed`, it does not fall back to the old unflagged delete):
--   DROP FUNCTION IF EXISTS public.sweep_tutor_conversation_retention(boolean);
--   DROP FUNCTION IF EXISTS public.tutor_conversation_retention_days();
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tutor_conversation_retention_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 7;
$$;

COMMENT ON FUNCTION public.tutor_conversation_retention_days() IS
  'Doc 03 §14.2: days a soft-deleted tutor conversation stays recoverable before the 7d tier deletes it. THE single definition; the sweep reads it.';

CREATE OR REPLACE FUNCTION public.sweep_tutor_conversation_retention(p_dry_run boolean)
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
  v_cutoff   timestamptz := now() - make_interval(days => public.tutor_conversation_retention_days());
  v_ids      uuid[];
  v_students uuid[];
  v_n        integer;
  v_tbl      text;
  -- Tables whose rows go with a deleted conversation (ON DELETE CASCADE on conversation_id).
  v_cascade  CONSTANT text[] := ARRAY[
    'tutor_messages',
    'tutor_question_links',
    'tutor_instruction_assignments',
    'tutor_instruction_exposures',
    'tutor_turn_metrics',
    'tutor_context_resolution_log'
  ];
BEGIN
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'sweep_tutor_conversation_retention: p_dry_run must not be null'
      USING ERRCODE = '22023';
  END IF;

  -- Expired, soft-deleted, and NOT crisis-flagged (RS-00). Locked before the check.
  SELECT coalesce(array_agg(x.id), '{}')
    INTO v_ids
    FROM (
      SELECT c.id
        FROM public.tutor_conversations c
       WHERE c.deleted_at IS NOT NULL
         AND c.deleted_at < v_cutoff
       ORDER BY c.id
         FOR UPDATE
    ) x
   WHERE NOT EXISTS (SELECT 1 FROM public.crisis_review_cases k  WHERE k.conversation_id = x.id)
     AND NOT EXISTS (SELECT 1 FROM public.crisis_review_events v WHERE v.conversation_id = x.id);

  -- Memory summaries go only for students losing a conversation in this run who keep nothing:
  -- no live conversation, none still recoverable, and none flagged (RS-00).
  SELECT coalesce(array_agg(DISTINCT c.student_id), '{}')
    INTO v_students
    FROM public.tutor_conversations c
   WHERE c.id = ANY (v_ids)
     AND NOT EXISTS (
       SELECT 1
         FROM public.tutor_conversations o
        WHERE o.student_id = c.student_id
          AND (
            o.deleted_at IS NULL
            OR o.deleted_at >= v_cutoff
            OR EXISTS (SELECT 1 FROM public.crisis_review_cases k  WHERE k.conversation_id = o.id)
            OR EXISTS (SELECT 1 FROM public.crisis_review_events v WHERE v.conversation_id = o.id)
          )
     );

  -- Counts first (they are the dry-run answer, and the live run reports the same numbers).
  swept_table   := 'tutor_conversations';
  deleted_count := coalesce(array_length(v_ids, 1), 0);
  cutoff        := v_cutoff;
  RETURN NEXT;

  FOREACH v_tbl IN ARRAY v_cascade LOOP
    EXECUTE format('SELECT count(*)::integer FROM public.%I WHERE conversation_id = ANY ($1)', v_tbl)
      INTO v_n
      USING v_ids;
    swept_table   := v_tbl;
    deleted_count := v_n;
    cutoff        := v_cutoff;
    RETURN NEXT;
  END LOOP;

  SELECT count(*)::integer INTO v_n
    FROM public.tutor_memory_summaries s
   WHERE s.student_id = ANY (v_students);
  swept_table   := 'tutor_memory_summaries';
  deleted_count := v_n;
  cutoff        := v_cutoff;
  RETURN NEXT;

  IF NOT p_dry_run THEN
    DELETE FROM public.tutor_memory_summaries s WHERE s.student_id = ANY (v_students);
    DELETE FROM public.tutor_conversations c WHERE c.id = ANY (v_ids);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sweep_tutor_conversation_retention(boolean) IS
  'Doc 03 §14.2 / owner ruling 2026-10-05 RS-00: the 7d tier. Deletes conversations soft-deleted more than tutor_conversation_retention_days() ago EXCEPT any a crisis_review_cases or crisis_review_events row links to, with their cascade rows, and the memory summaries of students left with no live, recoverable or flagged conversation. p_dry_run counts without deleting. One row per table, zero counts included, with the cutoff.';

REVOKE ALL ON FUNCTION public.tutor_conversation_retention_days()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_tutor_conversation_retention(boolean)      FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tutor_conversation_retention_days()           TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_tutor_conversation_retention(boolean)   TO service_role;

COMMIT;
