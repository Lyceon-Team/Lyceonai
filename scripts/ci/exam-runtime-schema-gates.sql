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
-- The activation used by P2/C7 is the legitimate §8.4 Tier-3 step-5 UPDATE
--   (attestation fields populated; published_at stamped by the E2 status
--   machine), done inside the rolled-back transaction, exactly as
--   scripts/ci/scoring-catalogue-gates.sql does.
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
-- built from fresh synthetic published questions. Any pairing of the three
-- marginals is valid because every question is created for its own slot.
-- Question ids: SAT<sec>1 + <tag:2><module:2><pos:2>, e.g. SATM1V1011A? -> 6 chars.
CREATE FUNCTION pg_temp.e3_make_form(p_form uuid, p_tag text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  m record; p int; v_id text; v_diff int; v_dom text; v_grid boolean; acc int; k int;
BEGIN
  INSERT INTO public.test_forms (id, name, test_kind, status, score_table_version,
    routing_threshold_rw, routing_threshold_m, break_duration_ms,
    rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
  VALUES (p_form, 'exg fixture ' || p_tag, 'full_length', 'draft', 'v1.0',
          19, 14, 600000, 1920000, 1920000, 2100000, 2100000);

  FOR m IN
    SELECT * FROM (VALUES
      ('RW', '1',  '01', 27, ARRAY[8, 11, 8],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 8, 5, 7]),
      ('RW', '2A', '2A', 27, ARRAY[14, 9, 4],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 7, 6, 7]),
      ('RW', '2B', '2B', 27, ARRAY[4, 9, 14],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 7, 6, 7]),
      ('M',  '1',  '01', 22, ARRAY[7, 9, 6],   3, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[8, 7, 4, 3]),
      ('M',  '2A', '2A', 22, ARRAY[11, 8, 3],  8, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[7, 8, 3, 4]),
      ('M',  '2B', '2B', 22, ARRAY[3, 8, 11],  8, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[7, 8, 3, 4])
    ) AS t(section, module, mcode, total, diffs, grid, doms, domn)
  LOOP
    FOR p IN 0 .. m.total - 1 LOOP
      v_diff := CASE WHEN p < m.diffs[1] THEN 1 WHEN p < m.diffs[1] + m.diffs[2] THEN 2 ELSE 3 END;
      acc := 0; v_dom := NULL;
      FOR k IN 1 .. 4 LOOP
        acc := acc + m.domn[k];
        IF v_dom IS NULL AND p < acc THEN v_dom := m.doms[k]; END IF;
      END LOOP;
      v_grid := p < m.grid;
      v_id := 'SAT' || m.section || '1' || p_tag || m.mcode || lpad(p::text, 2, '0');
      INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem,
                                    options, correct_answer, explanation, status, item_type,
                                    correct_variants, published_at)
      VALUES (v_id, m.section, 1, v_dom, ARRAY['exg-fixture'], v_diff, 'exg fixture',
              CASE WHEN v_grid THEN '[]'::jsonb ELSE '["A","B","C","D"]'::jsonb END,
              'A', 'exg fixture', 'published',
              CASE WHEN v_grid THEN 'grid_in' ELSE 'mcq' END,
              CASE WHEN v_grid THEN ARRAY['1'] ELSE NULL END, now());
      INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
      VALUES (p_form, m.section, m.module, p, v_id);
    END LOOP;
  END LOOP;
END $f$;

-- e3_activate_v10: the legitimate Tier-3 activation (inside a rolled-back txn).
CREATE FUNCTION pg_temp.e3_activate_v10() RETURNS void LANGUAGE sql AS $f$
  UPDATE public.scoring_model_versions
     SET status = 'active',
         constants_sha256 = 'gate-fixture',
         validation_packet_url = 'git://lyceon-spec/04B/v4.3/evidence_packet_v42/'
   WHERE version = 'v1.0';
$f$;

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
-- G1 — privileges: RLS on all seven, no policies, no anon/authenticated grant,
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
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                       'test_answer_submissions','test_session_answers','exam_runtime_outbox');
  IF v_n <> 0 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: % policies exist (G-EX-01 unresolved; expected none)', v_n; END IF;
  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
     AND table_name IN ('test_forms','test_form_items','test_sessions','test_session_sections',
                        'test_answer_submissions','test_session_answers','exam_runtime_outbox');
  IF v_n <> 0 THEN RAISE EXCEPTION 'EXG FAIL [G1 privileges]: % anon/authenticated grant(s)', v_n; END IF;
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
  RAISE NOTICE 'ok   [G1 privileges] RLS on 7/7, 0 policies, 0 anon/authenticated grants, ledger append-only';
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
-- P1 — v1.0 is 'candidate' (E2 owner ruling), so EVERY publish is rejected by
-- gate check (a) — shown on the composition-valid, in-range fixture form,
-- i.e. a form that would pass (b) and (c).
-- ---------------------------------------------------------------------------
BEGIN;
DO $$ BEGIN
  IF (SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0') <> 'candidate' THEN
    RAISE EXCEPTION 'EXG FAIL [P1 publish-rejected-candidate]: v1.0 is not candidate; this check''s premise changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scoring_model_versions WHERE status = 'active') THEN
    RAISE EXCEPTION 'EXG FAIL [P1 publish-rejected-candidate]: an active version exists; publishes are no longer universally refused';
  END IF;
END $$;
SELECT pg_temp.e3_expect('P1 publish-rejected-candidate',
  $q$UPDATE public.test_forms SET status = 'published', published_at = clock_timestamp()
      WHERE id = '00000000-0000-0000-0000-00000000e301'$q$,
  '23000', 'Cannot publish: score_table_version v1.0 is in status candidate (must be active)');
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
