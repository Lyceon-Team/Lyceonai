-- ============================================================================
-- Growth report: study time from the server's own timestamps (Karl, 2026-11-02)
--
-- @spec [owner brief "Growth report: 'Study time' reads 0.0 hours" (Karl, 2026-11-02) items 1-3;
--       owner brief "One funnel for every social post" (Karl, 2026-10-28) item 3 (the 5-minute
--       cap, the exclusions); Lyceon_Doc_05F (`review_estimated_seconds_per_item`: per-item time
--       is measured as `occurred_at - served_at`; the answer paths write answered_at and
--       occurred_at from the same server `now`); CLAUDE.md "Server-authoritative" (client
--       durations not trusted)] | @implemented [2026-11-02]
--
-- plain English: the first report (Oct 26 - Nov 1) showed "Study time, estimated (hours)" 0.0
--   for both weeks with 327 and 108 questions answered. Cause: growth_report_weekly summed
--   practice_session_items.time_spent_ms, and the server writes that column as NULL on every
--   answer (practice-canonical.ts `const clampedTimeSpentMs = null`; review-canonical.ts writes
--   null too), because a client-reported duration is never trusted. With `time_spent_ms > 0`
--   filtering every row out, COALESCE(..., 0) turned "nothing recorded" into 0.0.
--
--   The time IS recorded, by the server: every practice and review item gets served_at when the
--   server serves it (written once: the promote only matches status 'pending') and answered_at
--   when the server grades the answer. This body uses answered_at - served_at per answered item,
--   each capped at 5 minutes as before, for practice AND review answers (review answers now
--   count). No client value is read and no new column is needed.
--
--   Same exclusions as before (students only; under-13, deleted and passed-in internal/test
--   accounts never count), same week boundaries, every other metric unchanged.
--
-- Edge cases:
--   * A QOTD answer is written with served_at = answered_at (qotd_student_answer serves and
--     answers in one call; the time on the public page is never seen by the server), so it has
--     no measurable gap and is left out of the sum rather than counted as 0 minutes.
--   * An item served before a break and answered later counts at most 5 minutes (the cap).
--   * A week with answers but no measurable gap returns NULL, which the report shows as "not
--     recorded yet"; a week with no answers returns 0.
--
-- Mutations: this REPLACES growth_report_weekly's body (last defined in
--   20261122000000_growth_report.sql). scripts/ci/growth-report.mutations.sh re-points every
--   growth_report_weekly body plant here in the same change. Privileges are unchanged
--   (CREATE OR REPLACE keeps the ACL set in 20261122000000), so G13 still plants there.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback: re-run the CREATE OR REPLACE FUNCTION public.growth_report_weekly block of
--   20261122000000_growth_report.sql (the time_spent_ms body).
-- ============================================================================

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
    -- served_at and answered_at are both written by the server (served_at once, when the item is
    -- promoted to served; answered_at when the answer is graded), so the gap is server-measured.
    -- answered_at is Doc 05F's occurred_at: every answer path writes both from the same server
    -- `now` (practice-canonical.ts, review-canonical.ts, qotd_student_answer). If a path ever
    -- writes them apart, this measure must follow occurred_at.
    answers AS (
      SELECT user_id AS sid, answered_at, served_at
        FROM public.practice_session_items
       WHERE status = 'answered' AND answered_at >= p0
      UNION ALL
      SELECT student_id, answered_at, served_at
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
      -- NULL ("not recorded yet") when the week has answers but none with a measurable gap; 0
      -- only when there are no answers at all. Never 0 standing in for "unknown".
      'study_minutes_estimate', (
        SELECT CASE
                 WHEN count(*) FILTER (WHERE a.answered_at > a.served_at) = 0 AND count(*) > 0
                   THEN NULL
                 ELSE COALESCE(round((extract(epoch FROM sum(
                        LEAST(a.answered_at - a.served_at, interval '5 minutes'))
                        FILTER (WHERE a.answered_at > a.served_at)) / 60)::numeric, 1), 0)
               END
          FROM answers a JOIN stu ON stu.id = a.sid
         WHERE a.answered_at >= t0 AND a.answered_at < t1),
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
