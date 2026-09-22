-- ============================================================================
-- Doc 05F — system triggers own from TOMORROW, never today
-- ============================================================================
-- @spec [Doc-05F_V1.0 §12.1 (trigger date ownership), §12.2 (protected state),
--        §10.3 V-01 · owner ruling 2026-09-22 — "system triggers do not touch
--        today" · recorded as item 29 in
--        docs/plans/Doc_05F_Change_Record_Addendum.md]
-- @implemented [2026-09-22]
--
-- plain English. `weekly` and `post_exam` are SYSTEM-initiated: nobody asked for
-- them. They must not replace a block sitting on the student`s today. `setup`,
-- `profile_change`, `student_refresh` and `rollback` keep owning today, because
-- a student or an admin asked for them.
--
-- V-12 and calendar_carry_started already protect a STARTED block on today.
-- This closes the gap for an UNSTARTED one: a student who opens the app at 9am,
-- sees an Algebra 20 block, goes to make coffee, and comes back to a different
-- block because a cron ran.
--
-- SOURCE OF THIS BODY. calendar_persist_version has never been replaced: it was
-- created by 20260917130000_calendar_v1.sql and 20260917140000 does not touch
-- it. The body below is therefore taken VERBATIM from 20260917130000, with
-- exactly three lines changed -- CREATE -> CREATE OR REPLACE, and the two
-- v_output assignments wrapped in the new narrowing helper. Confirmed against
-- pg_get_functiondef on a database with the full pipeline applied.
--
-- ----------------------------------------------------------------------------
-- WHY THIS NARROWS THE OUTPUT AND NOT THE INPUT SERIES
-- ----------------------------------------------------------------------------
-- The obvious change -- start the generate_series at v_today + 1 for the two
-- system triggers -- does not work, and fails in the worst direction. It was
-- built and measured before this file was written:
--
--   weekly, live body       -> deterministic_v1, accepted
--   weekly, series + 1      -> fallback_v1, REJECTED, violations:
--                              [{"date":"<today>","rule":"V-01",
--                                "detail":"date is outside generated_for.dates"}]
--                              version written with validator_result=rejected,
--                              owning ZERO dates
--
-- The cause is that calendar_compute_plan does not read generated_for.dates at
-- all. It loops `FOR v_i IN 0 .. k_horizon_days - 1` over `p_today + v_i`, and
-- p_today comes from the snapshot`s own `today`, which calendar_build_plan_input
-- sets from the profile clock independently of the p_dates it was handed. So
-- narrowing the input narrows only what V-01 will ACCEPT, never what the
-- generator EMITS -- and the primary is rejected, the fallback is rejected for
-- the same reason, and calendar_current_plan (which filters on accepted) never
-- sees the new version. The weekly job would fail for every student, forever.
--
-- calendar_compute_plan is the formula and is byte-locked by the parity gate`s
-- 6018 comparisons, so it is not the thing to change.
--
-- The answer is the pattern calendar_regenerate_day already uses: let the
-- generator reason over the whole horizon, then narrow the OUTPUT. V-01 is a
-- membership test -- every output date must be IN generated_for.dates -- and
-- v_gen_dates is read at exactly one place in calendar_validate_plan, that
-- test. There is no completeness rule requiring every generated_for date to
-- appear, so dropping one from the output validates cleanly.
--
-- Narrowing happens AFTER calendar_carry_started, deliberately. If today
-- carries a started block, carry_started re-adds it to today`s entry and the
-- drop then removes that entry wholesale -- which is correct: the system
-- version does not own today at all, so today keeps the version that already
-- owns it, started block and all. calendar_current_plan resolves per date, so
-- today simply stays on the older accepted version.
--
-- Measured with this file applied:
--   weekly          -> deterministic_v1, accepted, 13 dates, tomorrow..+13,
--                      does NOT own today. Today still resolves to the prior
--                      version with its blocks unchanged
--   student_refresh -> deterministic_v1, accepted, 14 dates, today..+13,
--                      DOES own today
--
-- A weekly version owns THIRTEEN dates, not fourteen. §12.1 gives weekly
-- "future non-overridden dates in the horizon", and the horizon is the window
-- [today, today+13]. Extending to today+14 would create a date the §15 read
-- range never shows.
--
-- Migration authored only. The owner applies it.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. calendar_drop_today_for_system — the narrowing helper (§12.1)
--
-- Pure and IMMUTABLE, like every other output-shaping calendar function
-- (calendar_plan_to_output, calendar_carry_started, calendar_regenerate_day_only).
-- It is a no-op for every trigger a student or an admin initiates, so the one
-- place the rule lives is the trigger list in here.
--
-- The ORDER BY on the re-aggregation matters: jsonb_agg over a filtered set
-- would otherwise be free to reorder the dates, and V-08 reads display order
-- per date while the read model renders them in array order.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_drop_today_for_system(
  p_output  jsonb,
  p_trigger text,
  p_today   date
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_trigger NOT IN ('weekly', 'post_exam') THEN p_output
    ELSE jsonb_set(p_output, '{dates}', COALESCE((
      SELECT jsonb_agg(d ORDER BY d ->> 'scheduled_date')
      FROM jsonb_array_elements(p_output -> 'dates') d
      WHERE (d ->> 'scheduled_date')::date <> p_today
    ), '[]'::jsonb))
  END;
$$;

COMMENT ON FUNCTION public.calendar_drop_today_for_system(jsonb, text, date) IS
  'Doc 05F §12.1 / owner ruling 2026-09-22: weekly and post_exam are system-initiated and own dates from tomorrow. Drops today from a generated plan OUTPUT, leaving generated_for.dates whole so V-01''s membership test still passes. A no-op for setup, profile_change, student_refresh, day_* and rollback.';

-- ----------------------------------------------------------------------------
-- 2. calendar_persist_version — verbatim from 20260917130000, three lines changed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_persist_version(
  p_student_id        uuid,
  p_trigger           text,
  p_initiated_by      text,
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
  v_dates      date[];
  v_horizon    integer;
  v_tz         text;
  v_enabled    text[];
  v_degraded   text[];
BEGIN
  -- INV-08-17. A concurrent regeneration for the same student waits here
  -- rather than racing to the same version_no.
  -- ORDER MATTERS. The lock is taken BEFORE the ledger is read, so the
  -- check-then-insert is atomic per student. Read first and concurrent callers
  -- sharing a key all miss the ledger, serialise here, and then collide on
  -- calendar_mutation_ledger_pkey — the replay returns a 23505 instead of the
  -- stored response. Proved by scripts/ci/calendar-concurrency-gate.sh C-2.
  PERFORM 1 FROM public.student_study_profile WHERE student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_persist_version: student % has no study profile; nothing is generated and the prior plan stands', p_student_id
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT response INTO v_stored FROM public.calendar_mutation_ledger
    WHERE student_id = p_student_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_stored;   -- a replayed key returns the stored response and writes nothing
    END IF;
  END IF;

  SELECT timezone INTO v_tz FROM public.student_study_profile WHERE student_id = p_student_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT public.calendar_require_int(jsonb_object_agg(key, value), 'horizon_days')
    INTO v_horizon FROM public.calendar_runtime_config;

  -- §12.1 / §12.2: which dates this trigger may own. Past dates are never
  -- owned, and a date the student has overridden is never taken by a
  -- non-student version — filtering here is what keeps V-14 a backstop rather
  -- than a guaranteed rejection.
  SELECT array_agg(d ORDER BY d) INTO v_dates
  FROM generate_series(v_today, v_today + (v_horizon - 1), interval '1 day') g(d)
  WHERE p_trigger IN ('setup','rollback')
     OR NOT EXISTS (SELECT 1 FROM public.calendar_current_plan cp
                    WHERE cp.student_id = p_student_id
                      AND cp.scheduled_date = g.d::date
                      AND cp.is_user_override);

  v_input := public.calendar_build_plan_input(p_student_id, v_dates);

  SELECT COALESCE(array_agg(t), '{}') INTO v_enabled
  FROM jsonb_array_elements_text(v_input -> 'enabled_block_types') t;
  SELECT COALESCE(array_agg(t), '{}') INTO v_degraded
  FROM jsonb_array_elements_text(COALESCE(v_input -> 'degraded', '[]'::jsonb)) t;

  -- §5A: a degraded mastery read or review queue means the primary generator
  -- would be working from something it cannot trust.
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
      v_output := public.calendar_drop_today_for_system(
                    public.calendar_carry_started(v_input,
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                    p_trigger, v_today);
      v_res := public.calendar_validate_plan('generated', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    v_output := public.calendar_drop_today_for_system(
                  public.calendar_carry_started(v_input,
                    public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                  p_trigger, v_today);
  END IF;

  v_result := public.calendar_write_version(p_student_id, p_trigger, p_initiated_by,
                v_generator, p_generator_version, v_input, v_output, 'generated', v_reason);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.calendar_mutation_ledger
      (student_id, idempotency_key, route, response_hash, response)
    VALUES (p_student_id, p_idempotency_key, 'calendar_persist_version',
            encode(sha256(v_result::text::bytea), 'hex'), v_result);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.calendar_persist_version(uuid, text, text, text, uuid) IS
  'Doc 05F §12.3. FOR UPDATE on the profile, build, compute, validate, insert, one transaction. Falls back to fallback_v1 on degraded input, a raise, or a rejection, recording the reason on the version (sheet §5A). Since 2026-09-22 the two SYSTEM triggers, weekly and post_exam, own dates from tomorrow: the generator still reasons over the whole horizon and the OUTPUT is narrowed by calendar_drop_today_for_system.';

-- ----------------------------------------------------------------------------
-- 3. Grants (Doc 05F §7.12)
--
-- The helper is revoked from everyone and granted to no one: it is reachable
-- only from inside the SECURITY DEFINER writer, which runs as its owner -- the
-- same posture calendar_plan_to_output, calendar_carry_started and
-- calendar_regenerate_day_only have. Writer gate Z-19 sweeps every function
-- named calendar_% and caught exactly this omission the first time round.
--
-- calendar_persist_version keeps the grants 20260917130000 gave it. CREATE OR
-- REPLACE does not disturb them.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.calendar_drop_today_for_system(jsonb, text, date)
  FROM PUBLIC, anon, authenticated;

COMMIT;
