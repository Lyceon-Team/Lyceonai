-- RLS Policies for jobs, audit logs, and system logs
-- Jobs are user-scoped, audit logs are admin-viewable, system logs are restricted

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_file_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- JOBS POLICIES (user-scoped background jobs)
-- ============================================================================

-- Users can view their own jobs
CREATE POLICY "jobs_select_own"
ON jobs FOR SELECT
USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can create their own jobs
CREATE POLICY "jobs_insert_own"
ON jobs FOR INSERT
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users can update their own jobs (cancel, etc.)
CREATE POLICY "jobs_update_own"
ON jobs FOR UPDATE
USING (user_id = auth.uid() OR user_id IS NULL);

-- ============================================================================
-- BATCH FILE PROGRESS POLICIES
-- ============================================================================

-- Users can view batch file progress for their jobs
CREATE POLICY "batch_file_progress_select_via_job"
ON batch_file_progress FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = batch_file_progress.batch_job_id
      AND (j.user_id = auth.uid() OR j.user_id IS NULL)
  )
);

-- System creates batch file progress (no user insert)

-- ============================================================================
-- EXAM SECTIONS POLICIES
-- ============================================================================

-- Users can view exam sections for their own exam attempts
CREATE POLICY "exam_sections_select_via_exam"
ON exam_sections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM exam_attempts e
    WHERE e.id = exam_sections.exam_attempt_id
      AND e.user_id = auth.uid()
  )
);

-- Users can create/update exam sections for their own exams
CREATE POLICY "exam_sections_insert_via_exam"
ON exam_sections FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM exam_attempts e
    WHERE e.id = exam_sections.exam_attempt_id
      AND e.user_id = auth.uid()
  )
);

CREATE POLICY "exam_sections_update_via_exam"
ON exam_sections FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM exam_attempts e
    WHERE e.id = exam_sections.exam_attempt_id
      AND e.user_id = auth.uid()
  )
);

-- ============================================================================
-- AUDIT LOGS POLICIES (admin-viewable only)
-- ============================================================================

-- Only admins can view audit logs
CREATE POLICY "audit_logs_select_admin"
ON audit_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

-- System creates audit logs (no user insert)

-- ============================================================================
-- SYSTEM EVENT LOGS POLICIES (restricted)
-- ============================================================================

-- Only admins can view system event logs
CREATE POLICY "system_event_logs_select_admin"
ON system_event_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

-- System creates event logs (no user insert)

COMMENT ON TABLE jobs IS 'RLS enabled - users see their own jobs';
COMMENT ON TABLE batch_file_progress IS 'RLS enabled - visible via job ownership';
COMMENT ON TABLE exam_sections IS 'RLS enabled - visible via exam attempt ownership';
COMMENT ON TABLE audit_logs IS 'RLS enabled - admin-only access';
COMMENT ON TABLE system_event_logs IS 'RLS enabled - admin-only access';
