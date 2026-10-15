-- ============================================================================
-- Home "Getting started": Question of the Day no longer completes "Find your blind spots"
-- ============================================================================
-- @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
--        brief v2, Karl, 2026-10-13) §2 step 4, §3 completion rules; fix brief "QOTD must not
--        complete Find your blind spots" (Karl, 2026-10-15)] | @implemented [2026-10-15]
--
-- plain English: in production a Question of the Day answer ticked step 4 at the same moment as
-- step 2 (a fresh account showed qotd_done_at = blind_spots_done_at), because step 4 counted ANY
-- answered practice item and QOTD answers are practice items (mode 'qotd', SCL-224). Karl's rule:
--   * step 4 is done only when the diagnostic is completed, or the student has answered at least
--     one item in a practice session whose mode is not 'qotd';
--   * QOTD answers still count for step 2 only.
-- "Diagnostic completed" is the canonical lifecycle function, student_diagnostic_state, in
-- 'baseline_pending' or 'baseline_ready' (completed is terminal there). An answered item in an
-- unfinished diagnostic also counts, since its mode is not 'qotd': ruled by Karl on 2026-10-15
-- (#1253), "keep the rule as written", consistent with any practice answer counting.
--
-- This replaces getting_started_observe (last defined in 20261102000000); only step 4 changes.
-- The function stays SECURITY INVOKER, and service_role already holds what the new step reads:
-- SELECT on practice_sessions and EXECUTE on student_diagnostic_state (SECURITY DEFINER). Its
-- grants carry over through CREATE OR REPLACE; they are restated below so this file stands alone.
--
-- One-time data fix: clear blind_spots_done_at for students whose only answered items are QOTD
-- items (at least one answered QOTD item, no answered item in any other mode). Sticky completion
-- otherwise stays: a student who reached step 4 any other way keeps it, and the next read
-- re-derives step 4 under the new rule for everyone.
--
-- Mutations: G1, G2, G4, G6 and G7 in scripts/ci/getting-started.mutations.sh aimed at this
-- function's previous home are re-pointed here in the same change.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (restores the old step 4; the cleared timestamps are not restored, and the next read
-- under the old rule would set them again for anyone with a QOTD answer):
--   re-run the CREATE OR REPLACE FUNCTION public.getting_started_observe block from
--   20261102000000_home_getting_started.sql.
-- ============================================================================

BEGIN;

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

  -- Step 4 (Karl, 2026-10-15): the diagnostic completed, or an answered item in a practice
  -- session that is not Question of the Day. QOTD answers are practice items (mode 'qotd',
  -- SCL-224) but count for step 2 only.
  v_blind := public.student_diagnostic_state(p_profile_id) IN ('baseline_pending', 'baseline_ready')
    OR EXISTS (
      SELECT 1 FROM public.practice_session_items i
        JOIN public.practice_sessions ps ON ps.id = i.session_id
       WHERE i.user_id = p_profile_id AND i.status = 'answered' AND ps.mode <> 'qotd');

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

REVOKE ALL ON FUNCTION public.getting_started_observe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.getting_started_observe(uuid) TO service_role;

-- One-time data fix: step 4 reached only through Question of the Day answers.
UPDATE public.student_getting_started_state s
   SET blind_spots_done_at = NULL,
       updated_at          = now()
 WHERE s.blind_spots_done_at IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.practice_session_items i
       JOIN public.practice_sessions ps ON ps.id = i.session_id
      WHERE i.user_id = s.profile_id AND i.status = 'answered' AND ps.mode = 'qotd')
   AND NOT EXISTS (
     SELECT 1 FROM public.practice_session_items i
       JOIN public.practice_sessions ps ON ps.id = i.session_id
      WHERE i.user_id = s.profile_id AND i.status = 'answered' AND ps.mode <> 'qotd');

COMMIT;
