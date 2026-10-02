-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Guardian Wave 5, G5-04: the exam list carries each latest session's scaled total.
--
-- @spec [SCL-199 (amends SCL-181 and SCL-192, the guardian exam list item: each item carries
--        `total_scaled`, the score run's total, non-null exactly when the item is `scored`);
--        Guardian_Closure_Plan G5-04; ruling R13 (Karl, 2026-10-02)]
-- | @implemented [2026-10-02]
--
-- plain English: the guardian Dashboard's latest-test card shows the change since the
-- previous completed test, which needs that test's total. The list already joined the score
-- run (`score_total_present` is `r.total_scaled IS NOT NULL`); this adds the value itself to
-- `latest_session`, beside the flag, so the Dashboard reads the list it already reads (no new
-- endpoint, one call) instead of one report per past test. The student list's schema
-- (`formRowSchema`) parses the new key; the student wire is unchanged because the student
-- route serialises its own fields, not this jsonb.
--
-- Body otherwise byte-for-byte the 20260930090000 body (one added line). Grants survive
-- CREATE OR REPLACE (service_role EXECUTE only; gate G1 of exam-shell-server-gates.sql).
-- Mutations: no scripts/ci/*.mutations.sh entry targets exam_list_forms (grep, 2026-10-02),
-- so nothing is orphaned. This file is now the function's last definition.
--
-- rollback (exact: the 20260930090000 body; no data is touched):
--   CREATE OR REPLACE FUNCTION public.exam_list_forms(p_student_id uuid)
--   RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
--     SELECT jsonb_build_object('status', 200, 'body', jsonb_build_object('forms', COALESCE((
--       SELECT jsonb_agg(jsonb_build_object(
--                'test_form_id', f.id,
--                'name', f.name,
--                'is_selectable', f.is_selectable AND f.status = 'published',
--                'question_count', (SELECT count(*) FROM test_form_items fi
--                                    WHERE fi.test_form_id = f.id AND fi.module IN ('1', '2A')),
--                'break_duration_ms', f.break_duration_ms,
--                'sections', jsonb_build_array(
--                  jsonb_build_object('section', 'RW',
--                    'questions_per_module', (SELECT count(*) FROM test_form_items fi
--                                              WHERE fi.test_form_id = f.id AND fi.section = 'RW' AND fi.module = '1'),
--                    'module1_ms', f.rw_module1_ms, 'module2_ms', f.rw_module2_ms),
--                  jsonb_build_object('section', 'M',
--                    'questions_per_module', (SELECT count(*) FROM test_form_items fi
--                                              WHERE fi.test_form_id = f.id AND fi.section = 'M' AND fi.module = '1'),
--                    'module1_ms', f.m_module1_ms, 'module2_ms', f.m_module2_ms)),
--                'latest_session', (
--                  SELECT jsonb_build_object(
--                           'session_id', s.id,
--                           'state', s.state,
--                           'mode', s.mode,
--                           'attempt_number_for_form', s.attempt_number_for_form,
--                           'grace_expires_at', s.grace_expires_at,
--                           'completed_at', s.completed_at,
--                           'abandoned_at', s.abandoned_at,
--                           'score_total_present', r.total_scaled IS NOT NULL,
--                           'score_partial_present', r.partial_display_scaled IS NOT NULL,
--                           'failed_outbox_id', CASE WHEN r.id IS NULL THEN (
--                               SELECT o.id FROM exam_runtime_outbox o
--                                WHERE o.aggregate_id = s.id AND o.status = 'failed'
--                                ORDER BY o.created_at DESC LIMIT 1) END)
--                    FROM test_sessions s
--                    LEFT JOIN score_runs r ON r.test_session_id = s.id
--                   WHERE s.test_form_id = f.id AND s.student_id = p_student_id
--                   ORDER BY s.created_at DESC, s.id DESC LIMIT 1))
--              ORDER BY f.published_at, f.name, f.id)
--         FROM test_forms f
--        WHERE (f.status = 'published' AND f.is_selectable)
--           OR (f.status IN ('published', 'archived')
--               AND EXISTS (SELECT 1 FROM test_sessions s2
--                            WHERE s2.test_form_id = f.id AND s2.student_id = p_student_id))),
--       '[]'::jsonb)))
--   $$;
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.exam_list_forms(p_student_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('status', 200, 'body', jsonb_build_object('forms', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'test_form_id', f.id,
             'name', f.name,
             'is_selectable', f.is_selectable AND f.status = 'published',
             'question_count', (SELECT count(*) FROM test_form_items fi
                                 WHERE fi.test_form_id = f.id AND fi.module IN ('1', '2A')),
             'break_duration_ms', f.break_duration_ms,
             'sections', jsonb_build_array(
               jsonb_build_object('section', 'RW',
                 'questions_per_module', (SELECT count(*) FROM test_form_items fi
                                           WHERE fi.test_form_id = f.id AND fi.section = 'RW' AND fi.module = '1'),
                 'module1_ms', f.rw_module1_ms, 'module2_ms', f.rw_module2_ms),
               jsonb_build_object('section', 'M',
                 'questions_per_module', (SELECT count(*) FROM test_form_items fi
                                           WHERE fi.test_form_id = f.id AND fi.section = 'M' AND fi.module = '1'),
                 'module1_ms', f.m_module1_ms, 'module2_ms', f.m_module2_ms)),
             'latest_session', (
               SELECT jsonb_build_object(
                        'session_id', s.id,
                        'state', s.state,
                        'mode', s.mode,
                        'attempt_number_for_form', s.attempt_number_for_form,
                        'grace_expires_at', s.grace_expires_at,
                        'completed_at', s.completed_at,
                        'abandoned_at', s.abandoned_at,
                        'score_total_present', r.total_scaled IS NOT NULL,
                        'total_scaled', r.total_scaled,
                        'score_partial_present', r.partial_display_scaled IS NOT NULL,
                        'failed_outbox_id', CASE WHEN r.id IS NULL THEN (
                            SELECT o.id FROM exam_runtime_outbox o
                             WHERE o.aggregate_id = s.id AND o.status = 'failed'
                             ORDER BY o.created_at DESC LIMIT 1) END)
                 FROM test_sessions s
                 LEFT JOIN score_runs r ON r.test_session_id = s.id
                WHERE s.test_form_id = f.id AND s.student_id = p_student_id
                ORDER BY s.created_at DESC, s.id DESC LIMIT 1))
           ORDER BY f.published_at, f.name, f.id)
      FROM test_forms f
     WHERE (f.status = 'published' AND f.is_selectable)
        OR (f.status IN ('published', 'archived')
            AND EXISTS (SELECT 1 FROM test_sessions s2
                         WHERE s2.test_form_id = f.id AND s2.student_id = p_student_id))),
    '[]'::jsonb)))
$$;

COMMIT;
