-- ============================================================================
-- LISA curriculum retrieval store — schema + retrieval gates
-- ============================================================================
-- Proves, against a throwaway database with the full migration pipeline applied, that
-- curriculum_chunks / video_resources refuse what LISA_Video_RAG_Plan.md Step C (revised
-- 2026-10-15) says they must refuse, and that curriculum_chunks_search (THE Step F query)
-- filters by skill inside the statement. Every gate asserts the expected outcome or raises
-- CURRICULUM_GATE_FAILED. Everything runs in one transaction and rolls back.
--
-- Run:  psql -v ON_ERROR_STOP=1 -d <db> -f scripts/ci/curriculum-chunks-gates.sql
--
-- @spec [Doc-03D_V1.2 §6.6 (as amended by SCL-231, approved by Karl 2026-10-15), §6.7, §6.8;
--        LISA_Video_RAG_Plan.md Step C + Step F §7 tests] | @implemented [2026-10-15]
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off

BEGIN;

-- A 768-d vector pointing mostly along axis `i` (baseline 0.001, never the zero vector, whose
-- cosine distance is undefined). Two different axes are far apart; the same axis is distance 0.
CREATE FUNCTION pg_temp.axis(i integer, w real DEFAULT 1) RETURNS extensions.vector
LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('[' || array_to_string(ARRAY(
           SELECT CASE WHEN g = i THEN w ELSE 0.001 END FROM generate_series(1, 768) g), ',')
          || ']')::extensions.vector
$f$;

CREATE FUNCTION pg_temp.fail(msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'CURRICULUM_GATE_FAILED: %', msg; END $f$;

-- ---------------------------------------------------------------------------
-- S1 shape: dimension 768 (text-embedding-005), the four named indexes, RLS on.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO t FROM pg_attribute
   WHERE attrelid = 'public.curriculum_chunks'::regclass AND attname = 'embedding';
  IF t IS DISTINCT FROM 'extensions.vector(768)' AND t IS DISTINCT FROM 'vector(768)' THEN
    PERFORM pg_temp.fail('S1 embedding column is ' || coalesce(t, 'missing') || ', expected vector(768)');
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'curriculum_chunks'
        AND (indexname, position(' USING gin ' in indexdef) > 0) = ('curriculum_chunks_skills_idx', true)) <> 1
  THEN PERFORM pg_temp.fail('S1 GIN index on skill_codes missing'); END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'curriculum_chunks'
        AND indexname = 'curriculum_chunks_embedding_idx' AND indexdef LIKE '%USING hnsw%vector_cosine_ops%') <> 1
  THEN PERFORM pg_temp.fail('S1 HNSW cosine index missing'); END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'curriculum_chunks'
        AND indexname = 'curriculum_chunks_active_idx' AND indexdef LIKE '%WHERE (status = ''active''::text)%') <> 1
  THEN PERFORM pg_temp.fail('S1 partial active index missing'); END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'curriculum_chunks'
        AND indexname = 'curriculum_chunks_provenance_unique' AND indexdef LIKE 'CREATE UNIQUE INDEX%(provenance)') <> 1
  THEN PERFORM pg_temp.fail('S1 unique provenance index missing'); END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.curriculum_chunks'::regclass,
                                                 'public.video_resources'::regclass)
              AND NOT relrowsecurity)
  THEN PERFORM pg_temp.fail('S1 RLS not enabled'); END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('curriculum_chunks', 'video_resources'))
  THEN PERFORM pg_temp.fail('S1 a policy exists; students must never read these tables'); END IF;
  RAISE NOTICE 'OK S1 vector(768), four indexes, RLS on with zero policies';
END $$;

-- ---------------------------------------------------------------------------
-- S2 privileges: no student-facing role can read, write or call anything here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text; tbl text; fn text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH tbl IN ARRAY ARRAY['public.curriculum_chunks', 'public.video_resources'] LOOP
      IF has_table_privilege(r, tbl, 'SELECT') OR has_table_privilege(r, tbl, 'INSERT')
         OR has_table_privilege(r, tbl, 'UPDATE') OR has_table_privilege(r, tbl, 'DELETE') THEN
        PERFORM pg_temp.fail('S2 ' || r || ' holds a privilege on ' || tbl);
      END IF;
    END LOOP;
    FOREACH fn IN ARRAY ARRAY[
      'public.curriculum_chunks_search(extensions.vector, text[], integer)',
      'public.curriculum_chunk_upsert(text, text, text[], text, text, extensions.vector)'] LOOP
      IF has_function_privilege(r, fn, 'EXECUTE') THEN
        PERFORM pg_temp.fail('S2 ' || r || ' can EXECUTE ' || fn);
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.curriculum_chunks', 'SELECT')
     OR NOT has_function_privilege('service_role',
          'public.curriculum_chunks_search(extensions.vector, text[], integer)', 'EXECUTE') THEN
    PERFORM pg_temp.fail('S2 service_role cannot read the store (the BFF would get nothing)');
  END IF;
  RAISE NOTICE 'OK S2 anon/authenticated hold nothing; service_role reads';
END $$;

-- ---------------------------------------------------------------------------
-- S3 constraints refuse bad rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE refused boolean; stmt text;
BEGIN
  -- each statement must fail with check_violation
  FOR stmt IN SELECT unnest(ARRAY[
    -- active without a reviewer
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding, status)
        VALUES ('x', ARRAY['Linear equations in one variable'], 'youtube:AAAAAAAAAAA:0-60', 'pre_and_post', 'video_transcript', pg_temp.axis(1), 'active')$q$,
    -- empty skill array
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
        VALUES ('x', ARRAY[]::text[], 'youtube:AAAAAAAAAAA:0-61', 'pre_and_post', 'video_transcript', pg_temp.axis(1))$q$,
    -- blank skill
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
        VALUES ('x', ARRAY[''], 'youtube:AAAAAAAAAAA:0-62', 'pre_and_post', 'video_transcript', pg_temp.axis(1))$q$,
    -- surface_gate off the §6.7 enum
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
        VALUES ('x', ARRAY['Linear equations in one variable'], 'youtube:AAAAAAAAAAA:0-63', 'always', 'video_transcript', pg_temp.axis(1))$q$,
    -- content_type off the §6.7 enum
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
        VALUES ('x', ARRAY['Linear equations in one variable'], 'youtube:AAAAAAAAAAA:0-64', 'pre_and_post', 'video', pg_temp.axis(1))$q$,
    -- video provenance not youtube:<11-char id>:<start>-<end>
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
        VALUES ('x', ARRAY['Linear equations in one variable'], 'https://youtu.be/AAAAAAAAAAA?t=0', 'pre_and_post', 'video_transcript', pg_temp.axis(1))$q$,
    -- unknown status
    $q$INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding, status)
        VALUES ('x', ARRAY['Linear equations in one variable'], 'youtube:AAAAAAAAAAA:0-65', 'pre_and_post', 'video_transcript', pg_temp.axis(1), 'live')$q$,
    -- video_resources: bad id, non-positive duration, unknown status
    $q$INSERT INTO public.video_resources (video_id, title, channel_name, duration_seconds, last_checked_at)
        VALUES ('not-an-id', 't', 'c', 60, now())$q$,
    $q$INSERT INTO public.video_resources (video_id, title, channel_name, duration_seconds, last_checked_at)
        VALUES ('AAAAAAAAAAA', 't', 'c', 0, now())$q$,
    $q$INSERT INTO public.video_resources (video_id, title, channel_name, duration_seconds, status, last_checked_at)
        VALUES ('AAAAAAAAAAA', 't', 'c', 60, 'deleted', now())$q$
  ]) LOOP
    refused := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN check_violation THEN refused := true;
    END;
    IF NOT refused THEN PERFORM pg_temp.fail('S3 accepted: ' || stmt); END IF;
  END LOOP;
  -- a wrong-dimension vector is refused by the column type
  refused := false;
  BEGIN
    INSERT INTO public.curriculum_chunks (content, skill_codes, provenance, surface_gate, content_type, embedding)
      VALUES ('x', ARRAY['Linear equations in one variable'], 'youtube:AAAAAAAAAAA:0-66', 'pre_and_post',
              'video_transcript', '[1,2,3]'::extensions.vector);
  EXCEPTION WHEN data_exception THEN refused := true;
  END;
  IF NOT refused THEN PERFORM pg_temp.fail('S3 accepted a 3-d vector into vector(768)'); END IF;
  RAISE NOTICE 'OK S3 review gate, enums, provenance format, dimension and video_resources checks refuse';
END $$;

-- ---------------------------------------------------------------------------
-- Fixture for the retrieval gates. Skill X = 'Linear equations in one variable',
-- skill Y = 'Circles'. Reviewer is a fixed uuid.
-- ---------------------------------------------------------------------------
DO $$
DECLARE i integer; v_id uuid;
BEGIN
  -- X1: on skill X, along axis 1.  Y1: on skill Y, along axis 2.
  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXXX1:0-60', 'X one',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  PERFORM public.curriculum_chunk_upsert('youtube:YYYYYYYYYY1:0-60', 'Y one',
            ARRAY['Circles'], 'pre_and_post', 'video_transcript', pg_temp.axis(2));
  -- RET: on skill X, EXACTLY the query vector for X, but retired.  PEN: same, pending review.
  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXRET:0-60', 'X retired',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXPEN:0-60', 'X pending',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  -- T1/T2: two on-skill X chunks with an IDENTICAL vector (a distance tie).
  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXXT1:0-60', 'X tie a',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(3));
  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXXT2:0-60', 'X tie b',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(3));
  -- 80 skill-Y chunks all nearer to an axis-1 query than the X tie pair: they crowd the
  -- nearest-neighbour candidates for the selective-skill gate (R3).
  FOR i IN 1..80 LOOP
    PERFORM public.curriculum_chunk_upsert(
      'youtube:YCROWD' || lpad(i::text, 5, '0') || ':0-60', 'Y crowd ' || i,
      ARRAY['Circles'], 'pre_and_post', 'video_transcript',
      pg_temp.axis(1, 0.9) );
  END LOOP;
  UPDATE public.curriculum_chunks
     SET status = 'active', reviewed_by = '00000000-0000-4000-8000-0000000000aa', reviewed_at = now()
   WHERE provenance <> 'youtube:XXXXXXXXPEN:0-60';
  UPDATE public.curriculum_chunks SET status = 'retired' WHERE provenance = 'youtube:XXXXXXXXRET:0-60';
  ANALYZE public.curriculum_chunks;
END $$;

-- ---------------------------------------------------------------------------
-- R1 skill filter: a chunk tagged only with skill Y is never returned for skill X, even when
--    it is the exact nearest neighbour of the query. Presence first: the X search returns rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer; leaked integer;
BEGIN
  SELECT count(*) INTO n FROM public.curriculum_chunks_search(pg_temp.axis(2), ARRAY['Linear equations in one variable'], 20);
  IF n = 0 THEN PERFORM pg_temp.fail('R1 presence: the skill-X search returned nothing, so absence proves nothing'); END IF;
  SELECT count(*) INTO leaked
    FROM public.curriculum_chunks_search(pg_temp.axis(2), ARRAY['Linear equations in one variable'], 20) s
   WHERE NOT ('Linear equations in one variable' = ANY (s.skill_codes));
  IF leaked <> 0 THEN PERFORM pg_temp.fail('R1 ' || leaked || ' off-skill chunk(s) returned for skill X'); END IF;
  -- the reverse direction, and the skill-Y nearest neighbour is really there for skill Y
  IF (SELECT provenance FROM public.curriculum_chunks_search(pg_temp.axis(2), ARRAY['Circles'], 1))
       IS DISTINCT FROM 'youtube:YYYYYYYYYY1:0-60'
  THEN PERFORM pg_temp.fail('R1 control: skill-Y search did not return Y one first'); END IF;
  -- no overlap -> nothing
  IF EXISTS (SELECT 1 FROM public.curriculum_chunks_search(pg_temp.axis(1), ARRAY['Boundaries'], 20))
  THEN PERFORM pg_temp.fail('R1 a skill with no chunks returned rows'); END IF;
  IF EXISTS (SELECT 1 FROM public.curriculum_chunks_search(pg_temp.axis(1), ARRAY[]::text[], 20))
  THEN PERFORM pg_temp.fail('R1 an empty skill array returned rows'); END IF;
  RAISE NOTICE 'OK R1 skill filter holds in both directions (% skill-X rows, 0 off-skill)', n;
END $$;

-- ---------------------------------------------------------------------------
-- R2 retired and pending_review are never returned, though each is the exact nearest
--    neighbour of the query on the right skill.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.curriculum_chunks_search(pg_temp.axis(1), ARRAY['Linear equations in one variable'], 20)
              WHERE provenance IN ('youtube:XXXXXXXXRET:0-60', 'youtube:XXXXXXXXPEN:0-60'))
  THEN PERFORM pg_temp.fail('R2 a retired or pending_review chunk was returned'); END IF;
  IF (SELECT provenance FROM public.curriculum_chunks_search(pg_temp.axis(1), ARRAY['Linear equations in one variable'], 1))
       IS DISTINCT FROM 'youtube:XXXXXXXXXX1:0-60'
  THEN PERFORM pg_temp.fail('R2 control: the active nearest neighbour was not first'); END IF;
  RAISE NOTICE 'OK R2 retired/pending never returned; active nearest neighbour first';
END $$;

-- ---------------------------------------------------------------------------
-- R3 limit n returns n on-skill chunks whenever n exist, even when 80 off-skill chunks are
--    nearer. The planner is left only the HNSW index for an ORDER BY ... LIMIT (the GIN and
--    partial indexes are dropped inside this rolled-back transaction, seqscan is off, and
--    ef_search is small), which is the plan a larger table gets on its own. Under it the bare
--    "WHERE skill && ... ORDER BY distance LIMIT n" form filters the index's ef_search
--    candidates and comes back short; curriculum_chunks_search must not.
-- ---------------------------------------------------------------------------
DROP INDEX public.curriculum_chunks_skills_idx, public.curriculum_chunks_active_idx;
SET LOCAL enable_seqscan = off;
SET LOCAL hnsw.ef_search = 10;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.curriculum_chunks_search(pg_temp.axis(1), ARRAY['Linear equations in one variable'], 3);
  IF n <> 3 THEN PERFORM pg_temp.fail('R3 limit 3 returned ' || n || ' on-skill chunk(s); 3 active ones exist'); END IF;
  RAISE NOTICE 'OK R3 limit 3 -> 3 on-skill chunks past 80 nearer off-skill ones';
END $$;
RESET enable_seqscan;
RESET hnsw.ef_search;

-- ---------------------------------------------------------------------------
-- R4 determinism: identical requests return identical chunks in identical order, including
--    across a distance tie (broken by id).
-- ---------------------------------------------------------------------------
DO $$
DECLARE a uuid[]; b uuid[]; tie uuid[];
BEGIN
  SELECT array_agg(id) INTO a FROM public.curriculum_chunks_search(pg_temp.axis(3), ARRAY['Linear equations in one variable'], 5);
  SELECT array_agg(id) INTO b FROM public.curriculum_chunks_search(pg_temp.axis(3), ARRAY['Linear equations in one variable'], 5);
  IF a IS NULL OR cardinality(a) < 2 THEN PERFORM pg_temp.fail('R4 presence: fewer than 2 rows'); END IF;
  IF a IS DISTINCT FROM b THEN PERFORM pg_temp.fail('R4 two identical requests differed'); END IF;
  SELECT array_agg(id ORDER BY id) INTO tie FROM public.curriculum_chunks
   WHERE provenance IN ('youtube:XXXXXXXXXT1:0-60', 'youtube:XXXXXXXXXT2:0-60');
  IF a[1:2] IS DISTINCT FROM tie THEN PERFORM pg_temp.fail('R4 the distance tie was not broken by id'); END IF;
  RAISE NOTICE 'OK R4 identical requests -> identical ordered rows; tie broken by id';
END $$;

-- ---------------------------------------------------------------------------
-- U1 re-ingesting a segment updates rather than duplicates; an unchanged re-run keeps its
--    approval; a changed one drops to pending_review; a retired row stays retired.
-- ---------------------------------------------------------------------------
DO $$
DECLARE id1 uuid; id2 uuid; id3 uuid; s text; rb uuid; n integer;
BEGIN
  SELECT id INTO id1 FROM public.curriculum_chunks WHERE provenance = 'youtube:XXXXXXXXXX1:0-60';
  id2 := public.curriculum_chunk_upsert('youtube:XXXXXXXXXX1:0-60', 'X one',
           ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  SELECT count(*), max(status), (array_agg(reviewed_by))[1] INTO n, s, rb
    FROM public.curriculum_chunks WHERE provenance = 'youtube:XXXXXXXXXX1:0-60';
  IF id2 IS DISTINCT FROM id1 OR n <> 1 THEN PERFORM pg_temp.fail('U1 unchanged re-ingest created a row or changed the id'); END IF;
  IF s <> 'active' OR rb IS NULL THEN PERFORM pg_temp.fail('U1 unchanged re-ingest lost its approval'); END IF;

  id3 := public.curriculum_chunk_upsert('youtube:XXXXXXXXXX1:0-60', 'X one, rewritten',
           ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  SELECT count(*), max(status), (array_agg(reviewed_by))[1] INTO n, s, rb
    FROM public.curriculum_chunks WHERE provenance = 'youtube:XXXXXXXXXX1:0-60';
  IF id3 IS DISTINCT FROM id1 OR n <> 1 THEN PERFORM pg_temp.fail('U1 changed re-ingest duplicated'); END IF;
  IF s <> 'pending_review' OR rb IS NOT NULL THEN PERFORM pg_temp.fail('U1 changed content stayed live on an old approval'); END IF;
  IF (SELECT content FROM public.curriculum_chunks WHERE id = id1) <> 'X one, rewritten'
  THEN PERFORM pg_temp.fail('U1 changed re-ingest did not update the content'); END IF;

  PERFORM public.curriculum_chunk_upsert('youtube:XXXXXXXXRET:0-60', 'X retired, rewritten',
            ARRAY['Linear equations in one variable'], 'pre_and_post', 'video_transcript', pg_temp.axis(1));
  IF (SELECT status FROM public.curriculum_chunks WHERE provenance = 'youtube:XXXXXXXXRET:0-60') <> 'retired'
  THEN PERFORM pg_temp.fail('U1 re-ingest resurrected a retired chunk'); END IF;
  RAISE NOTICE 'OK U1 upsert on provenance: no duplicate; approval kept only when unchanged; retired stays retired';
END $$;

ROLLBACK;

\echo 'CURRICULUM CHUNKS GATES: PASS'
