-- ============================================================================
-- EXAM RUNTIME SCHEMA GATES — every Doc 04A §5/§6/§9 constraint, and the ruled
-- validate_form_composition(), observed rejecting (or accepting) what it must.
-- ============================================================================
-- @spec [Doc-04A_V2.2, §4 #3/#4/#5/#15, §5.1-§5.7, §6.1-§6.3, §9.2, §11.2 step 7]
--       [Doc-04B_V4.3, §13 as amended by owner ruling 2026-09-24 (SCL-121)]
-- @implemented [2026-09-24]
--
-- plain English: runs against a genesis-fresh-applied database. A committed
--   setup block builds SYNTHETIC fixtures (one student, one composition-valid
--   draft form of 147 synthetic published questions); every named check then
--   runs in its own transaction that is ROLLED BACK, so checks are independent.
--   A check passes only by printing its own `ok   [ID name]` NOTICE;
--   scripts/ci/exam-runtime-schema-gates.sh requires every expected id and no
--   ERROR. A failed assertion raises `EXG FAIL [ID name]: <why>`.
--
-- Every rejection asserts the SPECIFIC SQLSTATE and the constraint name or the
--   message — "some error happened" is not a pass.
--
-- The fixtures are synthetic because CI cannot reach production. The same
--   function was exercised against the real 6381-row bank metadata locally;
--   that run is evidence in the E3 PR body, not part of this gate.
--
-- Since E4 (20260930050000_activate_scoring_v1.sql, owner ruling) the pipeline
--   ends with v1.0 ACTIVE: P2/C7/F*/I* publish against the real activation
--   (e3_activate_v10 only asserts it), and P1/P1s prove a candidate and a
--   superseded version are still refused, using versions made inside their
--   rolled-back transactions.
-- ============================================================================

\set ON_ERROR_STOP 0
SET client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Helpers (session-local, pg_temp).
-- ---------------------------------------------------------------------------
-- e3_expect: run p_sql, require it to raise p_state; require the constraint
-- name to equal p_constraint (when given) and the message to match p_like.
CREATE FUNCTION pg_temp.e3_expect(p_id text, p_sql text, p_state text,
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
    RAISE EXCEPTION 'EXG FAIL [%]: statement was accepted: %', p_id, p_sql;
  END IF;
  IF v_state <> p_state
     OR (p_constraint IS NOT NULL AND v_con IS DISTINCT FROM p_constraint)
     OR v_msg NOT LIKE p_like THEN
    RAISE EXCEPTION 'EXG FAIL [%]: wrong error % % "%" (wanted % % "%")',
      p_id, v_state, v_con, v_msg, p_state, p_constraint, p_like;
  END IF;
  RAISE NOTICE 'ok   [%] % % "%"', p_id, v_state, COALESCE(v_con, '-'), v_msg;
END $f$;

-- e3_make_form: a DRAFT form whose composition is exactly the ruled blueprint,
-- built from fresh synthetic published questions. Since E4 the body lives in
-- scripts/ci/lib/exam-form-fixture.sql (extracted verbatim, shared with the
-- scoring gates and the scoring parity harness); this alias keeps the call
-- sites below unchanged. Same thresholds (19, 14), same ids, same answers.
\ir lib/exam-form-fixture.sql
CREATE FUNCTION pg_temp.e3_make_form(p_form uuid, p_tag text) RETURNS void
LANGUAGE sql AS $f$ SELECT pg_temp.exam_fixture_make_form(p_form, p_tag, 19, 14); $f$;

-- e3_activate_v10: before E4 this performed the Tier-3 activation inside each
-- rolled-back txn. E4 ruling (20260930050000_activate_scoring_v1.sql): the
-- pipeline now ends with v1.0 ACTIVE and fully attested, so this only asserts
-- that premise (it must NOT rewrite the real attestation fields).
CREATE FUNCTION pg_temp.e3_activate_v10() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0') IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'EXG FAIL [premise]: v1.0 is not active after the pipeline';
  END IF;
END $f$;

-- ---------------------------------------------------------------------------
-- SETUP (committed; the database is throwaway).
--   form ...e301 : composition-valid DRAFT (the base for every check)
--   form ...e302 : composition-valid DRAFT (a second form for uniqueness checks)
--   student ...e3aa via auth.users -> handle_new_user -> profiles
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_make_form('00000000-0000-0000-0000-00000000e301', 'V1');
SELECT pg_temp.e3_make_form('00000000-0000-0000-0000-00000000e302', 'V2');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000e3aa', 'exg-student@example.com');
COMMIT;

-- ---------------------------------------------------------------------------
-- G1 — privileges: RLS on all seven, exactly the E4 + E6 policies, only E6's SELECT grants,
-- service_role cannot UPDATE/DELETE the §5.5 append-only ledger.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity
     AND tablename IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                       'test_answer_submissions','test_session_answers','exam_runtime_outbox');
  IF v_n <> 7 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: RLS enabled on % of 7 tables', v_n; END IF;
  -- E4 (20260930040000, D7): six SELECT-only policies for lyceon_scoring_owner
  -- (not BYPASSRLS) that the §11.1 scoring functions need. E6
  -- (20260930060000): exactly seven more — the student own-row reads (auth.uid(),
  -- SCL-131), the published-forms read, the own-form items read and the outbox's
  -- explicit no-client-access. Any other policy is still a failure.
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                       'test_answer_submissions','test_session_answers','exam_runtime_outbox')
     AND NOT (policyname = tablename || '_scoring_owner_read' AND cmd = 'SELECT'
              AND roles = ARRAY['lyceon_scoring_owner']::name[] AND qual = 'true'
              AND tablename <> 'test_answer_submissions')
     AND policyname NOT IN ('test_sessions_select_self', 'test_session_sections_select_self',
                            'test_session_answers_select_self', 'test_answer_submissions_select_self',
                            'test_forms_select_published', 'test_form_items_select_own_form',
                            'exam_runtime_outbox_no_client_access');
  IF v_n <> 0 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: % policies exist beyond the E4 scoring-owner reads and the E6 set', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND policyname LIKE '%\_scoring\_owner\_read'
     AND tablename IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                       'test_session_answers','exam_runtime_outbox');
  IF v_n <> 6 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: expected the 6 E4 scoring-owner read policies, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public'
     AND ((policyname IN ('test_sessions_select_self', 'test_session_sections_select_self',
                          'test_session_answers_select_self', 'test_answer_submissions_select_self',
                          'test_forms_select_published', 'test_form_items_select_own_form')
           AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[])
       OR (policyname = 'exam_runtime_outbox_no_client_access' AND qual = 'false'));
  IF v_n <> 7 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: expected the 7 E6 policies, found %', v_n; END IF;
  -- Grants: nothing for anon/PUBLIC; for authenticated only E6's SELECTs — the
  -- whole test_sessions row, and column lists that leave out the routing path
  -- (module2_path, module), thresholds and the replay body.
  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                        'test_answer_submissions','test_session_answers','exam_runtime_outbox')
     AND (grantee IN ('anon','PUBLIC')
          OR (grantee = 'authenticated' AND NOT (table_name = 'test_sessions' AND privilege_type = 'SELECT')));
  IF v_n <> 0 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: % table grant(s) beyond E6''s test_sessions SELECT', v_n; END IF;
  SELECT count(*) INTO v_n FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
     AND (privilege_type <> 'SELECT'
          OR table_name IN ('test_form_items', 'exam_runtime_outbox')
          OR column_name IN ('module2_path', 'module', 'response_json', 'routing_threshold_rw',
                             'routing_threshold_m', 'score_table_version',
                             'routing_override_approved_by', 'routing_override_reason',
                             'routing_override_ticket_id'))
     AND table_name IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                        'test_answer_submissions','test_session_answers','exam_runtime_outbox')
     AND NOT (table_name = 'test_sessions' AND privilege_type = 'SELECT');
  IF v_n <> 0 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: % column grant(s) expose a path/threshold/replay column or a non-SELECT', v_n; END IF;
  IF has_table_privilege('service_role', 'public.test_answer_submissions', 'UPDATE')
     OR has_table_privilege('service_role', 'public.test_answer_submissions', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.test_answer_submissions', 'INSERT') THEN
    RAISE EXCEPTION 'EXG FAIL [G1 privileges]: test_answer_submissions is not append-only for service_role';
  END IF;
  IF has_function_privilege('anon', 'public.validate_form_composition(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.validate_form_composition(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.validate_form_composition(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXG FAIL [G1 privileges]: validate_form_composition EXECUTE is not service_role-only';
  END IF;
  RAISE NOTICE 'ok   [G1 privileges] RLS on 7/7, the 6 E4 scoring-owner + 7 E6 policies and no other, authenticated: SELECT only, no path/threshold/replay column, ledger append-only';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C4 — composition ACCEPTS the valid fixture form.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$ BEGIN
  PERFORM public.validate_form_composition('00000000-0000-0000-0000-00000000e301');
  RAISE NOTICE 'ok   [C4 composition-accepts-valid] 147 items, RW 3x27 + Math 3x22, every tally exact';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C1 — difficulty miss: one Math M1 easy item becomes medium (domain and
-- item_type untouched), so ONLY the difficulty tally is off.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.questions SET difficulty = 2 WHERE id = 'SATM1V10100';
SELECT pg_temp.e3_expect('C1 composition-difficulty-miss',
  $q$SELECT public.validate_form_composition('00000000-0000-0000-0000-00000000e301')$q$,
  '23514', '%section=M module=1 dimension=difficulty value=1 expected=7 actual=6');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C2 — domain miss: one Math 2A Algebra item becomes Advanced Math.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.questions SET domain = 'Advanced Math' WHERE id = 'SATM1V12A00';
SELECT pg_temp.e3_expect('C2 composition-domain-miss',
  $q$SELECT public.validate_form_composition('00000000-0000-0000-0000-00000000e301')$q$,
  '23514', '%section=M module=2A dimension=domain value=Algebra expected=7 actual=6');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C3 — grid-in miss: one Math 2B grid_in item becomes mcq.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.questions SET item_type = 'mcq', options = '["A","B","C","D"]'::jsonb, correct_variants = NULL
 WHERE id = 'SATM1V12B00';
SELECT pg_temp.e3_expect('C3 composition-grid-in-miss',
  $q$SELECT public.validate_form_composition('00000000-0000-0000-0000-00000000e301')$q$,
  '23514', '%section=M module=2B dimension=item_type value=grid_in expected=8 actual=7');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C5 — a missing module fails its total cell (actual 0).
-- ---------------------------------------------------------------------------
BEGIN;
DELETE FROM public.test_form_items
 WHERE test_form_id = '00000000-0000-0000-0000-00000000e301' AND section = 'RW' AND module = '2B';
SELECT pg_temp.e3_expect('C5 composition-missing-module',
  $q$SELECT public.validate_form_composition('00000000-0000-0000-0000-00000000e301')$q$,
  '23514', '%section=RW module=2B dimension=total value=* expected=27 actual=0');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C6 — an item whose question is not published is refused, by name.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.questions SET status = 'retired', retired_at = now() WHERE id = 'SATRW1V10105';
SELECT pg_temp.e3_expect('C6 composition-unpublished-question',
  $q$SELECT public.validate_form_composition('00000000-0000-0000-0000-00000000e301')$q$,
  '23514', '%section=RW module=1 dimension=question_status value=SATRW1V10105 ordinal=5 expected=published actual=retired');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P1 — gate check (a): a form bound to a CANDIDATE version cannot publish.
-- E4 ruling (20260930050000_activate_scoring_v1.sql): before E4 v1.0 itself
-- was the candidate and EVERY publish was refused; now v1.0 is active, so the
-- candidate is created inside this rolled-back txn and the composition-valid,
-- in-range draft is rebound to it (draft rows are mutable). Same assertion.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.scoring_model_versions (version, formula_name, formula_doc_ref, status)
VALUES ('zz_p1_cand', 'option_a_banded_ceiling', 'Doc 04B V4.3 §6', 'candidate');
UPDATE public.test_forms SET score_table_version = 'zz_p1_cand' WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('P1 publish-rejected-candidate',
  $q$UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23000', 'Cannot publish: score_table_version zz_p1_cand is in status candidate (must be active)');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P1s — gate check (a): a form bound to a SUPERSEDED version cannot publish
-- (added with E4: once v1.0 is active, "not active" has a second face).
-- v1.0 itself is superseded inside the rolled-back txn.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.scoring_model_versions SET status = 'superseded' WHERE version = 'v1.0';
SELECT pg_temp.e3_expect('P1s publish-rejected-superseded',
  $q$UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23000', 'Cannot publish: score_table_version v1.0 is in status superseded (must be active)');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P2 — against an ACTIVE version the same publish succeeds ((a)+(b)+(c)).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
 WHERE id = '00000000-0000-0000-0000-00000000e301';
DO $$ BEGIN
  IF (SELECT status FROM public.test_forms WHERE id = '00000000-0000-0000-0000-00000000e301') IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'EXG FAIL [P2 publish-succeeds-active]: form is not published';
  END IF;
  RAISE NOTICE 'ok   [P2 publish-succeeds-active] draft -> published with v1.0 active (rolled back)';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P3 — gate (b): thresholds outside RW 18-21 / M 13-16 with no override.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET routing_threshold_rw = 22 WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('P3 publish-rejected-threshold',
  $q$UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23000', 'Cannot publish: routing thresholds (RW=22, M=14) outside expected range%');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P4 — the override approver is pinned NULL until an admins table exists
-- (G-EX-04), so gate (b)'s override path cannot be opened with an unverified id.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_expect('P4 override-approver-pinned-null',
  $q$UPDATE public.test_forms SET routing_override_approved_by = gen_random_uuid(),
        routing_override_reason = 'r', routing_override_ticket_id = 't'
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23514', '%', 'routing_override_pending_admins_g_ex_04');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- P5 — a form cannot be born published (would bypass the gate).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_expect('P5 insert-non-draft-rejected',
  $q$INSERT INTO public.test_forms (id, name, test_kind, status, score_table_version,
       routing_threshold_rw, routing_threshold_m, break_duration_ms, rw_module1_ms, rw_module2_ms,
       m_module1_ms, m_module2_ms, published_at)
     VALUES (gen_random_uuid(), 'born published', 'full_length', 'published', 'v1.0',
       19, 14, 1, 1, 1, 1, 1, now())$q$,
  '23000', 'Cannot insert test_form % with status published: forms are created as draft%');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- C7 — gate (c) in the trigger: with v1.0 active, a publish of a form whose
-- composition is off is refused by validate_form_composition, cell named.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.questions SET difficulty = 2 WHERE id = 'SATM1V10100';
SELECT pg_temp.e3_expect('C7 publish-rejected-composition',
  $q$UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23514', '%section=M module=1 dimension=difficulty value=1 expected=7 actual=6');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- F1..F4, I1..I3 — published-form immutability (form row + items).
-- Each publishes the fixture form inside its own rolled-back txn first.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('F1 published-form-update',
  $q$UPDATE public.test_forms SET rw_module1_ms = rw_module1_ms + 1 WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  'P0001', 'Published forms are immutable. Archive and republish.');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
-- is_selectable / retired_for_new_sessions_at stay mutable (§6.5) — must NOT raise.
UPDATE public.test_forms SET is_selectable = false, retired_for_new_sessions_at = clock_timestamp()
 WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('F2 published-form-delete',
  $q$DELETE FROM public.test_forms WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  'P0001', 'Cannot delete test_form % published forms are retained for historical scoring and audit.');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('F3 status-one-way',
  $q$UPDATE public.test_forms SET status = 'draft' WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  'P0001', 'Illegal test_forms status transition published -> draft%');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
UPDATE public.test_forms SET status = 'archived', archived_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('F4 archived-form-update',
  $q$UPDATE public.test_forms SET score_table_version = 'v1.0', routing_threshold_m = 15 WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  'P0001', 'Published forms are immutable. Archive and republish.');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('I1 published-items-insert',
  $q$INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
     VALUES ('00000000-0000-0000-0000-00000000e301', 'RW', '1', 99, 'SATRW1V20100')$q$,
  'P0001', 'test_form_items of published form % are immutable (INSERT refused)%');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('I2 published-items-update',
  $q$UPDATE public.test_form_items SET ordinal = ordinal + 100
      WHERE test_form_id = '00000000-0000-0000-0000-00000000e301' AND section = 'RW' AND module = '1' AND ordinal = 0$q$,
  'P0001', 'test_form_items of published form % are immutable (UPDATE refused)%');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_activate_v10();
UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp() WHERE id = '00000000-0000-0000-0000-00000000e301';
SELECT pg_temp.e3_expect('I3 published-items-delete',
  $q$DELETE FROM public.test_form_items
      WHERE test_form_id = '00000000-0000-0000-0000-00000000e301' AND section = 'RW' AND module = '1' AND ordinal = 0$q$,
  'P0001', 'test_form_items of published form % are immutable (DELETE refused)%');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- U1 / U2 — test_form_items uniqueness.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT pg_temp.e3_expect('U1 form-question-unique',
  $q$INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
     VALUES ('00000000-0000-0000-0000-00000000e301', 'RW', '1', 99, 'SATRW1V10100')$q$,
  '23505', '%', 'test_form_items_test_form_id_question_id_key');
ROLLBACK;

BEGIN;
SELECT pg_temp.e3_expect('U2 form-slot-unique',
  $q$INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
     VALUES ('00000000-0000-0000-0000-00000000e301', 'RW', '1', 0, 'SATRW1V20100')$q$,
  '23505', '%', 'test_form_items_test_form_id_section_module_ordinal_key');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- R1 / R2 — module2_path: first lock allowed; any rewrite refused.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.test_sessions (id, student_id, test_form_id, state, mode, active_section, started_at,
                                  grace_expires_at, attempt_number_for_form, is_first_seen_form_attempt)
VALUES ('00000000-0000-0000-0000-0000000e3501', '00000000-0000-0000-0000-00000000e3aa',
        '00000000-0000-0000-0000-00000000e301', 'active', 'strict', 'RW', now(), now() + interval '1 day', 1, true);
INSERT INTO public.test_session_sections (test_session_id, section, state, module1_started_at)
VALUES ('00000000-0000-0000-0000-0000000e3501', 'RW', 'module1_active', now());
UPDATE public.test_session_sections
   SET state = 'module1_submitted', module2_path = 'B', module1_submitted_at = now(), module1_submitted_by = 'student'
 WHERE test_session_id = '00000000-0000-0000-0000-0000000e3501' AND section = 'RW';
DO $$ BEGIN
  IF (SELECT module2_path FROM public.test_session_sections
       WHERE test_session_id = '00000000-0000-0000-0000-0000000e3501' AND section = 'RW') IS DISTINCT FROM 'B' THEN
    RAISE EXCEPTION 'EXG FAIL [R1 routing-first-lock-allowed]: first write of module2_path did not stick';
  END IF;
  RAISE NOTICE 'ok   [R1 routing-first-lock-allowed] NULL -> B accepted';
END $$;
SELECT pg_temp.e3_expect('R2 routing-rewrite-blocked',
  $q$UPDATE public.test_session_sections SET module2_path = 'A'
      WHERE test_session_id = '00000000-0000-0000-0000-0000000e3501' AND section = 'RW'$q$,
  'P0001', 'module2_path is immutable once set');
ROLLBACK;

-- ---------------------------------------------------------------------------
-- A1 — answer upsert idempotency on (session, section, module, ordinal).
-- Semantics (§11.2 step 7, §11.3): the ledger key (session, idempotency_key)
-- makes a replay a no-op — the replayed INSERT is refused 23505 and canonical
-- state is untouched; a NEW key for the same slot deterministically UPDATEs
-- the single canonical row (answer, last_submission_id). One row throughout.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.test_sessions (id, student_id, test_form_id, state, mode, active_section, started_at,
                                  grace_expires_at, attempt_number_for_form, is_first_seen_form_attempt)
VALUES ('00000000-0000-0000-0000-0000000e3502', '00000000-0000-0000-0000-00000000e3aa',
        '00000000-0000-0000-0000-00000000e301', 'active', 'strict', 'RW', now(), now() + interval '1 day', 1, true);
CREATE TEMP TABLE _submit (key text, answer text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.e3_submit(p_key text, p_answer text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_sub uuid;
BEGIN
  INSERT INTO public.test_answer_submissions (test_session_id, idempotency_key, section, module, ordinal,
      question_id, answer, response_json, response_schema_version, was_canonical_update)
  VALUES ('00000000-0000-0000-0000-0000000e3502', p_key, 'RW', '1', 0, 'SATRW1V10100', p_answer,
          jsonb_build_object('stored', jsonb_build_object('answer', p_answer)), 'tests-answer-v1', true)
  RETURNING id INTO v_sub;
  INSERT INTO public.test_session_answers (test_session_id, section, module, ordinal, question_id, answer, last_submission_id)
  VALUES ('00000000-0000-0000-0000-0000000e3502', 'RW', '1', 0, 'SATRW1V10100', p_answer, v_sub)
  ON CONFLICT (test_session_id, section, module, ordinal) DO UPDATE
    SET answer = EXCLUDED.answer, client_latency_ms = EXCLUDED.client_latency_ms,
        last_submission_id = EXCLUDED.last_submission_id, updated_at = clock_timestamp();
END $f$;
SELECT pg_temp.e3_submit('K1', 'A');
SELECT pg_temp.e3_expect('A1a answer-replay-refused',
  $q$SELECT pg_temp.e3_submit('K1', 'A')$q$,
  '23505', '%', 'test_answer_submissions_test_session_id_idempotency_key_key');
SELECT pg_temp.e3_submit('K2', 'B');
-- the canonical upsert statement itself, replayed verbatim with K2's values:
-- ON CONFLICT on the PRIMARY KEY lands on the same row, values unchanged.
INSERT INTO public.test_session_answers (test_session_id, section, module, ordinal, question_id, answer, last_submission_id)
SELECT '00000000-0000-0000-0000-0000000e3502', 'RW', '1', 0, 'SATRW1V10100', 'B', id
  FROM public.test_answer_submissions WHERE test_session_id = '00000000-0000-0000-0000-0000000e3502' AND idempotency_key = 'K2'
ON CONFLICT (test_session_id, section, module, ordinal) DO UPDATE
  SET answer = EXCLUDED.answer, client_latency_ms = EXCLUDED.client_latency_ms,
      last_submission_id = EXCLUDED.last_submission_id, updated_at = clock_timestamp();
-- delayed K1 retry (§11.3): refused again, canonical state stays B
SELECT pg_temp.e3_expect('A1b answer-delayed-replay-refused',
  $q$SELECT pg_temp.e3_submit('K1', 'A')$q$,
  '23505', '%', 'test_answer_submissions_test_session_id_idempotency_key_key');
DO $$
DECLARE v_rows int; v_ans text; v_last text; v_subs int;
BEGIN
  SELECT count(*), max(a.answer), max(s.idempotency_key) INTO v_rows, v_ans, v_last
    FROM public.test_session_answers a JOIN public.test_answer_submissions s ON s.id = a.last_submission_id
   WHERE a.test_session_id = '00000000-0000-0000-0000-0000000e3502';
  SELECT count(*) INTO v_subs FROM public.test_answer_submissions
   WHERE test_session_id = '00000000-0000-0000-0000-0000000e3502';
  IF v_rows <> 1 OR v_ans <> 'B' OR v_last <> 'K2' OR v_subs <> 2 THEN
    RAISE EXCEPTION 'EXG FAIL [A1 answer-upsert-idempotent]: rows=% answer=% last_key=% ledger=% (want 1/B/K2/2)',
      v_rows, v_ans, v_last, v_subs;
  END IF;
  RAISE NOTICE 'ok   [A1 answer-upsert-idempotent] 1 canonical row, answer B via K2, ledger 2 rows, both K1 replays refused';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- D1 — account deletion: DELETE of the student's profile cascades through
-- test_sessions to sections, submissions and answers (nothing blocks).
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.test_sessions (id, student_id, test_form_id, state, mode, active_section, started_at,
                                  grace_expires_at, attempt_number_for_form, is_first_seen_form_attempt)
VALUES ('00000000-0000-0000-0000-0000000e3503', '00000000-0000-0000-0000-00000000e3aa',
        '00000000-0000-0000-0000-00000000e301', 'active', 'strict', 'RW', now(), now() + interval '1 day', 1, true);
INSERT INTO public.test_session_sections (test_session_id, section, state) VALUES
  ('00000000-0000-0000-0000-0000000e3503', 'RW', 'module1_active'),
  ('00000000-0000-0000-0000-0000000e3503', 'M',  'not_started');
WITH s AS (
  INSERT INTO public.test_answer_submissions (test_session_id, idempotency_key, section, module, ordinal,
      question_id, answer, response_json, response_schema_version, was_canonical_update)
  VALUES ('00000000-0000-0000-0000-0000000e3503', 'K', 'RW', '1', 0, 'SATRW1V10100', 'A', '{}', 'tests-answer-v1', true)
  RETURNING id)
INSERT INTO public.test_session_answers (test_session_id, section, module, ordinal, question_id, answer, last_submission_id)
SELECT '00000000-0000-0000-0000-0000000e3503', 'RW', '1', 0, 'SATRW1V10100', 'A', id FROM s;
DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000e3aa';
DO $$
DECLARE v_left int;
BEGIN
  SELECT (SELECT count(*) FROM public.test_sessions WHERE id = '00000000-0000-0000-0000-0000000e3503')
       + (SELECT count(*) FROM public.test_session_sections WHERE test_session_id = '00000000-0000-0000-0000-0000000e3503')
       + (SELECT count(*) FROM public.test_answer_submissions WHERE test_session_id = '00000000-0000-0000-0000-0000000e3503')
       + (SELECT count(*) FROM public.test_session_answers WHERE test_session_id = '00000000-0000-0000-0000-0000000e3503')
    INTO v_left;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'EXG FAIL [D1 deletion-cascade]: % runtime row(s) survived the profile delete', v_left;
  END IF;
  RAISE NOTICE 'ok   [D1 deletion-cascade] profile delete removed session, 2 sections, 1 submission, 1 answer';
END $$;
ROLLBACK;
