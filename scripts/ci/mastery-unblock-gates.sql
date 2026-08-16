-- ============================================================================
-- Fixture + assertions for the mastery-unblock migration gate.
-- ============================================================================
-- Driven by scripts/ci/mastery-unblock-gates.sh, which controls WHICH
-- migrations are applied before each section runs. This file is a library of
-- \i-able sections, not a standalone script — the sequencing is the test.
--
-- Sections (selected by the driver via :section):
--   seed_repairable   — pre-migration state: resolved rows with NULL occurred_at
--                       plus unresolved rows whose NULL is legitimate
--   assert_pre        — captures the negative-control baseline and proves the
--                       constraint does NOT yet exist (the RED half)
--   assert_post       — repair happened, negative control unchanged, constraint
--                       now rejects (the GREEN half)
--   seed_unrepairable — resolved row with NULL occurred_at AND NULL answered_at
--   seed_overscope    — 43 repairable rows (one past the pinned 42)
--   seed_bad_domain   — a question with a non-canonical (section, domain) pair
--   assert_domain_post— both domain constraints present and rejecting
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
\if :{?seed_repairable}

DO $seed$
DECLARE
  v_student uuid := '11111111-1111-1111-1111-111111111111';
  v_session uuid := '22222222-2222-2222-2222-222222222222';
  v_qid     text := 'SATM1A00001';
  v_actor   uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_student, 'unblock@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: profile actor_id not assigned — the 05E substrate trigger did not fire';
  END IF;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'Explanation')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_session, v_student, 'flow', 10, 'web', 'inst-unblock', 'active', v_actor);

  -- 3 REPAIRABLE: resolved, NULL occurred_at, non-NULL answered_at.
  -- Two 'answered' and one 'skipped' — the skip path writes answered_at and
  -- occurred_at together, so a skipped row is repairable on exactly the same terms.
  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
  ) VALUES
    (v_session, v_student, 1, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true,  'correct',   now() - interval '3 days', NULL, v_actor),
    (v_session, v_student, 2, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'answered', 'B', false, 'incorrect', now() - interval '2 days', NULL, v_actor),
    (v_session, v_student, 3, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'skipped',  NULL, false, 'skipped',  now() - interval '1 days', NULL, v_actor);

  -- 2 LEGITIMATE NULLs: unresolved items are not events yet. These are the
  -- negative control — the UPDATE must not touch them.
  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, served_at, actor_id
  ) VALUES
    (v_session, v_student, 4, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'served',  now(), v_actor),
    (v_session, v_student, 5, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'pending', NULL,  v_actor);
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_pre}

-- RED HALF. Before the migration the constraint must NOT exist, and a resolved
-- row with NULL occurred_at must be writable. If either assertion fails, the
-- green half proves nothing — it would be passing for an unrelated reason.
DO $pre$
DECLARE
  v_repairable integer;
  v_legit      integer;
  v_con        integer;
BEGIN
  SELECT count(*) INTO v_repairable FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS NULL AND answered_at IS NOT NULL;
  IF v_repairable <> 3 THEN
    RAISE EXCEPTION 'PRE: expected 3 repairable rows, found %', v_repairable;
  END IF;

  SELECT count(*) INTO v_legit FROM public.practice_session_items
   WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL;
  IF v_legit <> 2 THEN
    RAISE EXCEPTION 'PRE: expected 2 legitimately-NULL rows, found %', v_legit;
  END IF;

  SELECT count(*) INTO v_con FROM pg_constraint
   WHERE conname = 'psi_resolved_requires_occurred_at';
  IF v_con <> 0 THEN
    RAISE EXCEPTION 'PRE: constraint psi_resolved_requires_occurred_at already exists — cutoff apply is wrong';
  END IF;

  -- The mutation the constraint is supposed to stop. It must SUCCEED here.
  UPDATE public.practice_session_items
     SET status = 'answered', answered_at = now(), occurred_at = NULL
   WHERE ordinal = 4;

  RAISE NOTICE 'PRE ok: 3 repairable, 2 legit-NULL, no constraint, unconstrained write accepted';

  -- put it back so the migration sees the intended shape (now 4 repairable)
  UPDATE public.practice_session_items
     SET status = 'served', answered_at = NULL
   WHERE ordinal = 4;
END $pre$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_post}

DO $post$
DECLARE
  v_unrepaired integer;
  v_legit      integer;
  v_drifted    integer;
  v_con        integer;
  v_sqlstate   text;
BEGIN
  -- (i) repair assertion
  SELECT count(*) INTO v_unrepaired FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS NULL;
  IF v_unrepaired <> 0 THEN
    RAISE EXCEPTION 'POST: % resolved row(s) still have NULL occurred_at', v_unrepaired;
  END IF;

  -- (ii) NEGATIVE CONTROL — the load-bearing assertion. The UPDATE must not
  --      have touched unresolved rows. A widened predicate shows up here.
  SELECT count(*) INTO v_legit FROM public.practice_session_items
   WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL;
  IF v_legit <> 2 THEN
    RAISE EXCEPTION 'POST NEGATIVE CONTROL FAILED: legitimately-NULL rows went from 2 to % — the UPDATE touched unresolved items', v_legit;
  END IF;

  -- (iii) repaired value is exactly answered_at, not now()
  SELECT count(*) INTO v_drifted FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS DISTINCT FROM answered_at;
  IF v_drifted <> 0 THEN
    RAISE EXCEPTION 'POST: % repaired row(s) have occurred_at <> answered_at', v_drifted;
  END IF;

  -- (iv) constraint present
  SELECT count(*) INTO v_con FROM pg_constraint
   WHERE conname = 'psi_resolved_requires_occurred_at';
  IF v_con <> 1 THEN
    RAISE EXCEPTION 'POST: constraint psi_resolved_requires_occurred_at not found';
  END IF;

  -- (v) GREEN HALF of the mutation: the same write the pre-state accepted must
  --     now be refused with 23514.
  BEGIN
    UPDATE public.practice_session_items
       SET status = 'answered', answered_at = now(), occurred_at = NULL
     WHERE ordinal = 5;
    RAISE EXCEPTION 'POST: unconstrained write ACCEPTED — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '23514' THEN
      RAISE EXCEPTION 'POST: expected SQLSTATE 23514, got %', v_sqlstate;
    END IF;
    RAISE NOTICE 'POST ok: repaired 3, negative control held at 2, constraint rejects with 23514';
  END;
END $post$;

\endif

-- ---------------------------------------------------------------------------
\if :{?seed_unrepairable}

DO $seed$
DECLARE
  v_student uuid := '33333333-3333-3333-3333-333333333333';
  v_session uuid := '44444444-4444-4444-4444-444444444444';
  v_qid     text := 'SATM1A00002';
  v_actor   uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_student, 'unrepairable@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_session, v_student, 'flow', 10, 'web', 'inst-unrep', 'active', v_actor);

  -- answered, but BOTH occurred_at and answered_at NULL: no repair source.
  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
  ) VALUES
    (v_session, v_student, 1, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
     'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct', NULL, NULL, v_actor);
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?seed_overscope}

DO $seed$
DECLARE
  v_student uuid := '55555555-5555-5555-5555-555555555555';
  v_session uuid := '66666666-6666-6666-6666-666666666666';
  v_qid     text := 'SATM1A00003';
  v_actor   uuid;
  i         integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_student, 'overscope@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_session, v_student, 'flow', 50, 'web', 'inst-over', 'active', v_actor);

  -- 43 repairable rows: one past the 42 pinned by 1.1-pre-apply.sql.
  FOR i IN 1..43 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
    ) VALUES
      (v_session, v_student, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
       'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct', now(), NULL, v_actor);
  END LOOP;
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?seed_bad_domain}

DO $seed$
BEGIN
  -- The hyphenated form. This is the exact drift the CHECK exists to stop:
  -- refresh_domain_mastery's canonical M list has NO hyphen.
  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES ('SATM1A00009', 'M', 1, 'Problem-Solving and Data Analysis', ARRAY['PSD.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E');
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_domain_post}

DO $post$
DECLARE
  v_con      integer;
  v_sqlstate text;
BEGIN
  SELECT count(*) INTO v_con FROM pg_constraint
   WHERE conname IN ('questions_domain_section_canonical', 'psi_question_domain_section_canonical');
  IF v_con <> 2 THEN
    RAISE EXCEPTION 'DOMAIN POST: expected both canonical-domain constraints, found %', v_con;
  END IF;

  -- Hyphenated variant must be rejected.
  BEGIN
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
    VALUES ('SATM1A00099', 'M', 1, 'Problem-Solving and Data Analysis', ARRAY['PSD.01'], 2, 'Stem',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'E');
    RAISE EXCEPTION 'DOMAIN POST: hyphenated domain ACCEPTED — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '23514' THEN
      RAISE EXCEPTION 'DOMAIN POST: expected SQLSTATE 23514, got %', v_sqlstate;
    END IF;
  END;

  -- Cross-section pairing must also be rejected: a valid RW domain under M.
  BEGIN
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
    VALUES ('SATM1A00098', 'M', 1, 'Craft and Structure', ARRAY['CAS.01'], 2, 'Stem',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'E');
    RAISE EXCEPTION 'DOMAIN POST: cross-section (M, Craft and Structure) ACCEPTED — pairing is not enforced';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- And the canonical form must still be accepted (not a blanket refusal).
  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES ('SATM1A00097', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSD.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E');

  RAISE NOTICE 'DOMAIN POST ok: both constraints present; hyphen rejected, cross-section rejected, canonical accepted';
END $post$;

\endif
