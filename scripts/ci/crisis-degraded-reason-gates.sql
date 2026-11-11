-- ============================================================================
-- Crisis classifier failure reason: schema gates (owner brief "Crisis classifier: record the
-- failure reason, and look at the timeout", Karl 2026-11-08; SCL-276)
-- ============================================================================
-- @spec [SCL-276; supabase/migrations/20261202000000_crisis_degraded_reason.sql]
--       | @implemented [2026-11-08]
--
-- plain English: the new columns accept exactly the states the BFF writes and refuse the rest,
-- including the rows a NULL comparison would let through.
--   D1 a degraded case (classifier_degraded, classifier_degraded_no_floor) takes a reason with its
--      attempts (0-2); a case with neither is fine.
--   D2 refused: a reason on a signature/model case; a reason without attempts; attempts without a
--      reason; an unknown reason; attempts out of range.
--   D3 turn rows: no Layer 2 at all, or ms + attempts with an optional known reason; refused:
--      partial rows, negative ms, an unknown reason, attempts out of range.
-- One transaction, rolled back.
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'CRISIS_DEGRADED_REASON_GATE_FAILED: %', msg; END $f$;

INSERT INTO auth.users (id, email)
VALUES ('9c1d0000-0000-4000-8000-0000000000e1', 'crisis-reason-gate@ci.invalid');
INSERT INTO public.tutor_conversations (id, student_id, entry_mode, source_surface)
VALUES ('9c1d0000-0000-4000-8000-0000000000c1', '9c1d0000-0000-4000-8000-0000000000e1',
        'general', 'dashboard');

-- Whether a case with these values is accepted (each in its own savepoint via the EXCEPTION block,
-- and deleted again so the one-active-case-per-conversation index never interferes).
CREATE FUNCTION pg_temp.case_ok(src text, reason text, attempts smallint) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.crisis_review_cases (conversation_id, student_id, source, sla_deadline,
    degraded_reason, classifier_attempts)
  VALUES ('9c1d0000-0000-4000-8000-0000000000c1', '9c1d0000-0000-4000-8000-0000000000e1',
          src, now() + interval '48 hours', reason, attempts);
  DELETE FROM public.crisis_review_cases
   WHERE conversation_id = '9c1d0000-0000-4000-8000-0000000000c1';
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END $f$;

CREATE FUNCTION pg_temp.turn_ok(ms integer, attempts smallint, reason text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.tutor_turn_metrics (conversation_id, turn_ordinal, orchestration_duration_ms,
    model_name, crisis_classifier_ms, crisis_classifier_attempts, crisis_degraded_reason)
  VALUES ('9c1d0000-0000-4000-8000-0000000000c1', 0, 1, 'gate', ms, attempts, reason);
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END $f$;

DO $$
BEGIN
  IF NOT pg_temp.case_ok('classifier_degraded', 'timeout', 2::smallint) THEN
    PERFORM pg_temp.fail('D1 degraded + timeout/2 refused'); END IF;
  IF NOT pg_temp.case_ok('classifier_degraded_no_floor', 'config_error', 0::smallint) THEN
    PERFORM pg_temp.fail('D1 no_floor + config_error/0 refused'); END IF;
  IF NOT pg_temp.case_ok('classifier_degraded', NULL, NULL) THEN
    PERFORM pg_temp.fail('D1 degraded with no reason refused'); END IF;
  IF NOT pg_temp.case_ok('signature', NULL, NULL) THEN
    PERFORM pg_temp.fail('D1 signature case refused'); END IF;
  RAISE NOTICE 'D1 PASS';
END $$;

DO $$
BEGIN
  IF pg_temp.case_ok('signature', 'timeout', 2::smallint) THEN
    PERFORM pg_temp.fail('D2 reason on a signature case'); END IF;
  IF pg_temp.case_ok('model', 'rate_limited', 2::smallint) THEN
    PERFORM pg_temp.fail('D2 reason on a model case'); END IF;
  IF pg_temp.case_ok('classifier_degraded', 'timeout', NULL) THEN
    PERFORM pg_temp.fail('D2 reason without attempts'); END IF;
  IF pg_temp.case_ok('classifier_degraded', NULL, 2::smallint) THEN
    PERFORM pg_temp.fail('D2 attempts without reason'); END IF;
  IF pg_temp.case_ok('classifier_degraded', 'flaky', 2::smallint) THEN
    PERFORM pg_temp.fail('D2 unknown reason'); END IF;
  IF pg_temp.case_ok('classifier_degraded', 'timeout', 3::smallint) THEN
    PERFORM pg_temp.fail('D2 attempts 3'); END IF;
  RAISE NOTICE 'D2 PASS';
END $$;

DO $$
BEGIN
  IF NOT pg_temp.turn_ok(NULL, NULL, NULL) THEN PERFORM pg_temp.fail('D3 no Layer 2 refused'); END IF;
  IF NOT pg_temp.turn_ok(412, 1::smallint, NULL) THEN PERFORM pg_temp.fail('D3 healthy refused'); END IF;
  IF NOT pg_temp.turn_ok(6004, 2::smallint, 'timeout') THEN PERFORM pg_temp.fail('D3 timeout refused'); END IF;
  IF NOT pg_temp.turn_ok(3, 0::smallint, 'config_error') THEN PERFORM pg_temp.fail('D3 config refused'); END IF;
  IF pg_temp.turn_ok(412, NULL, NULL) THEN PERFORM pg_temp.fail('D3 ms without attempts'); END IF;
  IF pg_temp.turn_ok(NULL, NULL, 'timeout') THEN PERFORM pg_temp.fail('D3 reason without ms'); END IF;
  IF pg_temp.turn_ok(-1, 1::smallint, NULL) THEN PERFORM pg_temp.fail('D3 negative ms'); END IF;
  IF pg_temp.turn_ok(10, 1::smallint, 'flaky') THEN PERFORM pg_temp.fail('D3 unknown reason'); END IF;
  IF pg_temp.turn_ok(10, 3::smallint, NULL) THEN PERFORM pg_temp.fail('D3 attempts 3'); END IF;
  RAISE NOTICE 'D3 PASS';
END $$;

ROLLBACK;
\echo 'CRISIS DEGRADED REASON GATES: PASS'
