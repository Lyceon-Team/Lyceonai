-- ============================================================================
-- SCORING ENGINE GATES — Doc 04B V4.3 §9-§12 observed rejecting (or accepting)
-- what the spec says, against the activated v1.0.
-- ============================================================================
-- @spec [Doc-04B_V4.3, §5.16, §5.17, §7.2, §8.4, §9.1, §9.2, §9.4, §10.1
--        (SCL-122), §11.2 (SCL-128), §12.1, §14.4, §15.2, §16.1, §19.1-§19.7,
--        §21.1; SCL-129 (deletion)] | @implemented [2026-09-24]
--
-- plain English: runs against a genesis-fresh-applied database (pipeline ends
--   with v1.0 ACTIVE). A committed setup block builds one published fixture
--   form (T_RW 18, T_M 15) and two students; every named check then runs in
--   its own transaction that is ROLLED BACK. A check passes only by printing
--   its own `ok   [ID name]` NOTICE; scripts/ci/scoring-engine-gates.sh
--   requires every expected id and no ERROR. A failed assertion raises
--   `SEG FAIL [ID name]: <why>`.
--
-- Every rejection asserts the SPECIFIC SQLSTATE and the constraint name or the
--   message. The insert-once checks name the LAYER that stops each write:
--     IO1 privilege  (§9.4 Layer 1)  UPDATE as service_role      -> 42501
--     IO2 trigger    (§9.4 Layer 2)  DELETE as the table owner   -> P0001
--     IO3 unique     (§9.1)          2nd row for one session     -> 23505
--     IO4 RLS        (§9.4 Layer 3)  UPDATE/DELETE by a role that HAS the
--                                    privilege, trigger disabled -> 0 rows
--     IO5 trigger    (§9.4 Layer 2)  UPDATE as the table owner   -> P0001
-- ============================================================================

\set ON_ERROR_STOP 0
SET client_min_messages = notice;

\ir lib/exam-form-fixture.sql
\ir lib/scoring-session-fixture.sql

CREATE FUNCTION pg_temp.e4_expect(p_id text, p_sql text, p_state text,
                                  p_like text, p_constraint text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_raised boolean := false; v_state text; v_msg text; v_con text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SEG FAIL [%]: statement was accepted: %', p_id, p_sql;
  END IF;
  IF v_state <> p_state
     OR (p_constraint IS NOT NULL AND v_con IS DISTINCT FROM p_constraint)
     OR v_msg NOT LIKE p_like THEN
    RAISE EXCEPTION 'SEG FAIL [%]: wrong error % % "%" (wanted % % "%")',
      p_id, v_state, v_con, v_msg, p_state, p_constraint, p_like;
  END IF;
  RAISE NOTICE 'ok   [%] % % "%"', p_id, v_state, COALESCE(v_con, '-'), v_msg;
END $f$;

-- A fresh session with the §28.1 pattern (both sections), scored or not.
CREATE FUNCTION pg_temp.e4_session(p_session uuid, p_student uuid DEFAULT '00000000-0000-0000-0000-0000000e4a01',
                                   p_form uuid DEFAULT '00000000-0000-0000-0000-0000000e4f01')
RETURNS uuid LANGUAGE sql AS $f$
  SELECT pg_temp.scoring_fixture_session(p_session, p_student, p_form,
    '{"path":"B","r1":24,"ne":1,"nm":2,"nh":2}', '{"path":"B","r1":20,"ne":1,"nm":1,"nh":2}');
$f$;

-- A draft copy of the fixture form bound to another scoring version.
CREATE FUNCTION pg_temp.e4_clone_form(p_form uuid, p_version text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.test_forms (id, name, test_kind, status, score_table_version,
    routing_threshold_rw, routing_threshold_m, break_duration_ms,
    rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
  SELECT p_form, 'seg clone ' || p_version, test_kind, 'draft', p_version, routing_threshold_rw,
         routing_threshold_m, break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms
    FROM public.test_forms WHERE id = '00000000-0000-0000-0000-0000000e4f01';
  INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
  SELECT p_form, section, module, ordinal, question_id
    FROM public.test_form_items WHERE test_form_id = '00000000-0000-0000-0000-0000000e4f01';
$f$;

-- ---------------------------------------------------------------------------
-- SETUP (committed; the database is throwaway)
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.exam_fixture_make_form('00000000-0000-0000-0000-0000000e4f01', 'G1', 18, 15);
UPDATE public.test_forms SET status = 'published', published_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000e4f01';
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e4a01', 'seg-student-1@example.com'),
  ('00000000-0000-0000-0000-0000000e4a02', 'seg-student-2@example.com');
COMMIT;

-- ---------------------------------------------------------------------------
-- V1 — the activation row: v1.0 active, all four attestation fields, and the
-- stored constants hash equals a recomputation and the ruled literal.
-- H1 — the pgcrypto digest() form of the E2 serializer is the same hash.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE v public.scoring_model_versions%ROWTYPE; v_digest text;
BEGIN
  SELECT * INTO v FROM public.scoring_model_versions WHERE version = 'v1.0';
  IF v.status IS DISTINCT FROM 'active' OR v.published_at IS NULL
     OR v.constants_sha256 IS DISTINCT FROM public.scoring_constants_sha256('v1.0')
     OR v.constants_sha256 IS DISTINCT FROM '5a51132234b2d1654b5362943af2d1fef59eadbc57ed6af50a44211a735680d1'
     OR v.validation_packet_sha256 IS DISTINCT FROM '29c3e0fd362b6f5c3c90c50a49b49fa55ebc03e1518f8ab1922408329b88651b'
     OR v.validation_packet_url IS DISTINCT FROM 'https://github.com/Lyceon-Team/Lyceonai/tree/exam/scripts/ci/fixtures/scoring-v1.0' THEN
    RAISE EXCEPTION 'SEG FAIL [V1 v1.0-activated-attested]: %', row_to_json(v);
  END IF;
  RAISE NOTICE 'ok   [V1 v1.0-activated-attested] active, published_at %, constants % = recomputed', v.published_at, v.constants_sha256;

  SELECT encode(extensions.digest(convert_to(string_agg(
           key || '|' || COALESCE(section, '') || '|' || trim_scale(value)::text, E'\n'
           ORDER BY key COLLATE "C", section COLLATE "C" NULLS FIRST), 'UTF8'), 'sha256'), 'hex')
    INTO v_digest FROM public.scoring_constants WHERE scoring_model_version = 'v1.0';
  IF v_digest IS DISTINCT FROM v.constants_sha256 THEN
    RAISE EXCEPTION 'SEG FAIL [H1 digest-equals-sha256]: digest() % <> sha256() %', v_digest, v.constants_sha256;
  END IF;
  RAISE NOTICE 'ok   [H1 digest-equals-sha256] extensions.digest(..., sha256) = core sha256() = %', v_digest;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- G1 — privileges and ownership (§9.4 Layer 1, §11.1).
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE v_n int; f text; r record;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity AND tablename IN ('score_runs', 'score_run_event_ledger');
  IF v_n <> 2 THEN RAISE EXCEPTION 'SEG FAIL [G1 privileges]: RLS on % of 2 tables', v_n; END IF;

  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name IN ('score_runs', 'score_run_event_ledger')
     AND (grantee IN ('anon', 'authenticated', 'PUBLIC')
          OR (grantee = 'service_role' AND privilege_type <> 'SELECT')
          OR (grantee = 'lyceon_scoring_owner' AND privilege_type NOT IN ('SELECT', 'INSERT')));
  IF v_n <> 0 THEN RAISE EXCEPTION 'SEG FAIL [G1 privileges]: % excess table grant(s)', v_n; END IF;

  SELECT * INTO r FROM pg_roles WHERE rolname = 'lyceon_scoring_owner';
  IF NOT FOUND OR r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb THEN
    RAISE EXCEPTION 'SEG FAIL [G1 privileges]: lyceon_scoring_owner missing or over-privileged: %', row_to_json(r);
  END IF;

  FOREACH f IN ARRAY ARRAY['public.is_answer_correct(text,text)',
                           'public.compute_scaled_score_from_counts(text,int,int,int,int,int,int,int,int)',
                           'public.compute_section_scaled_score(uuid,text)',
                           'public.scoring_constants_snapshot_jsonb(text)',
                           'public.emit_score_run_side_effects(uuid)',
                           'public.score_test_session_from_outbox(uuid)'] LOOP
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = f::regprocedure) <> 'lyceon_scoring_owner' THEN
      RAISE EXCEPTION 'SEG FAIL [G1 privileges]: % is not owned by lyceon_scoring_owner', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'SEG FAIL [G1 privileges]: anon/authenticated can EXECUTE %', f;
    END IF;
    IF has_function_privilege('service_role', f, 'EXECUTE') <> (f <> 'public.emit_score_run_side_effects(uuid)') THEN
      RAISE EXCEPTION 'SEG FAIL [G1 privileges]: service_role EXECUTE on % is wrong', f;
    END IF;
  END LOOP;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN (
            'public.is_answer_correct(text,text)'::regprocedure, 'public.compute_section_scaled_score(uuid,text)'::regprocedure,
            'public.scoring_constants_snapshot_jsonb(text)'::regprocedure, 'public.score_test_session_from_outbox(uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'SEG FAIL [G1 privileges]: a §9.4/§10/§11/§12 function is not SECURITY DEFINER';
  END IF;
  -- the scoring owner can read no answer-bearing column it does not need
  IF has_column_privilege('lyceon_scoring_owner', 'public.questions', 'explanation', 'SELECT')
     OR has_column_privilege('lyceon_scoring_owner', 'public.questions', 'stem', 'SELECT') THEN
    RAISE EXCEPTION 'SEG FAIL [G1 privileges]: lyceon_scoring_owner reads questions beyond the scoring columns';
  END IF;
  RAISE NOTICE 'ok   [G1 privileges] RLS 2/2; service_role SELECT only; owner = lyceon_scoring_owner (NOLOGIN, no BYPASSRLS); EXECUTE service_role-only; seam uncallable';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- AC1 — comparator (§10.1 / SCL-122; §21.1 "Unit tests on is_answer_correct").
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
BEGIN
  IF NOT public.is_answer_correct('A', 'SATRW1G10100') OR public.is_answer_correct('B', 'SATRW1G10100')
     OR NOT public.is_answer_correct('1', 'SATM1G10100') OR public.is_answer_correct('1.0', 'SATM1G10100')
     OR public.is_answer_correct(NULL, 'SATRW1G10100') IS DISTINCT FROM false
     OR public.is_answer_correct(NULL, 'SATM1G10100') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SEG FAIL [AC1 comparator]: mcq/grid_in/NULL truth table wrong';
  END IF;
END $$;
SELECT pg_temp.e4_expect('AC1 comparator',
  $q$SELECT public.is_answer_correct('A', 'SATRW1ZZ0000')$q$,
  'P0001', 'Question not found: SATRW1ZZ0000');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- SEAL1 — post-activation, E2's §8.4 trigger refuses an UPDATE on a v1.0
-- constant (the point of no return holds).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_expect('SEAL1 v1.0-constants-sealed',
  $q$UPDATE public.scoring_constants SET value = value + 1
      WHERE scoring_model_version = 'v1.0' AND key = 'deduction_easy'$q$,
  '23000', 'scoring_constants rows for active/superseded scoring_model_version v1.0 are immutable.%');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- K1..K3 — D11 hardening CHECKs, on a candidate version (so the seal is not
-- what refuses them).
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.scoring_model_versions (version, formula_name, formula_doc_ref, status)
VALUES ('zz_k', 'f', 'd', 'candidate');
SELECT pg_temp.e4_expect('K1 constant-not-nan',
  $q$INSERT INTO public.scoring_constants (scoring_model_version, key, value, description)
     VALUES ('zz_k', 'alpha_ceiling_exponent', 'NaN', 'plant')$q$,
  '23514', '%', 'scoring_constants_value_finite');
SELECT pg_temp.e4_expect('K2 constant-not-infinity',
  $q$INSERT INTO public.scoring_constants (scoring_model_version, key, value, description)
     VALUES ('zz_k', 'ceiling_max', 'Infinity', 'plant')$q$,
  '23514', '%', 'scoring_constants_value_finite');
SELECT pg_temp.e4_expect('K3 constant-key-charset',
  $q$INSERT INTO public.scoring_constants (scoring_model_version, key, value, description)
     VALUES ('zz_k', E'ceiling_max|x\n', 800, 'plant')$q$,
  '23514', '%', 'scoring_constants_key_charset');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- HP1 — full happy path (§21.1): one score_runs row + one ledger row, the
-- total is the sum, partial_display NULL, and those two tables are the ONLY
-- tables the scoring call writes (§16.1 "exactly two artifacts").
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e501') AS ev \gset
CREATE TEMP TABLE _before AS SELECT relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_xact_user_tables;
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
DO $$
DECLARE r public.score_runs%ROWTYPE; v_written text;
BEGIN
  SELECT * INTO r FROM public.score_runs WHERE test_session_id = '00000000-0000-0000-0000-00000000e501';
  IF r.rw_scaled <> 710 OR r.math_scaled <> 730 OR r.total_scaled <> 1440 OR r.partial_display_scaled IS NOT NULL
     OR r.source_event_type <> 'test_session_completed' OR r.scoring_model_version <> 'v1.0'
     OR (SELECT count(*) FROM public.score_run_event_ledger WHERE score_run_id = r.id) <> 1
     OR r.constants_snapshot <> public.scoring_constants_snapshot_jsonb('v1.0') THEN
    RAISE EXCEPTION 'SEG FAIL [HP1 full-happy-path]: %', row_to_json(r);
  END IF;
  SELECT string_agg(a.relname, ',' ORDER BY a.relname) INTO v_written
    FROM pg_stat_xact_user_tables a LEFT JOIN _before b USING (relname)
   WHERE a.schemaname = 'public'
     AND (a.n_tup_ins, a.n_tup_upd, a.n_tup_del) IS DISTINCT FROM (b.n_tup_ins, b.n_tup_upd, b.n_tup_del);
  IF v_written IS DISTINCT FROM 'score_run_event_ledger,score_runs' THEN
    RAISE EXCEPTION 'SEG FAIL [HP1 full-happy-path]: scoring wrote % (want exactly score_run_event_ledger,score_runs)', v_written;
  END IF;
  RAISE NOTICE 'ok   [HP1 full-happy-path] 710 + 730 = 1440; ledger 1; writes = %', v_written;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- PS1 — partial scoring (§15.2): Math never submitted -> math NULL, total NULL,
-- partial_display = rw.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.scoring_fixture_session('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-0000000e4a01',
  '00000000-0000-0000-0000-0000000e4f01', '{"path":"B","r1":24,"ne":1,"nm":2,"nh":2}', NULL) AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
DO $$
DECLARE r public.score_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.score_runs WHERE test_session_id = '00000000-0000-0000-0000-00000000e502';
  IF NOT r.rw_scored OR r.math_scored OR r.math_scaled IS NOT NULL OR r.math_ceiling IS NOT NULL
     OR r.total_scaled IS NOT NULL OR r.partial_display_scaled <> 710
     OR r.source_event_type <> 'test_session_partial_scored_abandoned' THEN
    RAISE EXCEPTION 'SEG FAIL [PS1 partial-scoring]: %', row_to_json(r);
  END IF;
  RAISE NOTICE 'ok   [PS1 partial-scoring] rw 710, math NULL, total NULL, partial_display 710';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- ID1 — idempotency (§5.17, §12.1, §14.3): the SAME outbox event replayed
-- returns the same score_run_id, raises nothing, writes nothing.
-- ID2 — a DIFFERENT event for an already-scored session is refused by
-- UNIQUE(test_session_id) (§19.7), not silently merged.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e503') AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run1 \gset
SELECT set_config('seg.run1', :'run1', true) \g /dev/null
SELECT public.score_test_session_from_outbox(:'ev') AS run2 \gset
SELECT set_config('seg.run2', :'run2', true) \g /dev/null
SELECT public.score_test_session_from_outbox(:'ev') AS run3 \gset
SELECT set_config('seg.run3', :'run3', true) \g /dev/null
RESET ROLE;
DO $$
BEGIN
  IF current_setting('seg.run1') <> current_setting('seg.run2') OR current_setting('seg.run1') <> current_setting('seg.run3')
     OR (SELECT count(*) FROM public.score_runs WHERE test_session_id = '00000000-0000-0000-0000-00000000e503') <> 1
     OR (SELECT count(*) FROM public.score_run_event_ledger WHERE test_session_id = '00000000-0000-0000-0000-00000000e503') <> 1 THEN
    RAISE EXCEPTION 'SEG FAIL [ID1 replay-idempotent]: replays returned % / % / % or duplicated rows', current_setting('seg.run1'), current_setting('seg.run2'), current_setting('seg.run3');
  END IF;
  RAISE NOTICE 'ok   [ID1 replay-idempotent] 3 calls -> one run %, 1 score_runs row, 1 ledger row, no error', current_setting('seg.run1');
END $$;
INSERT INTO public.exam_runtime_outbox (id, event_type, aggregate_id, payload)
VALUES ('00000000-0000-0000-0000-00000000e5e3', 'test_session_completed', '00000000-0000-0000-0000-00000000e503', '{}');
SELECT pg_temp.e4_expect('ID2 second-event-same-session',
  $q$SELECT public.score_test_session_from_outbox('00000000-0000-0000-0000-00000000e5e3')$q$,
  '23505', '%', 'score_runs_test_session_id_key');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- VG1 — version gate (§12.1, §19.6): a form bound to a CANDIDATE version
-- never scores (23000), and nothing is written.
-- VG2 — a SUPERSEDED version SCORES: §12.1 / §19.6 "explicitly allowed"
-- (historical reproducibility, §7.5). v1.0 is superseded inside this txn.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.scoring_model_versions (version, formula_name, formula_doc_ref, status)
VALUES ('zz_cand', 'option_a_banded_ceiling', 'Doc 04B V4.3 §6', 'candidate');
INSERT INTO public.scoring_constants (scoring_model_version, key, section, value, description)
SELECT 'zz_cand', key, section, value, description FROM public.scoring_constants WHERE scoring_model_version = 'v1.0';
SELECT pg_temp.e4_clone_form('00000000-0000-0000-0000-0000000e4fc0', 'zz_cand');
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e504', '00000000-0000-0000-0000-0000000e4a01',
                          '00000000-0000-0000-0000-0000000e4fc0') AS ev \gset
SET ROLE service_role;
SELECT pg_temp.e4_expect('VG1 candidate-version-blocked',
  format('SELECT public.score_test_session_from_outbox(%L)', :'ev'),
  '23000', 'Scoring blocked: scoring_model_version zz_cand is missing, candidate, or incompletely attested.%');
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.score_runs WHERE test_session_id = '00000000-0000-0000-0000-00000000e504') THEN
    RAISE EXCEPTION 'SEG FAIL [VG1 candidate-version-blocked]: a score_runs row exists';
  END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.scoring_model_versions SET status = 'superseded' WHERE version = 'v1.0';
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e505') AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
DO $$
DECLARE r public.score_runs%ROWTYPE;
BEGIN
  IF (SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0') <> 'superseded' THEN
    RAISE EXCEPTION 'SEG FAIL [VG2 superseded-version-scores]: premise: v1.0 is not superseded';
  END IF;
  SELECT * INTO r FROM public.score_runs WHERE test_session_id = '00000000-0000-0000-0000-00000000e505';
  IF r.total_scaled IS DISTINCT FROM 1440 OR r.scoring_model_version <> 'v1.0' THEN
    RAISE EXCEPTION 'SEG FAIL [VG2 superseded-version-scores]: %', row_to_json(r);
  END IF;
  RAISE NOTICE 'ok   [VG2 superseded-version-scores] superseded v1.0 still scores 1440 against its own constants (§19.6)';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- PI1 — presented-item filter (§14.4, §19.2): answers for slots the form
-- never presented to this session (the other M2 path, ordinal 90) do not
-- move the score. Two identical sessions; the noise is deleted from one.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e506') AS ev_a \gset
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e507', '00000000-0000-0000-0000-0000000e4a02') AS ev_b \gset
DELETE FROM public.test_session_answers a
 WHERE a.test_session_id = '00000000-0000-0000-0000-00000000e506'
   AND NOT EXISTS (SELECT 1 FROM public.test_form_items i JOIN public.test_session_sections s
                     ON s.test_session_id = a.test_session_id AND s.section = i.section
                    WHERE i.test_form_id = '00000000-0000-0000-0000-0000000e4f01'
                      AND i.section = a.section AND i.module = a.module AND i.ordinal = a.ordinal
                      AND i.module IN ('1', '2' || s.module2_path));
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev_a') AS run_a \gset
SELECT set_config('seg.run_a', :'run_a', true) \g /dev/null
SELECT public.score_test_session_from_outbox(:'ev_b') AS run_b \gset
SELECT set_config('seg.run_b', :'run_b', true) \g /dev/null
RESET ROLE;
DO $$
DECLARE a public.score_runs%ROWTYPE; b public.score_runs%ROWTYPE; v_noise int;
BEGIN
  SELECT * INTO a FROM public.score_runs WHERE id = current_setting('seg.run_a')::uuid;
  SELECT * INTO b FROM public.score_runs WHERE id = current_setting('seg.run_b')::uuid;
  SELECT count(*) INTO v_noise FROM public.test_session_answers
   WHERE test_session_id = '00000000-0000-0000-0000-00000000e507' AND (module = '2A' OR ordinal = 90);
  IF v_noise < 2 * 22 THEN
    RAISE EXCEPTION 'SEG FAIL [PI1 presented-item-filter]: premise: only % noise rows', v_noise;
  END IF;
  IF (a.rw_scaled, a.rw_module1_correct, a.rw_module2_correct, a.rw_m2_easy_wrong, a.rw_m2_medium_wrong, a.rw_m2_hard_wrong,
      a.math_scaled, a.math_module1_correct, a.math_module2_correct, a.math_m2_easy_wrong, a.math_m2_medium_wrong, a.math_m2_hard_wrong, a.total_scaled)
     IS DISTINCT FROM
     (b.rw_scaled, b.rw_module1_correct, b.rw_module2_correct, b.rw_m2_easy_wrong, b.rw_m2_medium_wrong, b.rw_m2_hard_wrong,
      b.math_scaled, b.math_module1_correct, b.math_module2_correct, b.math_m2_easy_wrong, b.math_m2_medium_wrong, b.math_m2_hard_wrong, b.total_scaled) THEN
    RAISE EXCEPTION 'SEG FAIL [PI1 presented-item-filter]: noise moved the score: clean % vs noisy %', row_to_json(a), row_to_json(b);
  END IF;
  RAISE NOTICE 'ok   [PI1 presented-item-filter] % never-presented answer rows (2A path, ordinal 90) ignored: both % / % / %',
    v_noise, b.rw_scaled, b.math_scaled, b.total_scaled;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- BL1 — submit-with-blank-answers (§28.8 / §19.2): a submitted section with
-- NO answer rows at all scores every presented item as wrong.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.scoring_fixture_session('00000000-0000-0000-0000-00000000e508', '00000000-0000-0000-0000-0000000e4a01',
  '00000000-0000-0000-0000-0000000e4f01', '{"path":"A","r1":0,"ne":14,"nm":9,"nh":4}', NULL) AS ev \gset
DELETE FROM public.test_session_answers WHERE test_session_id = '00000000-0000-0000-0000-00000000e508';
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
DO $$
DECLARE r public.score_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.score_runs WHERE id = current_setting('seg.run')::uuid;
  IF r.rw_module1_correct <> 0 OR r.rw_module2_correct <> 0 OR r.rw_m2_easy_wrong <> 14
     OR r.rw_m2_medium_wrong <> 9 OR r.rw_m2_hard_wrong <> 4 OR r.rw_deduction <> 315 OR r.rw_scaled <> 200 THEN
    RAISE EXCEPTION 'SEG FAIL [BL1 all-blank-counts-wrong]: %', row_to_json(r);
  END IF;
  RAISE NOTICE 'ok   [BL1 all-blank-counts-wrong] 0 rows -> r1 0, r2 0, wrong 14/9/4, deduction 315, scaled 200';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- NS1 — no submitted section (§19.1, §21.1 "stale event") raises, no rows.
-- MS1 — an event whose session does not exist raises (§21.1).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.scoring_fixture_session('00000000-0000-0000-0000-00000000e509', '00000000-0000-0000-0000-0000000e4a01',
  '00000000-0000-0000-0000-0000000e4f01', NULL, NULL) AS ev \gset
SET ROLE service_role;
SELECT pg_temp.e4_expect('NS1 no-scoreable-section',
  format('SELECT public.score_test_session_from_outbox(%L)', :'ev'),
  'P0001', 'No scoreable sections found for session 00000000-0000-0000-0000-00000000e509');
RESET ROLE;
INSERT INTO public.exam_runtime_outbox (id, event_type, aggregate_id, payload)
VALUES ('00000000-0000-0000-0000-00000000e5f0', 'test_session_completed', '00000000-0000-0000-0000-00000000dead', '{}');
SET ROLE service_role;
SELECT pg_temp.e4_expect('MS1 missing-session',
  $q$SELECT public.score_test_session_from_outbox('00000000-0000-0000-0000-00000000e5f0')$q$,
  'P0001', 'Test session not found for outbox event %');
RESET ROLE;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- IO1..IO5 — insert-once, one layer per check (see header).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e510') AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
SELECT pg_temp.e4_expect('IO1 update-blocked-by-privilege',
  format('UPDATE public.score_runs SET rw_scaled = 800 WHERE id = %L', :'run'),
  '42501', 'permission denied for table score_runs');
RESET ROLE;
SELECT pg_temp.e4_expect('IO2 delete-blocked-by-trigger',
  format('DELETE FROM public.score_runs WHERE id = %L', :'run'),
  'P0001', 'score_runs is insert-once. UPDATE and DELETE are forbidden.%');
SELECT pg_temp.e4_expect('IO5 update-blocked-by-trigger',
  format('UPDATE public.score_runs SET rw_scaled = 800 WHERE id = %L', :'run'),
  'P0001', 'score_runs is insert-once. UPDATE and DELETE are forbidden.%');
SELECT pg_temp.e4_expect('IO3 second-insert-blocked-by-unique',
  format($q$INSERT INTO public.score_runs (test_session_id, student_id, test_form_id, scoring_model_version,
       source_outbox_event_id, source_event_type, rw_scored, rw_module1_correct, rw_scaled, math_scored,
       partial_display_scaled, constants_snapshot)
     SELECT test_session_id, student_id, test_form_id, scoring_model_version, source_outbox_event_id,
       source_event_type, true, 0, 200, false, 200, '{}'::jsonb FROM public.score_runs WHERE id = %L$q$, :'run'),
  '23505', '%', 'score_runs_test_session_id_key');
ROLLBACK;

-- IO4: a role that HOLDS UPDATE/DELETE, with the trigger disabled, is still
-- stopped by RLS (§9.4 Layer 3): both statements touch zero rows.
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e511') AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
CREATE ROLE zz_seg_rls_probe NOLOGIN;
GRANT SELECT, UPDATE, DELETE ON public.score_runs TO zz_seg_rls_probe;
ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_update;
ALTER TABLE public.score_runs DISABLE TRIGGER trg_prevent_score_runs_delete;
CREATE TEMP TABLE _io4 (upd int, del int);
GRANT ALL ON _io4 TO zz_seg_rls_probe;
SET ROLE zz_seg_rls_probe;
DO $$
DECLARE v_u int; v_d int;
BEGIN
  UPDATE public.score_runs SET rw_scaled = 800;
  GET DIAGNOSTICS v_u = ROW_COUNT;
  DELETE FROM public.score_runs;
  GET DIAGNOSTICS v_d = ROW_COUNT;
  INSERT INTO _io4 VALUES (v_u, v_d);
END $$;
RESET ROLE;
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM _io4;
  IF v.upd <> 0 OR v.del <> 0
     OR (SELECT rw_scaled FROM public.score_runs WHERE id = current_setting('seg.run')::uuid) <> 710 THEN
    RAISE EXCEPTION 'SEG FAIL [IO4 update-delete-blocked-by-rls]: privileged role updated % / deleted % row(s)', v.upd, v.del;
  END IF;
  RAISE NOTICE 'ok   [IO4 update-delete-blocked-by-rls] UPDATE 0 rows, DELETE 0 rows (score_runs_no_update / _no_delete USING false)';
END $$;
ROLLBACK;

-- IO6 — the ledger is not writable by service_role either (§9.4).
BEGIN;
SET ROLE service_role;
SELECT pg_temp.e4_expect('IO6 ledger-write-blocked',
  $q$INSERT INTO public.score_run_event_ledger (outbox_event_id, score_run_id, test_session_id)
     VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())$q$,
  '42501', 'permission denied for table score_run_event_ledger');
RESET ROLE;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- DEL1 — account deletion (SCL-124 / SCL-129): deleting the student's profile
-- cascades through test_sessions to score_runs and the ledger; the insert-once
-- trigger lets exactly that cascade through.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e4_session('00000000-0000-0000-0000-00000000e512', '00000000-0000-0000-0000-0000000e4a02') AS ev \gset
SET ROLE service_role;
SELECT public.score_test_session_from_outbox(:'ev') AS run \gset
SELECT set_config('seg.run', :'run', true) \g /dev/null
RESET ROLE;
DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000e4a02';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.score_runs WHERE id = current_setting('seg.run')::uuid)
     OR EXISTS (SELECT 1 FROM public.score_run_event_ledger WHERE score_run_id = current_setting('seg.run')::uuid)
     OR EXISTS (SELECT 1 FROM public.test_sessions WHERE id = '00000000-0000-0000-0000-00000000e512') THEN
    RAISE EXCEPTION 'SEG FAIL [DEL1 account-deletion-cascade]: rows survived the profile delete';
  END IF;
  RAISE NOTICE 'ok   [DEL1 account-deletion-cascade] profile delete removed session, score_run and ledger row';
END $$;
ROLLBACK;
