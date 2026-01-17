# RLS Recursion Fix Guide

## Executive Summary

**Issue:** Dashboard `/api/progress` endpoint returns 500 error due to RLS policy recursion on `memberships` table in Supabase database.

**Error:** `infinite recursion detected in policy for relation "memberships"`

**Impact:** Authenticated users cannot load dashboard progress data.

**Status:** Fix provided in `courses-memberships-rls-fix.sql` - **requires manual application to Supabase**

---

## Problem Details

### Error Message
```
error: infinite recursion detected in policy for relation "memberships"
PostgreSQL error code: 42P17
Location: /apps/api/src/dao/progress.ts:29 (getAllProgress function)
```

### Root Cause Analysis

The `/api/progress` endpoint executes this query:
```sql
SELECT p.*, c.title as course_title, c.visibility
FROM progress p
LEFT JOIN courses c ON c.id = p.course_id
```

This triggers RLS policies in the following chain:

1. **courses** table SELECT policy: `courses_select_public_or_member`
   ```sql
   EXISTS (SELECT 1 FROM memberships WHERE org_id = courses.org_id AND user_id = auth.uid())
   ```

2. **memberships** table SELECT policy: `memberships_select_member`
   ```sql
   EXISTS (SELECT 1 FROM memberships WHERE org_id = memberships.org_id AND user_id = auth.uid())
   ```

3. **Recursion:** memberships policy queries memberships → triggers same policy → infinite loop

### Why This Happened

Same pattern as the `profiles` table issue:
- RLS policies that query the same table they protect create recursion
- PostgreSQL detects infinite loops and aborts with error code 42P17

---

## The Fix

### File: `database/courses-memberships-rls-fix.sql`

**Strategy:** Replace recursive policies with JWT claim-based policies

### Key Changes

#### Before (Recursive):
```sql
-- memberships_select_member (OLD)
EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid())  -- ❌ Recursive!
```

#### After (Non-Recursive):
```sql
-- memberships_select_own_v2 (NEW)
user_id = auth.uid()  -- ✅ Direct JWT check, no table query
```

### Policy Breakdown

1. **courses_select_public_or_member_v2**
   - Public courses: Always visible
   - Org courses: Checks memberships with non-recursive SELECT policy

2. **memberships_select_own_v2** (Critical fix)
   - Uses direct `user_id = auth.uid()` check
   - No self-referencing queries
   - Stops recursion chain

3. **Admin policies** (insert/update/delete)
   - Query memberships BUT use the non-recursive SELECT policy
   - Safe because SELECT policy has no recursion

---

## How to Apply the Fix

### Step 1: Access Supabase Dashboard
1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT_ID
2. Navigate to **SQL Editor**

### Step 2: Run the Fix Script
1. Open `database/courses-memberships-rls-fix.sql`
2. Copy the entire contents
3. Paste into Supabase SQL Editor
4. Click **Run**

### Step 3: Verify the Fix
Run this verification query in Supabase:
```sql
SELECT tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('courses', 'memberships') 
ORDER BY tablename, policyname;
```

**Expected output:** All policies should have `_v2` suffix
- `courses_select_public_or_member_v2` ✅
- `memberships_select_own_v2` ✅
- `memberships_insert_admin_v2` ✅
- `memberships_update_admin_v2` ✅
- `memberships_delete_admin_v2` ✅

### Step 4: Test the Dashboard
1. Sign in to the application
2. Navigate to `/dashboard`
3. Verify progress data loads without errors
4. Check server logs - should see no "infinite recursion" errors

---

## Rollback Plan

If issues occur, restore original policies:

```sql
-- Restore original courses policy
CREATE POLICY "courses_select_public_or_member"
ON courses FOR SELECT TO public
USING (
  (visibility = 'public') OR 
  (visibility = 'org' AND org_id IS NOT NULL AND 
   EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = courses.org_id AND m.user_id = auth.uid()))
);

-- Restore original memberships policy  
CREATE POLICY "memberships_select_member"
ON memberships FOR SELECT TO public
USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = memberships.org_id AND m.user_id = auth.uid())
);

-- Note: This will restore the recursion error!
```

---

## Related Issues

### Previously Fixed
- **profiles** table recursion (fixed in `profiles-rls-fix.sql`)
- Same pattern: replaced `EXISTS (SELECT FROM profiles)` with `auth.uid() = profiles.user_id`

### Prevention Strategy
**Golden Rule:** RLS policies should NEVER query the table they protect

✅ **GOOD:**
```sql
user_id = auth.uid()  -- Direct JWT claim check
```

❌ **BAD:**
```sql
EXISTS (SELECT 1 FROM same_table WHERE ...)  -- Self-referencing!
```

---

## Technical Notes

### Database Context
- Database: Supabase PostgreSQL (via `SUPABASE_DB_URL`)
- Connection: `withRlsClient` in `apps/api/src/db/withRlsClient.ts`
- JWT injection: `set_config('request.jwt.claims', jwt, true)`
- Role: `SET LOCAL ROLE authenticated`

### Why This Works
- `auth.uid()` extracts user ID from JWT claims (no table query)
- JWT claims set via `request.jwt.claims` config
- PostgreSQL RLS can access these claims without recursion
- Supabase's RLS implementation supports this pattern natively

---

## Support

If you encounter issues after applying this fix:

1. **Check server logs** for new error messages
2. **Verify policies** using the SQL query in Step 3
3. **Test with psql** directly to isolate RLS vs application issues:
   ```bash
   psql "$SUPABASE_DB_URL" -c "SET ROLE authenticated; SET request.jwt.claims = '{\"sub\":\"USER_UUID\"}'; SELECT * FROM courses LIMIT 1;"
   ```

4. **Rollback** if necessary using the rollback plan above
