-- ============================================================================
-- Server-side funnel events: the once-per-student ledger
-- ============================================================================
-- @spec [owner brief "Server-side funnel events" (Karl, 2026-10-21): six events, each "fires
--        ONCE per student, ever", "once-only, enforced on the server", "idempotent on retries";
--        Doc 07A V1.0 §9.2 (every event goes through emitEvent)] | @implemented [2026-10-21]
--
-- plain English: one row per (student, milestone) that has been claimed. Before an event is sent
-- the server CLAIMS its milestone with an insert-once (`analytics_funnel_claim` returns true only
-- for the call that inserted the row), so retries, reloads, second sessions and concurrent
-- requests send it at most once. A send that fails for a transient reason RELEASES the claim
-- (`analytics_funnel_release`), so the next qualifying moment can try again; a policy exclusion
-- (under 13, age unknown) keeps it, so it is not re-tried on every answer.
--
-- No content and no identity beyond the profile id this database already holds: the milestone
-- name and when it was claimed. The events themselves carry only the salted analytics_user_id.
--
-- Backfill (below): students who already passed a milestone before this ships get its row now,
-- so the funnel counts only moments that happen from today, and an existing student's next answer
-- is never reported as their "first". The six moments the backfill reads:
--   onboarding_completed  profiles.profile_completed_at is set
--   first_answer          any answered practice_session_items row (QOTD answers included)
--   first_practice        an answered item in a session whose mode is not 'qotd'
--   diagnostic_completed  a completed diagnostic session
--   plan_created          any accepted calendar plan version (calendar_current_plan)
--   upgraded              any premium entitlement row, active or not (they were upgraded before)
--
-- Grants: the functions are SECURITY INVOKER and are called as service_role, so service_role
-- holds SELECT, INSERT and DELETE on the table (the #1248 lesson: tests run them as service_role).
-- Deletion: ON DELETE CASCADE from profiles, the FK guard's declarative rule.
--
-- Mutations: none target an existing function body here; both functions are new.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.analytics_funnel_release(uuid, text);
--   DROP FUNCTION IF EXISTS public.analytics_funnel_claim(uuid, text);
--   DROP TABLE IF EXISTS public.analytics_funnel_milestones;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics_funnel_milestones (
  profile_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  milestone  text        NOT NULL CHECK (milestone IN (
               'onboarding_completed', 'first_answer', 'first_practice',
               'diagnostic_completed', 'plan_created', 'upgraded')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, milestone)
);
COMMENT ON TABLE public.analytics_funnel_milestones IS
  'Server-side funnel events (Karl, 2026-10-21): one row per student per milestone already claimed, so each event is sent at most once ever. Names and timestamps only. Written only by analytics_funnel_claim / analytics_funnel_release. ON DELETE CASCADE from profiles.';

ALTER TABLE public.analytics_funnel_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_funnel_milestones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.analytics_funnel_milestones TO service_role;

-- Insert-once. True only for the call that inserted the row.
CREATE OR REPLACE FUNCTION public.analytics_funnel_claim(p_profile_id uuid, p_milestone text)
RETURNS boolean
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  WITH inserted AS (
    INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
    VALUES (p_profile_id, p_milestone)
    ON CONFLICT (profile_id, milestone) DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM inserted);
$fn$;

-- Undo a claim whose send failed, so a later qualifying moment can try again.
CREATE OR REPLACE FUNCTION public.analytics_funnel_release(p_profile_id uuid, p_milestone text)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  DELETE FROM public.analytics_funnel_milestones
   WHERE profile_id = p_profile_id AND milestone = p_milestone;
$fn$;

REVOKE ALL ON FUNCTION public.analytics_funnel_claim(uuid, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_funnel_release(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_funnel_claim(uuid, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_funnel_release(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill: milestones already passed before this ships are claimed, never sent.
-- ---------------------------------------------------------------------------
INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT p.id, 'onboarding_completed' FROM public.profiles p
 WHERE p.profile_completed_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT DISTINCT i.user_id, 'first_answer'
  FROM public.practice_session_items i
  JOIN public.profiles p ON p.id = i.user_id
 WHERE i.status = 'answered'
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT DISTINCT i.user_id, 'first_practice'
  FROM public.practice_session_items i
  JOIN public.practice_sessions ps ON ps.id = i.session_id
  JOIN public.profiles p ON p.id = i.user_id
 WHERE i.status = 'answered' AND ps.mode <> 'qotd'
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT DISTINCT ps.user_id, 'diagnostic_completed'
  FROM public.practice_sessions ps
  JOIN public.profiles p ON p.id = ps.user_id
 WHERE ps.mode = 'diagnostic' AND ps.status = 'completed'
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT DISTINCT c.student_id, 'plan_created'
  FROM public.calendar_current_plan c
  JOIN public.profiles p ON p.id = c.student_id
ON CONFLICT DO NOTHING;

INSERT INTO public.analytics_funnel_milestones (profile_id, milestone)
SELECT DISTINCT e.profile_id, 'upgraded'
  FROM public.entitlements e
  JOIN public.profiles p ON p.id = e.profile_id
 WHERE e.tier = 'premium'
ON CONFLICT DO NOTHING;

COMMIT;
