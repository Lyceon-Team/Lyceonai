-- ===========================================================================
-- LISA video library: extend video_resources with per-video skill tags, approval and a
-- chapter start; the one retrieval query.
--
-- @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §3 (extend video_resources,
--       do not create a second table), §4 (tagging), §5 (no row approved without approved_by;
--       retrieval returns approved rows only), §6 (one query: skill filter in the statement,
--       deterministic, shortest first); Doc-03D_V1.2 §6.6 as amended by SCL-231 (approved by
--       Karl 2026-10-15)] | @implemented [2026-10-15]
--
-- DO NOT APPLY TO PROD — Karl applies after review.
-- Renumbered 2026-10-22 from 20261104000000, which main's
-- 20261104000000_getting_started_service_role_grants.sql (committed earlier) also holds;
-- migration inventory gate I0. The body is unchanged.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed — see DOWN MIGRATION at the foot.
--
-- plain English:
--  1. `video_resources` (created by 20261101010000, shared with the teaching corpus on purpose)
--     gains: `skill_codes text[] NOT NULL DEFAULT '{}'` (full taxonomy names, as on
--     `questions.skill_codes`; empty = teaches no SAT skill = never offered), `domain` (one of
--     the 8 taxonomy domains, for a coarser fallback), `start_seconds` (a chapter start, else
--     null), `tagged_by` / `tagged_at`, `approved_by` / `approved_at`, and a GIN index on
--     `skill_codes`. The default keeps the corpus pipeline's writer (embed-and-upsert.ts),
--     which inserts rows without tags, valid: its rows are simply not offered until tagged.
--  2. CHECKs: each pair is set together; a row can be approved only with at least one tag;
--     `start_seconds` lies inside the video.
--  3. `video_resource_tag(...)`: the one tagging writer. Upserts the video's facts and tags.
--     A re-tag that changes the skills, domain or start CLEARS the approval, so a changed tag
--     set is never live on an old review. It never touches `status`.
--  4. `video_resources_approve(video_ids, approver)`: Karl's review applied. Approves only rows
--     that have tags; returns how many it approved.
--  5. `video_resources_for_skills(skills, limit)`: THE retrieval query (brief §6): available,
--     approved, `skill_codes && skills` in the statement, ordered shortest first then video_id
--     (stable), limit clamped 1..3. All three functions are SECURITY INVOKER, service role only.
--
-- trade-offs: `status` keeps the vocabulary it was created with ('available' | 'unavailable',
--  production since 2026-10-15); the brief's `status = 'active'` is written as 'available'.
-- ===========================================================================

ALTER TABLE public.video_resources
  ADD COLUMN skill_codes   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN domain        text,
  ADD COLUMN start_seconds integer,
  ADD COLUMN tagged_by     text,
  ADD COLUMN tagged_at     timestamptz,
  ADD COLUMN approved_by   uuid,
  ADD COLUMN approved_at   timestamptz;

ALTER TABLE public.video_resources
  ADD CONSTRAINT video_resources_skills_no_blank
    CHECK (array_position(skill_codes, NULL) IS NULL AND array_position(skill_codes, '') IS NULL),
  ADD CONSTRAINT video_resources_domain_check
    CHECK (domain IS NULL OR domain IN (
      'Algebra', 'Advanced Math', 'Problem Solving and Data Analysis', 'Geometry and Trigonometry',
      'Information and Ideas', 'Craft and Structure', 'Expression of Ideas',
      'Standard English Conventions')),
  ADD CONSTRAINT video_resources_start_check
    CHECK (start_seconds IS NULL OR (start_seconds >= 0 AND start_seconds < duration_seconds)),
  ADD CONSTRAINT video_resources_tagged_pair
    CHECK ((tagged_by IS NULL) = (tagged_at IS NULL)),
  ADD CONSTRAINT video_resources_approved_pair
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  ADD CONSTRAINT video_resources_approved_has_tags
    CHECK (approved_by IS NULL OR cardinality(skill_codes) >= 1);

CREATE INDEX video_resources_skills_idx ON public.video_resources USING gin (skill_codes);

COMMENT ON TABLE public.video_resources IS
  'Per-video facts and skill tags: the LISA video library (offered whole, by skill) and the '
  'render-time join for curriculum_chunks.provenance. Service role only.';

-- ---------------------------------------------------------------------------
-- video_resource_tag — the one tagging writer
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.video_resource_tag(
  p_video_id         text,
  p_title            text,
  p_channel_name     text,
  p_duration_seconds integer,
  p_skill_codes      text[],
  p_domain           text,
  p_start_seconds    integer,
  p_tagged_by        text
) RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.video_resources AS v
    (video_id, title, channel_name, duration_seconds, status, last_checked_at,
     skill_codes, domain, start_seconds, tagged_by, tagged_at)
  VALUES (p_video_id, p_title, p_channel_name, p_duration_seconds, 'available', now(),
          p_skill_codes, p_domain, p_start_seconds, p_tagged_by, now())
  ON CONFLICT (video_id) DO UPDATE SET
    title            = EXCLUDED.title,
    channel_name     = EXCLUDED.channel_name,
    duration_seconds = EXCLUDED.duration_seconds,
    skill_codes      = EXCLUDED.skill_codes,
    domain           = EXCLUDED.domain,
    start_seconds    = EXCLUDED.start_seconds,
    tagged_by        = EXCLUDED.tagged_by,
    tagged_at        = EXCLUDED.tagged_at,
    -- A changed tag set loses its approval; an unchanged one keeps it.
    approved_by = CASE
      WHEN (v.skill_codes, v.domain, v.start_seconds)
           IS NOT DISTINCT FROM (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds)
        THEN v.approved_by ELSE NULL END,
    approved_at = CASE
      WHEN (v.skill_codes, v.domain, v.start_seconds)
           IS NOT DISTINCT FROM (EXCLUDED.skill_codes, EXCLUDED.domain, EXCLUDED.start_seconds)
        THEN v.approved_at ELSE NULL END;
$fn$;

REVOKE ALL ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_resource_tag(text, text, text, integer, text[], text, integer, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- video_resources_approve — Karl's review, applied
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.video_resources_approve(p_video_ids text[], p_approver uuid)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH done AS (
    UPDATE public.video_resources
       SET approved_by = p_approver, approved_at = now()
     WHERE video_id = ANY (p_video_ids)
       AND cardinality(skill_codes) >= 1
       AND p_approver IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$fn$;

REVOKE ALL ON FUNCTION public.video_resources_approve(text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_resources_approve(text[], uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- video_resources_for_skills — THE retrieval query (brief §6, Step 13d)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.video_resources_for_skills(p_skill_codes text[], p_limit integer)
RETURNS TABLE (
  video_id         text,
  title            text,
  channel_name     text,
  duration_seconds integer,
  start_seconds    integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT v.video_id, v.title, v.channel_name, v.duration_seconds, v.start_seconds
  FROM public.video_resources v
  WHERE v.status = 'available'
    AND v.approved_by IS NOT NULL
    AND v.skill_codes && p_skill_codes        -- GIN index: the skill filter, in the statement
  ORDER BY v.duration_seconds, v.video_id     -- shortest first for a stuck student; stable
  LIMIT greatest(1, least(coalesce(p_limit, 3), 3));
$fn$;

REVOKE ALL ON FUNCTION public.video_resources_for_skills(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_resources_for_skills(text[], integer) TO service_role;

-- ===========================================================================
-- DOWN MIGRATION (manual; reviewed). The added columns hold build-time tags and review marks,
-- regenerated by scripts/rag/tag-videos.ts and the review CSV; no student data:
--   DROP FUNCTION IF EXISTS public.video_resources_for_skills(text[], integer);
--   DROP FUNCTION IF EXISTS public.video_resources_approve(text[], uuid);
--   DROP FUNCTION IF EXISTS public.video_resource_tag(text, text, text, integer, text[], text, integer, text);
--   DROP INDEX IF EXISTS public.video_resources_skills_idx;
--   ALTER TABLE public.video_resources
--     DROP CONSTRAINT IF EXISTS video_resources_approved_has_tags,
--     DROP CONSTRAINT IF EXISTS video_resources_approved_pair,
--     DROP CONSTRAINT IF EXISTS video_resources_tagged_pair,
--     DROP CONSTRAINT IF EXISTS video_resources_start_check,
--     DROP CONSTRAINT IF EXISTS video_resources_domain_check,
--     DROP CONSTRAINT IF EXISTS video_resources_skills_no_blank,
--     DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS tagged_at, DROP COLUMN IF EXISTS tagged_by,
--     DROP COLUMN IF EXISTS start_seconds, DROP COLUMN IF EXISTS domain,
--     DROP COLUMN IF EXISTS skill_codes;
-- ===========================================================================
