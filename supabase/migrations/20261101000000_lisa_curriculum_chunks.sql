-- ===========================================================================
-- LISA curriculum retrieval store: curriculum_chunks + video_resources (pgvector).
--
-- @spec [Doc-03D_V1.2 §6.5 (provenance), §6.6 (semantic path; storage amended by SCL-231,
--       PROPOSED 2026-10-15: pgvector in Postgres, not Vertex AI RAG Engine), §6.7 (the four
--       metadata fields; embedding model locked at creation), §6.8 (retrieved item shape;
--       surface_gate evaluated after retrieval); LISA_Video_RAG_Plan.md Step C (revised
--       2026-10-15, pgvector) and Step D §A (video_resources)] | @implemented [2026-10-15]
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English:
--  1. `curriculum_chunks`: one row per retrievable segment. `content` is the Lyceon-authored
--     description (Step D), `embedding` its text-embedding-005 vector. The dimension, 768, was
--     read from the live model on 2026-10-15 (a :predict call on us-central1 returned 768
--     values); it is as permanent as the model, because changing either means re-embedding
--     every row. `skill_codes` is TEXT[] exactly as on `questions` — the open taxonomy of full
--     College Board skill names, no FK (genesis note A7: deliberately no closed skills table).
--     `surface_gate` and `content_type` take the §6.7 values as encoded in
--     packages/shared/tutor-rag-types.ts (`ragCorpusMetadataSchema`).
--  2. Review gate in the schema, not only in the pipeline: `status` is pending_review | active |
--     retired, defaults to pending_review, and an active row must carry reviewed_by and
--     reviewed_at (CHECK). Nothing reaches a student unreviewed, whatever wrote the row.
--  3. `unique (provenance)` makes ingestion idempotent. `curriculum_chunk_upsert` is the one
--     ingestion writer: a re-run of an unchanged segment is a no-op on its review state; a
--     changed segment (content, skills, gate, type or vector) updates in place and drops back
--     to pending_review with the reviewer cleared, so an edit is never live on an old approval.
--     A retired row stays retired.
--  4. `curriculum_chunks_search`: THE retrieval query (Step F). The skill filter is a WHERE on
--     the GIN-indexed array, inside the statement. The candidate set is materialised BEFORE the
--     distance sort, so the nearest-neighbour step ranks exactly the on-skill active rows:
--     `limit n` returns n on-skill chunks whenever n exist. (A bare ORDER BY ... LIMIT over
--     the HNSW index filters AFTER the index returns its ef_search candidates, and can return
--     fewer than n — or none — for a selective skill: a silent shortfall of exactly the kind
--     this store replaces. On this corpus size the exact sort over one skill's rows is cheap.)
--     Ties on distance break on id, so identical requests return identical rows in identical
--     order. SECURITY INVOKER; service_role only.
--  5. `video_resources`: per-video facts for the render-time card (title, channel, duration,
--     availability, last check). Joined by video id from `provenance`, not stored per chunk.
--  6. RLS on, zero policies, no anon/authenticated privilege — the question-bank posture
--     (genesis A4). Students never read either table; the BFF reads with the service role.
--
-- trade-offs: the HNSW index is created as specified, but the filtered search in (4) does not
--  depend on it: the GIN index selects the candidate rows and the distance sort over them is
--  exact. HNSW serves any future unfiltered search and stays correct as the table grows.
--
-- edge cases: an empty or NULL skill array in a search returns nothing (`&&` with no overlap).
--  p_limit is clamped to 1..20, matching retrievalRequestSchema.max_items.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. curriculum_chunks
-- ---------------------------------------------------------------------------
CREATE TABLE public.curriculum_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  skill_codes   text[] NOT NULL,
  provenance    text NOT NULL,                 -- youtube:<video_id>:<start>-<end> (Doc 03D §6.5)
  surface_gate  text NOT NULL,
  content_type  text NOT NULL,
  embedding     extensions.vector(768) NOT NULL, -- text-embedding-005
  status        text NOT NULL DEFAULT 'pending_review',
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_chunks_provenance_unique UNIQUE (provenance),
  -- cardinality, not array_length: array_length('{}', 1) is NULL, and a NULL CHECK passes.
  CONSTRAINT curriculum_chunks_skills_nonempty CHECK (cardinality(skill_codes) >= 1),
  CONSTRAINT curriculum_chunks_skills_no_blank CHECK (array_position(skill_codes, NULL) IS NULL
                                                      AND array_position(skill_codes, '') IS NULL),
  CONSTRAINT curriculum_chunks_content_nonblank CHECK (btrim(content) <> ''),
  CONSTRAINT curriculum_chunks_surface_gate_check
    CHECK (surface_gate IN ('pre_and_post', 'post_only', 'review_only')),
  CONSTRAINT curriculum_chunks_content_type_check
    CHECK (content_type IN ('textbook', 'video_transcript', 'strategy', 'worked_example')),
  CONSTRAINT curriculum_chunks_video_provenance_check
    CHECK (content_type <> 'video_transcript'
           OR provenance ~ '^youtube:[A-Za-z0-9_-]{11}:[0-9]+-[0-9]+$'),
  CONSTRAINT curriculum_chunks_status_check
    CHECK (status IN ('pending_review', 'active', 'retired')),
  CONSTRAINT curriculum_chunks_active_reviewed
    CHECK (status <> 'active' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);

COMMENT ON TABLE public.curriculum_chunks IS
  'LISA curriculum retrieval store (Doc 03D §6.6 as amended by SCL-231). Service role only; '
  'students never read it directly. Written by curriculum_chunk_upsert, read by '
  'curriculum_chunks_search.';

CREATE INDEX curriculum_chunks_skills_idx
  ON public.curriculum_chunks USING gin (skill_codes);

CREATE INDEX curriculum_chunks_embedding_idx
  ON public.curriculum_chunks USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX curriculum_chunks_active_idx
  ON public.curriculum_chunks (status) WHERE status = 'active';

ALTER TABLE public.curriculum_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.curriculum_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.curriculum_chunks TO service_role;

-- ---------------------------------------------------------------------------
-- 2. video_resources (Step D §A)
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_resources (
  video_id          text PRIMARY KEY,
  title             text NOT NULL,
  channel_name      text NOT NULL,
  duration_seconds  integer NOT NULL,
  status            text NOT NULL DEFAULT 'available',
  last_checked_at   timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_resources_video_id_check CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  CONSTRAINT video_resources_duration_check CHECK (duration_seconds > 0),
  CONSTRAINT video_resources_status_check CHECK (status IN ('available', 'unavailable'))
);

COMMENT ON TABLE public.video_resources IS
  'Per-video facts for the LISA video card, joined at render time by the video id in '
  'curriculum_chunks.provenance. Service role only.';

ALTER TABLE public.video_resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_resources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_resources TO service_role;

-- ---------------------------------------------------------------------------
-- 3. curriculum_chunk_upsert — the one ingestion writer
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.curriculum_chunk_upsert(
  p_provenance   text,
  p_content      text,
  p_skill_codes  text[],
  p_surface_gate text,
  p_content_type text,
  p_embedding    extensions.vector(768)
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $fn$
  INSERT INTO public.curriculum_chunks AS c
    (provenance, content, skill_codes, surface_gate, content_type, embedding)
  VALUES (p_provenance, p_content, p_skill_codes, p_surface_gate, p_content_type, p_embedding)
  ON CONFLICT (provenance) DO UPDATE SET
    content      = EXCLUDED.content,
    skill_codes  = EXCLUDED.skill_codes,
    surface_gate = EXCLUDED.surface_gate,
    content_type = EXCLUDED.content_type,
    embedding    = EXCLUDED.embedding,
    -- A changed segment loses its approval; an unchanged one keeps it; retired stays retired.
    status = CASE
      WHEN c.status = 'retired' THEN 'retired'
      WHEN (c.content, c.skill_codes, c.surface_gate, c.content_type, c.embedding)
           IS NOT DISTINCT FROM
           (EXCLUDED.content, EXCLUDED.skill_codes, EXCLUDED.surface_gate,
            EXCLUDED.content_type, EXCLUDED.embedding)
        THEN c.status
      ELSE 'pending_review'
    END,
    reviewed_by = CASE
      WHEN (c.content, c.skill_codes, c.surface_gate, c.content_type, c.embedding)
           IS NOT DISTINCT FROM
           (EXCLUDED.content, EXCLUDED.skill_codes, EXCLUDED.surface_gate,
            EXCLUDED.content_type, EXCLUDED.embedding)
        THEN c.reviewed_by
      ELSE NULL
    END,
    reviewed_at = CASE
      WHEN (c.content, c.skill_codes, c.surface_gate, c.content_type, c.embedding)
           IS NOT DISTINCT FROM
           (EXCLUDED.content, EXCLUDED.skill_codes, EXCLUDED.surface_gate,
            EXCLUDED.content_type, EXCLUDED.embedding)
        THEN c.reviewed_at
      ELSE NULL
    END,
    updated_at = now()
  RETURNING c.id;
$fn$;

REVOKE ALL ON FUNCTION public.curriculum_chunk_upsert(text, text, text[], text, text, extensions.vector)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_chunk_upsert(text, text, text[], text, text, extensions.vector)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. curriculum_chunks_search — THE retrieval query (Step F, Step 13d)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.curriculum_chunks_search(
  p_query_embedding extensions.vector(768),
  p_skill_codes     text[],
  p_limit           integer
) RETURNS TABLE (
  id           uuid,
  content      text,
  skill_codes  text[],
  provenance   text,
  surface_gate text,
  content_type text,
  score        double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $fn$
  WITH candidates AS MATERIALIZED (
    SELECT c.id, c.content, c.skill_codes, c.provenance, c.surface_gate, c.content_type,
           c.embedding OPERATOR(extensions.<=>) p_query_embedding AS distance
    FROM public.curriculum_chunks c
    WHERE c.status = 'active'
      AND c.skill_codes && p_skill_codes            -- GIN index: the exact skill filter
  )
  SELECT k.id, k.content, k.skill_codes, k.provenance, k.surface_gate, k.content_type,
         1 - k.distance AS score
  FROM candidates k
  ORDER BY k.distance, k.id                         -- exact cosine order; id breaks ties
  LIMIT greatest(1, least(coalesce(p_limit, 3), 20));
$fn$;

REVOKE ALL ON FUNCTION public.curriculum_chunks_search(extensions.vector, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_chunks_search(extensions.vector, text[], integer)
  TO service_role;

-- ===========================================================================
-- DOWN MIGRATION (manual; reviewed). Both tables hold build-time data only (regenerated by
-- the Step D pipeline from sources.json), no student data:
--   DROP FUNCTION IF EXISTS public.curriculum_chunks_search(extensions.vector, text[], integer);
--   DROP FUNCTION IF EXISTS public.curriculum_chunk_upsert(text, text, text[], text, text, extensions.vector);
--   DROP TABLE IF EXISTS public.video_resources;
--   DROP TABLE IF EXISTS public.curriculum_chunks;
-- ===========================================================================
