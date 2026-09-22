-- ============================================================================
-- Doc 05F §12.1 / §12.2 — a regeneration no longer rejects itself over an
-- overridden date
-- ============================================================================
-- LYCEON-MIGRATION-REVIEWED — rollback written and confirmed, see the ROLLBACK
-- section at the foot of this file.
--
-- @spec [Doc_05F_Study_Calendar, §12.1 trigger date ownership, §12.2 protected
--        state, §10.3 V-01 (membership) and V-14 (override)]
-- @implemented [2026-09-22]
--
-- THE DEFECT. Once a student overrides ANY date inside the horizon -- by editing
-- a day (§12.4) or, from this release, by blocking one out -- every subsequent
-- horizon regeneration is REJECTED and their plan silently stops updating.
-- Measured, not inferred:
--
--   weekly           override=blocks -> rejected  V-01,V-14
--   weekly           override=EMPTY  -> rejected  V-01,V-14
--   profile_change   override=blocks -> rejected  V-01,V-14
--   profile_change   override=EMPTY  -> rejected  V-01,V-14
--   student_refresh  override=blocks -> rejected  V-01,V-14
--   student_refresh  override=EMPTY  -> rejected  V-01,V-14
--
-- WHY. calendar_persist_version already computes v_dates -- the dates the trigger
-- may own -- excluding overridden ones, and passes them as generated_for.dates.
-- Its comment says that filtering "is what keeps V-14 a backstop rather than a
-- guaranteed rejection". That is the right intent and the wrong mechanism, for
-- the reason 20260922000000's own header sets out: calendar_compute_plan NEVER
-- READS generated_for.dates. It loops `p_today + i` across the horizon from the
-- profile clock. So the generated OUTPUT still contains the overridden date,
-- V-01's membership test fails on it, and V-14 fires alongside. The fallback is
-- then built the same way and rejected for the identical reason, so the §5A
-- ladder has no rung left.
--
-- THE FIX IS THE PATTERN THIS CODEBASE ALREADY USES. 20260922000000 met exactly
-- this shape of problem for "today" and solved it by narrowing the OUTPUT rather
-- than the input series (its header explains, with measurements, why narrowing
-- the series fails). calendar_drop_unowned_dates is that helper generalised: keep
-- only the dates generated_for.dates names. It is complementary to
-- calendar_drop_today_for_system, not a replacement -- that one removes today
-- from a system trigger's output, which generated_for.dates still contains.
--
-- WHY NO GATE CAUGHT IT. Writer gate Z-11 asserts that after a weekly run the
-- overridden date still carries the day_edit's version number. It does, because
-- the weekly run was REJECTED and nothing was written at all. Z-11 passed for
-- the wrong reason from the day it was written. This migration ships with Z-11
-- amended to assert the validator result, which is the claim it always meant to
-- make.
--
-- expected outcome: all six rows above read `accepted`, and a regeneration plans
-- the dates it owns while leaving the student's own dates byte-identical.
--
-- SOURCE BODY. calendar_persist_version taken from
-- 20260922000000_calendar_system_triggers_from_tomorrow.sql (lines 120-238),
-- which is the LIVE declaration. Extracted programmatically, not retyped. The
-- diff against that body is exactly the two output-chain call sites wrapped, plus
-- three comment lines: 8 lines removed, 15 added, nothing else moved.
--
-- trade-offs: an output filter runs on every regeneration, over at most
-- horizon_days entries. That is the same cost profile as the helper beside it.
--
-- edge cases: `setup` and `rollback` own every date by design (v_dates skips the
-- override filter for them), so generated_for.dates is the whole horizon and this
-- helper is a no-op for both. A student who has overridden every date in the
-- horizon gets an accepted version owning no dates, which is correct: there is
-- nothing the generator is allowed to say.
--
-- Authored only. The owner applies it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calendar_drop_unowned_dates(
  p_output jsonb,
  p_input  jsonb
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_set(p_output, '{dates}', COALESCE((
    SELECT jsonb_agg(d ORDER BY d ->> 'scheduled_date')
    FROM jsonb_array_elements(p_output -> 'dates') d
    WHERE (d ->> 'scheduled_date') IN (
      SELECT jsonb_array_elements_text(
               COALESCE(p_input #> '{generated_for,dates}', '[]'::jsonb)))
  ), '[]'::jsonb));
$$;

COMMENT ON FUNCTION public.calendar_drop_unowned_dates(jsonb, jsonb) IS
  'Doc 05F §12.1/§12.2. Keeps only the dates generated_for.dates names, so a generated plan never offers a date the trigger does not own -- chiefly one the student has overridden. calendar_compute_plan walks the horizon from the profile clock and never reads generated_for.dates, so without this the output carries dates the input excluded and V-01/V-14 reject the whole version. Complementary to calendar_drop_today_for_system, which removes today for system triggers; generated_for.dates still contains today.';

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
      v_output := public.calendar_drop_unowned_dates(
                    public.calendar_drop_today_for_system(
                      public.calendar_carry_started(v_input,
                        public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                      p_trigger, v_today),
                    v_input);
      v_res := public.calendar_validate_plan('generated', v_input, v_output);
      IF v_res ->> 'result' <> 'accepted' THEN
        v_generator := 'fallback_v1';
        v_reason := jsonb_build_object('reason','primary_rejected','violations', v_res -> 'violations');
      END IF;
    END IF;
  END IF;

  IF v_generator = 'fallback_v1' THEN
    v_plan := public.calendar_compute_plan_fallback(v_input);
    -- The fallback needs the same narrowing as the primary. Without it a student with an
    -- overridden date whose primary plan was rejected would have the fallback rejected for
    -- the identical reason, and the ladder would have no rung left.
    v_output := public.calendar_drop_unowned_dates(
                  public.calendar_drop_today_for_system(
                    public.calendar_carry_started(v_input,
                      public.calendar_plan_to_output(v_plan, p_generator_version, v_enabled)),
                    p_trigger, v_today),
                  v_input);
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
  'Doc 05F §12.1-§12.3. Allocates a version under the profile lock, generates, validates, and persists. The plan OUTPUT is narrowed twice before validation: calendar_drop_today_for_system removes today for weekly/post_exam, and calendar_drop_unowned_dates removes any date generated_for.dates does not name -- chiefly a date the student overrode. Both are output filters, because calendar_compute_plan derives its dates from the profile clock and never reads generated_for.dates.';

-- ----------------------------------------------------------------------------
-- Grants (Doc 05F §7.12)
--
-- Same posture as calendar_drop_today_for_system beside it: reachable only from
-- inside the SECURITY DEFINER writer, granted to nobody. Writer gate Z-19 sweeps
-- every function named calendar_% for exactly this.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.calendar_drop_unowned_dates(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- ROLLBACK (INV-06)
-- ============================================================================
-- Re-apply calendar_persist_version from
-- 20260922000000_calendar_system_triggers_from_tomorrow.sql (lines 120-238)
-- verbatim -- that is this file minus the two wrapped call sites -- and then
-- DROP FUNCTION public.calendar_drop_unowned_dates(jsonb, jsonb).
--
-- Order matters: replace the writer first, or the DROP fails on the dependency.
--
-- Both are CREATE OR REPLACE / DROP of functions. No table, column, constraint,
-- policy or grant changes here, so a rollback cannot lose a row.
--
-- WHAT THE ROLLBACK RESTORES, stated so it is a decision and not a surprise:
-- every horizon regeneration for a student with any overridden date in the
-- horizon would again be rejected, and their plan would stop updating with no
-- error surfaced to them. Versions already written are append-only history
-- (INV-08-05) and are not recomputed either way.
-- ============================================================================
