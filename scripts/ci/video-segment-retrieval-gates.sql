-- ============================================================================
-- LISA video segments — retrieval gates (20261125000000_lisa_segment_retrieval.sql)
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that
-- video_segments_for_question ranks and filters as Doc 03D §6.4 / §6.8 (SCL-260, SCL-261)
-- say. Every gate raises VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED on failure. One transaction,
-- rolled back. The vocabulary is a throwaway one ('RR.*', 'CL.R*'), so no gate depends on the
-- real taxonomy's ids or counts.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/video-segment-retrieval-gates.sql
--
-- @spec [Doc-03D_V1.2 §6.4 as amended by SCL-260; §6.8 as amended by SCL-261; owner brief
--       "Phase C: retrieval switch-over", Karl 2026-10-29] | @implemented [2026-10-29]
-- R1 a rational-expressions question gets the rational segment first, at its start (the
--    Desmos Lesson #10 shape: 0:00 factor, 2:39 rational, 4:17 rational) — never the
--    expand-and-multiply short that shares only the skill.
-- R2 an expand-and-multiply question gets the expand-and-multiply segment first.
-- R3 the Desmos tap (method required) returns only Desmos segments, even where an algebraic
--    segment shares more sub-skills and clusters; as a preference, the algebraic one leads.
-- R4 a tagged question with no approved segment sharing a sub-skill returns nothing.
-- R5 the untagged path's function, video_resources_for_skills, returns the snapshot taken
--    before this change (Phase C does not touch it).
-- R6 an unapproved segment, or an approved segment of an unapproved video, is never returned.
-- R7 shared clusters count a method_in cluster of the question's skill on both sides.
-- R8 privileges: anon and authenticated cannot execute the function.
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'VIDEO_SEGMENT_RETRIEVAL_GATE_FAILED: %', msg; END $f$;

-- One segment as the writer takes it.
CREATE FUNCTION pg_temp.seg(s integer, e integer, subs text[], cls text[]) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'start_seconds', s, 'end_seconds', e, 'summary', 'summary ' || s,
    'sub_skills', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x, 'evidence', 'shown'))
                            FROM unnest(subs) x), '[]'::jsonb),
    'clusters', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x, 'evidence', 'shown'))
                          FROM unnest(cls) x), '[]'::jsonb))
$f$;

-- The retrieval as the BFF calls it, with the shared format priority.
CREATE FUNCTION pg_temp.r(q text, method text DEFAULT NULL, required boolean DEFAULT false)
RETURNS TABLE (video_id text, start_seconds integer, segment_id uuid, matched text[], shared integer,
               ord bigint)
LANGUAGE sql AS $f$
  SELECT x.video_id, x.start_seconds, x.segment_id, x.matched_sub_skills, x.shared_clusters,
         x.ordinality
  FROM public.video_segments_for_question(q, ARRAY['Equivalent Expressions'], 3, method, required,
         ARRAY['formula', 'worked_example', 'lesson', 'strategy'])
       WITH ORDINALITY x
  ORDER BY ordinality
$f$;

-- ---------------------------------------------------------------------------
-- Fixture: a throwaway vocabulary, five videos, their segments, five questions.
-- ---------------------------------------------------------------------------
INSERT INTO public.sub_skills (id, skill_code, section, domain, name, definition, inclusion_test, taxonomy_version)
VALUES ('RR.1', 'Equivalent Expressions', 'M', 'Advanced Math', 'rational', 'd', 't', 'gate'),
       ('RR.2', 'Equivalent Expressions', 'M', 'Advanced Math', 'expand', 'd', 't', 'gate'),
       ('RR.3', 'Equivalent Expressions', 'M', 'Advanced Math', 'factor', 'd', 't', 'gate'),
       ('RR.4', 'Equivalent Expressions', 'M', 'Advanced Math', 'radicals', 'd', 't', 'gate'),
       ('RR.5', 'Equivalent Expressions', 'M', 'Advanced Math', 'exponents', 'd', 't', 'gate'),
       ('RR.9', 'Equivalent Expressions', 'M', 'Advanced Math', 'no segment', 'd', 't', 'gate');
INSERT INTO public.clusters (id, display_name, family, definition, method_in, taxonomy_version)
VALUES ('CL.R01', 'graph both sides', 'desmos', 'd', '{}', 'gate'),
       ('CL.R02', 'cancel a factor', 'by_hand_doing', 'd', '{}', 'gate'),
       ('CL.R03', 'distribute', 'by_hand_doing', 'd', '{}', 'gate'),
       ('CL.R04', 'rewrite by rule', 'by_hand_doing', 'd', '{"Equivalent Expressions": 0.9}', 'gate');

-- Videos (11-character ids). methods and format are video-level.
SELECT public.video_resource_tag('RGATELESSON', 'Desmos lesson', 'c', 398, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', ARRAY['desmos'], 'lesson');
SELECT public.video_resource_tag('RGATEFOIL01', 'FOIL short', 'c', 60, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', ARRAY['algebraic'], 'formula');
SELECT public.video_resource_tag('RGATEALGEB1', 'by hand', 'c', 600, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', ARRAY['algebraic'], 'worked_example');
SELECT public.video_resource_tag('RGATEDESMO2', 'calculator', 'c', 500, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', ARRAY['desmos'], 'lesson');
SELECT public.video_resource_tag('RGATEUNAPRV', 'unapproved video', 'c', 300, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', ARRAY['algebraic'], 'formula');
SELECT public.video_resources_approve(
  ARRAY['RGATELESSON', 'RGATEFOIL01', 'RGATEALGEB1', 'RGATEDESMO2'], '00000000-0000-4000-8000-0000000000aa');

-- Segments. The lesson mirrors Desmos Lesson #10: 0-159 factor, 159-257 and 257-398 rational.
SELECT public.video_segments_set('RGATELESSON', 'gate', 'gate', jsonb_build_array(
  pg_temp.seg(0, 159, ARRAY['RR.3', 'RR.2'], ARRAY['CL.R03']),
  pg_temp.seg(159, 257, ARRAY['RR.1'], ARRAY['CL.R02']),
  pg_temp.seg(257, 398, ARRAY['RR.1'], ARRAY['CL.R02'])));
SELECT public.video_segments_set('RGATEFOIL01', 'gate', 'gate', jsonb_build_array(
  pg_temp.seg(0, 60, ARRAY['RR.2'], ARRAY['CL.R03'])));
SELECT public.video_segments_set('RGATEALGEB1', 'gate', 'gate', jsonb_build_array(
  pg_temp.seg(0, 600, ARRAY['RR.4', 'RR.5'], ARRAY['CL.R02', 'CL.R03'])));
SELECT public.video_segments_set('RGATEDESMO2', 'gate', 'gate', jsonb_build_array(
  pg_temp.seg(0, 200, ARRAY['RR.4'], ARRAY['CL.R01']),
  pg_temp.seg(200, 500, ARRAY['RR.1', 'RR.9'], ARRAY['CL.R02', 'CL.R03', 'CL.R04'])));
SELECT public.video_segments_set('RGATEUNAPRV', 'gate', 'gate', jsonb_build_array(
  pg_temp.seg(0, 300, ARRAY['RR.1'], ARRAY['CL.R02'])));

-- Approve every segment except RGATEDESMO2's 200-500 (it would out-rank the lesson for RR.1 on
-- clusters, and it carries the miss question's RR.9). RGATEUNAPRV's segment is approved, but
-- its video is not.
SELECT public.video_segments_approve(
  ARRAY(SELECT segment_id FROM public.video_segments
        WHERE video_id LIKE 'RGATE%' AND NOT (video_id = 'RGATEDESMO2' AND start_seconds = 200)),
  '00000000-0000-4000-8000-0000000000aa');

INSERT INTO public.questions
  (id, stem, item_type, options, correct_answer, explanation, section, domain, skill_codes, difficulty, status, source_type)
SELECT q, 'stem', 'mcq',
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       'A', 'because', 'M', 'Advanced Math', ARRAY['Equivalent Expressions'], 2, 'published', 2
FROM unnest(ARRAY['SATM1RQRATL', 'SATM1RQEXPD', 'SATM1RQTAPS', 'SATM1RQMISS', 'SATM1RQUNTG']) q;
INSERT INTO public.question_sub_skills (question_id, sub_skill_id, taxonomy_version, tagged_by)
VALUES ('SATM1RQRATL', 'RR.1', 'gate', 'gate'), ('SATM1RQEXPD', 'RR.2', 'gate', 'gate'),
       ('SATM1RQTAPS', 'RR.4', 'gate', 'gate'), ('SATM1RQTAPS', 'RR.5', 'gate', 'gate'),
       ('SATM1RQMISS', 'RR.9', 'gate', 'gate');
INSERT INTO public.question_clusters (question_id, cluster_id, taxonomy_version, tagged_by)
VALUES ('SATM1RQRATL', 'CL.R02', 'gate', 'gate'), ('SATM1RQEXPD', 'CL.R03', 'gate', 'gate'),
       ('SATM1RQTAPS', 'CL.R02', 'gate', 'gate'), ('SATM1RQTAPS', 'CL.R03', 'gate', 'gate');

-- ---------------------------------------------------------------------------
-- R1 rational question: the lesson's rational segment, at 2:39, first
-- ---------------------------------------------------------------------------
DO $$
DECLARE top record; n integer;
BEGIN
  SELECT * INTO top FROM pg_temp.r('SATM1RQRATL') ORDER BY ord LIMIT 1;
  IF top.video_id IS DISTINCT FROM 'RGATELESSON' OR top.start_seconds IS DISTINCT FROM 159 THEN
    PERFORM pg_temp.fail('R1 top should be RGATELESSON at 159, got ' || coalesce(top.video_id, 'nothing')
                         || ' at ' || coalesce(top.start_seconds::text, '-'));
  END IF;
  IF top.matched IS DISTINCT FROM ARRAY['RR.1'] THEN
    PERFORM pg_temp.fail('R1 matched sub-skills should be {RR.1}, got ' || coalesce(top.matched::text, 'null'));
  END IF;
  IF top.segment_id IS DISTINCT FROM (SELECT segment_id FROM public.video_segments
                                       WHERE video_id = 'RGATELESSON' AND start_seconds = 159) THEN
    PERFORM pg_temp.fail('R1 segment_id is not the 159 segment');
  END IF;
  SELECT count(*) INTO n FROM pg_temp.r('SATM1RQRATL') WHERE video_id = 'RGATEFOIL01';
  IF n <> 0 THEN PERFORM pg_temp.fail('R1 the FOIL short (skill only) was served for a rational question'); END IF;
  SELECT count(*) INTO n FROM pg_temp.r('SATM1RQRATL') WHERE video_id = 'RGATELESSON';
  IF n <> 1 THEN PERFORM pg_temp.fail('R1 one segment per video, got ' || n || ' from the lesson'); END IF;
  RAISE NOTICE 'R1 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R2 expand question: the expand-and-multiply segment first (formula before lesson)
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids text[];
BEGIN
  SELECT array_agg(video_id ORDER BY ord) INTO ids
  FROM pg_temp.r('SATM1RQEXPD');
  IF ids IS DISTINCT FROM ARRAY['RGATEFOIL01', 'RGATELESSON'] THEN
    PERFORM pg_temp.fail('R2 expected {RGATEFOIL01,RGATELESSON}, got ' || coalesce(ids::text, 'nothing'));
  END IF;
  IF (SELECT start_seconds FROM pg_temp.r('SATM1RQEXPD') WHERE video_id = 'RGATELESSON') IS DISTINCT FROM 0 THEN
    PERFORM pg_temp.fail('R2 the lesson should start at its expand segment (0)');
  END IF;
  RAISE NOTICE 'R2 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R3 the Desmos tap requires Desmos
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids text[];
BEGIN
  -- As a preference: the algebraic video shares two sub-skills and two clusters, so it leads.
  SELECT array_agg(video_id ORDER BY ord) INTO ids FROM pg_temp.r('SATM1RQTAPS', 'desmos', false);
  IF ids[1] IS DISTINCT FROM 'RGATEALGEB1' THEN
    PERFORM pg_temp.fail('R3 as a preference the algebraic segment should lead, got ' || coalesce(ids::text, 'nothing'));
  END IF;
  -- Required: only Desmos videos are candidates.
  SELECT array_agg(video_id ORDER BY ord) INTO ids FROM pg_temp.r('SATM1RQTAPS', 'desmos', true);
  IF ids IS DISTINCT FROM ARRAY['RGATEDESMO2'] THEN
    PERFORM pg_temp.fail('R3 the Desmos tap should get exactly {RGATEDESMO2}, got ' || coalesce(ids::text, 'nothing'));
  END IF;
  -- Required with no method asks for nothing.
  IF EXISTS (SELECT 1 FROM pg_temp.r('SATM1RQTAPS', NULL, true)) THEN
    PERFORM pg_temp.fail('R3 method required with no method should return nothing');
  END IF;
  RAISE NOTICE 'R3 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R4 a tagged question with no approved matching segment: nothing
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.r('SATM1RQMISS')) THEN
    PERFORM pg_temp.fail('R4 SATM1RQMISS (RR.9, only on an unapproved segment) should get nothing');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.r('SATM1RQMISS', 'desmos', true)) THEN
    PERFORM pg_temp.fail('R4 SATM1RQMISS via the Desmos tap should get nothing');
  END IF;
  RAISE NOTICE 'R4 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R5 the untagged path is today's function, unchanged (snapshot)
-- ---------------------------------------------------------------------------
DO $$
DECLARE got text;
BEGIN
  -- Snapshot of video_resources_for_skills on this fixture, recorded before Phase C:
  -- formula, then worked_example, then the shorter lesson; the unapproved video absent.
  SELECT string_agg(video_id || '@' || coalesce(start_seconds::text, '-'), ',' ORDER BY ord) INTO got
  FROM public.video_resources_for_skills(ARRAY['Equivalent Expressions'], 3, NULL)
         WITH ORDINALITY AS x(video_id, title, channel_name, duration_seconds, start_seconds,
                              methods, format, ord);
  IF got IS DISTINCT FROM 'RGATEFOIL01@-,RGATEALGEB1@-,RGATELESSON@-' THEN
    PERFORM pg_temp.fail('R5 untagged snapshot changed: ' || coalesce(got, 'nothing'));
  END IF;
  SELECT string_agg(video_id, ',' ORDER BY ord) INTO got
  FROM public.video_resources_for_skills(ARRAY['Equivalent Expressions'], 3, 'desmos')
         WITH ORDINALITY AS x(video_id, title, channel_name, duration_seconds, start_seconds,
                              methods, format, ord);
  IF got IS DISTINCT FROM 'RGATELESSON,RGATEDESMO2,RGATEFOIL01' THEN
    PERFORM pg_temp.fail('R5 untagged snapshot (desmos) changed: ' || coalesce(got, 'nothing'));
  END IF;
  RAISE NOTICE 'R5 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R6 unapproved segments and unapproved videos are never returned
-- ---------------------------------------------------------------------------
DO $$
DECLARE q text;
BEGIN
  FOREACH q IN ARRAY ARRAY['SATM1RQRATL', 'SATM1RQEXPD', 'SATM1RQTAPS', 'SATM1RQMISS'] LOOP
    IF EXISTS (SELECT 1 FROM pg_temp.r(q) r JOIN public.video_segments s USING (segment_id)
               WHERE s.approved_by IS NULL)
       OR EXISTS (SELECT 1 FROM pg_temp.r(q) WHERE video_id = 'RGATEUNAPRV') THEN
      PERFORM pg_temp.fail('R6 ' || q || ' got an unapproved segment or video');
    END IF;
  END LOOP;
  RAISE NOTICE 'R6 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R7 shared clusters count method_in defaults on both sides
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  -- SATM1RQRATL {CL.R02} vs the 159 segment {CL.R02}, plus CL.R04 (method_in Equivalent
  -- Expressions) present on both: 2.
  SELECT shared INTO n FROM pg_temp.r('SATM1RQRATL') WHERE video_id = 'RGATELESSON';
  IF n IS DISTINCT FROM 2 THEN PERFORM pg_temp.fail('R7 shared clusters should be 2, got ' || coalesce(n::text, 'null')); END IF;
  RAISE NOTICE 'R7 PASS';
END $$;

-- ---------------------------------------------------------------------------
-- R8 privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.video_segments_for_question(text, text[], integer, text, boolean, text[])', 'EXECUTE')
    THEN PERFORM pg_temp.fail('R8 ' || r || ' can EXECUTE video_segments_for_question'); END IF;
  END LOOP;
  RAISE NOTICE 'R8 PASS';
END $$;

ROLLBACK;
\echo 'VIDEO SEGMENT RETRIEVAL GATES: PASS'
