# Supabase Database Migration Summary

## Overview
Consolidated authentication and profile data to use Supabase database exclusively. Local/Neon PostgreSQL is now DEPRECATED for auth-related operations.

## Changes Made

### 1. Database Setup (Supabase)
**File**: `database/supabase-profiles-setup.sql`

**ACTION REQUIRED**: Run this SQL in your Supabase SQL Editor

Key features:
- `profiles` table with RLS policies
- Auto-insert trigger (`handle_new_user`) creates profile on signup
- Proper indexes for performance
- Row-level security enforcing user isolation

### 2. Backend Changes

**File**: `server/routes/supabase-auth-routes.ts`
- ✅ Signup route now relies on Supabase trigger for profile creation
- ✅ No more manual profile insertion in local DB
- ✅ Under-13 consent updates go to Supabase profiles table
- ✅ All auth operations use Supabase Admin client exclusively

**File**: `server/middleware/supabase-auth.ts`
- ✅ Already configured to fetch profiles from Supabase
- ✅ Uses RLS-enforced queries for user isolation

### 3. Frontend Changes (Already Complete)

**File**: `client/src/contexts/SupabaseAuthContext.tsx`
- ✅ SignUp calls backend API `/api/auth/signup`
- ✅ Google OAuth uses `signInWithOAuth` without `redirectTo`
- ✅ Auth callback uses `exchangeCodeForSession`

**File**: `client/src/pages/auth-callback.tsx`
- ✅ OAuth callback redirects to `/dashboard` (line 41)

**File**: `client/src/components/auth/SupabaseAuthForm.tsx`
- ✅ Post-signin redirects to `/dashboard` (line 43)
- ✅ Post-signup redirects to `/dashboard` (line 78)

**File**: `client/src/pages/login.tsx`
- ✅ Route guard redirects authenticated users to `/dashboard` (line 19)

**File**: `client/src/components/NavBar.tsx`
- ✅ Progress link navigates to `/dashboard` (line 38)

### 4. Local Database Status

**DEPRECATED for auth/profiles**:
- `apps/api/src/db/client.ts` - Uses local DATABASE_URL (Neon)
- This is still used for non-auth tables (questions, jobs, etc.)
- **Auth-related writes now go to Supabase exclusively**

## Architecture

```
┌─────────────────────────────────────────┐
│         Supabase Cloud                  │
├─────────────────────────────────────────┤
│  auth.users (Supabase Auth)             │
│     ↓ (trigger: handle_new_user)        │
│  public.profiles (with RLS)             │
│     - id → auth.users(id)               │
│     - email, display_name, role         │
│     - is_under_13, guardian_consent     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│      Local Neon PostgreSQL              │
├─────────────────────────────────────────┤
│  questions, jobs, practice_sessions,    │
│  user_progress, etc.                    │
│  (Non-auth application data)            │
└─────────────────────────────────────────┘
```

## Authentication Flow

### Email/Password Signup:
1. Frontend → POST `/api/auth/signup`
2. Backend → `supabase.auth.signUp()`
3. Supabase → Creates `auth.users` entry
4. Supabase Trigger → Auto-creates `profiles` row
5. Backend → Sets HTTP-only cookies
6. Frontend → Redirects to `/dashboard`

### Google OAuth:
1. Frontend → `supabase.auth.signInWithOAuth({ provider: 'google' })`
2. User → Authenticates with Google
3. Google → Redirects to `/auth/callback`
4. Frontend → `exchangeCodeForSession(window.location.href)`
5. Supabase → Creates session
6. Frontend → Redirects to `/dashboard`

### Session Management:
- JWT stored in HTTP-only cookies (`sb-access-token`, `sb-refresh-token`)
- Frontend reads session via `supabase.auth.getSession()`
- Auth context extracts user from session.user
- No backend `/api/auth/user` call needed

## Required Action

**You must run the SQL script in Supabase**:

1. Open your Supabase dashboard
2. Go to SQL Editor
3. Copy contents of `database/supabase-profiles-setup.sql`
4. Execute the SQL
5. Verify: `SELECT COUNT(*) FROM public.profiles;`

## Testing Checklist

After running the SQL script, test:

- [ ] Email signup creates user + profile in Supabase
- [ ] Google OAuth login redirects to `/dashboard`
- [ ] Authenticated user accessing `/login` auto-redirects to `/dashboard`
- [ ] NavBar "Progress" link goes to `/dashboard`
- [ ] Refresh on `/dashboard` maintains authentication
- [ ] Sign out redirects to homepage
- [ ] Unauthenticated access to `/dashboard` shows login prompt

## Files Modified

1. `database/supabase-profiles-setup.sql` - **NEW** (SQL to run in Supabase)
2. `server/routes/supabase-auth-routes.ts` - Updated signup to use trigger
3. `client/src/pages/login.tsx` - Redirect to /dashboard (already fixed)
4. `client/src/components/auth/SupabaseAuthForm.tsx` - Redirect to /dashboard (already fixed)
5. `client/src/components/NavBar.tsx` - Progress link to /dashboard (already fixed)
6. `client/src/contexts/SupabaseAuthContext.tsx` - Use backend API for signup (already fixed)
7. `server/index.ts` - Added localhost origins for development (already fixed)

## Environment Variables Required

✅ All present:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`

## Notes

- Local profiles table in PostgreSQL is ignored for auth
- Supabase trigger auto-creates profiles on signup
- All profile reads/writes use Supabase client
- RLS policies enforce user isolation
- Google OAuth config must have correct callback URL in Supabase dashboard
