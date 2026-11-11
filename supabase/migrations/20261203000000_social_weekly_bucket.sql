-- ===========================================================================
-- The private Storage bucket the weekly worked-example batch delivers to.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 6: "One migration creates a
--       private social-weekly bucket: no public read/write policies, a size limit, and allowed
--       types video/mp4 and text/markdown"; the 2026-11-11 answer on the voice cache: the same
--       bucket also allows audio/wav and application/json, for voice-cache/<key>.wav + .json]
--       | @implemented [2026-11-11]
--
-- plain English: one row in storage.buckets. public = false, so nothing is served without a
-- signed URL or the service role; this migration adds NO policy on storage.objects, so no anon or
-- authenticated user can read, list or write it. Only the weekly run (the service-role key, on the
-- scheduled run from main) uploads, signs links (14 days) and reads the voice cache. Layout:
--   social-weekly/<YYYY-Www>/<YYYY-MM-DD>/<id>.mp4 and captions.md
--   social-weekly/voice-cache/<sha256>.wav and .json
-- file_size_limit: 200 MB, far above a 60 s 1080x1920 video (about 3 MB).
--
-- edge cases: idempotent (re-applying resets the settings to these values). Where the storage
-- schema does not exist (the CI Postgres that applies every migration has no Supabase Storage),
-- it does nothing and says so.
--
-- rollback (the bucket's files first, through the Storage API or the dashboard's "Empty bucket":
-- SQL on storage.objects removes metadata, not the stored files):
--   1. empty the social-weekly bucket (dashboard → Storage → social-weekly → Empty bucket);
--   2. DELETE FROM storage.buckets WHERE id = 'social-weekly';
--   The weekly run then fails at its first upload or cache read, loudly; the daily job is untouched.
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'social_weekly_bucket: storage.buckets does not exist here; nothing to do';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'social-weekly',
    'social-weekly',
    false,
    209715200,
    ARRAY['video/mp4', 'text/markdown', 'audio/wav', 'application/json']
  )
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END
$$;
