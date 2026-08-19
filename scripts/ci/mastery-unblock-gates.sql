-- ============================================================================
-- Fixture + assertions for the mastery-unblock migration gate.
-- ============================================================================
-- Driven by scripts/ci/mastery-unblock-gates.sh, which controls WHICH
-- migrations are applied before each section runs. This file is a library of
-- \i-able sections, not a standalone script — the sequencing is the test.
--
-- Sections (selected by the driver via :section):
--   seed_repairable   — pre-migration state: resolved rows with NULL occurred_at
--                       plus unresolved rows whose NULL is legitimate. Shaped to
--                       production's exact census (42 / 0 / 70 / 154) so the
--                       prod-verify verdicts reach their hash branch — see the
--                       section header below.
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

-- WHY THIS FIXTURE MIRRORS PRODUCTION'S CENSUS EXACTLY
--   scripts/prod-verify/1.1-pre-apply.sql and 1.1-post-apply.sql render a single
--   verdict column whose CASE tests counts BEFORE the exact-target hash. With a
--   toy fixture — the earlier shape was 3 repairable, 2 already-repaired, 2
--   legitimately NULL, 7 rows total — the count branch short-circuits first, the
--   hash branch is unreachable, and gate (A3) could only assert the raw
--   *_hash_matches column. The shipped verdict logic went untested: a verdict
--   that computed the comparison and then ignored it would have passed.
--
--   So the census here is production's, row for row:
--
--     42  repairable      status IN ('answered','skipped'), occurred_at NULL,
--                         answered_at NOT NULL          -> ordinals   1..42
--     42  already-repaired resolved with occurred_at ALREADY = answered_at
--                                                       -> ordinals  43..84
--      9  served          unresolved, NULL occurred_at   -> ordinals  85..93
--     61  pending         unresolved, NULL occurred_at   -> ordinals  94..154
--      0  unrepairable    (covered by seed_unrepairable in case (B))
--     ---
--    154  total, 84 resolved, 70 legitimately NULL
--
--   Both prod-verify files therefore run their FULL verdict against this fixture
--   and reach 'OK — …', which is what lets (A3) assert the verdict STRING rather
--   than one column of it.
--
--   The 42 already-repaired rows are not padding. They keep the repairable set a
--   STRICT SUBSET of the resolved set (42 of 84, as in prod). Without them every
--   resolved row is also repairable, and a backfill log that wrongly logged "all
--   resolved rows" instead of "the rows I repaired" would produce an identical
--   set and slip through both the count assertion and the exact-target hash.
--
--   What this fixture deliberately does NOT reproduce is production's hash. Row
--   ids come from gen_random_uuid(), so the fixture's target-set hash is fresh on
--   every run and can never equal the pinned constant. (A3) supplies the
--   fixture's own hash via -v expected_target_set_hash, which is what that
--   documented override exists for.

DO $seed$
DECLARE
  v_student uuid := '11111111-1111-1111-1111-111111111111';
  v_session uuid := '22222222-2222-2222-2222-222222222222';
  v_qid     text := 'SATM1A00001';
  v_actor   uuid;
  i         integer;
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
  VALUES (v_session, v_student, 'flow', 154, 'web', 'inst-unblock', 'active', v_actor);

  -- ordinals 1..42 — 42 REPAIRABLE: resolved, NULL occurred_at, non-NULL
  -- answered_at. Ordinals 41 and 42 are 'skipped' rather than 'answered': the
  -- skip path writes answered_at and occurred_at together, so a skipped row is
  -- repairable on exactly the same terms and must be inside the UPDATE predicate.
  FOR i IN 1..42 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
    ) VALUES (
      v_session, v_student, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
      'Algebra', 'ALG.01', 2, 'M',
      CASE WHEN i >= 41 THEN 'skipped' ELSE 'answered' END,
      CASE WHEN i >= 41 THEN NULL WHEN i % 2 = 1 THEN 'A' ELSE 'B' END,
      CASE WHEN i >= 41 THEN false ELSE (i % 2 = 1) END,
      CASE WHEN i >= 41 THEN 'skipped' WHEN i % 2 = 1 THEN 'correct' ELSE 'incorrect' END,
      -- distinct answered_at per row, so a repair that writes now() instead of
      -- answered_at shows up in the post-apply drift assertion
      now() - make_interval(hours => 200 - i),
      NULL,
      v_actor
    );
  END LOOP;

  -- ordinals 43..84 — 42 ALREADY-REPAIRED resolved rows: answered with
  -- occurred_at ALREADY equal to answered_at. See the header: these are what make
  -- the repairable set a strict subset of the resolved set.
  FOR i IN 43..84 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, selected_answer, is_correct, outcome, answered_at, occurred_at, actor_id
    ) VALUES (
      v_session, v_student, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
      'Algebra', 'ALG.01', 2, 'M', 'answered',
      CASE WHEN i % 2 = 1 THEN 'A' ELSE 'B' END,
      (i % 2 = 1),
      CASE WHEN i % 2 = 1 THEN 'correct' ELSE 'incorrect' END,
      now() - make_interval(hours => 400 - i),
      now() - make_interval(hours => 400 - i),
      v_actor
    );
  END LOOP;

  -- ordinals 85..154 — 70 LEGITIMATE NULLs: unresolved items are not events yet.
  -- These are the negative control — the UPDATE must not touch them. Split 9
  -- 'served' / 61 'pending' exactly as production's 70 unresolved rows are split.
  FOR i IN 85..154 LOOP
    INSERT INTO public.practice_session_items (
      session_id, user_id, ordinal, question_id,
      question_stem, question_options, question_correct_answer, question_explanation,
      question_domain, question_skill, question_difficulty, question_section,
      status, served_at, actor_id
    ) VALUES (
      v_session, v_student, i, v_qid, 'Stem', '[{"key":"A","text":"a"}]'::jsonb, 'A', 'E',
      'Algebra', 'ALG.01', 2, 'M',
      CASE WHEN i <= 93 THEN 'served' ELSE 'pending' END,
      CASE WHEN i <= 93 THEN now() ELSE NULL END,
      v_actor
    );
  END LOOP;
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_pre}

-- RED HALF. Before the migration the constraint must NOT exist, and a resolved
-- row with NULL occurred_at must be writable. If either assertion fails, the
-- green half proves nothing — it would be passing for an unrelated reason.
DO $pre$
DECLARE
  v_repairable   integer;
  v_unrepairable integer;
  v_legit        integer;
  v_resolved     integer;
  v_total        integer;
  v_con          integer;
BEGIN
  SELECT count(*) INTO v_repairable FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS NULL AND answered_at IS NOT NULL;
  IF v_repairable <> 42 THEN
    RAISE EXCEPTION 'PRE: expected 42 repairable rows, found %', v_repairable;
  END IF;

  -- Production has none, and the prod-verify pre-apply verdict tests this branch
  -- first. If the fixture ever grows one, the verdict would STOP for the wrong
  -- reason and (A3) would be asserting a message it was not written to assert.
  SELECT count(*) INTO v_unrepairable FROM public.practice_session_items
   WHERE status IN ('answered','skipped') AND occurred_at IS NULL AND answered_at IS NULL;
  IF v_unrepairable <> 0 THEN
    RAISE EXCEPTION 'PRE: expected 0 unrepairable rows, found %', v_unrepairable;
  END IF;

  SELECT count(*) INTO v_legit FROM public.practice_session_items
   WHERE status NOT IN ('answered','skipped') AND occurred_at IS NULL;
  IF v_legit <> 70 THEN
    RAISE EXCEPTION 'PRE: expected 70 legitimately-NULL rows, found %', v_legit;
  END IF;

  -- The repairable set MUST be a strict subset of the resolved set, or the
  -- exact-target assertions below cannot discriminate a correct log from one
  -- that logged every resolved row.
  SELECT count(*) INTO v_resolved FROM public.practice_session_items
   WHERE status IN ('answered','skipped');
  IF v_resolved <> 84 THEN
    RAISE EXCEPTION 'PRE: expected 84 resolved rows (42 repairable + 42 already-repaired), found %', v_resolved;
  END IF;

  -- Whole-table size, the figure 1.1-post-apply.sql compares against to prove
  -- nothing was inserted or deleted during the apply.
  SELECT count(*) INTO v_total FROM public.practice_session_items;
  IF v_total <> 154 THEN
    RAISE EXCEPTION 'PRE: expected 154 total rows, found %', v_total;
  END IF;

  SELECT count(*) INTO v_con FROM pg_constraint
   WHERE conname = 'psi_resolved_requires_occurred_at';
  IF v_con <> 0 THEN
    RAISE EXCEPTION 'PRE: constraint psi_resolved_requires_occurred_at already exists — cutoff apply is wrong';
  END IF;

  SELECT count(*) INTO v_con FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'psi_occurred_at_backfill_log';
  IF v_con <> 0 THEN
    RAISE EXCEPTION 'PRE: backfill log table already exists — cutoff apply is wrong';
  END IF;

  -- The mutation the constraint is supposed to stop. It must SUCCEED here.
  -- Ordinal 85 is a 'served' row, i.e. one of the 70 legitimate NULLs.
  UPDATE public.practice_session_items
     SET status = 'answered', answered_at = now(), occurred_at = NULL
   WHERE ordinal = 85;

  RAISE NOTICE 'PRE ok: 42 repairable of 84 resolved, 0 unrepairable, 70 legit-NULL, 154 total, no constraint, unconstrained write accepted';

  -- Put it back. Restoring status AND answered_at returns the census to exactly
  -- 42 / 0 / 70 / 154 — leaving answered_at set would leave a 43rd repairable row
  -- and trip the migration's PSI_BACKFILL_SCOPE_EXPANDED guard.
  UPDATE public.practice_session_items
     SET status = 'served', answered_at = NULL
   WHERE ordinal = 85;
END $pre$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_post}

DO $post$
DECLARE
  v_unrepaired   integer;
  v_legit        integer;
  v_total        integer;
  v_drifted      integer;
  v_con          integer;
  v_logged       integer;
  v_logmismatch  integer;
  v_sqlstate     text;
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
  IF v_legit <> 70 THEN
    RAISE EXCEPTION 'POST NEGATIVE CONTROL FAILED: legitimately-NULL rows went from 70 to % — the UPDATE touched unresolved items', v_legit;
  END IF;

  -- Nothing was inserted or deleted by the apply. The prod-verify post file makes
  -- the same comparison against the pre-apply reading.
  SELECT count(*) INTO v_total FROM public.practice_session_items;
  IF v_total <> 154 THEN
    RAISE EXCEPTION 'POST: total row count went from 154 to % during the apply', v_total;
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

  -- (iv-b) BACKFILL LOG — exactly one row per repaired item, and each logged
  --        value still present on the row. The log is the only post-state
  --        record of WHICH rows were repaired, so a wrong log silently destroys
  --        the exact-target proof in 1.1-post-apply.sql.
  SELECT count(*) INTO v_logged FROM public.psi_occurred_at_backfill_log;
  IF v_logged <> 42 THEN
    RAISE EXCEPTION 'POST: backfill log has % row(s), expected 42 (one per REPAIRED item, not per resolved row — there are 84 resolved)', v_logged;
  END IF;

  SELECT count(*) INTO v_logmismatch
    FROM public.psi_occurred_at_backfill_log l
    JOIN public.practice_session_items pi ON pi.id = l.item_id
   WHERE pi.occurred_at IS DISTINCT FROM l.occurred_at_applied;
  IF v_logmismatch <> 0 THEN
    RAISE EXCEPTION 'POST: % logged row(s) do not carry the value the backfill wrote', v_logmismatch;
  END IF;

  -- the log must name exactly the rows that were repairable, not merely 3 rows
  SELECT count(*) INTO v_logmismatch
    FROM public.psi_occurred_at_backfill_log l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.practice_session_items pi
      WHERE pi.id = l.item_id
        AND pi.status IN ('answered','skipped')
        AND pi.occurred_at = pi.answered_at
   );
  IF v_logmismatch <> 0 THEN
    RAISE EXCEPTION 'POST: % logged item(s) are not repaired resolved rows', v_logmismatch;
  END IF;

  -- (v) GREEN HALF of the mutation: the same write the pre-state accepted must
  --     now be refused with 23514.
  BEGIN
    UPDATE public.practice_session_items
       SET status = 'answered', answered_at = now(), occurred_at = NULL
     WHERE ordinal = 94;
    RAISE EXCEPTION 'POST: unconstrained write ACCEPTED — the CHECK is not enforcing';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '23514' THEN
      RAISE EXCEPTION 'POST: expected SQLSTATE 23514, got %', v_sqlstate;
    END IF;
    RAISE NOTICE 'POST ok: repaired 42, logged 42, negative control held at 70, total still 154, constraint rejects with 23514';
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
