-- ============================================================================
-- Fixture for the baseline-repair gate.
-- ============================================================================
-- Driven by scripts/ci/baseline-repair-gate.sh.
--
-- THREE STUDENTS, chosen so the repair predicate must discriminate rather than
-- sweep. A fixture with only the repairable student could not tell a correct
-- repair from `INSERT ... SELECT * FROM student_section_projections`.
--
--   REPAIRABLE   completed diagnostic, no baseline, BOTH projections computable
--                -> must receive exactly 2 baseline rows
--   NO_EVIDENCE  completed diagnostic, no baseline, projections all-NULL
--                -> must receive NOTHING. Writing a baseline here would be
--                   fabricating a score. This is the load-bearing negative.
--   HAS_BASELINE completed diagnostic, baseline ALREADY present, computable
--                -> must receive nothing more (immutability + idempotency)
--
-- Plus a PERIODIC snapshot on the repairable student, which must survive
-- untouched — the repair must not confuse the two snapshot kinds.
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?seed}

DO $seed$
DECLARE
  v_repairable   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_no_evidence  uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_has_baseline uuid := 'cccccccc-0000-4000-8000-000000000003';
  v_ids          uuid[] := ARRAY[v_repairable, v_no_evidence, v_has_baseline];
  v_id           uuid;
  v_actor        uuid;
  i              integer := 0;
BEGIN
  FOREACH v_id IN ARRAY v_ids LOOP
    i := i + 1;
    INSERT INTO auth.users (id, email) VALUES (v_id, 'baseline' || i || '@example.com');
    SELECT actor_id INTO v_actor FROM public.profiles WHERE id = v_id;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'FIXTURE: profile actor_id not assigned for %', v_id;
    END IF;

    -- Every student has a COMPLETED diagnostic. That is the fact the repair keys
    -- on, so it must not be what distinguishes them.
    INSERT INTO public.practice_sessions
      (user_id, mode, target_count, platform, client_instance_id, status, actor_id, completed_at)
    VALUES (v_id, 'diagnostic', 40, 'web', 'inst-bl-' || i, 'completed', v_actor, now());
  END LOOP;

  -- REPAIRABLE: both sections computable.
  INSERT INTO public.student_section_projections
    (student_id, section, projected_score_mid, projected_score_low,
     projected_score_high, range_width, relevant_question_count, mastery_term)
  VALUES
    (v_repairable, 'M',  470, 380, 560, 180, 39, 466.4210),
    (v_repairable, 'RW', 400, 300, 500, 200, 23, 404.1932);

  -- NO_EVIDENCE: rows exist but every score is NULL. compute_section_projection
  -- emits exactly this shape when the Q4 evidence gate fails, which is why row
  -- COUNT can never be the repair predicate.
  INSERT INTO public.student_section_projections
    (student_id, section, projected_score_mid, projected_score_low,
     projected_score_high, range_width, relevant_question_count, mastery_term)
  VALUES
    (v_no_evidence, 'M',  NULL, NULL, NULL, NULL, NULL, NULL),
    (v_no_evidence, 'RW', NULL, NULL, NULL, NULL, NULL, NULL);

  -- HAS_BASELINE: computable, and already holds its immutable baseline.
  INSERT INTO public.student_section_projections
    (student_id, section, projected_score_mid, projected_score_low,
     projected_score_high, range_width, relevant_question_count, mastery_term)
  VALUES
    (v_has_baseline, 'M',  600, 550, 650, 100, 40, 600.0000),
    (v_has_baseline, 'RW', 550, 500, 600, 100, 40, 550.0000);

  INSERT INTO public.student_section_projection_snapshots
    (student_id, section, projected_score_mid, projected_score_low,
     projected_score_high, range_width, snapshot_kind)
  VALUES
    (v_has_baseline, 'M',  590, 540, 640, 100, 'diagnostic_baseline'),
    (v_has_baseline, 'RW', 540, 490, 590, 100, 'diagnostic_baseline');

  -- A PERIODIC snapshot that must survive untouched.
  INSERT INTO public.student_section_projection_snapshots
    (student_id, section, projected_score_mid, projected_score_low,
     projected_score_high, range_width, snapshot_kind)
  VALUES
    (v_repairable, 'M', 460, 370, 550, 180, 'periodic');

  RAISE NOTICE 'FIXTURE: 3 students seeded (repairable, no_evidence, has_baseline) + 1 periodic snapshot';
END $seed$;

\endif

-- ---------------------------------------------------------------------------
\if :{?assert_post}

DO $post$
DECLARE
  v_repairable   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_no_evidence  uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  v_has_baseline uuid := 'cccccccc-0000-4000-8000-000000000003';
  v_n            integer;
  v_mid          integer;
BEGIN
  -- (1) the repairable student got exactly two baseline rows
  SELECT count(*) INTO v_n FROM public.student_section_projection_snapshots
   WHERE student_id = v_repairable AND snapshot_kind = 'diagnostic_baseline';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'POST: repairable student has % baseline row(s), expected 2', v_n;
  END IF;

  -- (2) copied from the live projection, not invented
  SELECT projected_score_mid INTO v_mid
    FROM public.student_section_projection_snapshots
   WHERE student_id = v_repairable AND section = 'M'
     AND snapshot_kind = 'diagnostic_baseline';
  IF v_mid <> 470 THEN
    RAISE EXCEPTION 'POST: repairable M baseline mid is %, expected the live 470', v_mid;
  END IF;

  -- (3) LOAD-BEARING NEGATIVE: the no-evidence student got NOTHING.
  --     A baseline here would be a fabricated score.
  SELECT count(*) INTO v_n FROM public.student_section_projection_snapshots
   WHERE student_id = v_no_evidence AND snapshot_kind = 'diagnostic_baseline';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'POST: the no-evidence student was given % baseline row(s) — the repair fabricated a score for a student whose projection is NULL', v_n;
  END IF;

  -- (4) immutability: the pre-existing baseline is unchanged and un-duplicated
  SELECT count(*) INTO v_n FROM public.student_section_projection_snapshots
   WHERE student_id = v_has_baseline AND snapshot_kind = 'diagnostic_baseline';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'POST: has_baseline student has % baseline row(s), expected the original 2', v_n;
  END IF;
  SELECT projected_score_mid INTO v_mid
    FROM public.student_section_projection_snapshots
   WHERE student_id = v_has_baseline AND section = 'M'
     AND snapshot_kind = 'diagnostic_baseline';
  IF v_mid <> 590 THEN
    RAISE EXCEPTION
      'POST: has_baseline M mid is % — the original 590 was overwritten with the live 600; baselines are immutable', v_mid;
  END IF;

  -- (5) NEGATIVE CONTROL: the periodic snapshot survived
  SELECT count(*) INTO v_n FROM public.student_section_projection_snapshots
   WHERE snapshot_kind = 'periodic';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POST: periodic snapshots went from 1 to % — the repair touched the wrong kind', v_n;
  END IF;

  RAISE NOTICE 'POST ok: repairable repaired from live values, no-evidence skipped, existing baseline immutable, periodic untouched';
END $post$;

\endif
