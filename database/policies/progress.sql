-- RLS Policies for progress table
-- Users can only access their own progress data

ALTER TABLE progress ENABLE ROW LEVEL SECURITY;

-- Users can view their own progress
CREATE POLICY "progress_select_own"
ON progress FOR SELECT
USING (user_id = auth.uid());

-- Users can insert their own progress records
CREATE POLICY "progress_insert_own"
ON progress FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can update their own progress
CREATE POLICY "progress_update_own"
ON progress FOR UPDATE
USING (user_id = auth.uid());

-- Users can delete their own progress
CREATE POLICY "progress_delete_own"
ON progress FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE progress IS 'RLS enabled - users can only access their own progress';
