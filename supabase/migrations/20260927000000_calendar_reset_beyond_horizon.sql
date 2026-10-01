-- ============================================================================
-- Doc 05F §12.1 — a day off beyond the horizon can be undone
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §12.1 day_regenerate / day_reset, §12.2 protected
--        state, §10.3 V-01 membership, V-14 override]
-- @implemented [2026-09-22]
--
-- plain English: blocking out a day writes an override (§12.4, an edit to an empty
-- member list). Undoing it is a day RESET, which clears that override. But
-- calendar_regenerate_day refused any date beyond the 14-day horizon, so a student
-- who blocked out a concert three weeks ahead could not take it back: the control
-- existed and could not be reversed, which is worse than not offering it.
--
-- WHAT THE OLD REFUSAL GOT RIGHT, AND WHERE IT STOPPED. Its comment reads: "Outside
-- the horizon the generator never emits the date at all, so the version would own
-- nothing and the route would report a success that changed no plan." Every word of
-- that is true of a day REGENERATE. It is not true of a day RESET, and the two share
-- this function. A reset is not a request to plan a date; it is a request to stop
-- owning one.
--
-- So beyond the horizon the version owns the date with NO members and
-- is_user_override false -- exactly "this date belongs to the generator again, and
-- it has nothing to say about it yet". When the date drifts into the horizon the
-- ordinary weekly run plans it, because there is no override left to stop it (V-14).
--
-- THE GENERATOR IS NOT RUN IN THIS BRANCH. A date outside the horizon has no budget,
-- no mix and no cadence to compute; there is nothing to ask it. That is also why
-- this cannot disturb parity: calendar_compute_plan and its fallback are neither
-- redeclared nor invoked on this path.
--
-- The snapshot is built over the horizon PLUS the target date, so
-- generated_for.dates names it and V-01's membership test passes. Without that the
-- version would be rejected for owning a date its own input never mentioned — the
-- same trap 20260926000000 documents from the other direction.
--
-- SOURCE BODY. calendar_regenerate_day taken from
-- 20260917140000_calendar_route_constants.sql (lines 495-616), which is the LIVE
-- declaration -- 20260922000000 replaces calendar_persist_version and adds
-- calendar_drop_today_for_system, and does not touch this function. Extracted
-- programmatically, not retyped. The diff against that body is 9 lines removed
-- (CREATE -> CREATE OR REPLACE, and the 8-line RAISE block) and 59 added.
--
-- expected outcome: reset on a date 21 days out returns an accepted version owning
-- that one date, with no blocks and is_user_override false. A weekly run once the
-- date is inside the horizon then plans it normally.
--
-- trade-offs: a regenerate (as opposed to a reset) beyond the horizon now also
-- succeeds and clears the day rather than raising. That is the honest reading of the
-- same request -- "make this date the generator's again" -- and the two triggers are
-- deliberately one function because §12.1 gives them identical date ownership.
-- Distinguishing them here would be inventing a difference the spec does not have.
--
-- edge cases: a past date still raises, unchanged and above this branch — §12.2 says
-- a past date is never owned. A date exactly on the horizon edge takes the ordinary
-- path, because the generator does emit it.
--
-- Authored only. The owner applies it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calendar_regenerate_day(
  p_student_id        uuid,
  p_date              date,
  p_trigger           text,
  p_generator_version text,
  p_idempotency_key   uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stored     jsonb;
  v_input      jsonb;
  v_plan       jsonb;
  v_output     jsonb;
  v_generator  text := 'deterministic_v1';
  v_reason     jsonb;
  v_res        jsonb;
  v_result     jsonb;
  v_today      date;
  v_tz         text;
  v_enabled    text[];
  v_degraded   text[];
  v_horizon    integer;
  v_dates      date[];
BEGIN
  IF p_trigger NOT IN ('day_regenerate', 'day_reset') THEN
    RAISE EXCEPTION 'calendar_regenerate_day: trigger ''%'' is not a day-scoped trigger', p_trigger
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_regenerate_day: student % has no study profile; nothing is generated and the prior plan stands', p_student_id
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_stored; END IF;
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- §12.2: a past date is never owned and never regenerated.
  IF p_date < v_today THEN
    RAISE EXCEPTION 'calendar_regenerate_day: % is in the past and cannot be regenerated', p_date
      USING ERRCODE = '23514';
  END IF;

  SELECT public.calendar_require_int(jsonb_object_agg(key, value), 'horizon_days')
    INTO v_horizon FROM public.calendar_runtime_config;

  SELECT array_agg(d ORDER BY d) INTO v_dates
  FROM generate_series(v_today, v_today + (v_horizon - 1), interval '1 day') g(d);

  ----------------------------------------------------------------------------
  -- BEYOND THE HORIZON: own the date, plan nothing, and leave it to the future.
  --
  -- This used to RAISE. The reasoning was sound as far as it went -- the generator
  -- never emits a date outside the horizon, so running it and narrowing to that
  -- date would produce a version owning nothing, and the route would report a
  -- success that changed no plan.
  --
  -- What it missed is that a day-scoped RESET is not a request to plan a date. It
  -- is a request to STOP owning one. A student who blocks out a concert three weeks
  -- out creates an override at day +21; undoing it has to clear that override, and
  -- the horizon is fourteen days, so the undo raised and the day off could not be
  -- taken back until the date drifted into range. The control existed and could not
  -- be reversed, which is worse than not offering it.
  --
  -- So the version owns the date with NO members and is_user_override false. That is
  -- precisely "this date is the generator's again, and it has nothing to say about
  -- it yet". When the date enters the horizon the ordinary weekly run plans it,
  -- because there is no override left to stop it (V-14) -- which is the whole point.
  --
  -- The generator is NOT run here. There is nothing for it to compute: a date outside
  -- the horizon has no budget, no mix and no cadence yet. Skipping it is why this
  -- branch cannot disturb parity.
  --
  -- The snapshot is built over the horizon PLUS this date, so generated_for.dates
  -- names it and V-01's membership test passes. Without that the version would be
  -- rejected for owning a date its own input never mentioned.
  ----------------------------------------------------------------------------
  IF p_date > v_today + (v_horizon - 1) THEN
    v_input := public.calendar_build_plan_input(p_student_id, v_dates || p_date);
    v_output := jsonb_build_object(
      'generator', 'deterministic_v1',
      'generator_version', p_generator_version,
      'dates', jsonb_build_array(jsonb_build_object(
        'scheduled_date', p_date::text,
        'is_user_override', false,
        'members', '[]'::jsonb)));

    v_res := public.calendar_validate_plan('day_regenerate', v_input, v_output);
    IF v_res ->> 'result' <> 'accepted' THEN
      RAISE EXCEPTION 'calendar_regenerate_day: clearing % was rejected: %', p_date, v_res
        USING ERRCODE = '22023';
    END IF;

    v_result := public.calendar_write_version(p_student_id, p_trigger, 'student',
                  'deterministic_v1', p_generator_version, v_input, v_output, 'day_regenerate',
                  jsonb_build_object('reason', 'beyond_horizon_cleared', 'horizon_days', v_horizon));

    IF p_idempotency_key IS NOT NULL THEN
      INSERT INTO public.calendar_mutation_ledger
        (student_id, idempotency_key, route, response_hash, response)
      VALUES (p_student_id, p_idempotency_key, 'calendar_regenerate_day',
              encode(sha256(v_result::text::bytea), 'hex'), v_result);
    END IF;

    RETURN v_result;
  END IF;

  v_input := public.calendar_build_plan_input(p_student_id, v_dates);

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(v_input -> 'enabled_block_types') t;
  SELECT COALESCE(array_agg(t), '{}') INTO v_degraded
  FROM jsonb_array_elements_text(COALESCE(v_input -> 'degraded', '[]'::jsonb)) t;

  -- Sheet §5A, the same ladder calendar_persist_version runs. A day the student
  -- asked for is never left blank: a degraded read, a raise or a rejection all
  -- fall through to fallback_v1 on the same snapshot, with the reason recorded.
  IF 'mastery' = ANY (v_degraded) OR 'review_queue' = ANY (v_degraded) THEN
    v_generator := 'fallback_v1';
    v_reason := jsonb_build_object('reason','degraded_input','degraded', v_input -> 'degraded');
  ELSE
    BEGIN
      v_plan := public.calendar_compute_plan(v_input);
    EXCEPTION WHEN OTHERS THEN
      v_generator := 'fallback_v1';
      v_reason := jsonb_build_object('reason','primary_raised','sqlstate', SQLSTATE, 'message', SQLERRM);
    END;

    IF v_generator = 'deterministic_v1' THEN
      v_output := public.calendar_carry_started(v_input,
                    public.calendar_regenerate_day_only(
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled),
                      p_date));
      v_res := public.calendar_validate_plan('day_regenerate', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    v_output := public.calendar_carry_started(v_input,
                  public.calendar_regenerate_day_only(
                    public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled),
                    p_date));
  END IF;

  v_result := public.calendar_write_version(p_student_id, p_trigger, 'student',
                v_generator, p_generator_version, v_input, v_output, 'day_regenerate', v_reason);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_regenerate_day',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.calendar_regenerate_day(uuid, date, text, text, uuid) IS
  'Doc 05F §12.1 / §15: the writer behind POST /api/calendar/days/:date/regenerate and /reset. Owns exactly one date, derives it from the generator and leaves is_user_override false, which is how the student''s override clears. Validates in mode day_regenerate — generated minus V-14, because clearing that override is the operation. BEYOND THE HORIZON it owns the date with no members and runs no generator, so a day blocked out past the horizon can still be undone; the date is planned by the ordinary weekly run once it comes into range. FOR UPDATE on the profile before the ledger read, as every calendar writer does.';

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- Re-apply calendar_regenerate_day from
-- 20260917140000_calendar_route_constants.sql (lines 495-616) verbatim, changing
-- only CREATE -> CREATE OR REPLACE. That is this file minus the beyond-horizon
-- branch. The function is CREATE OR REPLACE, so the rollback is a replace and
-- touches no data.
--
-- No table, column, constraint, policy or grant changes here, so a rollback cannot
-- lose a row.
--
-- WHAT THE ROLLBACK RESTORES, stated so it is a decision and not a surprise: a day
-- blocked out beyond the horizon becomes un-undoable again — the Undo control would
-- 500 until the date drifted inside fourteen days. Versions already written by this
-- branch are append-only history (INV-08-05) and stand; the dates they cleared stay
-- cleared, which is the correct state either way.
-- ============================================================================
