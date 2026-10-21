-- ===========================================================================
-- Review: starting a session is never refused at the open-session cap, and no question is in
-- two open review sessions (F-81).
--
-- @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part B: "Starting or resuming review
--       is never blocked by the open-session cap. At the cap, starting a session auto-closes the
--       oldest open review session (answered items stay recorded; unanswered items return to the
--       queue) and proceeds. No question appears in two open sessions."; owner guidance 2026-10-21
--       ("Auto-close must be atomic/idempotent and deterministic (oldest by started_at, tie-break
--       by id)"); student-UI register F-81 (urgent since the owner brief "first-run activation
--       fixes", 2026-10-13); Doc-02B_V4 §16 ("Review is queue-based … item remains in queue for
--       fresh attempt"); owner ruling 2026-09-21 (the cap is review's own count of practice's
--       configured `max_concurrent_sessions`); ruling 15 of the review plan ("a question open in
--       another review session is NOT excluded") is REVERSED by the 2026-10-21 brief]
--       | @implemented [2026-10-21]
--
-- plain English:
--  1. `review_close_oldest_open_sessions(student, max_open, now)` makes room for ONE new session:
--     it closes the student's oldest open (`created` | `active`) review sessions until at most
--     `max_open - 1` stay open, oldest first by `created_at` (review_sessions has no started_at;
--     `created_at` is when the session was started), ties broken by `id`. A closed session is
--     `abandoned` exactly as `POST /api/review/sessions/:id/terminate` leaves one: `abandoned_at`
--     set, `completed_at` NULL (review_sessions_abandoned_not_completed), the bound client and
--     the active item cleared. Its answered items and their attempt rows are untouched; its
--     unanswered items' queue entries (`review_schedule`) were never changed by serving, so they
--     are in the queue again the moment the session is no longer open. Under a per-student
--     transaction advisory lock, so two starts at once cannot both count the same sessions;
--     idempotent (a second call with nothing over the cap closes nothing). Returns the closed ids,
--     oldest first.
--  2. `review_session_items_one_open_question` (BEFORE INSERT on review_session_items) refuses a
--     question that is already an item of ANOTHER open review session of the same student, with
--     SQLSTATE 23505 and the message `review_question_already_open`. The route excludes those
--     questions before it inserts; this is what makes two concurrent starts unable to share a
--     question (the same advisory lock serialises the check, so the second insert sees the
--     first's committed rows and is refused; the route rebuilds its pool once and retries).
--
-- Mutations: no scripts/ci/*.mutations.sh entry targets either function (both new). The route
-- tests in tests/ci/review.routes.pg.ci.test.ts (B1-B4) were each observed red under a plant.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP TRIGGER IF EXISTS review_session_items_one_open_question ON public.review_session_items;
--   DROP FUNCTION IF EXISTS public.review_session_items_one_open_question();
--   DROP FUNCTION IF EXISTS public.review_close_oldest_open_sessions(uuid, integer, timestamptz);
--   (the route then refuses at the cap again only after its code is rolled back too)
-- ===========================================================================

BEGIN;

-- One lock key per student, shared by the two functions below.
CREATE OR REPLACE FUNCTION public.review_open_sessions_lock(p_student_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
  SELECT pg_advisory_xact_lock(hashtextextended('review_open_sessions:' || p_student_id::text, 0));
$fn$;

CREATE OR REPLACE FUNCTION public.review_close_oldest_open_sessions(
  p_student_id uuid,
  p_max_open   integer,
  p_now        timestamptz DEFAULT now()
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_closed uuid[];
BEGIN
  IF p_student_id IS NULL OR p_max_open IS NULL OR p_max_open < 1 THEN
    RAISE EXCEPTION 'review_close_oldest_open_sessions: a student and max_open >= 1 are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.review_open_sessions_lock(p_student_id);

  WITH open_sessions AS (
    SELECT s.id,
           row_number() OVER (ORDER BY s.created_at DESC, s.id DESC) AS newest_rank
      FROM public.review_sessions s
     WHERE s.student_id = p_student_id
       AND s.status IN ('created', 'active')
  ),
  to_close AS (
    -- Keep the newest (max_open - 1); everything older is closed.
    SELECT id FROM open_sessions WHERE newest_rank >= p_max_open
  ),
  closed AS (
    UPDATE public.review_sessions s
       SET status = 'abandoned',
           abandoned_at = p_now,
           completed_at = NULL,
           updated_at = p_now,
           filters = COALESCE(s.filters, '{}'::jsonb)
                     || jsonb_build_object('active_session_item_id', NULL,
                                           'client_instance_id', NULL,
                                           'calculator_state', NULL)
      FROM to_close c
     WHERE s.id = c.id
     RETURNING s.id, s.created_at
  )
  SELECT COALESCE(array_agg(id ORDER BY created_at, id), ARRAY[]::uuid[]) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$fn$;

COMMENT ON FUNCTION public.review_close_oldest_open_sessions(uuid, integer, timestamptz) IS
  'F-81 (owner brief 2026-10-21 Part B). Makes room for one new review session: abandons the student''s oldest open review sessions (created_at, then id) until at most max_open - 1 stay open, as terminate does (abandoned_at set, completed_at NULL). Answered items stay; unanswered items'' queue entries were never changed, so they are back in the pool. Per-student advisory lock; idempotent. Service role only.';

CREATE OR REPLACE FUNCTION public.review_session_items_one_open_question()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.review_open_sessions_lock(NEW.student_id);
  IF EXISTS (
    SELECT 1
      FROM public.review_session_items i
      JOIN public.review_sessions s ON s.id = i.session_id
     WHERE i.student_id = NEW.student_id
       AND i.question_id = NEW.question_id
       AND i.session_id <> NEW.session_id
       AND s.status IN ('created', 'active')
  ) THEN
    RAISE EXCEPTION 'review_question_already_open'
      USING ERRCODE = '23505',
            DETAIL = 'This question is already in another open review session of the same student.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS review_session_items_one_open_question ON public.review_session_items;
CREATE TRIGGER review_session_items_one_open_question
  BEFORE INSERT ON public.review_session_items
  FOR EACH ROW EXECUTE FUNCTION public.review_session_items_one_open_question();

REVOKE ALL ON FUNCTION
  public.review_open_sessions_lock(uuid),
  public.review_close_oldest_open_sessions(uuid, integer, timestamptz),
  public.review_session_items_one_open_question()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.review_open_sessions_lock(uuid),
  public.review_close_oldest_open_sessions(uuid, integer, timestamptz)
  TO service_role;

COMMIT;
