-- =====================================================================
-- POSTGRESQL RLS POLICIES FOR NEON DATABASE
-- =====================================================================
-- Note: Since this is Neon PostgreSQL (not Supabase), we don't have
-- access to auth.uid(). RLS enforcement is done via:
-- 1. Middleware verifying Supabase JWT
-- 2. Application-layer filtering by req.user.id
-- 3. Database RLS as additional security layer using custom context
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- CUSTOM RLS CONTEXT FUNCTIONS
-- =====================================================================

-- Set current user ID in session (called by middleware)
CREATE OR REPLACE FUNCTION set_current_user_id(user_id text) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_user_id', user_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current user ID from session
CREATE OR REPLACE FUNCTION get_current_user_id() RETURNS text AS $$
BEGIN
  RETURN current_setting('app.current_user_id', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if current user is admin
CREATE OR REPLACE FUNCTION is_current_user_admin() RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(
    (SELECT "is_admin" FROM users WHERE id = get_current_user_id()),
    false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- ENABLE RLS ON ALL USER-RELATED TABLES
-- =====================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Questions table - all authenticated users can read
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- RLS POLICIES - USERS TABLE
-- =====================================================================

-- Users can view their own profile
CREATE POLICY "users_select_own" ON users
  FOR SELECT
  USING (id = get_current_user_id());

-- Users can update their own profile (but not role/admin status)
CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  USING (id = get_current_user_id())
  WITH CHECK (
    id = get_current_user_id() AND
    "is_admin" = (SELECT "is_admin" FROM users WHERE id = get_current_user_id())
  );

-- Admins have full access to users
CREATE POLICY "users_admin_all" ON users
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - USER_PROGRESS TABLE
-- =====================================================================

-- Users can manage their own progress
CREATE POLICY "user_progress_manage_own" ON "user_progress"
  FOR ALL
  USING ("user_id" = get_current_user_id())
  WITH CHECK ("user_id" = get_current_user_id());

-- Admins have full access
CREATE POLICY "user_progress_admin_all" ON "user_progress"
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - PRACTICE_SESSIONS TABLE
-- =====================================================================

-- Users can manage their own practice sessions
CREATE POLICY "practice_sessions_manage_own" ON practice_sessions
  FOR ALL
  USING ("user_id" = get_current_user_id())
  WITH CHECK ("user_id" = get_current_user_id());

-- Admins have full access
CREATE POLICY "practice_sessions_admin_all" ON practice_sessions
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - ANSWER_ATTEMPTS TABLE
-- =====================================================================

-- Users can manage their own answer attempts (via session ownership)
CREATE POLICY "answer_attempts_manage_own" ON answer_attempts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM practice_sessions
      WHERE practice_sessions.id = answer_attempts.session_id
      AND practice_sessions."user_id" = get_current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM exam_attempts
      WHERE exam_attempts.id = answer_attempts.exam_attempt_id
      AND exam_attempts."user_id" = get_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM practice_sessions
      WHERE practice_sessions.id = answer_attempts.session_id
      AND practice_sessions."user_id" = get_current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM exam_attempts
      WHERE exam_attempts.id = answer_attempts.exam_attempt_id
      AND exam_attempts."user_id" = get_current_user_id()
    )
  );

-- Admins have full access
CREATE POLICY "answer_attempts_admin_all" ON answer_attempts
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - EXAM_ATTEMPTS TABLE
-- =====================================================================

-- Users can manage their own exam attempts
CREATE POLICY "exam_attempts_manage_own" ON exam_attempts
  FOR ALL
  USING ("user_id" = get_current_user_id())
  WITH CHECK ("user_id" = get_current_user_id());

-- Admins have full access
CREATE POLICY "exam_attempts_admin_all" ON exam_attempts
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - EXAM_SECTIONS TABLE
-- =====================================================================

-- Users can manage their own exam sections (via exam attempt ownership)
CREATE POLICY "exam_sections_manage_own" ON exam_sections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts
      WHERE exam_attempts.id = exam_sections.exam_attempt_id
      AND exam_attempts."user_id" = get_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_attempts
      WHERE exam_attempts.id = exam_sections.exam_attempt_id
      AND exam_attempts."user_id" = get_current_user_id()
    )
  );

-- Admins have full access
CREATE POLICY "exam_sections_admin_all" ON exam_sections
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - NOTIFICATIONS TABLE
-- =====================================================================

-- Users can read their own notifications
CREATE POLICY "notifications_read_own" ON notifications
  FOR SELECT
  USING ("user_id" = get_current_user_id() OR "user_id" IS NULL);

-- Users can update their own notifications (mark as read)
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE
  USING ("user_id" = get_current_user_id())
  WITH CHECK ("user_id" = get_current_user_id());

-- Admins have full access
CREATE POLICY "notifications_admin_all" ON notifications
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - ADMIN_AUDIT_LOGS TABLE
-- =====================================================================

-- Only admins can read audit logs
CREATE POLICY "admin_audit_logs_admin_only" ON admin_audit_logs
  FOR SELECT
  USING (is_current_user_admin());

-- Only admins can insert audit logs
CREATE POLICY "admin_audit_logs_admin_insert" ON admin_audit_logs
  FOR INSERT
  WITH CHECK (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - SYSTEM_EVENT_LOGS TABLE
-- =====================================================================

-- Only admins can read system event logs
CREATE POLICY "system_event_logs_admin_only" ON system_event_logs
  FOR SELECT
  USING (is_current_user_admin());

-- System can insert logs (via service account)
CREATE POLICY "system_event_logs_insert" ON system_event_logs
  FOR INSERT
  WITH CHECK (true);

-- =====================================================================
-- RLS POLICIES - CHAT_MESSAGES TABLE
-- =====================================================================

-- For now, all authenticated users can read all chat messages
-- TODO: Add user_id column to chat_messages for proper scoping
CREATE POLICY "chat_messages_authenticated_read" ON chat_messages
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

-- All authenticated users can insert
CREATE POLICY "chat_messages_authenticated_insert" ON chat_messages
  FOR INSERT
  WITH CHECK (get_current_user_id() IS NOT NULL);

-- =====================================================================
-- RLS POLICIES - QUESTIONS TABLE
-- =====================================================================

-- All authenticated users can read questions
CREATE POLICY "questions_authenticated_read" ON questions
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

-- Only admins can modify questions
CREATE POLICY "questions_admin_modify" ON questions
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - DOCUMENTS TABLE
-- =====================================================================

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read documents
CREATE POLICY "documents_authenticated_read" ON documents
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

-- Only admins can modify documents
CREATE POLICY "documents_admin_modify" ON documents
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - DOC_CHUNKS TABLE
-- =====================================================================

ALTER TABLE doc_chunks ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read doc chunks
CREATE POLICY "doc_chunks_authenticated_read" ON doc_chunks
  FOR SELECT
  USING (get_current_user_id() IS NOT NULL);

-- Only admins can modify doc chunks
CREATE POLICY "doc_chunks_admin_modify" ON doc_chunks
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - BATCH JOBS TABLE
-- =====================================================================

ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;

-- Only admins can access batch jobs
CREATE POLICY "batch_jobs_admin_only" ON batch_jobs
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- RLS POLICIES - BATCH_FILE_PROGRESS TABLE
-- =====================================================================

ALTER TABLE batch_file_progress ENABLE ROW LEVEL SECURITY;

-- Only admins can access batch file progress
CREATE POLICY "batch_file_progress_admin_only" ON batch_file_progress
  FOR ALL
  USING (is_current_user_admin());

-- =====================================================================
-- GRANT PERMISSIONS
-- =====================================================================

-- Grant access to authenticated users (via service role)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;

-- =====================================================================
-- INDEXES FOR RLS PERFORMANCE
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON "user_progress"("user_id");
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_id ON practice_sessions("user_id");
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_id ON exam_attempts("user_id");
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications("user_id");
CREATE INDEX IF NOT EXISTS idx_answer_attempts_session_id ON answer_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_answer_attempts_exam_attempt_id ON answer_attempts(exam_attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_sections_exam_attempt_id ON exam_sections(exam_attempt_id);

-- =====================================================================
-- COMPLETE ✅
-- =====================================================================
-- PostgreSQL RLS policies created for all tables
-- RLS enforced via custom session context (app.current_user_id)
-- Middleware must call set_current_user_id() after JWT verification
-- =====================================================================
