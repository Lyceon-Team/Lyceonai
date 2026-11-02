-- ===========================================================================
-- LISA video library — segments tagged by sub-skill and cluster (storage)
-- ===========================================================================
-- @spec [Doc-03D_V1.2 §6.7 (metadata schema) as amended by SCL-248 and SCL-259; owner brief
--       "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase B (approved
--       2026-10-29: videos up to 15 minutes; storage now, retrieval in Phase C);
--       docs/plans/lisa-video-library/segments-phase-a.md §2] | @implemented [2026-10-29]
--
-- OWNER-RUN. Karl applies to production by hand. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English: a library video is retrieved today by skill only, so a student failing
-- rational expressions can be served a FOIL short (Equivalent Expressions, but the wrong
-- sub-skill). This stores what each part of a video teaches, from the one vocabulary the
-- questions are tagged with (SCL-256), so retrieval can later (Phase C) match a question's
-- sub-skills to a segment and start playback there:
--  1. `video_segments`: a span of an approved library video, with a one-line summary in our
--     own words (never instructor text), the taxonomy version its tags were made against, and
--     Karl's approval. A segment belongs to its video and goes with it (ON DELETE CASCADE).
--  2. `video_segment_sub_skills`, `video_segment_clusters`: the tags, several per segment and
--     none primary (no rank column), each a FOREIGN KEY into `sub_skills` / `clusters`: no
--     second vocabulary, no free text. RESTRICT (the default) on the vocabulary side: the
--     taxonomy loader deletes ids that left the canonical file, and deleting one still in use
--     fails loudly instead of orphaning tags. Each tag carries one line of evidence.
--     A segment with clusters and no sub-skill is valid: calculator technique (Phase A
--     ruling 2) and any segment either tagging pass called mixed or an overview (one-topic
--     rule, 2026-10-29) keep clusters only. `method_in` clusters are present by default and
--     are never stored as tags; a missing cluster is never evidence that it is not used.
--  3. `video_segments_set(video_id, taxonomy_version, tagged_by, segments jsonb)`: the one
--     writer, per video, from Karl's reviewed file. It replaces the video's segments in one
--     statement set, refusing a span outside the video, an overlap, or an id outside the
--     vocabulary (the foreign keys). A segment whose span and tag sets are unchanged keeps its
--     approval; any change clears it, as `video_resource_tag` does for a video.
--  4. `video_segments_approve(segment_ids, approver)`: Karl's review, applied. Approves only
--     segments with at least one tag; returns how many it approved.
--
-- Not here, on purpose: the retrieval function and the miss log (segments-phase-a.md §2, §4)
-- are Phase C, which waits for the questions team's Phase 2 tags (Karl, 2026-10-29, ruling C).
-- Until then the segments are tagged, reviewed and stored, and nothing reads them.
--
-- Library content, not student data: no student, guardian or conversation id anywhere, so no
-- Doc 03 §14.2 retention row (video_resources has none either). RLS on with no policies;
-- service_role only, like sub_skills and clusters.
--
-- Precondition: the SCL-256 vocabulary is loaded (`scripts/scl-taxonomy-loader.ts --apply`,
-- taxonomy_version scl-v1.0.0), or the apply SQL's tag rows fail their foreign keys.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. video_segments
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_segments (
  segment_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id         text NOT NULL REFERENCES public.video_resources(video_id) ON DELETE CASCADE,
  start_seconds    integer NOT NULL CHECK (start_seconds >= 0),
  end_seconds      integer NOT NULL,
  summary          text NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  taxonomy_version text NOT NULL,
  tagged_by        text NOT NULL,
  tagged_at        timestamptz NOT NULL DEFAULT now(),
  approved_by      uuid,
  approved_at      timestamptz,
  CONSTRAINT video_segments_span CHECK (end_seconds > start_seconds),
  CONSTRAINT video_segments_approved_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT video_segments_video_start UNIQUE (video_id, start_seconds)
);

ALTER TABLE public.video_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_segments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_segments TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The tags
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_segment_sub_skills (
  segment_id       uuid NOT NULL REFERENCES public.video_segments(segment_id) ON DELETE CASCADE,
  sub_skill_id     text NOT NULL REFERENCES public.sub_skills(id),
  evidence         text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 300),
  taxonomy_version text NOT NULL,
  PRIMARY KEY (segment_id, sub_skill_id)
);

CREATE TABLE public.video_segment_clusters (
  segment_id       uuid NOT NULL REFERENCES public.video_segments(segment_id) ON DELETE CASCADE,
  cluster_id       text NOT NULL REFERENCES public.clusters(id),
  evidence         text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 300),
  taxonomy_version text NOT NULL,
  PRIMARY KEY (segment_id, cluster_id)
);

-- Phase C matches a question's tags to segments by these.
CREATE INDEX video_segment_sub_skills_sub_skill_idx ON public.video_segment_sub_skills (sub_skill_id);
CREATE INDEX video_segment_clusters_cluster_idx ON public.video_segment_clusters (cluster_id);

ALTER TABLE public.video_segment_sub_skills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_segment_sub_skills FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_segment_sub_skills TO service_role;

ALTER TABLE public.video_segment_clusters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_segment_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_segment_clusters TO service_role;

-- ---------------------------------------------------------------------------
-- 3. video_segments_set — the one writer, per video
-- ---------------------------------------------------------------------------
-- p_segments: a JSON array of
--   {"start_seconds": int, "end_seconds": int, "summary": text,
--    "sub_skills": [{"id": text, "evidence": text}], "clusters": [{"id": text, "evidence": text}]}
-- The video's segments become exactly this list. Returns the segment ids in start order.
CREATE FUNCTION public.video_segments_set(
  p_video_id         text,
  p_taxonomy_version text,
  p_tagged_by        text,
  p_segments         jsonb
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_duration integer;
  v_seg      jsonb;
  v_start    integer;
  v_end      integer;
  v_prev_end integer := 0;
  v_id       uuid;
  v_ids      uuid[] := '{}';
  v_same     boolean;
BEGIN
  SELECT duration_seconds INTO v_duration FROM public.video_resources WHERE video_id = p_video_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'video_segments_set: unknown video %', p_video_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF jsonb_typeof(p_segments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'video_segments_set: segments must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Segments in start order; a span must lie in the video and not overlap the previous one.
  FOR v_start, v_end IN
    SELECT (e->>'start_seconds')::integer, (e->>'end_seconds')::integer
    FROM jsonb_array_elements(p_segments) e
    ORDER BY (e->>'start_seconds')::integer
  LOOP
    IF v_start IS NULL OR v_end IS NULL OR v_start < 0 OR v_end <= v_start
       OR v_end > v_duration OR v_start < v_prev_end THEN
      RAISE EXCEPTION 'video_segments_set: % span %-% is empty, outside the video (% s) or overlaps the previous segment',
        p_video_id, v_start, v_end, v_duration USING ERRCODE = 'check_violation';
    END IF;
    v_prev_end := v_end;
  END LOOP;

  -- Segments no longer in the list go (their tags cascade).
  DELETE FROM public.video_segments s
  WHERE s.video_id = p_video_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_segments) e
      WHERE (e->>'start_seconds')::integer = s.start_seconds
    );

  FOR v_seg IN
    SELECT e FROM jsonb_array_elements(p_segments) e ORDER BY (e->>'start_seconds')::integer
  LOOP
    v_start := (v_seg->>'start_seconds')::integer;
    v_end   := (v_seg->>'end_seconds')::integer;
    v_seg   := v_seg || jsonb_build_object(
                 'sub_skills', coalesce(v_seg->'sub_skills', '[]'::jsonb),
                 'clusters',   coalesce(v_seg->'clusters', '[]'::jsonb));

    -- Unchanged span and tag sets keep the approval; anything else clears it.
    SELECT s.segment_id,
           s.end_seconds = v_end
           AND (SELECT coalesce(array_agg(t.sub_skill_id ORDER BY t.sub_skill_id), '{}')
                FROM public.video_segment_sub_skills t WHERE t.segment_id = s.segment_id)
             = (SELECT coalesce(array_agg(x->>'id' ORDER BY x->>'id'), '{}')
                FROM jsonb_array_elements(v_seg->'sub_skills') x)
           AND (SELECT coalesce(array_agg(t.cluster_id ORDER BY t.cluster_id), '{}')
                FROM public.video_segment_clusters t WHERE t.segment_id = s.segment_id)
             = (SELECT coalesce(array_agg(x->>'id' ORDER BY x->>'id'), '{}')
                FROM jsonb_array_elements(v_seg->'clusters') x)
      INTO v_id, v_same
    FROM public.video_segments s
    WHERE s.video_id = p_video_id AND s.start_seconds = v_start;

    IF v_id IS NULL THEN
      INSERT INTO public.video_segments
        (video_id, start_seconds, end_seconds, summary, taxonomy_version, tagged_by)
      VALUES (p_video_id, v_start, v_end, v_seg->>'summary', p_taxonomy_version, p_tagged_by)
      RETURNING segment_id INTO v_id;
    ELSE
      UPDATE public.video_segments SET
        end_seconds      = v_end,
        summary          = v_seg->>'summary',
        taxonomy_version = p_taxonomy_version,
        tagged_by        = p_tagged_by,
        tagged_at        = now(),
        approved_by      = CASE WHEN v_same THEN approved_by END,
        approved_at      = CASE WHEN v_same THEN approved_at END
      WHERE segment_id = v_id;
      DELETE FROM public.video_segment_sub_skills WHERE segment_id = v_id;
      DELETE FROM public.video_segment_clusters WHERE segment_id = v_id;
    END IF;

    INSERT INTO public.video_segment_sub_skills (segment_id, sub_skill_id, evidence, taxonomy_version)
    SELECT v_id, x->>'id', x->>'evidence', p_taxonomy_version
    FROM jsonb_array_elements(v_seg->'sub_skills') x;
    INSERT INTO public.video_segment_clusters (segment_id, cluster_id, evidence, taxonomy_version)
    SELECT v_id, x->>'id', x->>'evidence', p_taxonomy_version
    FROM jsonb_array_elements(v_seg->'clusters') x;

    v_ids := v_ids || v_id;
    v_id := NULL;
  END LOOP;

  RETURN v_ids;
END
$fn$;

REVOKE ALL ON FUNCTION public.video_segments_set(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_segments_set(text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. video_segments_approve — Karl's review, applied
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.video_segments_approve(p_segment_ids uuid[], p_approver uuid)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH done AS (
    UPDATE public.video_segments s
       SET approved_by = p_approver, approved_at = now()
     WHERE s.segment_id = ANY (p_segment_ids)
       AND p_approver IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.video_segment_sub_skills t WHERE t.segment_id = s.segment_id)
            OR EXISTS (SELECT 1 FROM public.video_segment_clusters t WHERE t.segment_id = s.segment_id))
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$fn$;

REVOKE ALL ON FUNCTION public.video_segments_approve(uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_segments_approve(uuid[], uuid) TO service_role;

-- ===========================================================================
-- DOWN MIGRATION (by hand, in this order; nothing else references these objects):
--
--   DROP FUNCTION IF EXISTS public.video_segments_approve(uuid[], uuid);
--   DROP FUNCTION IF EXISTS public.video_segments_set(text, text, text, jsonb);
--   DROP TABLE IF EXISTS public.video_segment_clusters;
--   DROP TABLE IF EXISTS public.video_segment_sub_skills;
--   DROP TABLE IF EXISTS public.video_segments;
--
-- The segments and their approvals are lost with the tables; video_resources, sub_skills and
-- clusters are untouched (the foreign keys point from these tables, never into them).
-- ===========================================================================
