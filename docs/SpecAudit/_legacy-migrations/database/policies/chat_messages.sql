-- RLS Policies for chat_messages table
-- Users can only access their own chat history

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can view their own chat messages
CREATE POLICY "chat_messages_select_own"
ON chat_messages FOR SELECT
USING (user_id = auth.uid());

-- Users can create their own chat messages
CREATE POLICY "chat_messages_insert_own"
ON chat_messages FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Users can delete their own chat history
CREATE POLICY "chat_messages_delete_own"
ON chat_messages FOR DELETE
USING (user_id = auth.uid());

COMMENT ON TABLE chat_messages IS 'RLS enabled - users can only access their own chat history';
