-- ===========================================================================
-- LISA video library — retrieval by segment (Phase C)
-- ===========================================================================
-- @spec [Doc-03D_V1.2 §6.4 as amended by SCL-260; §6.8 as amended by SCL-261; owner brief
--       "Phase C: retrieval switch-over", Karl 2026-10-29 (rulings Q3, Q4, Q6 revised);
--       docs/plans/lisa-video-library/segments-phase-a.md §4] | @implemented [2026-10-29]
--
-- OWNER-RUN. Karl applies to production by hand. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English: a question the questions team has tagged with sub-skills
-- (`question_sub_skills`) is now matched to the approved SEGMENT of a library video that
-- teaches what the question asks, and playback starts at that segment. One function, one
-- statement, at most 3 rows, read-only:
--
--   video_segments_for_question(question_id, skill_codes, limit, method, method_required,
--                               format_priority)
--
--  - Candidates: approved segments of approved, `available` videos whose `skill_codes` overlap
--    the question's (the skill gate stays a WHERE), sharing at least one sub-skill with the
--    question. No taxonomy-version comparison (ruling Q6, revised): the foreign keys guarantee
--    every tag id exists in the one vocabulary.
--  - One segment per video (its best), then the videos, ordered by ruling Q3:
--      1. shared sub-skills (more first);
--      2. the requested method (a video-level tag, `video_resources.methods`);
--      3. shared clusters, counting a cluster whose `method_in` names one of the question's
--         skills as present on both sides (it is never stored as a tag; absence is not
--         evidence it is unused);
--      4. format priority — passed in as `p_format_priority` from the one definition
--         (packages/shared/src/video-methods.ts `VIDEO_FORMAT_PRIORITY`), so this statement
--         holds no copy of the format vocabulary;
--      5. segment length (shorter first); 6. video_id. Within a video, ties fall to the earlier
--         segment, so the row chosen is deterministic.
--  - `p_method_required` (the Desmos tap, ruling Q3): only videos tagged with `p_method` are
--    candidates, so the tap gets a Desmos segment whenever one exists, even when an algebraic
--    segment shares more sub-skills or clusters. Without it, the method is a preference only.
--  - The row's `start_seconds` is the SEGMENT's start: the same field the player already uses,
--    so no wire or client change. It also returns `segment_id`, the shared sub-skill ids and
--    the shared-cluster count, for the `video_retrieval` timing block (ids and counts only).
--  - No row is the answer (ruling Q4): the caller serves no video and logs the miss. It never
--    falls back to the skill-only ranking for a tagged question; that is how a FOIL short got
--    served for rational expressions.
--
-- Not changed: `video_resources_for_skills` (the untagged path) is untouched, byte for byte.
-- The BFF decides which to call (server/services/tutor-video-library.ts): a question with any
-- `question_sub_skills` row takes this function, every other question the old one.
--
-- No table, no column, no data change. No student, guardian or conversation id is read or
-- returned. SECURITY INVOKER; service_role only, like the function it sits beside.
-- ===========================================================================

CREATE FUNCTION public.video_segments_for_question(
  p_question_id     text,
  p_skill_codes     text[],
  p_limit           integer,
  p_method          text,
  p_method_required boolean,
  p_format_priority text[]
)
RETURNS TABLE (
  video_id           text,
  title              text,
  channel_name       text,
  duration_seconds   integer,
  start_seconds      integer,
  methods            text[],
  format             text,
  segment_id         uuid,
  matched_sub_skills text[],
  shared_clusters    integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH q_sub AS (
    SELECT qs.sub_skill_id FROM public.question_sub_skills qs WHERE qs.question_id = p_question_id
  ),
  -- method_in clusters of the question's skills: present on both sides by default.
  defaults AS (
    SELECT c.id FROM public.clusters c WHERE c.method_in ?| p_skill_codes
  ),
  q_cl AS (
    SELECT qc.cluster_id AS id FROM public.question_clusters qc WHERE qc.question_id = p_question_id
    UNION
    SELECT d.id FROM defaults d
  ),
  candidates AS (
    SELECT v.video_id, v.title, v.channel_name, v.duration_seconds, s.start_seconds,
           v.methods, v.format, s.segment_id,
           s.end_seconds - s.start_seconds AS seg_len,
           m.matched,
           (SELECT count(*)::integer
              FROM (SELECT sc.cluster_id AS id FROM public.video_segment_clusters sc
                     WHERE sc.segment_id = s.segment_id
                    UNION
                    SELECT d.id FROM defaults d) seg_cl
             WHERE seg_cl.id IN (SELECT id FROM q_cl)) AS shared
    FROM public.video_segments s
    JOIN public.video_resources v ON v.video_id = s.video_id
    CROSS JOIN LATERAL (
      SELECT array_agg(t.sub_skill_id ORDER BY t.sub_skill_id) AS matched
      FROM public.video_segment_sub_skills t
      WHERE t.segment_id = s.segment_id
        AND t.sub_skill_id IN (SELECT sub_skill_id FROM q_sub)
    ) m
    WHERE s.approved_by IS NOT NULL                                -- approved segments only
      AND v.status = 'available'
      AND v.approved_by IS NOT NULL
      AND v.skill_codes && p_skill_codes                           -- skill gate, required
      AND m.matched IS NOT NULL                                    -- shares a sub-skill
      AND (NOT coalesce(p_method_required, false)
           OR (p_method IS NOT NULL AND p_method = ANY (v.methods)))
  ),
  best_per_video AS (
    SELECT DISTINCT ON (c.video_id) c.*
    FROM candidates c
    ORDER BY c.video_id, cardinality(c.matched) DESC, c.shared DESC, c.seg_len, c.start_seconds
  )
  SELECT b.video_id, b.title, b.channel_name, b.duration_seconds, b.start_seconds,
         b.methods, b.format, b.segment_id, b.matched, b.shared
  FROM best_per_video b
  ORDER BY
    cardinality(b.matched) DESC,                                     -- 1. shared sub-skills
    (p_method IS NOT NULL AND p_method = ANY (b.methods)) DESC,      -- 2. the method asked for
    b.shared DESC,                                                   -- 3. shared clusters
    array_position(p_format_priority, b.format) NULLS LAST,          -- 4. format priority
    b.seg_len,                                                       -- 5. segment length
    b.video_id                                                       -- 6. stable
  LIMIT greatest(1, least(coalesce(p_limit, 3), 3));
$fn$;

REVOKE ALL ON FUNCTION public.video_segments_for_question(text, text[], integer, text, boolean, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_segments_for_question(text, text[], integer, text, boolean, text[])
  TO service_role;

-- ===========================================================================
-- DOWN MIGRATION (manual; not run by the pipeline)
-- ===========================================================================
-- Deploy the BFF that no longer calls it first (the previous release calls only
-- video_resources_for_skills), then:
--   DROP FUNCTION public.video_segments_for_question(text, text[], integer, text, boolean, text[]);
-- Nothing else to undo: no table, column or row was created.
