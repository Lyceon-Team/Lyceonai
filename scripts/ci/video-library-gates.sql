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
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

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
      'public.video_resources_approve(text[], uuid)',
      'public.video_resource_tag(text, text, text, integer, text[], text, integer, text)'] LOOP
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
  PERFORM public.video_resource_tag('XLONGXXXXX1', 'X long', 'c', 900, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't');
  PERFORM public.video_resource_tag('XSHORTXXXX1', 'X short', 'c', 120, ARRAY['Linear Equations in One Variable', 'Linear Functions'], 'Algebra', 42, 't');
  PERFORM public.video_resource_tag('XMIDXXXXXX1', 'X mid', 'c', 400, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't');
  PERFORM public.video_resource_tag('XMID2XXXXX1', 'X mid 2', 'c', 400, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't');
  -- X, NOT approved; X, approved but unavailable; Y, approved; no-tag video.
  PERFORM public.video_resource_tag('XPENDINGXX1', 'X pending', 'c', 60, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't');
  PERFORM public.video_resource_tag('XGONEXXXXX1', 'X gone', 'c', 30, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't');
  PERFORM public.video_resource_tag('YONLYYYYYY1', 'Y only', 'c', 10, ARRAY['Circles'], 'Geometry and Trigonometry', NULL, 't');
  PERFORM public.video_resource_tag('NOTAGSXXXX1', 'webinar', 'c', 50, ARRAY[]::text[], NULL, NULL, 't');
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
  SELECT array_agg(video_id) INTO ids FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 3);
  IF ids IS NULL THEN PERFORM pg_temp.fail('R1 presence: skill X returned nothing'); END IF;
  IF ids IS DISTINCT FROM ARRAY['XSHORTXXXX1', 'XMID2XXXXX1', 'XMIDXXXXXX1'] THEN
    PERFORM pg_temp.fail('R1 expected shortest-first approved available X videos, got ' || array_to_string(ids, ','));
  END IF;
  SELECT array_agg(video_id) INTO again FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 3);
  IF again IS DISTINCT FROM ids THEN PERFORM pg_temp.fail('R1 identical requests differed'); END IF;
  IF (SELECT count(*) FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 50)) <> 3
  THEN PERFORM pg_temp.fail('R1 limit not clamped to 3'); END IF;
  IF (SELECT start_seconds FROM public.video_resources_for_skills(ARRAY['Linear Equations in One Variable'], 1)) IS DISTINCT FROM 42
  THEN PERFORM pg_temp.fail('R1 chapter start not returned'); END IF;
  RAISE NOTICE 'OK R1 % — pending, unavailable and off-skill excluded; shortest first; clamped to 3', array_to_string(ids, ', ');
END $$;

-- ---------------------------------------------------------------------------
-- R2 a skill with no tagged video returns nothing (proof 5); an empty skill list returns nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.video_resources_for_skills(ARRAY['Boundaries'], 3))
  THEN PERFORM pg_temp.fail('R2 a skill with no video returned rows'); END IF;
  IF EXISTS (SELECT 1 FROM public.video_resources_for_skills(ARRAY[]::text[], 3))
  THEN PERFORM pg_temp.fail('R2 an empty skill list returned rows'); END IF;
  IF (SELECT video_id FROM public.video_resources_for_skills(ARRAY['Circles'], 3)) IS DISTINCT FROM 'YONLYYYYYY1'
  THEN PERFORM pg_temp.fail('R2 control: skill Y did not return its video'); END IF;
  RAISE NOTICE 'OK R2 no-video skill and empty list return nothing; skill Y control returns its video';
END $$;

-- ---------------------------------------------------------------------------
-- T1 re-tagging: unchanged keeps the approval; changed tags clear it; status is untouched.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.video_resource_tag('XLONGXXXXX1', 'X long (renamed)', 'c', 900, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't2');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'XLONGXXXXX1') IS NULL
  THEN PERFORM pg_temp.fail('T1 an unchanged re-tag lost its approval'); END IF;
  PERFORM public.video_resource_tag('XLONGXXXXX1', 'X long', 'c', 900, ARRAY['Linear Functions'], 'Algebra', NULL, 't3');
  IF (SELECT approved_by FROM public.video_resources WHERE video_id = 'XLONGXXXXX1') IS NOT NULL
  THEN PERFORM pg_temp.fail('T1 a changed tag set kept its approval'); END IF;
  PERFORM public.video_resource_tag('XGONEXXXXX1', 'X gone', 'c', 30, ARRAY['Linear Equations in One Variable'], 'Algebra', NULL, 't2');
  IF (SELECT status FROM public.video_resources WHERE video_id = 'XGONEXXXXX1') <> 'unavailable'
  THEN PERFORM pg_temp.fail('T1 re-tagging revived an unavailable video'); END IF;
  RAISE NOTICE 'OK T1 approval kept only when tags unchanged; status untouched by tagging';
END $$;

ROLLBACK;

\echo 'VIDEO LIBRARY GATES: PASS'
