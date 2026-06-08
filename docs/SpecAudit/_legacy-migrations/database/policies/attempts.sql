-- RLS Policies for attempts table
-- Users can only access their own answer attempts

ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;

-- Users can view their own attempts
CREATE POLICY "attempts_select_own"
ON attempts FOR SELECT
USING (user_id = auth.uid());

-- Users can create their own attempts
CREATE POLICY "attempts_insert_own"
ON attempts FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can update their own attempts (rare, but allowed)
CREATE POLICY "attempts_update_own"
ON attempts FOR UPDATE
USING (user_id = auth.uid());

-- Users can delete their own attempts
CREATE POLICY "attempts_delete_own"
ON attempts FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE attempts IS 'RLS enabled - users can only access their own answer attempts';
