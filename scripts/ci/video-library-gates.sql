-- ============================================================================
-- LISA video library — schema + retrieval gates
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that the
-- video library refuses what the brief says it must refuse, and that
-- video_resources_for_skills (THE retrieval query) returns only available, approved, on-skill
-- videos, shortest first. Every gate raises VIDEO_LIBRARY_GATE_FAILED on failure. One
-- transaction, rolled back.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/video-library-gates.sql
--
-- @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §3, §5, §6, §11 proof 5]
--       | @implemented [2026-10-15]
-- @spec [Doc-03D_V1.2 §6.7/§6.8 as amended by the video-method SCLs; owner brief "Video
--       retrieval: method tags", Karl 2026-10-27] | @implemented [2026-10-27]
-- M1–M4 (20261116000000_lisa_video_methods.sql): the methods/format CHECKs refuse what is
-- outside the vocabulary, on both tables; a requested method ranks its videos first ("show me
-- on desmos" + Equivalent Expressions → a Desmos lesson first); with no method the order is
-- format priority, then shortest; a changed methods or format value clears the approval.
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- The tagging writer, with methods and format defaulted for fixtures that do not set them.
CREATE FUNCTION pg_temp.tag(id text, title text, dur integer, skills text[], dom text, start integer,
                            methods text[] DEFAULT '{}', fmt text DEFAULT NULL, by text DEFAULT 't')
RETURNS void LANGUAGE sql AS $f$
  SELECT public.video_resource_tag(id, title, 'c', dur, skills, dom, start, by, methods, fmt)
$f$;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'VIDEO_LIBRARY_GATE_FAILED: %', msg; END $f$;

-- ---------------------------------------------------------------------------
-- L1 shape and privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text; fn text;
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.video_resources'::regclass AND attname = 'skill_codes') <> 'text[]'
  THEN PERFORM pg_temp.fail('L1 skill_codes is not text[]'); END IF;
  IF NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.video_resources'::regclass AND attname = 'skill_codes')
  THEN PERFORM pg_temp.fail('L1 skill_codes is nullable'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'video_resources'
                  AND indexname = 'video_resources_skills_idx' AND indexdef LIKE '%USING gin (skill_codes)%')
  THEN PERFORM pg_temp.fail('L1 GIN index on skill_codes missing'); END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.video_resources', 'SELECT') THEN
      PERFORM pg_temp.fail('L1 ' || r || ' can read video_resources');
    END IF;
    FOREACH fn IN ARRAY ARRAY[
      'public.video_resources_for_skills(text[], integer)',
      'public.video_resources_for_skills(text[], integer, text)',
      'public.video_resources_approve(text[], uuid)',
      'public.video_resource_tag(text, text, text, integer, text[], text, integer, text, text[], text)'] LOOP
      IF has_function_privilege(r, fn, 'EXECUTE') THEN
        PERFORM pg_temp.fail('L1 ' || r || ' can EXECUTE ' || fn);
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'OK L1 text[] NOT NULL, GIN index, no student-facing privilege';
END $$;

-- ---------------------------------------------------------------------------
-- L2 constraints refuse bad rows
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean; stmt text;
BEGIN
  INSERT INTO public.video_resources (video_id, title, channel_name, duration_seconds, last_checked_at)
    VALUES ('LLLLLLLLLL0', 't', 'c', 300, now());
  FOR stmt IN SELECT unnest(ARRAY[
    -- approved with no tags
    $q$UPDATE public.video_resources SET approved_by = '00000000-0000-4000-8000-0000000000aa', approved_at = now() WHERE video_id = 'LLLLLLLLLL0'$q$,
    -- approved_by without approved_at
    $q$UPDATE public.video_resources SET skill_codes = ARRAY['Circles'], approved_by = '00000000-0000-4000-8000-0000000000aa' WHERE video_id = 'LLLLLLLLLL0'$q$,
    -- tagged_by without tagged_at
    $q$UPDATE public.video_resources SET tagged_by = 'x' WHERE video_id = 'LLLLLLLLLL0'$q$,
    -- start outside the video
    $q$UPDATE public.video_resources SET start_seconds = 300 WHERE video_id = 'LLLLLLLLLL0'$q$,
    -- unknown domain
    $q$UPDATE public.video_resources SET domain = 'Calculus' WHERE video_id = 'LLLLLLLLLL0'$q$,
    -- blank skill
    $q$UPDATE public.video_resources SET skill_codes = ARRAY[''] WHERE video_id = 'LLLLLLLLLL0'$q$
  ]) LOOP
    refused := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN PERFORM pg_temp.fail('L2 accepted: ' || stmt); END IF;
  END LOOP;
  DELETE FROM public.video_resources WHERE video_id = 'LLLLLLLLLL0';
  RAISE NOTICE 'OK L2 approval needs tags and both fields; pairs, start, domain, blank skill refused';
END $$;

-- ---------------------------------------------------------------------------
-- Fixture. Skill X = 'Linear Equations in One Variable', skill Y = 'Circles'.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- X, approved: a long one and a short one (ordering), one with a chapter start.
  PERFORM pg_temp.tag('XLONGXXXXX1', 'X long', 900, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL);
  PERFORM pg_temp.tag('XSHORTXXXX1', 'X short', 120, ARRAY['Linear Equations in One Variable', 'Linear Functions'], 'Algebra', 42);
  PERFORM pg_temp.tag('XMIDXXXXXX1', 'X mid', 400, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL);
  PERFORM pg_temp.tag('XMID2XXXXX1', 'X mid 2', 400, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL);
  -- X, NOT approved; X, approved but unavailable; Y, approved; no-tag video.
  PERFORM pg_temp.tag('XPENDINGXX1', 'X pending', 60, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL);
  PERFORM pg_temp.tag('XGONEXXXXX1', 'X gone', 30, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL);
  PERFORM pg_temp.tag('YONLYYYYYY1', 'Y only', 10, ARRAY['Circles'], 'Geometry and Trigonometry', NULL);
  PERFORM pg_temp.tag('NOTAGSXXXX1', 'webinar', 50, ARRAY[]::text[], NULL, NULL);
  IF public.video_resources_approve(
       ARRAY['XLONGXXXXX1', 'XSHORTXXXX1', 'XMIDXXXXXX1', 'XMID2XXXXX1', 'XGONEXXXXX1', 'YONLYYYYYY1', 'NOTAGSXXXX1'],
       '00000000-0000-4000-8000-0000000000aa') <> 6
  THEN PERFORM pg_temp.fail('fixture: approve should approve 6 (the untagged video cannot be approved)'); END IF;
  UPDATE public.video_resources SET status = 'unavailable' WHERE video_id = 'XGONEXXXXX1';
END $$;

-- ---------------------------------------------------------------------------
-- R1 retrieval: on-skill, approved, available only; shortest first; limit 3; stable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids text[]; again text[];
BEGIN
  SELECT array_agg(video_id) INTO ids FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 3, NULL);
  IF ids IS NULL THEN PERFORM pg_temp.fail('R1 presence: skill X returned nothing'); END IF;
  IF ids IS DISTINCT FROM ARRAY['XSHORTXXXX1', 'XMID2XXXXX1', 'XMIDXXXXXX1'] THEN
    PERFORM pg_temp.fail('R1 expected shortest-first approved available X videos, got ' || array_to_string(ids, ','));
  END IF;
  SELECT array_agg(video_id) INTO again FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 3, NULL);
  IF again IS DISTINCT FROM ids THEN PERFORM pg_temp.fail('R1 identical requests differed'); END IF;
  -- The 2-argument form (the BFF live before this change) still answers the same set, until
  -- it is dropped once the new BFF is deployed.
  SELECT array_agg(video_id) INTO again FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 3);
  IF again IS DISTINCT FROM ids THEN PERFORM pg_temp.fail('R1 the 2-argument form answered differently'); END IF;
  IF (SELECT count(*) FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 50, NULL)) <> 3
  THEN PERFORM pg_temp.fail('R1 limit not clamped to 3'); END IF;
  IF (SELECT start_seconds FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 1, NULL)) IS DISTINCT FROM 42
  THEN PERFORM pg_temp.fail('R1 chapter start not returned'); END IF;
  RAISE NOTICE 'OK R1 % — pending, unavailable and off-skill excluded; shortest first; clamped to 3', array_to_string(ids, ', ');
END $$;

-- ---------------------------------------------------------------------------
-- R2 a skill with no tagged video returns nothing (proof 5); an empty skill list returns nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.video_resources_for_skills(ARRAY['Boundaries'], 3, 'desmos'))
  THEN PERFORM pg_temp.fail('R2 a skill with no video returned rows'); END IF;
  IF EXISTS (SELECT 1 FROM public.video_resources_for_skills(ARRAY[]::text[], 3, NULL))
  THEN PERFORM pg_temp.fail('R2 an empty skill list returned rows'); END IF;
  IF (SELECT video_id FROM public.video_resources_for_skills(ARRAY['Circles'], 3, NULL)) IS DISTINCT FROM 'YONLYYYYYY1'
  THEN PERFORM pg_temp.fail('R2 control: skill Y did not return its video'); END IF;
  RAISE NOTICE 'OK R2 no-video skill and empty list return nothing; skill Y control returns its video';
END $$;

-- ---------------------------------------------------------------------------
-- T1 re-tagging: unchanged keeps the approval; changed tags clear it; status is untouched.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.tag('XLONGXXXXX1', 'X long (renamed)', 900, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, '{}', NULL, 't2');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'XLONGXXXXX1') IS NULL
  THEN PERFORM pg_temp.fail('T1 an unchanged re-tag lost its approval'); END IF;
  PERFORM pg_temp.tag('XLONGXXXXX1', 'X long', 900, ARRAY['Linear Functions'], 'Algebra', NULL, '{}', NULL, 't3');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'XLONGXXXXX1') IS NOT NULL
  THEN PERFORM pg_temp.fail('T1 a changed tag set kept its approval'); END IF;
  PERFORM pg_temp.tag('XGONEXXXXX1', 'X gone', 30, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, '{}', NULL, 't2');
  IF (SELECT status FROM public.video_resources WHERE video_id = 'XGONEXXXXX1') <> 'unavailable'
  THEN PERFORM pg_temp.fail('T1 re-tagging revived an unavailable video'); END IF;
  RAISE NOTICE 'OK T1 approval kept only when tags unchanged; status untouched by tagging';
END $$;


-- ---------------------------------------------------------------------------
-- M1 the methods and format CHECKs refuse what is outside the vocabulary (both tables)
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean; stmt text;
BEGIN
  PERFORM pg_temp.tag('MMMMMMMMMM1', 'm', 300, ARRAY['Circles'], 'Geometry and Trigonometry', NULL, ARRAY['desmos', 'algebraic', 'backsolve'], 'lesson');
  IF (SELECT methods FROM public.video_resources WHERE video_id = 'MMMMMMMMMM1') IS DISTINCT FROM ARRAY['desmos', 'algebraic', 'backsolve']
  THEN PERFORM pg_temp.fail('M1 presence: the three vocabulary values were not stored'); END IF;
  PERFORM public.curriculum_chunk_upsert('youtube:MMMMMMMMMM1:0-60', 'm', ARRAY['Circles'], 'pre_and_post',
            'video_transcript', ('[' || array_to_string(array_fill(0.001::real, ARRAY[768]), ',') || ']')::extensions.vector);
  UPDATE public.curriculum_chunks SET methods = ARRAY['desmos'] WHERE provenance = 'youtube:MMMMMMMMMM1:0-60';
  FOR stmt IN SELECT unnest(ARRAY[
    $q$UPDATE public.video_resources SET methods = ARRAY['geometry'] WHERE video_id = 'MMMMMMMMMM1'$q$,
    $q$UPDATE public.video_resources SET methods = ARRAY['desmos', NULL] WHERE video_id = 'MMMMMMMMMM1'$q$,
    $q$UPDATE public.video_resources SET methods = ARRAY['Desmos'] WHERE video_id = 'MMMMMMMMMM1'$q$,
    $q$UPDATE public.video_resources SET format = 'tips' WHERE video_id = 'MMMMMMMMMM1'$q$,
    $q$UPDATE public.video_resources SET format = 'video_transcript' WHERE video_id = 'MMMMMMMMMM1'$q$,
    $q$SELECT public.video_resource_tag('MMMMMMMMMM2', 'm', 'c', 300, ARRAY['Circles'], 'Geometry and Trigonometry', NULL, 't', ARRAY['calculator'], 'lesson')$q$,
    $q$UPDATE public.curriculum_chunks SET methods = ARRAY['graphing'] WHERE provenance = 'youtube:MMMMMMMMMM1:0-60'$q$,
    $q$UPDATE public.curriculum_chunks SET methods = ARRAY[NULL]::text[] WHERE provenance = 'youtube:MMMMMMMMMM1:0-60'$q$
  ]) LOOP
    refused := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN PERFORM pg_temp.fail('M1 accepted: ' || stmt); END IF;
  END LOOP;
  IF (SELECT methods FROM public.curriculum_chunks WHERE provenance = 'youtube:MMMMMMMMMM1:0-60') IS DISTINCT FROM ARRAY['desmos']
  THEN PERFORM pg_temp.fail('M1 curriculum_chunks did not keep its valid methods'); END IF;
  DELETE FROM public.curriculum_chunks WHERE provenance = 'youtube:MMMMMMMMMM1:0-60';
  DELETE FROM public.video_resources WHERE video_id = 'MMMMMMMMMM1';
  RAISE NOTICE 'OK M1 unknown, NULL and mis-cased methods and unknown formats refused on both tables';
END $$;

-- ---------------------------------------------------------------------------
-- M2/M3 method-ranked retrieval. Skill E = 'Equivalent Expressions', modelled on production:
-- three formula shorts, Desmos lessons and a Desmos tips video, a worked-example video, and a
-- very short video with no format yet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids text[]; again text[]; e text[] := ARRAY['Equivalent Expressions'];
BEGIN
  PERFORM pg_temp.tag('EFORMULA001', 'Formula 30 - FOILing', 48, e, 'Advanced Math', NULL, ARRAY['algebraic'], 'formula');
  PERFORM pg_temp.tag('EFORMULA002', 'Formula 31 - Squaring a Binomial', 49, e, 'Advanced Math', NULL, ARRAY['algebraic'], 'formula');
  PERFORM pg_temp.tag('EFORMULA003', 'Formula 32 - Exponent Rules', 59, e, 'Advanced Math', NULL, ARRAY['algebraic'], 'formula');
  PERFORM pg_temp.tag('EDESMOSLES1', 'Desmos Lesson #10', 398, e, 'Advanced Math', NULL, ARRAY['desmos'], 'lesson');
  PERFORM pg_temp.tag('EDESMOSLES2', 'Desmos Guide', 2018, e, 'Advanced Math', 751, ARRAY['desmos'], 'lesson');
  PERFORM pg_temp.tag('EDESMOSTIP1', 'Every Desmos Hack', 508, e, 'Advanced Math', NULL, ARRAY['desmos'], 'strategy');
  PERFORM pg_temp.tag('EWORKEDEX01', 'Hardest Questions', 1187, e, 'Advanced Math', NULL, ARRAY['algebraic', 'backsolve'], 'worked_example');
  PERFORM pg_temp.tag('ENOFORMAT01', 'untagged', 10, e, 'Advanced Math', NULL);
  IF public.video_resources_approve(ARRAY['EFORMULA001', 'EFORMULA002', 'EFORMULA003', 'EDESMOSLES1', 'EDESMOSLES2',
       'EDESMOSTIP1', 'EWORKEDEX01', 'ENOFORMAT01'], '00000000-0000-4000-8000-0000000000aa') <> 8
  THEN PERFORM pg_temp.fail('M2 fixture: approve should approve 8'); END IF;

  -- M2 "show me on desmos" on an Equivalent Expressions item: Desmos videos first, the lesson first.
  SELECT array_agg(video_id) INTO ids FROM public.video_resources_for_skills(e, 3, 'desmos');
  IF ids IS DISTINCT FROM ARRAY['EDESMOSLES1', 'EDESMOSLES2', 'EDESMOSTIP1'] THEN
    PERFORM pg_temp.fail('M2 desmos expected the Desmos lessons then the tips video, got ' || coalesce(array_to_string(ids, ','), 'nothing'));
  END IF;
  SELECT array_agg(video_id) INTO again FROM public.video_resources_for_skills(e, 3, 'desmos');
  IF again IS DISTINCT FROM ids THEN PERFORM pg_temp.fail('M2 identical desmos requests differed'); END IF;
  -- A method with fewer matches than the limit is filled from the rest, in the no-method order.
  SELECT array_agg(video_id) INTO ids FROM public.video_resources_for_skills(e, 3, 'backsolve');
  IF ids IS DISTINCT FROM ARRAY['EWORKEDEX01', 'EFORMULA001', 'EFORMULA002'] THEN
    PERFORM pg_temp.fail('M2 backsolve expected its one video then the formula shorts, got ' || coalesce(array_to_string(ids, ','), 'nothing'));
  END IF;

  -- M3 no method requested: format priority (formula first), then shortest; the 10-second
  -- video with no format ranks after every tagged one. An unknown method is no preference.
  SELECT array_agg(video_id) INTO ids FROM public.video_resources_for_skills(e, 3, NULL);
  IF ids IS DISTINCT FROM ARRAY['EFORMULA001', 'EFORMULA002', 'EFORMULA003'] THEN
    PERFORM pg_temp.fail('M3 no method expected the three formula shorts, got ' || coalesce(array_to_string(ids, ','), 'nothing'));
  END IF;
  SELECT array_agg(video_id) INTO again FROM public.video_resources_for_skills(e, 3, 'calculus');
  IF again IS DISTINCT FROM ids THEN PERFORM pg_temp.fail('M3 an unknown method changed the order'); END IF;
  SELECT array_agg(video_id ORDER BY ord) INTO ids
    FROM (SELECT video_id, row_number() OVER () AS ord FROM public.video_resources_for_skills(e, 3, NULL)) x;
  IF 'ENOFORMAT01' = ANY (ids) THEN PERFORM pg_temp.fail('M3 a video with no format outranked tagged ones'); END IF;
  RAISE NOTICE 'OK M2 desmos → EDESMOSLES1, EDESMOSLES2, EDESMOSTIP1; backsolve fills from the rest. OK M3 no method → formula shorts; unknown method = none';
END $$;

-- ---------------------------------------------------------------------------
-- M4 a changed methods or format value clears the approval; an unchanged re-tag keeps it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE e text[] := ARRAY['Equivalent Expressions'];
BEGIN
  PERFORM pg_temp.tag('EDESMOSLES1', 'Desmos Lesson #10 (renamed)', 398, e, 'Advanced Math', NULL, ARRAY['desmos'], 'lesson', 't2');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'EDESMOSLES1') IS NULL
  THEN PERFORM pg_temp.fail('M4 an unchanged re-tag lost its approval'); END IF;
  PERFORM pg_temp.tag('EDESMOSLES1', 'Desmos Lesson #10', 398, e, 'Advanced Math', NULL, ARRAY['desmos', 'backsolve'], 'lesson', 't3');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'EDESMOSLES1') IS NOT NULL
  THEN PERFORM pg_temp.fail('M4 a changed methods value kept its approval'); END IF;
  PERFORM pg_temp.tag('EDESMOSLES2', 'Desmos Guide', 2018, e, 'Advanced Math', 751, ARRAY['desmos'], 'strategy', 't3');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'EDESMOSLES2') IS NOT NULL
  THEN PERFORM pg_temp.fail('M4 a changed format kept its approval'); END IF;
  IF (SELECT approved_at FROM public.video_resources WHERE video_id IN ('EDESMOSLES1', 'EDESMOSLES2') LIMIT 1) IS NOT NULL
  THEN PERFORM pg_temp.fail('M4 approved_at survived a cleared approval'); END IF;
  IF EXISTS (SELECT 1 FROM public.video_resources_for_skills(e, 3, 'desmos') WHERE video_id IN ('EDESMOSLES1', 'EDESMOSLES2'))
  THEN PERFORM pg_temp.fail('M4 a video whose approval was cleared is still retrieved'); END IF;
  RAISE NOTICE 'OK M4 methods or format change clears the approval (and retrieval drops the row); unchanged keeps it';
END $$;

-- ---------------------------------------------------------------------------
-- M5 the keyword map is seeded, versioned, and names every vocabulary method
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.tutor_context_runtime_config WHERE key = 'video_method_keywords';
  IF v IS NULL THEN PERFORM pg_temp.fail('M5 video_method_keywords is not seeded'); END IF;
  IF jsonb_typeof(v -> 'version') <> 'number' THEN PERFORM pg_temp.fail('M5 the map has no version'); END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v -> 'methods') k) IS DISTINCT FROM ARRAY['algebraic', 'backsolve', 'desmos']
  THEN PERFORM pg_temp.fail('M5 the map does not name exactly the vocabulary methods'); END IF;
  IF NOT (v -> 'methods' -> 'desmos') ? 'desmos' THEN PERFORM pg_temp.fail('M5 "desmos" is not a desmos phrase'); END IF;
  RAISE NOTICE 'OK M5 keyword map v% seeded for desmos, algebraic, backsolve', v ->> 'version';
END $$;

ROLLBACK;

\echo 'VIDEO LIBRARY GATES: PASS'
