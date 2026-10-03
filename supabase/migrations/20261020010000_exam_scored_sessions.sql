-- ============================================================================
-- OQ-30 — the student's scored full-length sessions (score history read)
-- ============================================================================
-- @spec [Doc-04C_V1.0, §16.3 (multi-session listing: "a projection over the same
--        canonical data"), §7.1 (scores are read from score_runs, never
--        recomputed — §7.2), §15.1-§15.2 (a scaled score ships with the disclosure
--        bound to its score run's scoring_model_version), §5.3 (scored = session
--        completed AND score_runs.total_scaled present)]
--       [Owner ruling (Karl) 2026-10-02, student-ui register §9 OQ-30: "approved.
--        A read of the student's completed full-length results (date, total,
--        sections)."; OQ-31: the score is the real exam result from score_runs]
-- @implemented [2026-10-03]
--
-- plain English: exam_scored_sessions(student, limit) returns the caller's own
--   sessions whose report state would derive as `scored` — test_sessions.state =
--   'completed' with a score_runs row carrying total_scaled — newest first
--   (completed_at DESC, then id DESC so equal timestamps still order the same way
--   on every call), at most p_limit rows. Each row carries the session id, the
--   form's name, completed_at, the three scaled scores from score_runs, and the
--   disclosure bound to that run's scoring_model_version.
--
-- What it never reads or emits: score_runs decomposition (module correct counts,
--   module2 path, floors, deductions), routing thresholds, score_table_version,
--   any item, answer, explanation or per-domain count. Partial-scored, pending,
--   failed and in-progress sessions are not `scored` and are not listed.
--
-- Edge cases:
--   * The disclosure is LEFT JOINed and may come back null; the server refuses
--     the whole response (500 report_data_integrity_violation, 04C §16.7) rather
--     than ship a score without it — the same rule as exam_report_source.
--   * p_limit outside 1..100 raises: the server passes one constant; any other
--     value is a programming error, not a request to honour.
--   * Pure read: STABLE, touches nothing, server-only grants (E6's rule).
--   * No new index: idx_test_sessions_student_form (student_id, test_form_id)
--     already narrows to one student's sessions, a handful of rows.
--
-- Rollback (reviewed: the function is new, nothing else depends on it):
--   DROP FUNCTION public.exam_scored_sessions(uuid, int);
-- LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

CREATE FUNCTION public.exam_scored_sessions(p_student_id uuid, p_limit int)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_student_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'exam_scored_sessions: invalid arguments'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'session_id', x.session_id,
               'test_form_name', x.test_form_name,
               'completed_at', x.completed_at,
               'total_scaled', x.total_scaled,
               'rw_scaled', x.rw_scaled,
               'math_scaled', x.math_scaled,
               'disclosure', x.disclosure)
             ORDER BY x.completed_at DESC, x.session_id DESC)
        FROM (
          SELECT s.id AS session_id,
                 f.name AS test_form_name,
                 s.completed_at,
                 r.total_scaled,
                 r.rw_scaled,
                 r.math_scaled,
                 CASE WHEN d.scoring_model_version IS NULL THEN NULL
                      ELSE jsonb_build_object(
                             'disclosure_version', d.disclosure_version,
                             'summary', d.summary,
                             'full_text_url', d.full_text_url)
                 END AS disclosure
            FROM test_sessions s
            JOIN test_forms f ON f.id = s.test_form_id
            JOIN score_runs r ON r.test_session_id = s.id
            LEFT JOIN score_disclosure_versions d
                   ON d.scoring_model_version = r.scoring_model_version
           WHERE s.student_id = p_student_id
             AND s.state = 'completed'
             AND r.total_scaled IS NOT NULL
           ORDER BY s.completed_at DESC, s.id DESC
           LIMIT p_limit
        ) x), '[]'::jsonb)));
END;
$$;

COMMENT ON FUNCTION public.exam_scored_sessions(uuid, int) IS
  'OQ-30 (owner ruling 2026-10-02; Doc 04C §16.3): the caller''s scored full-length sessions, newest first (completed_at DESC, id DESC), capped by p_limit (1..100). Per row: session_id, test_form_name, completed_at, total/rw/math scaled from score_runs, and the disclosure bound to the run''s scoring_model_version (null when unbound — the server refuses it). No decomposition, item or answer data.';

REVOKE ALL ON FUNCTION public.exam_scored_sessions(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_scored_sessions(uuid, int) TO service_role;

COMMIT;
