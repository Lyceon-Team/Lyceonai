-- ============================================================================
-- LISA video segments — schema gates (20261124000000_lisa_video_segments.sql)
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that the
-- segment tables refuse what segments-phase-a.md §2 says they must refuse, and that the one
-- writer keeps an approval only for an unchanged segment. Every gate raises
-- VIDEO_SEGMENT_GATE_FAILED on failure. One transaction, rolled back.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/video-segment-gates.sql
--
-- @spec [Doc-03D_V1.2 §6.7 as amended by SCL-259; owner brief "Video segments tagged by
--       sub-skill and cluster", Karl 2026-10-29, Phase B] | @implemented [2026-10-29]
-- G1 RLS on, no anon/authenticated privilege on the tables or the two functions.
-- G2 a tag outside the vocabulary is refused by its foreign key (sub-skill and cluster).
-- G3 a span past the video's end, an overlap, or an empty span is refused; nothing is written.
-- G4 an unchanged segment keeps its approval; a changed tag set or end clears it.
-- G5 a segment left out of the list is deleted with its tags; a video's delete cascades.
-- G6 a clusters-only segment can be approved; a segment with no tag cannot.
-- G7 a vocabulary id in use cannot be deleted (RESTRICT): the loader fails loudly.
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'VIDEO_SEGMENT_GATE_FAILED: %', msg; END $f$;

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

CREATE FUNCTION pg_temp.approved(vid text, s integer) RETURNS boolean LANGUAGE sql AS $f$
  SELECT approved_by IS NOT NULL FROM public.video_segments WHERE video_id = vid AND start_seconds = s
$f$;

-- Fixture: one video, two sub-skills and two clusters from a throwaway taxonomy version.
INSERT INTO public.sub_skills (id, skill_code, section, domain, name, definition, inclusion_test, taxonomy_version)
VALUES ('ZZ.1', 'Equivalent Expressions', 'M', 'Advanced Math', 'n', 'd', 't', 'gate'),
       ('ZZ.2', 'Equivalent Expressions', 'M', 'Advanced Math', 'n', 'd', 't', 'gate');
INSERT INTO public.clusters (id, display_name, family, definition, taxonomy_version)
VALUES ('CL.Z001', 'graph both', 'desmos', 'd', 'gate'),
       ('CL.Z002', 'distribute', 'by_hand_doing', 'd', 'gate');
SELECT public.video_resource_tag('SEGGATEVID1', 't', 'c', 300, ARRAY['Equivalent Expressions'],
                                 'Advanced Math', NULL, 'gate', '{}', NULL);

-- ---------------------------------------------------------------------------
-- G1 RLS and privileges
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text; t text; fn text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.video_segments', 'public.video_segment_sub_skills',
                           'public.video_segment_clusters'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass)
    THEN PERFORM pg_temp.fail('G1 RLS off on ' || t); END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT')
      THEN PERFORM pg_temp.fail('G1 ' || r || ' has a privilege on ' || t); END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH fn IN ARRAY ARRAY['public.video_segments_set(text, text, text, jsonb)',
                              'public.video_segments_approve(uuid[], uuid)'] LOOP
      IF has_function_privilege(r, fn, 'EXECUTE')
      THEN PERFORM pg_temp.fail('G1 ' || r || ' can EXECUTE ' || fn); END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.video_segments_set(text, text, text, jsonb)', 'EXECUTE')
  THEN PERFORM pg_temp.fail('G1 service_role cannot EXECUTE video_segments_set'); END IF;
  RAISE NOTICE 'OK G1 RLS on; service_role only';
END $$;

-- ---------------------------------------------------------------------------
-- G2 the vocabulary is the foreign keys
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean; bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    jsonb_build_array(pg_temp.seg(0, 100, ARRAY['ZZ.9'], ARRAY[]::text[])),
    jsonb_build_array(pg_temp.seg(0, 100, ARRAY['ZZ.1'], ARRAY['CL.Z999']))] LOOP
    refused := false;
    BEGIN
      PERFORM public.video_segments_set('SEGGATEVID1', 'gate', 'gate', bad);
    EXCEPTION WHEN foreign_key_violation THEN refused := true;
    END;
    IF NOT refused THEN PERFORM pg_temp.fail('G2 accepted an id outside the vocabulary: ' || bad::text); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.video_segments WHERE video_id = 'SEGGATEVID1')
  THEN PERFORM pg_temp.fail('G2 a refused call left a segment behind'); END IF;
  RAISE NOTICE 'OK G2 unknown sub-skill and cluster ids refused';
END $$;

-- ---------------------------------------------------------------------------
-- G3 spans
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean; bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    jsonb_build_array(pg_temp.seg(0, 301, ARRAY['ZZ.1'], ARRAY[]::text[])),              -- past the end
    jsonb_build_array(pg_temp.seg(0, 120, ARRAY['ZZ.1'], ARRAY[]::text[]),
                      pg_temp.seg(100, 200, ARRAY['ZZ.2'], ARRAY[]::text[])),            -- overlap
    jsonb_build_array(pg_temp.seg(50, 50, ARRAY['ZZ.1'], ARRAY[]::text[]))] LOOP          -- empty
    refused := false;
    BEGIN
      PERFORM public.video_segments_set('SEGGATEVID1', 'gate', 'gate', bad);
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN PERFORM pg_temp.fail('G3 accepted a bad span: ' || bad::text); END IF;
  END LOOP;
  RAISE NOTICE 'OK G3 past-the-end, overlapping and empty spans refused';
END $$;

-- ---------------------------------------------------------------------------
-- G4 approval survives only an unchanged segment
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids uuid[]; n integer;
BEGIN
  ids := public.video_segments_set('SEGGATEVID1', 'gate', 'gate', jsonb_build_array(
    pg_temp.seg(0, 100, ARRAY['ZZ.1'], ARRAY['CL.Z002']),
    pg_temp.seg(100, 200, ARRAY['ZZ.2'], ARRAY[]::text[]),
    pg_temp.seg(200, 300, ARRAY['ZZ.1', 'ZZ.2'], ARRAY[]::text[])));
  IF cardinality(ids) <> 3 THEN PERFORM pg_temp.fail('G4 expected 3 segment ids'); END IF;
  n := public.video_segments_approve(ids, '00000000-0000-4000-8000-0000000000aa');
  IF n <> 3 THEN PERFORM pg_temp.fail('G4 approve should approve 3, approved ' || n); END IF;
  -- Same list again, then: segment 2 gains a cluster; segment 3 ends earlier.
  PERFORM public.video_segments_set('SEGGATEVID1', 'gate', 'gate', jsonb_build_array(
    pg_temp.seg(0, 100, ARRAY['ZZ.1'], ARRAY['CL.Z002']),
    pg_temp.seg(100, 200, ARRAY['ZZ.2'], ARRAY['CL.Z001']),
    pg_temp.seg(200, 290, ARRAY['ZZ.2', 'ZZ.1'], ARRAY[]::text[])));
  IF NOT pg_temp.approved('SEGGATEVID1', 0) THEN PERFORM pg_temp.fail('G4 unchanged segment lost its approval'); END IF;
  IF pg_temp.approved('SEGGATEVID1', 100) THEN PERFORM pg_temp.fail('G4 changed cluster set kept its approval'); END IF;
  IF pg_temp.approved('SEGGATEVID1', 200) THEN PERFORM pg_temp.fail('G4 changed end kept its approval'); END IF;
  IF (SELECT count(*) FROM public.video_segment_clusters c JOIN public.video_segments s USING (segment_id)
       WHERE s.video_id = 'SEGGATEVID1' AND s.start_seconds = 100) <> 1
  THEN PERFORM pg_temp.fail('G4 the new cluster tag was not written'); END IF;
  RAISE NOTICE 'OK G4 approval kept when unchanged, cleared on a tag or span change';
END $$;

-- ---------------------------------------------------------------------------
-- G5 a dropped segment goes with its tags; a video takes its segments with it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.video_segments_set('SEGGATEVID1', 'gate', 'gate', jsonb_build_array(
    pg_temp.seg(0, 100, ARRAY['ZZ.1'], ARRAY['CL.Z002'])));
  IF (SELECT count(*) FROM public.video_segments WHERE video_id = 'SEGGATEVID1') <> 1
  THEN PERFORM pg_temp.fail('G5 a segment left out of the list survived'); END IF;
  IF EXISTS (SELECT 1 FROM public.video_segment_sub_skills t
              WHERE NOT EXISTS (SELECT 1 FROM public.video_segments s WHERE s.segment_id = t.segment_id))
  THEN PERFORM pg_temp.fail('G5 orphaned sub-skill tags'); END IF;
  PERFORM public.video_resource_tag('SEGGATEVID2', 't', 'c', 100, ARRAY['Equivalent Expressions'],
                                    'Advanced Math', NULL, 'gate', '{}', NULL);
  PERFORM public.video_segments_set('SEGGATEVID2', 'gate', 'gate', jsonb_build_array(
    pg_temp.seg(0, 100, ARRAY['ZZ.1'], ARRAY[]::text[])));
  DELETE FROM public.video_resources WHERE video_id = 'SEGGATEVID2';
  IF EXISTS (SELECT 1 FROM public.video_segments WHERE video_id = 'SEGGATEVID2')
  THEN PERFORM pg_temp.fail('G5 a deleted video kept its segments'); END IF;
  RAISE NOTICE 'OK G5 dropped segment and deleted video cascade';
END $$;

-- ---------------------------------------------------------------------------
-- G6 clusters-only is approvable; no tag is not
-- ---------------------------------------------------------------------------
DO $$
DECLARE ids uuid[];
BEGIN
  ids := public.video_segments_set('SEGGATEVID1', 'gate', 'gate', jsonb_build_array(
    pg_temp.seg(0, 100, ARRAY[]::text[], ARRAY['CL.Z001']),
    pg_temp.seg(100, 200, ARRAY[]::text[], ARRAY[]::text[])));
  IF public.video_segments_approve(ids, '00000000-0000-4000-8000-0000000000aa') <> 1
  THEN PERFORM pg_temp.fail('G6 expected exactly the clusters-only segment approved'); END IF;
  IF NOT pg_temp.approved('SEGGATEVID1', 0) OR pg_temp.approved('SEGGATEVID1', 100)
  THEN PERFORM pg_temp.fail('G6 wrong segment approved'); END IF;
  IF public.video_segments_approve(ids, NULL) <> 0
  THEN PERFORM pg_temp.fail('G6 approved without an approver'); END IF;
  RAISE NOTICE 'OK G6 clusters-only approvable, untagged and approver-less not';
END $$;

-- ---------------------------------------------------------------------------
-- G7 a vocabulary id in use cannot be deleted
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.clusters WHERE id = 'CL.Z001';
  EXCEPTION WHEN foreign_key_violation THEN refused := true;
  END;
  IF NOT refused THEN PERFORM pg_temp.fail('G7 deleted a cluster still tagged on a segment'); END IF;
  RAISE NOTICE 'OK G7 RESTRICT holds on the vocabulary';
END $$;

ROLLBACK;
\echo 'VIDEO SEGMENT GATES: PASS'
