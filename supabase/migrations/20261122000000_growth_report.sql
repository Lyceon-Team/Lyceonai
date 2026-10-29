-- ============================================================================
-- Monday growth report: the week's numbers, aggregates only, and a ledger so it posts once.
--
-- @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
--       (Karl, 2026-10-28) item 3 ("Monday growth report to #social at 14:00 UTC, from the
--       database, with week and change from last week") and item 4 (tests, planted defects);
--       .claude/skills/cmo/references/03-data-sources.md §4 (the canonical metric definitions this
--       reuses: new students, active students, questions answered, new premium entitlements);
--       CLAUDE.md Public Disclosure Doctrine 7 (under-13 users excluded from analytics)]
--       | @implemented [2026-10-28]
--
-- plain English:
--   growth_report_week_start(now) — the Monday that starts the last COMPLETE Monday–Sunday week in
--     America/Chicago (the site's day). On a Monday it is the Monday a week earlier.
--   growth_report_weekly(week_start, excluded) — one jsonb with that week and the week before,
--     counts only (never an id, email, name or answer). Who counts: role student, not deleted, not
--     under 13 (`is_under_13` true is excluded; NULL, not yet onboarded, is kept), and not in
--     `excluded` (Karl's internal and test accounts, passed in by the server from a private
--     setting; the list never lives in the repository). For each week:
--       signups_by_channel  student profiles CREATED in the week, by signup_channel (NULL → untagged);
--       active_students     distinct students with a practice or review item answered or skipped,
--                           a LISA message sent, or a full-length test started (the CMO canonical);
--       returning_by_test_date  students active this week AND the week before, by their current
--                           effective SAT date (student_study_profile.target_exam_date; none → NULL);
--       questions_answered  practice + review items with status 'answered' (skips excluded; the
--                           QOTD answer is a practice item, so it is not counted twice);
--       full_length_answers full-length answers last saved in the week (reported separately, as
--                           the canonical says);
--       reviews_done        review sessions completed in the week;
--       study_minutes_estimate  sum of the timed practice answers' time_spent_ms, each capped at
--                           5 minutes, in minutes. AN ESTIMATE: only answers with a recorded time
--                           count (review answers record none), and a cap stops one tab left open
--                           from counting as an hour. Nothing is inferred for untimed answers;
--       signups_answered_24h  of the week's sign-ups, those who answered a practice or review
--                           question within 24 hours of their account's creation (measured when the
--                           report runs: a Sunday-night sign-up has had less than a day);
--       upgrades            distinct students with a premium entitlement created in the week.
--                           ALPHA (founding code) and paid cannot be told apart from stored data:
--                           entitlements keep no discount, and the Stripe event ledger keeps only
--                           the event id and type. The founding split lives in Stripe (CMO §4,
--                           "Founding redemptions"), so this reports upgrades unsplit.
--   growth_report_claim / _mark_posted / _release — the insert-once ledger (growth_report_posts,
--     one row per week): a double-fired cron posts once; a failed Slack post releases its claim so a
--     re-run posts; a claim left by a crashed run is taken over after 15 minutes.
--
-- Security: growth_report_weekly is SECURITY DEFINER (it reads several student tables) and returns
--   aggregates only; EXECUTE on every function is revoked from PUBLIC, anon and authenticated and
--   granted to service_role, the only caller (the CRON_SECRET-gated route). The ledger has RLS on,
--   no policies, and grants to service_role only.
--
-- Mutations: none target an existing function body here; every function is new.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.growth_report_release(date);
--   DROP FUNCTION IF EXISTS public.growth_report_mark_posted(date);
--   DROP FUNCTION IF EXISTS public.growth_report_claim(date);
--   DROP FUNCTION IF EXISTS public.growth_report_weekly(date, uuid[]);
--   DROP FUNCTION IF EXISTS public.growth_report_week_start(timestamptz);
--   DROP TABLE IF EXISTS public.growth_report_posts;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.growth_report_posts (
  week_start date        PRIMARY KEY CHECK (extract(isodow FROM week_start) = 1),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  posted_at  timestamptz
);
ALTER TABLE public.growth_report_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.growth_report_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.growth_report_posts TO service_role;
COMMENT ON TABLE public.growth_report_posts IS
  'One row per reported week (owner brief 2026-10-28 item 3): claimed before the Slack post, posted_at set after it, so the Monday report posts once.';

CREATE OR REPLACE FUNCTION public.growth_report_week_start(p_now timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT (date_trunc('week', (p_now AT TIME ZONE 'America/Chicago'))::date - 7);
$$;

CREATE OR REPLACE FUNCTION public.growth_report_weekly(p_week_start date, p_excluded uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weeks jsonb := '[]'::jsonb;
  v_offset int;
  v_start date;
  t0 timestamptz;
  t1 timestamptz;
  p0 timestamptz;
  v_week jsonb;
BEGIN
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'growth_report_weekly: week_start must be a Monday, got %', p_week_start
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 0 = the reported week, 1 = the week before (the comparison).
  FOREACH v_offset IN ARRAY ARRAY[0, 1] LOOP
    v_start := p_week_start - 7 * v_offset;
    t0 := (v_start::timestamp) AT TIME ZONE 'America/Chicago';
    t1 := ((v_start + 7)::timestamp) AT TIME ZONE 'America/Chicago';
    p0 := ((v_start - 7)::timestamp) AT TIME ZONE 'America/Chicago';

    WITH stu AS (
      SELECT p.id, p.created_at, p.signup_channel
        FROM public.profiles p
       WHERE p.role = 'student'
         AND p.deleted_at IS NULL
         AND p.is_under_13 IS NOT TRUE
         AND NOT (p.id = ANY (COALESCE(p_excluded, ARRAY[]::uuid[])))
    ),
    -- Activity in [lo, hi): the CMO canonical "active student".
    act_cur AS (
      SELECT user_id AS sid FROM public.practice_session_items
       WHERE answered_at >= t0 AND answered_at < t1
      UNION SELECT student_id FROM public.review_session_items
       WHERE answered_at >= t0 AND answered_at < t1
      UNION SELECT student_id FROM public.tutor_messages
       WHERE created_at >= t0 AND created_at < t1 AND role = 'student'
      UNION SELECT student_id FROM public.test_sessions
       WHERE created_at >= t0 AND created_at < t1
    ),
    act_prev AS (
      SELECT user_id AS sid FROM public.practice_session_items
       WHERE answered_at >= p0 AND answered_at < t0
      UNION SELECT student_id FROM public.review_session_items
       WHERE answered_at >= p0 AND answered_at < t0
      UNION SELECT student_id FROM public.tutor_messages
       WHERE created_at >= p0 AND created_at < t0 AND role = 'student'
      UNION SELECT student_id FROM public.test_sessions
       WHERE created_at >= p0 AND created_at < t0
    ),
    active AS (
      SELECT DISTINCT a.sid FROM act_cur a JOIN stu ON stu.id = a.sid
    ),
    returning_students AS (
      SELECT a.sid FROM active a JOIN act_prev b ON b.sid = a.sid GROUP BY a.sid
    ),
    signups AS (
      SELECT * FROM stu WHERE created_at >= t0 AND created_at < t1
    ),
    answers AS (
      SELECT user_id AS sid, answered_at, time_spent_ms
        FROM public.practice_session_items
       WHERE status = 'answered' AND answered_at >= p0
      UNION ALL
      SELECT student_id, answered_at, NULL::integer
        FROM public.review_session_items
       WHERE status = 'answered' AND answered_at >= p0
    )
    SELECT jsonb_build_object(
      'week_start', v_start,
      'signups_by_channel', COALESCE((
        SELECT jsonb_object_agg(channel, n)
          FROM (SELECT COALESCE(signup_channel, 'untagged') AS channel, count(*) AS n
                  FROM signups GROUP BY 1) c), '{}'::jsonb),
      'signups', (SELECT count(*) FROM signups),
      'active_students', (SELECT count(*) FROM active),
      'returning_by_test_date', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('test_date', d, 'students', n) ORDER BY d NULLS LAST)
          FROM (SELECT sp.target_exam_date AS d, count(*) AS n
                  FROM returning_students r
                  LEFT JOIN public.student_study_profile sp ON sp.student_id = r.sid
                 GROUP BY 1) g), '[]'::jsonb),
      'returning_students', (SELECT count(*) FROM returning_students),
      'questions_answered', (
        SELECT count(*) FROM answers a JOIN stu ON stu.id = a.sid
         WHERE a.answered_at >= t0 AND a.answered_at < t1),
      'full_length_answers', (
        SELECT count(*) FROM public.test_session_answers ta
          JOIN public.test_sessions ts ON ts.id = ta.test_session_id
          JOIN stu ON stu.id = ts.student_id
         WHERE ta.answer IS NOT NULL AND ta.updated_at >= t0 AND ta.updated_at < t1),
      'reviews_done', (
        SELECT count(*) FROM public.review_sessions rs JOIN stu ON stu.id = rs.student_id
         WHERE rs.status = 'completed' AND rs.completed_at >= t0 AND rs.completed_at < t1),
      'study_minutes_estimate', (
        SELECT COALESCE(round(sum(LEAST(a.time_spent_ms, 300000))::numeric / 60000, 1), 0)
          FROM answers a JOIN stu ON stu.id = a.sid
         WHERE a.answered_at >= t0 AND a.answered_at < t1 AND a.time_spent_ms > 0),
      'signups_answered_24h', (
        SELECT count(*) FROM signups s
         WHERE EXISTS (SELECT 1 FROM answers a
                        WHERE a.sid = s.id
                          AND a.answered_at >= s.created_at
                          AND a.answered_at < s.created_at + interval '24 hours')),
      'upgrades', (
        SELECT count(DISTINCT e.profile_id) FROM public.entitlements e
          JOIN stu ON stu.id = e.profile_id
         WHERE e.tier = 'premium' AND e.created_at >= t0 AND e.created_at < t1)
    ) INTO v_week;

    v_weeks := v_weeks || jsonb_build_array(v_week);
  END LOOP;

  RETURN jsonb_build_object('week', v_weeks -> 0, 'previous', v_weeks -> 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_report_claim(p_week_start date)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows int;
BEGIN
  INSERT INTO public.growth_report_posts (week_start) VALUES (p_week_start)
  ON CONFLICT (week_start) DO UPDATE
     SET claimed_at = now()
   WHERE growth_report_posts.posted_at IS NULL
     AND growth_report_posts.claimed_at < now() - interval '15 minutes';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.growth_report_mark_posted(p_week_start date)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  UPDATE public.growth_report_posts SET posted_at = now() WHERE week_start = p_week_start;
$$;

CREATE OR REPLACE FUNCTION public.growth_report_release(p_week_start date)
RETURNS void
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.growth_report_posts
   WHERE week_start = p_week_start AND posted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.growth_report_week_start(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_report_weekly(date, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_report_claim(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_report_mark_posted(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.growth_report_release(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_report_week_start(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_report_weekly(date, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_report_claim(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_report_mark_posted(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.growth_report_release(date) TO service_role;

COMMIT;
