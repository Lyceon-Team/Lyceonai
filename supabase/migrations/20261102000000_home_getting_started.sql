-- ============================================================================
-- Home "Getting started" checklist — per-student state
-- ============================================================================
-- @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
--        brief v2, Karl, 2026-10-13) §2 steps, §3 completion rules, §8 storage; mocks v2
--        approved 2026-10-13] | @implemented [2026-10-13]
--
-- plain English: one row per student holding what the checklist must REMEMBER rather than
-- re-derive:
--   * the first time each step was reached (`*_done_at`). Completion is sticky: a step never
--     un-ticks, e.g. when a LISA conversation is deleted and the 7-day sweep removes its
--     messages, or a student opts out of the email later;
--   * "Not sure yet" for the SAT date and for the target score. Until now "Not sure yet" saved
--     an empty date list, which cannot be told apart from "never asked"; the choice is recorded
--     here (the date and score themselves stay in `student_study_profile`);
--   * "Not now" on the email step (`email_skipped_at`), which counts toward finishing;
--   * when the finished card was dismissed.
--
-- `getting_started_observe` derives every step from the real data and latches the ones reached
-- for the first time. Clicks never tick a step: the only writes that are not derived are the two
-- "Not sure yet" answers, "Not now" and Dismiss, each an explicit student answer. Which steps a
-- student SEES (free vs Pro, who can opt in to email, who can use LISA) is the server's decision
-- from the plan; this table records all eight, so an upgrade later finds the Pro steps true.
--
-- Trade-offs: the latch happens on read (the Home load), not by triggers on eight source tables
-- (Karl's ruling 2026-10-12 against bespoke trigger infrastructure). A step reached and undone
-- before the student next opens Home is not latched; that is the "first time reached" the
-- server can observe.
--
-- Deletion: ON DELETE CASCADE from profiles, the FK guard's declarative rule
-- (scripts/ci/fk-delete-action-guard.sql). Timestamps only; no content.
--
-- Mutations: none target an existing function body here; every function is new.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.getting_started_dismiss(uuid);
--   DROP FUNCTION IF EXISTS public.getting_started_skip_email(uuid);
--   DROP FUNCTION IF EXISTS public.getting_started_record_not_sure(uuid, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.getting_started_observe(uuid);
--   DROP TABLE IF EXISTS public.student_getting_started_state;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.student_getting_started_state (
  profile_id               uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_date_not_sure_at    timestamptz NULL,
  target_score_not_sure_at timestamptz NULL,
  email_skipped_at         timestamptz NULL,
  test_date_done_at        timestamptz NULL,
  qotd_done_at             timestamptz NULL,
  email_done_at            timestamptz NULL,
  blind_spots_done_at      timestamptz NULL,
  review_done_at           timestamptz NULL,
  calendar_done_at         timestamptz NULL,
  lisa_done_at             timestamptz NULL,
  guardian_done_at         timestamptz NULL,
  dismissed_at             timestamptz NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.student_getting_started_state IS
  'Home "Getting started" checklist (owner brief v2, 2026-10-13): sticky first-reached time per step, the recorded "Not sure yet" for SAT date and target score, "Not now" on the email step, and the dismissal. Written only by the getting_started_* functions. ON DELETE CASCADE from profiles.';

ALTER TABLE public.student_getting_started_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_getting_started_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.student_getting_started_state TO service_role;

-- Derive every step from the student's real data, latch the ones reached for the first time,
-- and return the stored state with the fact the server needs for email visibility.
CREATE OR REPLACE FUNCTION public.getting_started_observe(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pref      jsonb;
  v_test_date boolean;
  v_qotd      boolean;
  v_blind     boolean;
  v_review    boolean;
  v_calendar  boolean;
  v_lisa      boolean;
  v_guardian  boolean;
  v_row       public.student_getting_started_state;
BEGIN
  INSERT INTO public.student_getting_started_state (profile_id)
  VALUES (p_profile_id)
  ON CONFLICT (profile_id) DO NOTHING;

  -- Step 1: a SAT date (any saved date, past or future) or "Not sure yet", AND a target score
  -- or "Not sure yet".
  SELECT ( COALESCE(cardinality(sp.target_exam_dates), 0) > 0
           OR s.test_date_not_sure_at IS NOT NULL )
     AND ( sp.target_score IS NOT NULL
           OR s.target_score_not_sure_at IS NOT NULL )
    INTO v_test_date
    FROM public.student_getting_started_state s
    LEFT JOIN public.student_study_profile sp ON sp.student_id = s.profile_id
   WHERE s.profile_id = p_profile_id;

  -- Step 2: any Question of the Day answer.
  v_qotd := EXISTS (
    SELECT 1 FROM public.student_qotd_attempts a WHERE a.student_id = p_profile_id);

  -- Step 3: opted in to the daily email, read through the one canonical preference function.
  v_pref := public.qotd_daily_email_preference(p_profile_id);

  -- Step 4: the diagnostic or any answered practice item. Question of the Day answers are
  -- practice items (mode 'qotd', SCL-224), so they count here too.
  v_blind := EXISTS (
    SELECT 1 FROM public.practice_session_items i
     WHERE i.user_id = p_profile_id AND i.status = 'answered');

  -- Step 5: a review session exists.
  v_review := EXISTS (
    SELECT 1 FROM public.review_sessions r WHERE r.student_id = p_profile_id);

  -- Step 6: a study plan exists.
  v_calendar := EXISTS (
    SELECT 1 FROM public.calendar_current_plan c WHERE c.student_id = p_profile_id);

  -- Step 7: the student has sent LISA a message. Presence only; the message is never read.
  v_lisa := EXISTS (
    SELECT 1 FROM public.tutor_messages m
     WHERE m.student_id = p_profile_id AND m.role = 'student' AND m.content_kind = 'message');

  -- Step 8: an active guardian link.
  v_guardian := EXISTS (
    SELECT 1 FROM public.guardian_links g
     WHERE g.student_profile_id = p_profile_id AND g.status = 'active');

  UPDATE public.student_getting_started_state s
     SET test_date_done_at   = COALESCE(s.test_date_done_at,   CASE WHEN COALESCE(v_test_date, false) THEN now() END),
         qotd_done_at        = COALESCE(s.qotd_done_at,        CASE WHEN v_qotd THEN now() END),
         email_done_at       = COALESCE(s.email_done_at,       CASE WHEN COALESCE((v_pref ->> 'enabled')::boolean, false) THEN now() END),
         blind_spots_done_at = COALESCE(s.blind_spots_done_at, CASE WHEN v_blind THEN now() END),
         review_done_at      = COALESCE(s.review_done_at,      CASE WHEN v_review THEN now() END),
         calendar_done_at    = COALESCE(s.calendar_done_at,    CASE WHEN v_calendar THEN now() END),
         lisa_done_at        = COALESCE(s.lisa_done_at,        CASE WHEN v_lisa THEN now() END),
         guardian_done_at    = COALESCE(s.guardian_done_at,    CASE WHEN v_guardian THEN now() END),
         updated_at          = now()
   WHERE s.profile_id = p_profile_id
  RETURNING s.* INTO v_row;

  RETURN jsonb_build_object(
    'email_eligible',   COALESCE((v_pref ->> 'eligible')::boolean, false),
    'test_date_done',   v_row.test_date_done_at   IS NOT NULL,
    'qotd_done',        v_row.qotd_done_at        IS NOT NULL,
    'email_done',       v_row.email_done_at       IS NOT NULL,
    'email_skipped',    v_row.email_skipped_at    IS NOT NULL,
    'blind_spots_done', v_row.blind_spots_done_at IS NOT NULL,
    'review_done',      v_row.review_done_at      IS NOT NULL,
    'calendar_done',    v_row.calendar_done_at    IS NOT NULL,
    'lisa_done',        v_row.lisa_done_at        IS NOT NULL,
    'guardian_done',    v_row.guardian_done_at    IS NOT NULL,
    'dismissed',        v_row.dismissed_at        IS NOT NULL);
END;
$fn$;

-- "Not sure yet" for the SAT date and/or the target score. Idempotent: the first answer's time
-- is kept.
CREATE OR REPLACE FUNCTION public.getting_started_record_not_sure(
  p_profile_id   uuid,
  p_test_date    boolean,
  p_target_score boolean
)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.student_getting_started_state AS s
         (profile_id, test_date_not_sure_at, target_score_not_sure_at)
  VALUES (p_profile_id,
          CASE WHEN p_test_date    THEN now() END,
          CASE WHEN p_target_score THEN now() END)
  ON CONFLICT (profile_id) DO UPDATE
     SET test_date_not_sure_at    = COALESCE(s.test_date_not_sure_at,    EXCLUDED.test_date_not_sure_at),
         target_score_not_sure_at = COALESCE(s.target_score_not_sure_at, EXCLUDED.target_score_not_sure_at),
         updated_at               = now();
$fn$;

-- "Not now" on the email step. Idempotent.
CREATE OR REPLACE FUNCTION public.getting_started_skip_email(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.student_getting_started_state AS s (profile_id, email_skipped_at)
  VALUES (p_profile_id, now())
  ON CONFLICT (profile_id) DO UPDATE
     SET email_skipped_at = COALESCE(s.email_skipped_at, now()),
         updated_at       = now();
$fn$;

-- Dismiss the finished card. The server refuses it until every visible step is done or
-- skipped (visibility depends on the plan, which the server owns); this records it once.
CREATE OR REPLACE FUNCTION public.getting_started_dismiss(p_profile_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.student_getting_started_state
     SET dismissed_at = COALESCE(dismissed_at, now()),
         updated_at   = now()
   WHERE profile_id = p_profile_id;
$fn$;

REVOKE ALL ON FUNCTION public.getting_started_observe(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.getting_started_record_not_sure(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.getting_started_skip_email(uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.getting_started_dismiss(uuid)                           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.getting_started_observe(uuid)                           TO service_role;
GRANT EXECUTE ON FUNCTION public.getting_started_record_not_sure(uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.getting_started_skip_email(uuid)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.getting_started_dismiss(uuid)                           TO service_role;

COMMIT;
