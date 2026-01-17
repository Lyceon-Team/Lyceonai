-- RLS Policies for notifications table
-- Users can only access their own notifications and system-wide notifications

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications and system-wide notifications (user_id IS NULL)
CREATE POLICY "notifications_select_own_or_system"
ON notifications FOR SELECT
USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can update (mark as read) their own notifications
CREATE POLICY "notifications_update_own"
ON notifications FOR UPDATE
USING (user_id = auth.uid());

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own"
ON notifications FOR DELETE
USING (user_id = auth.uid());

-- System creates notifications (no user insert policy - admin/system only)

COMMENT ON TABLE notifications IS 'RLS enabled - users see their own notifications + system broadcasts';
