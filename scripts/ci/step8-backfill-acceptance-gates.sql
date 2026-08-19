-- ============================================================================
-- Fixture for the Step 8 backfill-acceptance gate.
-- ============================================================================
-- Driven by scripts/ci/step8-backfill-acceptance-gates.sh.
--
-- Sections (selected by the driver):
--   seed_above_gate — a student whose id starts 3f18cbe2 with >= mastery_min_events()
--                     answered items in EVERY one of the canonical 8 (section, domain)
--                     pairs. This clears Doc 05C's Q4 evidence gate, so
--                     compute_section_projection must emit a NON-NULL
--                     projected_score_mid in both sections.
--   seed_below_gate — the same student, but only the 4 M-section domains populated.
--                     The Q4 gate spans BOTH sections, so it must fail and both
--                     projections must come back all-NULL. This is the negative
--                     control for the acceptance test: row counts stay non-zero
--                     while the real signal goes NULL.
--   run_backfill    — drive public.backfill_recompute_student for the seeded student
--   assert_event_time_empty — the structural claim the rewritten verdict rests on
--
-- WHY THE STUDENT ID STARTS WITH 3f18cbe2
--   scripts/prod-verify/step8-verify.sql scopes its acceptance test with
--   p.id::text LIKE '3f18cbe2%'. Running the REAL file against this fixture is the
--   point of the gate, so the fixture has to satisfy that predicate rather than
--   the gate re-typing the assertion against a different id.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- The domain count travels through a session GUC, not a psql variable: psql does
-- NOT interpolate :vars inside dollar-quoted strings, so `:seed_domains` inside
-- the DO block below reaches the server verbatim and fails with a syntax error.
\if :{?seed_above_gate}
SET lyceon.seed_domains = '8';
\set do_seed 1
\endif
\if :{?seed_below_gate}
SET lyceon.seed_domains = '4';
\set do_seed 1
\endif

\if :{?do_seed}

DO $seed$
DECLARE
  v_student uuid := '3f18cbe2-0000-4000-8000-000000000001';
  v_session uuid := '3f18cbe2-0000-4000-8000-0000000000ff';
  v_actor   uuid;
  v_pairs   text[][] := ARRAY[
    ARRAY['M','Algebra','ALG.01','SATM1A00001'],
    ARRAY['M','Advanced Math','ADV.01','SATM1A00002'],
    ARRAY['M','Problem Solving and Data Analysis','PSD.01','SATM1A00003'],
    ARRAY['M','Geometry and Trigonometry','GEO.01','SATM1A00004'],
    ARRAY['RW','Information and Ideas','INF.01','SATRW1A00001'],
    ARRAY['RW','Craft and Structure','CAS.01','SATRW1A00002'],
    ARRAY['RW','Expression of Ideas','EOI.01','SATRW1A00003'],
    ARRAY['RW','Standard English Conventions','SEC.01','SATRW1A00004']
  ];
  v_domains integer := current_setting('lyceon.seed_domains')::integer;
  v_min     integer;
  v_ord     integer := 0;
  i         integer;
  j         integer;
BEGIN
  SELECT public.mastery_min_events() INTO v_min;
  IF v_min IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: mastery_min_events() is NULL — mastery_constants not seeded';
  END IF;

  INSERT INTO auth.users (id, email) VALUES (v_student, 'step8@example.com');
  SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_student;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: profile actor_id not assigned — the 05E substrate trigger did not fire';
  END IF;

  INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform,
                                        client_instance_id, status, actor_id)
  VALUES (v_session, v_student, 'flow', 200, 'web', 'inst-step8', 'active', v_actor);

  FOR i IN 1..v_domains LOOP
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                  stem, options, correct_answer, explanation)
    VALUES (v_pairs[i][4], v_pairs[i][1], 1, v_pairs[i][2], ARRAY[v_pairs[i][3]], 2, 'Stem',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'Explanation')
    ON CONFLICT (id) DO NOTHING;

    -- One more than the minimum, so the gate clears with margin and a single
    -- off-by-one in mastery_min_events() does not silently decide the outcome.
    FOR j IN 1..(v_min + 1) LOOP
      v_ord := v_ord + 1;
      INSERT INTO public.practice_session_items (
        session_id, user_id, ordinal, question_id,
        question_stem, question_options, question_correct_answer, question_explanation,
        question_domain, question_skill, question_difficulty, question_section,
        status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
      ) VALUES (
        v_session, v_student, v_ord, v_pairs[i][4], 'Stem',
        '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
        v_pairs[i][2], v_pairs[i][3], 2, v_pairs[i][1],
        'answered',
        CASE WHEN j % 3 = 0 THEN 'B' ELSE 'A' END,
        (j % 3 <> 0),
        CASE WHEN j % 3 = 0 THEN 'incorrect' ELSE 'correct' END,
        now() - make_interval(hours => 500 - v_ord),
        now() - make_interval(hours => 500 - v_ord),
        v_actor
      );
    END LOOP;
  END LOOP;

  RAISE NOTICE 'FIXTURE: seeded % domain(s) x % event(s) = % answered items',
    v_domains, v_min + 1, v_ord;
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?run_backfill}

DO $run$
DECLARE
  v_student uuid := '3f18cbe2-0000-4000-8000-000000000001';
BEGIN
  PERFORM public.backfill_recompute_student(v_student);
  RAISE NOTICE 'BACKFILL: complete for %', v_student;
END $run$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_event_time_empty}

-- The structural claim the rewritten step8-verify.sql verdict rests on, asserted
-- directly rather than inferred: a backfill writes NO event-time rows.
--
-- If this ever fails, step8-verify.sql's "these tables must be empty" assertions
-- become wrong and BOTH must change together. That is exactly why this is a
-- separate, explicit assertion instead of a comment.
DO $assert$
DECLARE
  v_refresh integer;
  v_audit   integer;
  v_stamped integer;
  v_skill   integer;
BEGIN
  SELECT count(*) INTO v_refresh FROM public.student_projection_refresh_state;
  IF v_refresh <> 0 THEN
    RAISE EXCEPTION
      'STRUCTURAL: backfill wrote % student_projection_refresh_state row(s); it calls recompute_skill_mastery with p_chain_downstream := false, so bump_projection_refresh_counter must never fire',
      v_refresh;
  END IF;

  SELECT count(*) INTO v_audit FROM public.mastery_event_audit_log;
  IF v_audit <> 0 THEN
    RAISE EXCEPTION
      'STRUCTURAL: backfill wrote % mastery_event_audit_log row(s); only apply_mastery_event writes that table and the backfill does not call it',
      v_audit;
  END IF;

  -- and the positive provenance signal must be present
  SELECT count(*) INTO v_stamped FROM public.mastery_domain_refresh_audit_log
   WHERE triggered_by = 'backfill_recompute';
  IF v_stamped = 0 THEN
    RAISE EXCEPTION 'STRUCTURAL: no mastery_domain_refresh_audit_log row stamped backfill_recompute';
  END IF;

  SELECT count(*) INTO v_skill FROM public.student_skill_mastery;
  IF v_skill = 0 THEN
    RAISE EXCEPTION 'STRUCTURAL: backfill produced no skill mastery at all';
  END IF;

  RAISE NOTICE 'STRUCTURAL ok: refresh_state 0, event audit 0, backfill-stamped %, skill rows %',
    v_stamped, v_skill;
END $assert$;

\endif
