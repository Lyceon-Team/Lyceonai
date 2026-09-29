-- ============================================================================
-- E6 — Row-level security for the full-length exam tables
-- ============================================================================
-- @spec [Doc-04A_V2.2, §5.1-§5.7 (the seven runtime tables), §9.3 (routing
--        path never student-visible), §10.2 (anti-leak); Doc-04B_V4.3 §9.5,
--        §22.1 (current_student_id() — NOT used, SCL-131)]
--       [E6 owner rulings 2026-09-24: identity is auth.uid() = profiles.id;
--        student reads "same as practice and review"]
-- @implemented [2026-09-24]
--
-- plain English: E3 enabled RLS on the seven exam tables with no policies
--   (deny-all) and E4 did the same for score_runs' student read. This file
--   writes the policies with auth.uid() directly — a profile's primary key IS
--   the auth user id, which is how practice and review are live in
--   production (20260610020000_ws2_practice_review_runtime.sql:269-274).
--   Doc 04B §22.1's current_student_id() does not exist and is not waited for;
--   swapping it in later is one migration with no behaviour change (SCL-131).
--
-- expected outcome (the practice pattern: own-row policy + column grants):
--   * test_sessions            own rows; every column granted.
--   * test_session_sections    own rows; module2_path NOT granted (§9.3).
--   * test_session_answers     own rows; `module` NOT granted (2A/2B is the path).
--   * test_answer_submissions  own rows; `module` and response_json NOT granted.
--   * exam_runtime_outbox      no client access at all (explicit false policy,
--                              no grant): service-internal wakeup rows.
--   * test_forms               published forms readable; routing thresholds,
--                              override columns and score_table_version NOT
--                              granted.
--   * test_form_items          policy = forms the student has a session on;
--                              NO column granted — listing a form's items
--                              (and which are in 2A vs 2B) before sitting it
--                              is exactly what practice never exposes.
--   * score_runs               own rows (student_id = auth.uid()); NO column
--                              granted yet — it carries rw/math_module2_path;
--                              E8 (reporting) chooses the student columns.
--   The API itself uses the service-role client (BYPASSRLS), like every
--   practice route; these policies govern direct PostgREST reads with the
--   student's own JWT and are the second line, not the first.
--   No INSERT/UPDATE/DELETE policy or grant for anon/authenticated anywhere:
--   every write goes through the server's exam_* functions.
--
-- trade-offs: child tables reach ownership through one EXISTS hop on
--   test_sessions (which itself is RLS-filtered for the caller, so the hop
--   can only ever find the caller's sessions).
--
-- OWNER-RUN: tracked pipeline. Sorts before 20261001000000; see
--   20260930070000_exam_runtime_api.sql header (--include-all).
--
-- ROLLBACK (INV-06): transactional.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP POLICY test_sessions_select_self            ON public.test_sessions;
--   DROP POLICY test_session_sections_select_self    ON public.test_session_sections;
--   DROP POLICY test_session_answers_select_self     ON public.test_session_answers;
--   DROP POLICY test_answer_submissions_select_self  ON public.test_answer_submissions;
--   DROP POLICY exam_runtime_outbox_no_client_access ON public.exam_runtime_outbox;
--   DROP POLICY test_forms_select_published          ON public.test_forms;
--   DROP POLICY test_form_items_select_own_form      ON public.test_form_items;
--   DROP POLICY score_runs_select_self               ON public.score_runs;
--   REVOKE SELECT ON public.test_sessions, public.test_session_sections,
--     public.test_session_answers, public.test_answer_submissions,
--     public.test_forms FROM authenticated;
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Student-owned runtime rows
-- ---------------------------------------------------------------------------
CREATE POLICY test_sessions_select_self ON public.test_sessions
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY test_session_sections_select_self ON public.test_session_sections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_sessions s
                  WHERE s.id = test_session_sections.test_session_id
                    AND s.student_id = auth.uid()));

CREATE POLICY test_session_answers_select_self ON public.test_session_answers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_sessions s
                  WHERE s.id = test_session_answers.test_session_id
                    AND s.student_id = auth.uid()));

CREATE POLICY test_answer_submissions_select_self ON public.test_answer_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_sessions s
                  WHERE s.id = test_answer_submissions.test_session_id
                    AND s.student_id = auth.uid()));

-- Service-internal: the outbox is a wakeup signal for the scoring pipeline.
CREATE POLICY exam_runtime_outbox_no_client_access ON public.exam_runtime_outbox
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- Catalogue rows
-- ---------------------------------------------------------------------------
CREATE POLICY test_forms_select_published ON public.test_forms
  FOR SELECT TO authenticated
  USING (status = 'published');

CREATE POLICY test_form_items_select_own_form ON public.test_form_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_sessions s
                  WHERE s.test_form_id = test_form_items.test_form_id
                    AND s.student_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- score_runs (E4 left the §9.5 student policy out: its helper does not exist)
-- ---------------------------------------------------------------------------
CREATE POLICY score_runs_select_self ON public.score_runs
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column grants (anti-leak: the grant limits which columns, RLS which rows)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.test_sessions TO authenticated;

GRANT SELECT (
  id, test_session_id, section, state,
  module1_started_at, module1_submitted_at, module1_submitted_by,
  module2_started_at, module2_submitted_at, module2_submitted_by,
  module1_expires_at, module2_expires_at, active_paused_ms, last_active_at
) ON public.test_session_sections TO authenticated;

GRANT SELECT (
  test_session_id, section, ordinal, question_id, answer,
  client_latency_ms, last_submission_id, updated_at
) ON public.test_session_answers TO authenticated;

GRANT SELECT (
  id, test_session_id, idempotency_key, section, ordinal, question_id, answer,
  client_latency_ms, response_schema_version, was_canonical_update, created_at
) ON public.test_answer_submissions TO authenticated;

GRANT SELECT (
  id, name, test_kind, status, is_selectable, retired_for_new_sessions_at,
  break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms,
  created_at, published_at, archived_at
) ON public.test_forms TO authenticated;

COMMIT;
