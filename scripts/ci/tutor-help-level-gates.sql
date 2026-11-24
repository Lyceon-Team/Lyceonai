-- ============================================================================
-- LISA help-level engine: schema gates (owner brief "Help-level engine", Karl 2026-11-05; SCL-275)
-- ============================================================================
-- @spec [SCL-275; supabase/migrations/20261201000000_lisa_help_level.sql,
--       20261209000000_lisa_help_keywords_v2.sql] | @implemented [2026-11-05; H3 updated 2026-11-22]
--
-- plain English: the three help columns on tutor_turn_metrics accept exactly the states the BFF
-- writes and refuse everything else, including the rows a NULL comparison would let through.
--   H1 accepted: no help (a turn that reached no worker), each level with its step and a signal.
--   H2 refused: an unknown level; a worked step out of 1..3; worked_step without a step; a step on
--      another level; a level without a signal; a signal without a level; an unknown signal.
--   H3 after the whole pipeline the keyword map is at version 2 with 33 stuck and 20 solve_it
--      phrases: the v1 seed (20261201000000) plus the v2 append (20261209000000), the state Karl
--      reported for production on 2026-11-22.
-- One transaction, rolled back.
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'TUTOR_HELP_LEVEL_GATE_FAILED: %', msg; END $f$;

INSERT INTO auth.users (id, email)
VALUES ('9e1f0000-0000-4000-8000-0000000000e1', 'help-level-gate@ci.invalid');
INSERT INTO public.tutor_conversations (id, student_id, entry_mode, source_surface)
VALUES ('9e1f0000-0000-4000-8000-0000000000c1', '9e1f0000-0000-4000-8000-0000000000e1',
        'general', 'dashboard');

-- Whether a row with these help values is accepted.
CREATE FUNCTION pg_temp.accepts(lvl text, step smallint, sig text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.tutor_turn_metrics (conversation_id, turn_ordinal, orchestration_duration_ms,
    model_name, help_level, help_worked_step, help_signal)
  VALUES ('9e1f0000-0000-4000-8000-0000000000c1', 0, 1, 'gate', lvl, step, sig);
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END $f$;

DO $$
BEGIN
  IF NOT pg_temp.accepts(NULL, NULL, NULL) THEN PERFORM pg_temp.fail('H1 no help refused'); END IF;
  IF NOT pg_temp.accepts('ask', NULL, 'none') THEN PERFORM pg_temp.fail('H1 ask refused'); END IF;
  IF NOT pg_temp.accepts('hint', NULL, 'walkthrough') THEN PERFORM pg_temp.fail('H1 hint refused'); END IF;
  IF NOT pg_temp.accepts('worked_step', 3::smallint, 'step_understood') THEN
    PERFORM pg_temp.fail('H1 worked step 3 refused'); END IF;
  IF NOT pg_temp.accepts('full_solution', NULL, 'solve_it') THEN
    PERFORM pg_temp.fail('H1 full solution refused'); END IF;
  RAISE NOTICE 'H1 PASS';
END $$;

DO $$
BEGIN
  IF pg_temp.accepts('everything', NULL, 'none') THEN PERFORM pg_temp.fail('H2 unknown level'); END IF;
  IF pg_temp.accepts('worked_step', 4::smallint, 'none') THEN PERFORM pg_temp.fail('H2 step 4'); END IF;
  IF pg_temp.accepts('worked_step', 0::smallint, 'none') THEN PERFORM pg_temp.fail('H2 step 0'); END IF;
  IF pg_temp.accepts('worked_step', NULL, 'none') THEN PERFORM pg_temp.fail('H2 worked step, no step'); END IF;
  IF pg_temp.accepts('hint', 2::smallint, 'none') THEN PERFORM pg_temp.fail('H2 step on hint'); END IF;
  IF pg_temp.accepts('hint', NULL, NULL) THEN PERFORM pg_temp.fail('H2 level, no signal'); END IF;
  IF pg_temp.accepts(NULL, NULL, 'none') THEN PERFORM pg_temp.fail('H2 signal, no level'); END IF;
  IF pg_temp.accepts('hint', NULL, 'bogus') THEN PERFORM pg_temp.fail('H2 unknown signal'); END IF;
  RAISE NOTICE 'H2 PASS';
END $$;

DO $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.tutor_context_runtime_config WHERE key = 'tutor_help_keywords';
  IF v IS NULL OR (v->>'version')::int IS DISTINCT FROM 2
     OR jsonb_array_length(v->'signals'->'stuck') IS DISTINCT FROM 33
     OR jsonb_array_length(v->'signals'->'solve_it') IS DISTINCT FROM 20 THEN
    PERFORM pg_temp.fail('H3 tutor_help_keywords is not version 2 with 33 stuck and 20 solve_it phrases');
  END IF;
  RAISE NOTICE 'H3 PASS';
END $$;

ROLLBACK;
\echo 'TUTOR HELP LEVEL GATES: PASS'
