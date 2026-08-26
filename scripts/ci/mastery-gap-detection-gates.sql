-- ============================================================================
-- Gap-detection gate (Amendment 2 / Step 2.4).
-- ============================================================================
-- Runs against a throwaway DB carrying genesis + all migrations.
--
-- Asserts:
--   (1) a seeded answered item with NO audit row reports exactly one gap
--   (2) the same item WITH an audit row reports zero gaps
--   (3) review_error_attempts is covered too — a detector blind to half of
--       canonical_mastery_events' source branches gives false confidence
--   (4) record_mastery_derivation_gap() persists the count to the ledger
--
-- The mutation this must catch (owner-specified): changing the anti-join to
-- `LEFT JOIN … WHERE TRUE` so gaps stop being counted. Assertion (1) fails.
-- ============================================================================

\set ON_ERROR_STOP on

DO $gate$
DECLARE
  v_student uuid := '77777777-7777-7777-7777-777777777777';
  v_session uuid := '88888888-8888-8888-8888-888888888888';
  v_qid     text := 'SATM1A00050';
  v_actor   uuid;
  v_item    uuid;
  v_gaps    integer;
  v_total   integer;
  v_ledger  public.mastery_derivation_gap_ledger;
BEGIN
  -- ---------------------------------------------------------------------
  -- Seed: one answered practice item, no audit row.
  -- ---------------------------------------------------------------------
  INSERT INTO auth.users (id, email) VALUES (v_student, 'gap@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;

  INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation)
  VALUES (v_qid, 'M', 1, 'Algebra', ARRAY['ALG.01'], 2, 'Stem',
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'A', 'E') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, status, actor_id)
  VALUES (v_session, v_student, 'diagnostic', 40, 'web', 'inst-gap', 'active', v_actor);

  INSERT INTO public.practice_session_items (
    session_id, user_id, ordinal, question_id,
    question_stem, question_options, question_correct_answer, question_explanation,
    question_domain, question_skill, question_difficulty, question_section,
    status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
  ) VALUES (
    v_session, v_student, 1, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
    'Algebra', 'ALG.01', 2, 'M', 'answered', 'A', true, 'correct', now(), now(), v_actor
  ) RETURNING id INTO v_item;

  -- ---------------------------------------------------------------------
  -- (1) exactly one gap, and it is the row we seeded, tagged diagnostic_attempt
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_gaps FROM public.mastery_derivation_gaps
   WHERE student_id = v_student;
  IF v_gaps <> 1 THEN
    RAISE EXCEPTION 'GAP (1): expected exactly 1 gap for the seeded student, found %', v_gaps;
  END IF;

  PERFORM 1 FROM public.mastery_derivation_gaps
   WHERE event_id = v_item AND event_source_kind = 'diagnostic_attempt';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GAP (1): the gap row is not the seeded item, or event_source_kind is not diagnostic_attempt';
  END IF;

  -- ---------------------------------------------------------------------
  -- (4a) ledger records the non-zero count
  -- ---------------------------------------------------------------------
  SELECT * INTO v_ledger FROM public.record_mastery_derivation_gap();
  IF v_ledger.total_gap_count < 1 THEN
    RAISE EXCEPTION 'GAP (4a): ledger recorded total_gap_count=% with a known gap present', v_ledger.total_gap_count;
  END IF;
  IF v_ledger.students_affected < 1 THEN
    RAISE EXCEPTION 'GAP (4a): ledger recorded students_affected=%', v_ledger.students_affected;
  END IF;

  -- ---------------------------------------------------------------------
  -- (2) attribute the event -> the gap closes
  -- ---------------------------------------------------------------------
  INSERT INTO public.mastery_event_audit_log (
    student_id, section, domain, skill, source_family, event_source_kind,
    event_id, question_id, difficulty, correct, occurred_at,
    event_count_after, constants_snapshot_hash, mastery_model_version, applied_at, actor_id
  ) VALUES (
    v_student, 'M', 'Algebra', 'ALG.01', 'practice', 'diagnostic_attempt',
    v_item, v_qid, 2, true, now(),
    1, 'gatehash', 'v1.0', now(), v_actor
  );

  SELECT count(*) INTO v_gaps FROM public.mastery_derivation_gaps
   WHERE student_id = v_student;
  IF v_gaps <> 0 THEN
    RAISE EXCEPTION 'GAP (2): expected 0 gaps after attributing the event, found %', v_gaps;
  END IF;

  -- ---------------------------------------------------------------------
  -- (3) review_error_attempts is covered on the same terms
  -- ---------------------------------------------------------------------
  INSERT INTO public.review_error_attempts
    (student_id, question_id, is_correct, section, domain, skill, difficulty, occurred_at, actor_id)
  VALUES
    (v_student, v_qid, true, 'M', 'Algebra', 'ALG.01', 2, now(), v_actor);

  SELECT count(*) INTO v_gaps FROM public.mastery_derivation_gaps
   WHERE student_id = v_student AND event_source_kind = 'review_error_attempt';
  IF v_gaps <> 1 THEN
    RAISE EXCEPTION 'GAP (3): review_error_attempts not covered — expected 1 review gap, found %', v_gaps;
  END IF;

  -- ---------------------------------------------------------------------
  -- (4b) ledger reflects the new state on re-observation
  -- ---------------------------------------------------------------------
  SELECT * INTO v_ledger FROM public.record_mastery_derivation_gap();
  SELECT total_gap_count INTO v_total FROM public.mastery_derivation_gap_ledger
   ORDER BY observed_at DESC LIMIT 1;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'GAP (4b): latest ledger row reports total_gap_count=%, expected 1', v_total;
  END IF;

  RAISE NOTICE 'GAP DETECTION ok: practice gap found, closed on attribution, review branch covered, ledger persisted';
END $gate$;
