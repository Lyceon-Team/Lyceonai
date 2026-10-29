-- ===========================================================================
-- LISA video library — method tags, format, and method-ranked retrieval
-- ===========================================================================
-- @spec [Doc-03D_V1.2 §6.7 (metadata schema) and §6.8 (retrieval contract) as amended by the
--       video-method SCLs; owner brief "Video retrieval: method tags", Karl 2026-10-27 (Step 0
--       ruled; format order formula > worked_example > lesson > strategy)] | @implemented [2026-10-27]
--
-- OWNER-RUN. Karl applies to production. DO NOT auto-apply.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English: a student in review asked "can you show me how to do this on desmos" on an
-- Equivalent Expressions item; retrieval (skill only, shortest first) returned three formula
-- shorts, because nothing recorded HOW a video solves. This adds that, as tagged metadata:
--  1. `methods text[] NOT NULL DEFAULT '{}'` on video_resources AND curriculum_chunks, each
--     element from the one vocabulary (packages/shared/src/video-methods.ts VIDEO_METHODS:
--     desmos, algebraic, backsolve). Reading and Writing content carries none.
--  2. `format` on video_resources (VIDEO_FORMATS: worked_example and strategy are
--     curriculum_chunks.content_type values, lesson and formula are new). Nullable: the 85
--     approved rows have none until Karl's apply run writes the reviewed file; a NULL format
--     ranks after every tagged one.
--  3. `video_resource_tag` takes both. A change to methods or format clears the approval, the
--     same as skills, domain and start. The 8-argument form is replaced (one writer).
--  4. `video_resources_for_skills(skills, limit, method)`: one statement, at most 3. Skill
--     match required; then method match when one was asked for; then format priority
--     (VIDEO_FORMAT_PRIORITY); then duration; then video_id, so ties are stable. Returns methods
--     and format so the worker can say which video is which. The 2-argument form stays for the
--     BFF that is live when this is applied; it is dropped once the new BFF is deployed (closure
--     plan row R-17).
--  5. `video_method_keywords` in tutor_context_runtime_config: the versioned keyword map the
--     BFF uses to detect the requested method from the student's current message (no model
--     call). ON CONFLICT DO NOTHING: an operator's edit is never overwritten.
--
-- Order: (1) apply this (the live BFF keeps calling the 2-argument form); (2) deploy the worker
-- (its strict offered_videos schema now accepts optional methods and format); (3) deploy the
-- BFF (it calls the 3-argument form and sends methods and format) — never before the worker,
-- whose older schema would refuse them; (4) apply the reviewed file with --approver: the re-tag
-- clears every approval and the same transaction approves the yes rows again.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1–2. Columns and their CHECKs
-- ---------------------------------------------------------------------------
ALTER TABLE public.video_resources
  ADD COLUMN methods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN format  text;

ALTER TABLE public.video_resources
  ADD CONSTRAINT video_resources_methods_check
    CHECK (methods <@ ARRAY['desmos', 'algebraic', 'backsolve']::text[]
           AND array_position(methods, NULL) IS NULL),
  ADD CONSTRAINT video_resources_format_check
    CHECK (format IS NULL OR format IN ('worked_example', 'formula', 'lesson', 'strategy'));

ALTER TABLE public.curriculum_chunks
  ADD COLUMN methods text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.curriculum_chunks
  ADD CONSTRAINT curriculum_chunks_methods_check
    CHECK (methods <@ ARRAY['desmos', 'algebraic', 'backsolve']::text[]
           AND array_position(methods, NULL) IS NULL);

-- ---------------------------------------------------------------------------
-- 3. video_resource_tag — the one tagging writer, now with methods and format
-- ---------------------------------------------------------------------------
DROP FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text);

CREATE FUNCTION public.video_resource_tag(
  p_video_id         text,
  p_title            text,
  p_channel_name     text,
  p_duration_seconds integer,
  p_skill_codes      text[],
  p_domain           text,
  p_start_seconds    integer,
  p_tagged_by        text,
  p_methods          text[],
  p_format           text
) RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.video_resources AS v
    (video_id, title, channel_name, duration_seconds, status, last_checked_at,
     skill_codes, domain, start_seconds, tagged_by, tagged_at, methods, format)
  VALUES (p_video_id, p_title, p_channel_name, p_duration_seconds, 'available', now(),
          p_skill_codes, p_domain, p_start_seconds, p_tagged_by, now(),
          coalesce(p_methods, '{}'), p_format)
  ON CONFLICT (video_id) DO UPDATE SET
    title            = EXCLUDED.title,
    channel_name     = EXCLUDED.channel_name,
    duration_seconds = EXCLUDED.duration_seconds,
    skill_codes      = EXCLUDED.skill_codes,
    domain           = EXCLUDED.domain,
    start_seconds    = EXCLUDED.start_seconds,
    tagged_by        = EXCLUDED.tagged_by,
    tagged_at        = EXCLUDED.tagged_at,
    methods          = EXCLUDED.methods,
    format           = EXCLUDED.format,
    -- A changed tag set loses its approval; an unchanged one keeps it. Methods and format are
    -- part of the tag set: what Karl approved is what the student is offered.
    approved_by = CASE
      WHEN (v.skill_codes, v.domain, v.start_seconds, v.methods, v.format)
           IS NOT DISTINCT FROM
           (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds, EXCLUDED.methods, EXCLUDED.format)
        THEN v.approved_by ELSE NULL END,
    approved_at = CASE
      WHEN (v.skill_codes, v.domain, v.start_seconds, v.methods, v.format)
           IS NOT DISTINCT FROM
           (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds, EXCLUDED.methods, EXCLUDED.format)
        THEN v.approved_at ELSE NULL END;
$fn$;

REVOKE ALL ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text, text[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text, text[], text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. video_resources_for_skills — THE retrieval query, method-ranked
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.video_resources_for_skills(
  p_skill_codes text[],
  p_limit       integer,
  p_method      text
)
RETURNS TABLE (
  video_id         text,
  title            text,
  channel_name     text,
  duration_seconds integer,
  start_seconds    integer,
  methods          text[],
  format           text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT v.video_id, v.title, v.channel_name, v.duration_seconds, v.start_seconds,
         v.methods, v.format
  FROM public.video_resources v
  WHERE v.status = 'available'
    AND v.approved_by IS NOT NULL
    AND v.skill_codes && p_skill_codes                            -- GIN index: skill match, required
  ORDER BY
    (p_method IS NOT NULL AND p_method = ANY (v.methods)) DESC,   -- the method asked for, first
    array_position(ARRAY['formula', 'worked_example', 'lesson', 'strategy']::text[], v.format)
      NULLS LAST,                                                 -- format priority
    v.duration_seconds,                                           -- then shortest
    v.video_id                                                    -- stable
  LIMIT greatest(1, least(coalesce(p_limit, 3), 3));
$fn$;

REVOKE ALL ON FUNCTION public.video_resources_for_skills(text[], integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_resources_for_skills(text[], integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The keyword map (version 1)
-- ---------------------------------------------------------------------------
INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
VALUES (
  'video_method_keywords',
  $json${
    "version": 1,
    "methods": {
      "desmos": ["desmos", "desmo", "graphing calculator", "calculator", "graph it", "graph this", "graph them"],
      "algebraic": ["algebraically", "with algebra", "using algebra", "by hand", "on paper", "manually",
                    "without a calculator", "without the calculator", "without desmos", "no calculator"],
      "backsolve": ["backsolve", "back solve", "backsolving", "plug in", "plugging in", "plug in the answers",
                    "plug in the answer choices", "test the answers", "try the answer choices",
                    "work backwards", "working backwards", "pick numbers", "picking numbers"]
    }
  }$json$::jsonb,
  'object',
  'engineering',
  'Video retrieval (owner brief 2026-10-27): phrases that name a way of solving, matched whole-word against the student''s current message; the longest matching phrase wins. Versioned; the version is recorded in route_timing.'
)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- DOWN MIGRATION (by hand, in this order; restores 20261104010000's state exactly):
--
--   DELETE FROM public.tutor_context_runtime_config WHERE key = 'video_method_keywords';
--   DROP FUNCTION IF EXISTS public.video_resources_for_skills(text[], integer, text);
--   DROP FUNCTION IF EXISTS public.video_resource_tag(text, text, text, integer, text[], text, integer, text, text[], text);
--   CREATE FUNCTION public.video_resource_tag(
--     p_video_id text, p_title text, p_channel_name text, p_duration_seconds integer,
--     p_skill_codes text[], p_domain text, p_start_seconds integer, p_tagged_by text
--   ) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
--     INSERT INTO public.video_resources AS v
--       (video_id, title, channel_name, duration_seconds, status, last_checked_at,
--        skill_codes, domain, start_seconds, tagged_by, tagged_at)
--     VALUES (p_video_id, p_title, p_channel_name, p_duration_seconds, 'available', now(),
--             p_skill_codes, p_domain, p_start_seconds, p_tagged_by, now())
--     ON CONFLICT (video_id) DO UPDATE SET
--       title = EXCLUDED.title, channel_name = EXCLUDED.channel_name,
--       duration_seconds = EXCLUDED.duration_seconds, skill_codes = EXCLUDED.skill_codes,
--       domain = EXCLUDED.domain, start_seconds = EXCLUDED.start_seconds,
--       tagged_by = EXCLUDED.tagged_by, tagged_at = EXCLUDED.tagged_at,
--       approved_by = CASE WHEN (v.skill_codes, v.domain, v.start_seconds)
--         IS NOT DISTINCT FROM (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds)
--         THEN v.approved_by ELSE NULL END,
--       approved_at = CASE WHEN (v.skill_codes, v.domain, v.start_seconds)
--         IS NOT DISTINCT FROM (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds)
--         THEN v.approved_at ELSE NULL END;
--   $fn$;
--   REVOKE ALL ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text)
--     FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text)
--     TO service_role;
--   ALTER TABLE public.curriculum_chunks
--     DROP CONSTRAINT IF EXISTS curriculum_chunks_methods_check, DROP COLUMN IF EXISTS methods;
--   ALTER TABLE public.video_resources
--     DROP CONSTRAINT IF EXISTS video_resources_format_check,
--     DROP CONSTRAINT IF EXISTS video_resources_methods_check,
--     DROP COLUMN IF EXISTS format, DROP COLUMN IF EXISTS methods;
--
-- Approvals made while the new columns existed survive the rollback (approved_by/approved_at
-- are not touched); methods and format values are lost with their columns.
-- ===========================================================================
