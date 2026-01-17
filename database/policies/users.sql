-- RLS Policies for users table
-- Users can only read and update their own profile

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can select their own profile
CREATE POLICY "users_select_self"
ON users FOR SELECT
USING (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "users_update_self"
ON users FOR UPDATE
USING (id = auth.uid());

-- System/admin controlled inserts (no public insert policy)
-- User creation happens via Supabase Auth or admin endpoints

COMMENT ON TABLE users IS 'RLS enabled - users can only see/edit their own profile';
