-- Migration 0002: RLS Policies
-- Enables Row Level Security on all tables and applies security policies

-- RLS Policies for users table
-- Users can only read and update their own profile

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_self"
ON users FOR SELECT
USING (id = auth.uid());

CREATE POLICY "users_update_self"
ON users FOR UPDATE
USING (id = auth.uid());

COMMENT ON TABLE users IS 'RLS enabled - users can only see/edit their own profile';

-- RLS Policies for progress table
-- Users can only access their own progress data

ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_select_own"
ON progress FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "progress_insert_own"
ON progress FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "progress_update_own"
ON progress FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "progress_delete_own"
ON progress FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE progress IS 'RLS enabled - users can only access their own progress';

-- RLS Policies for attempts table
-- Users can only access their own answer attempts

ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attempts_select_own"
ON attempts FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "attempts_insert_own"
ON attempts FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "attempts_update_own"
ON attempts FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "attempts_delete_own"
ON attempts FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE attempts IS 'RLS enabled - users can only access their own answer attempts';

-- RLS Policies for practice_sessions table
-- Users can only access their own practice sessions

ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "practice_sessions_select_own"
ON practice_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "practice_sessions_insert_own"
ON practice_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "practice_sessions_update_own"
ON practice_sessions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "practice_sessions_delete_own"
ON practice_sessions FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE practice_sessions IS 'RLS enabled - users can only access their own practice sessions';

-- RLS Policies for exam_attempts table
-- Users can only access their own exam attempts

ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exam_attempts_select_own"
ON exam_attempts FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "exam_attempts_insert_own"
ON exam_attempts FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "exam_attempts_update_own"
ON exam_attempts FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "exam_attempts_delete_own"
ON exam_attempts FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE exam_attempts IS 'RLS enabled - users can only access their own exam attempts';

-- RLS Policies for notifications table
-- Users can only access their own notifications and system-wide notifications

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own_or_system"
ON notifications FOR SELECT
USING (
  user_id = auth.uid() OR user_id IS NULL
);

CREATE POLICY "notifications_insert_own"
ON notifications FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
ON notifications FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
ON notifications FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE notifications IS 'RLS enabled - users see own notifications + system-wide';

-- RLS Policies for chat_messages table
-- Users can only access their own chat messages

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_select_own"
ON chat_messages FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "chat_messages_insert_own"
ON chat_messages FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_messages_update_own"
ON chat_messages FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "chat_messages_delete_own"
ON chat_messages FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE chat_messages IS 'RLS enabled - users can only access their own chat messages';

-- RLS Policies for orgs, courses, sections, items
-- Org-scoped visibility based on membership

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs_select_member"
ON orgs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = orgs.id AND m.user_id = auth.uid()
  )
);

CREATE POLICY "memberships_select_member"
ON memberships FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id AND m.user_id = auth.uid()
  )
);

CREATE POLICY "memberships_insert_admin"
ON memberships FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id 
      AND m.user_id = auth.uid() 
      AND m.role = 'admin'
  )
);

CREATE POLICY "memberships_update_admin"
ON memberships FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id 
      AND m.user_id = auth.uid() 
      AND m.role = 'admin'
  )
);

CREATE POLICY "memberships_delete_admin"
ON memberships FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = memberships.org_id 
      AND m.user_id = auth.uid() 
      AND m.role = 'admin'
  )
);

CREATE POLICY "courses_select_public_or_member"
ON courses FOR SELECT
USING (
  visibility = 'public'
  OR (
    visibility = 'org'
    AND org_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = courses.org_id AND m.user_id = auth.uid()
    )
  )
);

CREATE POLICY "sections_select_via_course"
ON sections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM courses c
    WHERE c.id = sections.course_id
      AND (
        c.visibility = 'public'
        OR (
          c.visibility = 'org'
          AND c.org_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
          )
        )
      )
  )
);

CREATE POLICY "items_select_via_course"
ON items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sections s
    JOIN courses c ON c.id = s.course_id
    WHERE s.id = items.section_id
      AND (
        c.visibility = 'public'
        OR (
          c.visibility = 'org'
          AND c.org_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.org_id = c.org_id AND m.user_id = auth.uid()
          )
        )
      )
  )
);

COMMENT ON TABLE orgs IS 'RLS enabled - visible to org members';
COMMENT ON TABLE memberships IS 'RLS enabled - managed by org admins';
COMMENT ON TABLE courses IS 'RLS enabled - public or org-member access';
COMMENT ON TABLE sections IS 'RLS enabled - inherit course visibility';
COMMENT ON TABLE items IS 'RLS enabled - inherit course visibility';

-- RLS Policies for questions table
-- Questions use canonical global-bank access controls

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "questions_select_authenticated"
ON questions FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "questions_insert_admin"
ON questions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

CREATE POLICY "questions_update_admin"
ON questions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

CREATE POLICY "questions_delete_admin"
ON questions FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

COMMENT ON TABLE questions IS 'RLS enabled - authenticated read, admin write';

-- RLS Policies for jobs, batch_file_progress, exam_sections
-- User-scoped or relation-scoped access

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_file_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_select_own"
ON jobs FOR SELECT
USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "batch_file_progress_select_via_job"
ON batch_file_progress FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = batch_file_progress.batch_job_id
      AND (j.user_id = auth.uid() OR j.user_id IS NULL)
  )
);

CREATE POLICY "exam_sections_select_via_exam"
ON exam_sections FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM exam_attempts e
    WHERE e.id = exam_sections.exam_attempt_id
      AND e.user_id = auth.uid()
  )
);

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

-- RLS Policies for audit_logs and system_event_logs
-- Admin-only access

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select_admin"
ON audit_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

CREATE POLICY "system_event_logs_select_admin"
ON system_event_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);

COMMENT ON TABLE jobs IS 'RLS enabled - users see their own jobs';
COMMENT ON TABLE batch_file_progress IS 'RLS enabled - visible via job ownership';
COMMENT ON TABLE exam_sections IS 'RLS enabled - visible via exam attempt ownership';
COMMENT ON TABLE audit_logs IS 'RLS enabled - admin-only access';
COMMENT ON TABLE system_event_logs IS 'RLS enabled - admin-only access';

COMMENT ON SCHEMA public IS 'SAT Learning Copilot - RLS Policies v1 Applied';

