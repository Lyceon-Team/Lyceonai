-- ============================================================================
-- Doc 05F §12.2, §12.4 — calendar_move_block
--
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §12.2 protected state, §12.4 day edit]
-- @implemented [2026-09-23]
--
-- plain English: moves one unstarted block from the day it sits on to another
-- day, in ONE version that owns BOTH dates. The source date loses the block,
-- the target date gains a copy whose lineage points back at the original. Both
-- dates become user overrides, because the student chose this arrangement and
-- a later auto-regeneration must leave it alone (§12.2).
--
-- WHY A COPY AND NOT AN UPDATE. calendar_blocks rows are append-only and a
-- block row carries its scheduled_date (§7.4). Re-dating a row in place would
-- rewrite history that the ledger, the launches table and every prior version
-- still reference. So a move is what every other calendar mutation is: a new
-- version, a created block on the target, and the source date re-stated
-- without it. derived_from_block_id carries the lineage, exactly as
-- calendar_do_it_now does when it copies a missed block onto today.
--
-- WRITER SHAPE. Taken from the LIVE body of calendar_edit_day in
-- 20260917130000_calendar_v1.sql -- that function has never been replaced
-- (20260917140000 and 20260922000000 do not touch it), confirmed against
-- pg_get_functiondef on a full-pipeline database. The member construction and
-- the created-copy shape come from the live calendar_do_it_now in the same
-- file. The lock order is theirs and is not incidental: the profile is locked
-- FOR UPDATE BEFORE the ledger is read, so check-then-insert is atomic per
-- student.
--
-- REFUSALS ARE DATA, NOT RAISES. A started block, a past date, and a move to
-- the day the block is already on are all things a student can ask for by
-- ordinary use of a drag handle -- a stale tab, a drag that crosses local
-- midnight, a drop back where it started. They are expected outcomes, so they
-- come back as a value the route turns into a 409, not an exception a caller
-- would have to parse an error string to understand (Coding Standards §13:
-- expected failures are Results, throw is for the unrecoverable). A block that
-- does not belong to the caller still RAISES -- that is not an expected
-- outcome, it is an authorisation failure.
--
-- expected outcome: one accepted version owning two dates, the block gone from
-- the source and present on the target, both dates flagged is_user_override.
--
-- trade-offs: the move reuses the day_edit trigger rather than adding a
-- `move` value to the calendar_plan_versions trigger CHECK. A move IS two day
-- edits performed together, §17.4 keys its banner copy off the trigger and has
-- nothing to say about a student moving their own block, and a new trigger
-- value would be a CHECK change plus a shared-schema change plus a contract
-- row for a distinction no consumer reads.
--
-- edge cases: a review block keeps its target_count rather than being clamped
-- to what is due on the new date -- the validator owns that judgement in
-- student_edit mode, and clamping here would be a second copy of a rule that
-- already lives in calendar_validate_plan. explanation_key travels with the
-- block: moving work does not change WHY the work is there, which is the same
-- reasoning calendar_do_it_now applies.
-- ============================================================================

CREATE FUNCTION public.calendar_move_block(
  p_student_id        uuid,
  p_block_id          uuid,
  p_to_date           date,
  p_generator_version text,
  p_idempotency_key   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stored    jsonb;
  v_src       record;
  v_input     jsonb;
  v_output    jsonb;
  v_result    jsonb;
  v_tz        text;
  v_today     date;
  v_from      date;
  v_from_mem  jsonb;
  v_to_mem    jsonb;
  v_created   jsonb;
  v_lo        date;
  v_hi        date;
BEGIN
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey -- the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_move_block: student % has no study profile', p_student_id USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT * INTO v_src FROM public.calendar_blocks
  WHERE block_id = p_block_id AND student_id = p_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_move_block: block % does not belong to student %', p_block_id, p_student_id
      USING ERRCODE = '42501';
  END IF;
  v_from := v_src.scheduled_date;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- §12.2: a past date is never owned and never edited, at either end. Moving
  -- work INTO the past would rewrite what the student did not do. Moving it
  -- OUT of the past would erase it.
  IF v_from < v_today OR p_to_date < v_today THEN
    RETURN jsonb_build_object('refused', 'date_in_past',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  IF v_from = p_to_date THEN
    RETURN jsonb_build_object('refused', 'same_date',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  v_lo := least(v_from, p_to_date);
  v_hi := greatest(v_from, p_to_date);
  v_input := public.calendar_build_plan_input(p_student_id, ARRAY[v_lo, v_hi]);

  -- §12.2 V-12: a started block is protected state. started_blocks_by_date is
  -- the canonical answer to "has this block been launched" -- calendar_carry_started
  -- and the V-12 validator arm both read exactly this key, so the refusal is
  -- decided by the same fact they are, never by a second query that could drift.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_input -> 'started_blocks_by_date', '[]'::jsonb)) s
    WHERE (s ->> 'block_id')::uuid = p_block_id
  ) THEN
    RETURN jsonb_build_object('refused', 'block_started',
                              'from_date', v_from::text, 'to_date', p_to_date::text);
  END IF;

  -- The source date, re-stated WITHOUT the block being moved. Everything else
  -- on that day is carried by id, so nothing is regenerated by moving a sibling.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','carried','block_id', cp.block_id::text)
                            ORDER BY cp.display_ordinal), '[]'::jsonb)
    INTO v_from_mem
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = p_student_id AND cp.scheduled_date = v_from
    AND cp.block_id IS NOT NULL AND cp.block_id <> p_block_id;

  -- The target date, as it stands today. The moved copy is appended, so it
  -- lands last in display order rather than displacing the day.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','carried','block_id', cp.block_id::text)
                            ORDER BY cp.display_ordinal), '[]'::jsonb)
    INTO v_to_mem
  FROM public.calendar_current_plan cp
  WHERE cp.student_id = p_student_id AND cp.scheduled_date = p_to_date
    AND cp.block_id IS NOT NULL;

  v_created := jsonb_build_array(jsonb_build_object(
    'kind','created',
    'block', jsonb_build_object(
      'block_type', v_src.block_type,
      'section', v_src.section,
      'scope', v_src.scope,
      'target_count', v_src.target_count,
      'explanation_key', v_src.explanation_key,
      'derived_from_block_id', p_block_id::text)));

  -- Ascending date order, so the emitted output is a function of the inputs and
  -- not of which direction the student dragged.
  v_output := jsonb_build_object(
    'generator', 'deterministic_v1',
    'generator_version', p_generator_version,
    'dates', CASE WHEN v_from < p_to_date THEN
      jsonb_build_array(
        jsonb_build_object('scheduled_date', v_from::text,    'is_user_override', true, 'members', v_from_mem),
        jsonb_build_object('scheduled_date', p_to_date::text, 'is_user_override', true, 'members', v_to_mem || v_created))
    ELSE
      jsonb_build_array(
        jsonb_build_object('scheduled_date', p_to_date::text, 'is_user_override', true, 'members', v_to_mem || v_created),
        jsonb_build_object('scheduled_date', v_from::text,    'is_user_override', true, 'members', v_from_mem))
    END);

  v_output := public.calendar_carry_started(v_input, v_output);

  v_result := public.calendar_write_version(p_student_id, 'day_edit', 'student',
                'deterministic_v1', p_generator_version, v_input, v_output, 'student_edit', NULL);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_move_block',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.calendar_move_block(uuid, uuid, date, text, uuid) IS
  'Doc 05F §12.2/§12.4. Moves one unstarted block to another date in a single day_edit version owning both dates; the target gets a created copy with derived_from_block_id set, and both dates become user overrides. Refuses a started block, a past date at either end, and a move to the same date as DATA ({"refused": ...}), never as an exception.';

-- The function is SECURITY DEFINER and route-driven. No client role calls it
-- directly, so no client role gets EXECUTE -- the server calls it as the
-- service role, the same posture as every other calendar writer.
REVOKE ALL ON FUNCTION public.calendar_move_block(uuid, uuid, date, text, uuid) FROM PUBLIC;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- This migration is ADDITIVE ONLY: it creates one function and grants nothing.
-- It alters no table, no column, no constraint, no policy and no existing
-- function, so undoing it cannot lose a row.
--
--   DROP FUNCTION IF EXISTS public.calendar_move_block(uuid, uuid, date, text, uuid)
--
-- Confirmed against a full-pipeline database: applying this migration and then
-- running the DROP above returns pg_dump --schema-only to the pre-migration
-- schema byte for byte.
--
-- WHAT THE ROLLBACK DOES NOT UNDO, and why that is correct. Versions the
-- function wrote before the rollback STAY. calendar_plan_versions, _dates,
-- _blocks and _memberships are append-only by design (§7.2-§7.5, INV-08-05)
-- and the only sanctioned path that removes them is the account-deletion
-- cascade. A moved block is an ordinary day_edit version indistinguishable
-- from one calendar_edit_day could have written, so those rows remain valid
-- plan history with the function gone, and calendar_current_plan keeps
-- resolving them. Dropping the function stops NEW moves. It does not and must
-- not rewrite the plans students already have.
--
-- The route must be removed in the same deploy as the DROP, or
-- POST /api/calendar/blocks/:id/move answers 500 (undefined_function, 42883)
-- instead of 404.
-- ============================================================================
