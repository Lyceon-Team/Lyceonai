-- ===========================================================================
-- Review: every start creates a NEW session of at most `session_size` questions; it is never
-- refused at the open-session cap; no question is in two open review sessions (F-81).
--
-- @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part B: "Starting or resuming review
--       is never blocked by the open-session cap. At the cap, starting a session auto-closes the
--       oldest open review session (answered items stay recorded; unanswered items return to the
--       queue) and proceeds. No question appears in two open sessions."; owner rulings on #1277
--       (Karl, 2026-10-21), ruling 1: "Review session size defaults to 10, stored as a runtime
--       config key with bounds (min 5) ... No session ever takes the whole queue", and ruling 2:
--       "Every review start creates a NEW session. Never resume a different session on a
--       filtered start. If questions the new session needs are held by an open session, close
--       that open session first (answered items stay recorded; unanswered items return to the
--       queue), then build the new one ... Keep it atomic and deterministic under the
--       per-student advisory lock"; Doc-01A_V1.0 §24 (values live in the service's
--       `*_runtime_config` table); student-UI register F-81; Doc-02B_V4 §16 ("Review is
--       queue-based … item remains in queue for fresh attempt"); owner ruling 2026-09-21 (the cap
--       is review's own count of practice's configured `max_concurrent_sessions`); ruling 15 of
--       the review plan ("a question open in another review session is NOT excluded") is
--       REVERSED by the 2026-10-21 brief]
--       | @implemented [2026-10-21]
--
-- plain English:
--  1. `review_runtime_config.session_size` = 10 (min 5, max 20): the most questions one review
--     session takes. The route caps every start by it, a caller's (the calendar's) size
--     included: size = min(requested size, or the key when none is asked, and the key). Lowering
--     it to 5 is an UPDATE of this row, no deploy (the server's cache refreshes within
--     `caching_runtime_config.review_config_cache_ttl_seconds`, 60 s, seeded below).
--  2. `review_admit_session_start(student, max_open, question_ids, now)` makes room for the ONE
--     new session the route is about to insert, in one transaction under the per-student
--     advisory lock: first every open (`created` | `active`) review session of the student that
--     holds any of `question_ids` (the questions the new session will take) is closed; then, if
--     the open sessions left would still reach the cap, the oldest are closed (by `created_at`,
--     ties by `id`) until at most `max_open - 1` stay open. A closed session is `abandoned`
--     exactly as `POST /api/review/sessions/:id/terminate` leaves one: `abandoned_at` set,
--     `completed_at` NULL (review_sessions_abandoned_not_completed), the bound client and the
--     active item cleared. Its answered items and their attempt rows are untouched; its
--     unanswered items' queue entries (`review_schedule`) were never changed by serving, so they
--     are in the queue again the moment it is no longer open. Idempotent: a second call finds
--     no holder and nothing over the cap, and closes nothing. Returns the closed ids, oldest
--     first. Nothing is ever resumed in place of a new session.
--  3. `review_session_items_one_open_question` (BEFORE INSERT on review_session_items) refuses a
--     question that is already an item of ANOTHER open review session of the same student, with
--     SQLSTATE 23505 and the message `review_question_already_open`. The admit step above
--     clears the holders before the insert; this is what keeps two concurrent starts from
--     sharing a question (the same advisory lock serialises the check, so the second insert sees
--     the first's committed rows and is refused; the route then admits and inserts once more).
--
-- Mutations: scripts/ci/review-routes-gate.mutations.sh plants B1/B1tie/B2/B3/B4 aim at this
-- file (the only definition of each function); every one was observed reddening its B test.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP TRIGGER IF EXISTS review_session_items_one_open_question ON public.review_session_items;
--   DROP FUNCTION IF EXISTS public.review_session_items_one_open_question();
--   DROP FUNCTION IF EXISTS public.review_admit_session_start(uuid, integer, text[], timestamptz);
--   DROP FUNCTION IF EXISTS public.review_open_sessions_lock(uuid);
--   DELETE FROM public.review_runtime_config WHERE key = 'session_size';
--   DELETE FROM public.caching_runtime_config WHERE key = 'review_config_cache_ttl_seconds';
--   (the route refuses at the cap again only after its code is rolled back too)
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The session size (ruling 1) and its cache lifetime (Doc 01A §24)
-- ---------------------------------------------------------------------------
INSERT INTO public.review_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('session_size', '10'::jsonb, 'integer', '5'::jsonb, '20'::jsonb, 'product',
   'Owner rulings on #1277 (Karl, 2026-10-21), ruling 1: the most questions one review session takes; every start, the calendar''s included, is capped by it (min(requested or this, this)). Default 10; lower to 5 here, no deploy. A value outside min..max is refused by the server (a 500), never clamped.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.caching_runtime_config
  (key, value, value_type, min_value, max_value, owner, description)
VALUES
  ('review_config_cache_ttl_seconds', '60'::jsonb, 'integer', '10'::jsonb, '600'::jsonb,
   'Engineering',
   'In-process TTL for the review_runtime_config session_size read (server/services/review-config.ts). Owner rulings on #1277, 2026-10-21, ruling 1.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Admission (ruling 2)
-- ---------------------------------------------------------------------------

-- One lock key per student, shared by the two functions below.
CREATE OR REPLACE FUNCTION public.review_open_sessions_lock(p_student_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
  SELECT pg_advisory_xact_lock(hashtextextended('review_open_sessions:' || p_student_id::text, 0));
$fn$;

CREATE OR REPLACE FUNCTION public.review_admit_session_start(
  p_student_id   uuid,
  p_max_open     integer,
  p_question_ids text[],
  p_now          timestamptz DEFAULT now()
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_to_close uuid[];
  v_closed   uuid[];
BEGIN
  IF p_student_id IS NULL OR p_max_open IS NULL OR p_max_open < 1 THEN
    RAISE EXCEPTION 'review_admit_session_start: a student and max_open >= 1 are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.review_open_sessions_lock(p_student_id);

  WITH open_sessions AS (
    SELECT s.id, s.created_at,
           EXISTS (
             SELECT 1 FROM public.review_session_items i
              WHERE i.session_id = s.id
                AND i.question_id = ANY (COALESCE(p_question_ids, ARRAY[]::text[]))
           ) AS holds
      FROM public.review_sessions s
     WHERE s.student_id = p_student_id
       AND s.status IN ('created', 'active')
  ),
  kept AS (
    -- The sessions holding none of the new session's questions, newest first: the newest
    -- (max_open - 1) of them stay open, everything older is closed to make room.
    SELECT id,
           row_number() OVER (ORDER BY created_at DESC, id DESC) AS newest_rank
      FROM open_sessions
     WHERE NOT holds
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_to_close
    FROM (
      SELECT id FROM open_sessions WHERE holds
      UNION
      SELECT id FROM kept WHERE newest_rank >= p_max_open
    ) c;

  WITH closed AS (
    UPDATE public.review_sessions s
       SET status = 'abandoned',
           abandoned_at = p_now,
           completed_at = NULL,
           updated_at = p_now,
           filters = COALESCE(s.filters, '{}'::jsonb)
                     || jsonb_build_object('active_session_item_id', NULL,
                                           'client_instance_id', NULL,
                                           'calculator_state', NULL)
     WHERE s.id = ANY (v_to_close)
     RETURNING s.id, s.created_at
  )
  SELECT COALESCE(array_agg(id ORDER BY created_at, id), ARRAY[]::uuid[]) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$fn$;

COMMENT ON FUNCTION public.review_admit_session_start(uuid, integer, text[], timestamptz) IS
  'F-81 (owner rulings on #1277, Karl, 2026-10-21, ruling 2). Makes room for one NEW review session that will take p_question_ids: abandons every open review session of the student holding any of them, then the oldest of the rest (created_at, then id) until at most max_open - 1 stay open, as terminate does (abandoned_at set, completed_at NULL). Answered items stay; unanswered items'' queue entries were never changed, so they are back in the pool. Per-student advisory lock; idempotent. Service role only.';

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
  public.review_admit_session_start(uuid, integer, text[], timestamptz),
  public.review_session_items_one_open_question()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.review_open_sessions_lock(uuid),
  public.review_admit_session_start(uuid, integer, text[], timestamptz)
  TO service_role;

COMMIT;
