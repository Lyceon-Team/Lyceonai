-- RLS Policies for exam_attempts table
-- Users can only access their own exam attempts

ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;

-- Users can view their own exam attempts
CREATE POLICY "exam_attempts_select_own"
ON exam_attempts FOR SELECT
USING (user_id = auth.uid());

-- Users can create their own exam attempts
CREATE POLICY "exam_attempts_insert_own"
ON exam_attempts FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can update their own exam attempts
CREATE POLICY "exam_attempts_update_own"
ON exam_attempts FOR UPDATE
USING (user_id = auth.uid());

-- Users can delete their own exam attempts
CREATE POLICY "exam_attempts_delete_own"
ON exam_attempts FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE exam_attempts IS 'RLS enabled - users can only access their own exam attempts';
