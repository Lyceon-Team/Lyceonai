-- ===========================================================================
-- Smart landing: the within-student rotating landing test.
--
-- @spec [owner brief "Smart landing: within-student rotating landing test" (Karl, 2026-10-26),
--       "Assignment" and "Data" (table `landing_windows (profile_id, window_index, arm,
--       eligible_arms, assigned_at, device_class)`; RLS; deletion cascade; grants checked as
--       service_role); Karl's rulings on Step 0 the same day: A (the first open of the
--       America/Chicago day within the window), B (`fallback_reason`), C (round 1 arms and the
--       1/3 dashboard share; calendar_today held), D (a nightly `landing_session_summary` job;
--       under-13 and unknown age never stored), E (behind the runtime-config kill switch);
--       Doc-01A_V1.0 §24 (values live in the service's `*_runtime_config` table)]
--       | @implemented [2026-10-26]
--
-- plain English:
--  1. `landing_windows`: one row per (student, 48-hour window) the first time the student opens
--     the app in that window: the arm, the eligible arms it was drawn from (frozen then), when,
--     and the coarse device class. Never updated.
--  2. `landing_shows`: one row per landing actually shown: the first open of each Chicago day
--     within the window (ruling A). Carries `fallback_reason` when the arm could not be served and
--     Home was shown (ruling B), `escaped_at` when the student went Home within 30 s, and
--     `summarized_at` once the nightly job has sent its `landing_session_summary`.
--  3. `landing_claim_open(...)` does both inserts atomically: it keeps the window's FIRST arm
--     (a concurrent second open cannot change it) and returns a show only if this is the first
--     open of that Chicago day in the window; otherwise it returns no row and the student stays
--     on Home.
--  4. `landing_record_escape(...)` sets `escaped_at` once, only within `p_max_seconds` of the
--     show, measured by the server's clock (never the client's).
--  5. `landing_claim_summaries(...)` claims the shows whose Chicago day is over, with
--     `questions_answered`: the practice and review items the student answered from the show
--     until their next show or the end of that Chicago day, whichever is first.
--  6. Four `practice_runtime_config` keys: the kill switch (seeded OFF: Karl turns the rotation on
--     with one UPDATE, and off the same way; every server sees it within the cache TTL), the
--     dashboard share (1/3), the arm weights (calendar_today 0 = held for round 2) and the salt.
--
-- Deletion: both tables cascade from profiles (and shows from their window).
-- Grants: service_role only; RLS on with no policies, so clients can read nothing.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   UPDATE public.rate_limit_runtime_config SET value = value - 'landing_student'
--     WHERE key = 'bucket_definitions';
--   DELETE FROM public.practice_runtime_config WHERE key IN ('landing_rotation_enabled',
--     'landing_dashboard_share', 'landing_arm_weights', 'landing_salt');
--   DELETE FROM public.caching_runtime_config WHERE key = 'landing_config_cache_ttl_seconds';
--   DROP FUNCTION IF EXISTS public.landing_claim_summaries(timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.landing_record_escape(uuid, uuid, timestamptz, integer);
--   DROP FUNCTION IF EXISTS public.landing_claim_open(uuid, integer, text, text[], text, timestamptz);
--   DROP TABLE IF EXISTS public.landing_shows;
--   DROP TABLE IF EXISTS public.landing_windows;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. landing_windows
-- ---------------------------------------------------------------------------
CREATE TABLE public.landing_windows (
  profile_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_index  integer     NOT NULL CHECK (window_index >= 0),
  arm           text        NOT NULL CHECK (arm IN ('dashboard', 'qotd_then_more', 'set_mixed',
                                                    'set_math_first', 'calendar_today',
                                                    'session_today', 'plan_builder')),
  eligible_arms text[]      NOT NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  device_class  text        NOT NULL CHECK (device_class IN ('phone', 'tablet', 'desktop')),
  PRIMARY KEY (profile_id, window_index),
  CONSTRAINT landing_windows_arm_is_eligible CHECK (arm = ANY (eligible_arms)),
  CONSTRAINT landing_windows_eligible_known CHECK (
    eligible_arms <@ ARRAY['dashboard', 'qotd_then_more', 'set_mixed', 'set_math_first',
                           'calendar_today', 'session_today', 'plan_builder']::text[]
    AND 'dashboard' = ANY (eligible_arms)
  )
);

-- ---------------------------------------------------------------------------
-- 2. landing_shows
-- ---------------------------------------------------------------------------
CREATE TABLE public.landing_shows (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_index    integer     NOT NULL,
  chicago_day     date        NOT NULL,
  shown_at        timestamptz NOT NULL,
  arm             text        NOT NULL,
  device_class    text        NOT NULL CHECK (device_class IN ('phone', 'tablet', 'desktop')),
  fallback_reason text        CHECK (fallback_reason IN ('quota_exhausted', 'session_limit',
                                                         'no_questions', 'qotd_unavailable',
                                                         'no_block_today', 'not_entitled',
                                                         'error')),
  escaped_at      timestamptz,
  summarized_at   timestamptz,
  CONSTRAINT landing_shows_one_per_day UNIQUE (profile_id, window_index, chicago_day),
  CONSTRAINT landing_shows_window_fk FOREIGN KEY (profile_id, window_index)
    REFERENCES public.landing_windows (profile_id, window_index) ON DELETE CASCADE
);

-- The nightly job's scan: shows not yet summarised.
CREATE INDEX landing_shows_unsummarized_idx
  ON public.landing_shows (chicago_day)
  WHERE summarized_at IS NULL;

ALTER TABLE public.landing_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_shows   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.landing_windows, public.landing_shows
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.landing_windows TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.landing_shows TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The claim: first open of the Chicago day within the window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landing_claim_open(
  p_profile_id    uuid,
  p_window_index  integer,
  p_arm           text,
  p_eligible_arms text[],
  p_device_class  text,
  p_now           timestamptz
) RETURNS TABLE (show_id uuid, arm text, eligible_arms text[], first_in_window boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_first   boolean;
  v_arm     text;
  v_elig    text[];
  v_show_id uuid;
BEGIN
  INSERT INTO public.landing_windows
    (profile_id, window_index, arm, eligible_arms, assigned_at, device_class)
  VALUES (p_profile_id, p_window_index, p_arm, p_eligible_arms, p_now, p_device_class)
  ON CONFLICT (profile_id, window_index) DO NOTHING;
  v_first := FOUND;

  -- The window's stored arm wins: a second open (or a racing one) never re-draws.
  SELECT w.arm, w.eligible_arms INTO v_arm, v_elig
    FROM public.landing_windows w
   WHERE w.profile_id = p_profile_id AND w.window_index = p_window_index;

  INSERT INTO public.landing_shows
    (profile_id, window_index, chicago_day, shown_at, arm, device_class)
  VALUES (p_profile_id, p_window_index, public.chicago_day(p_now), p_now, v_arm, p_device_class)
  ON CONFLICT (profile_id, window_index, chicago_day) DO NOTHING
  RETURNING id INTO v_show_id;

  IF v_show_id IS NULL THEN
    RETURN;  -- already shown this Chicago day in this window: no landing
  END IF;
  RETURN QUERY SELECT v_show_id, v_arm, v_elig, v_first;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The escape: went Home within p_max_seconds of the show (server clock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landing_record_escape(
  p_show_id     uuid,
  p_profile_id  uuid,
  p_now         timestamptz,
  p_max_seconds integer
) RETURNS TABLE (window_index integer, arm text, device_class text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.landing_shows s
     SET escaped_at = p_now
   WHERE s.id = p_show_id
     AND s.profile_id = p_profile_id
     AND s.escaped_at IS NULL
     AND s.arm <> 'dashboard'
     AND s.fallback_reason IS NULL
     AND p_now >= s.shown_at
     AND p_now <= s.shown_at + make_interval(secs => p_max_seconds)
  RETURNING s.window_index, s.arm, s.device_class;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The nightly summary claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.landing_claim_summaries(
  p_now   timestamptz,
  p_limit integer
) RETURNS TABLE (
  show_id            uuid,
  profile_id         uuid,
  window_index       integer,
  arm                text,
  device_class       text,
  questions_answered integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH due AS (
    SELECT s.id
      FROM public.landing_shows s
     WHERE s.summarized_at IS NULL
       AND s.chicago_day < public.chicago_day(p_now)
     ORDER BY s.chicago_day, s.id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.landing_shows s
       SET summarized_at = p_now
      FROM due
     WHERE s.id = due.id
    RETURNING s.id, s.profile_id, s.window_index, s.arm, s.device_class, s.shown_at,
              s.chicago_day
  ), bounded AS (
    SELECT c.*,
           LEAST(
             COALESCE((SELECT min(n.shown_at) FROM public.landing_shows n
                        WHERE n.profile_id = c.profile_id AND n.shown_at > c.shown_at),
                      'infinity'::timestamptz),
             ((c.chicago_day + 1)::timestamp AT TIME ZONE 'America/Chicago')
           ) AS ends_at
      FROM claimed c
  )
  SELECT b.id, b.profile_id, b.window_index, b.arm, b.device_class,
         ((SELECT count(*) FROM public.practice_session_items i
            WHERE i.user_id = b.profile_id AND i.status = 'answered'
              AND i.answered_at >= b.shown_at AND i.answered_at < b.ends_at)
          + (SELECT count(*) FROM public.review_session_items r
              WHERE r.student_id = b.profile_id AND r.status = 'answered'
                AND r.answered_at >= b.shown_at AND r.answered_at < b.ends_at))::integer
    FROM bounded b;
$fn$;

REVOKE ALL ON FUNCTION public.landing_claim_open(uuid, integer, text, text[], text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.landing_record_escape(uuid, uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.landing_claim_summaries(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landing_claim_open(uuid, integer, text, text[], text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.landing_record_escape(uuid, uuid, timestamptz, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.landing_claim_summaries(timestamptz, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Runtime config (ruling E: the kill switch; ruling C: share and weights)
-- ---------------------------------------------------------------------------
INSERT INTO public.practice_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('landing_rotation_enabled', 'false'::jsonb, 'boolean', NULL, NULL, 'product',
   'Smart landing kill switch (Karl, 2026-10-26, ruling E). true = the rotation runs; false = every student lands on Home and nothing is assigned, stored or sent. Seeded OFF; turn on after deploy. Reaches every server within the practice config cache TTL.'),
  ('landing_dashboard_share', '0.3333333333'::jsonb, 'float', '0'::jsonb, '0.99'::jsonb, 'product',
   'Smart landing: the share of assignments that go to dashboard (ruling C: 1/3). The rest is split across the other eligible arms by landing_arm_weights.'),
  ('landing_arm_weights',
   '{"qotd_then_more": 1, "set_mixed": 1, "set_math_first": 1, "session_today": 1, "plan_builder": 1, "calendar_today": 0}'::jsonb,
   'object', NULL, NULL, 'product',
   'Smart landing: relative weights of the non-dashboard arms (ruling C). 0 = never eligible; calendar_today is held for round 2.'),
  ('landing_salt', '"smart-landing-r1"'::jsonb, 'string', NULL, NULL, 'product',
   'Smart landing: the experiment salt in hash(student, window, salt). Changing it re-draws every future window.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.caching_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('landing_config_cache_ttl_seconds', '60'::jsonb, 'integer', '10'::jsonb, '600'::jsonb,
   'Engineering',
   'In-process TTL for the smart landing practice_runtime_config landing_* read (server/services/landing/landing-config.ts). Owner brief "Smart landing", 2026-10-26, ruling E.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. One rate-limit bucket for the three landing routes (open, escape, more)
-- ---------------------------------------------------------------------------
UPDATE public.rate_limit_runtime_config
SET value = value || jsonb_build_object(
      'landing_student', jsonb_build_object('limit', 120, 'window_seconds', 3600)
    ),
    updated_at = now()
WHERE key = 'bucket_definitions';

DO $rl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rate_limit_runtime_config
     WHERE key = 'bucket_definitions' AND value ? 'landing_student'
  ) THEN
    RAISE EXCEPTION 'smart landing migration: bucket_definitions row missing; landing_student was not seeded';
  END IF;
END
$rl$;

COMMIT;
