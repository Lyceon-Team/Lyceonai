-- RLS Policies for practice_sessions table
-- Users can only access their own practice sessions

ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;

-- Users can view their own practice sessions
CREATE POLICY "practice_sessions_select_own"
ON practice_sessions FOR SELECT
USING (user_id = auth.uid());

-- Users can create their own practice sessions
CREATE POLICY "practice_sessions_insert_own"
ON practice_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can update their own practice sessions
CREATE POLICY "practice_sessions_update_own"
ON practice_sessions FOR UPDATE
USING (user_id = auth.uid());

-- Users can delete their own practice sessions
CREATE POLICY "practice_sessions_delete_own"
ON practice_sessions FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE practice_sessions IS 'RLS enabled - users can only access their own practice sessions';
