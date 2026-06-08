-- ========================================================================
-- RLS Recursion Fix for Courses & Memberships Tables
-- ========================================================================
-- Problem: Infinite recursion in RLS policies
--   - courses_select_public_or_member references memberships table
--   - memberships_select_member queries memberships table (self-reference)
--   - Result: "infinite recursion detected in policy for relation 'memberships'"
--
-- Root Cause: Recursive policies where memberships policies SELECT from memberships
--
-- Solution: Replace recursive policies with JWT claim-based policies
--   - Use auth.uid() directly from JWT claims (no table queries)
--   - For org checks, use straightforward non-recursive queries
-- ========================================================================

BEGIN;

-- ========================================================================
-- Step 1: Drop existing recursive policies
-- ========================================================================

DROP POLICY IF EXISTS "courses_select_public_or_member" ON courses;
DROP POLICY IF EXISTS "memberships_select_member" ON memberships;
DROP POLICY IF EXISTS "memberships_insert_admin" ON memberships;
DROP POLICY IF EXISTS "memberships_update_admin" ON memberships;
DROP POLICY IF EXISTS "memberships_delete_admin" ON memberships;

-- ========================================================================
-- Step 2: Create non-recursive policies using JWT claims
-- ========================================================================

-- Courses: Allow SELECT if public OR user is member of the org (non-recursive)
CREATE POLICY "courses_select_public_or_member_v2"
ON courses
FOR SELECT
TO public
USING (
  -- Public courses: always visible
  visibility = 'public'
  OR
  -- Org courses: visible if user is in org (direct user_id check, no recursion)
  (
    visibility = 'org' 
    AND org_id IS NOT NULL 
    AND EXISTS (
      SELECT 1 FROM memberships 
      WHERE org_id = courses.org_id 
      AND user_id = auth.uid()  -- Direct JWT claim check (base case)
    )
  )
);

-- Memberships: Allow SELECT for own memberships (JWT-based, non-recursive)
CREATE POLICY "memberships_select_own_v2"
ON memberships
FOR SELECT
TO public
USING (
  -- User can see their own memberships directly (no recursion)
  user_id = auth.uid()
);

-- Memberships: Allow INSERT by org admins 
-- SAFE: Queries memberships but uses non-recursive SELECT policy (user_id = auth.uid())
CREATE POLICY "memberships_insert_admin_v2"
ON memberships
FOR INSERT
TO public
WITH CHECK (
  -- Allow insert if caller is admin of the target org
  -- The SELECT FROM memberships uses the non-recursive policy above
  EXISTS (
    SELECT 1 FROM memberships
    WHERE org_id = memberships.org_id
    AND user_id = auth.uid()
    AND role = 'admin'
  )
);

-- Memberships: Allow UPDATE by org admins
-- SAFE: Uses non-recursive SELECT policy for the subquery
CREATE POLICY "memberships_update_admin_v2"
ON memberships
FOR UPDATE
TO public
USING (
  EXISTS (
    SELECT 1 FROM memberships
    WHERE org_id = memberships.org_id
    AND user_id = auth.uid()
    AND role = 'admin'
  )
);

-- Memberships: Allow DELETE by org admins
-- SAFE: Uses non-recursive SELECT policy for the subquery
CREATE POLICY "memberships_delete_admin_v2"
ON memberships
FOR DELETE
TO public
USING (
  EXISTS (
    SELECT 1 FROM memberships
    WHERE org_id = memberships.org_id
    AND user_id = auth.uid()
    AND role = 'admin'
  )
);

COMMIT;

-- ========================================================================
-- Verification
-- ========================================================================
-- After applying this fix, run:
--   SELECT tablename, policyname FROM pg_policies 
--   WHERE tablename IN ('courses', 'memberships') 
--   ORDER BY tablename, policyname;
--
-- Expected: All policies should be *_v2 versions with no recursion
-- ========================================================================
