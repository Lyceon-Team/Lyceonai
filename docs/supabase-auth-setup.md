# Supabase Auth Setup Guide

## Overview
This document outlines the setup process for migrating to Supabase as the single authentication layer for the SAT Learning Copilot application, with FERPA-aligned privacy controls.

## Environment Variables Checklist

### Required Secrets (Already Added)
- ✅ `SUPABASE_URL` - Your Supabase project URL
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Server-only key for admin operations
- ✅ `SUPABASE_ANON_KEY` - Public/anon key for frontend
- ✅ `GOOGLE_CLIENT_ID` - Google OAuth client ID
- ✅ `GOOGLE_CLIENT_SECRET` - Google OAuth client secret

### Optional (For Apple Sign-In - Can add later)
- ⏳ `APPLE_CLIENT_ID`
- ⏳ `APPLE_TEAM_ID`
- ⏳ `APPLE_KEY_ID`
- ⏳ `APPLE_PRIVATE_KEY`

### Application Configuration
Add these to your Replit Secrets:
- `ENABLE_UNDER_13_GATE=true` (For age verification and guardian consent)
- `BASE_URL=https://workspace-amingwa08.replit.app` (Your deployment URL)

## Database Migration Steps

### 1. Run the RLS Migration SQL

**IMPORTANT:** You need to run the SQL migration script in your Supabase dashboard to create the FERPA-aligned schema with Row-Level Security policies.

```sql
-- File: database/supabase-auth-migration.sql
-- Run this entire file in Supabase SQL Editor
```

**Steps:**
1. Go to your Supabase Dashboard → SQL Editor
2. Copy the contents of `database/supabase-auth-migration.sql`
3. Paste into SQL Editor
4. Click "Run" to execute

This creates:
- `profiles` table (minimal PII: email, display_name, role)
- `student_teacher_map` table (teacher-student assignments)
- `practice_sessions` table (session tracking)
- `answer_attempts` table (individual attempts)
- `admin_audit_logs` table (audit trail)
- RLS policies for all tables
- `questions_safe` view (no answers for students)
- Auto-profile creation trigger

### 2. Configure Supabase Auth Providers

#### Email/Password Setup
1. Go to Supabase Dashboard → Authentication → Providers
2. Enable **Email** provider
3. Configure:
   - ✅ Enable email confirmations
   - ✅ Enable password reset emails
   - Set email templates (customize for students/parents)

#### Google OAuth Setup
1. Go to Supabase Dashboard → Authentication → Providers
2. Enable **Google** provider
3. Enter your Google OAuth credentials:
   - Client ID: (from Google Cloud Console)
   - Client Secret: (from Google Cloud Console)
4. **CRITICAL:** Add authorized redirect URI:
   ```
   https://<your-supabase-project>.supabase.co/auth/v1/callback
   ```
5. Also add your app's callback URL:
   ```
   https://workspace-amingwa08.replit.app/auth/callback
   ```

#### Apple OAuth Setup (Optional - Future)
Follow Supabase docs for Apple Sign-In configuration when ready.

### 3. Configure Auth Settings

In Supabase Dashboard → Authentication → Settings:

**URL Configuration:**
- Site URL: `https://workspace-amingwa08.replit.app`
- Redirect URLs (add these):
  - `https://workspace-amingwa08.replit.app/auth/callback`
  - `https://workspace-amingwa08.replit.app/**` (for development)

**Email Auth:**
- ✅ Enable email confirmations
- ✅ Enable password recovery
- Set email templates for student-friendly language

**Security:**
- ✅ Enable refresh token rotation
- Session expiry: 7 days (604800 seconds)
- ✅ Disable "Allow unverified email sign-ins" (for production)

**Advanced:**
- JWT expiry: 3600 seconds (1 hour)
- Enable "Enable Signup" (allow new registrations)

## User Migration

After completing the setup above, existing users will be migrated using the migration script (Task 6).

## FERPA Compliance Summary

### What PII is Stored
- **Minimal PII:** Email address, display name only
- **Location:** `profiles` table in Supabase
- **Access Control:** Row-Level Security enforced

### Who Can Access What
- **Students:** Can read/update own profile, own sessions, own attempts
- **Teachers:** Can read assigned students' profiles, sessions, attempts (via student_teacher_map)
- **Admin:** Full access to all data
- **Public/Unauthenticated:** No access to any user data

### RLS Policy Summary
| Table | Student | Teacher | Admin |
|-------|---------|---------|-------|
| profiles | Own profile only | Assigned students | All |
| student_teacher_map | Own assignments | Own assignments | All |
| practice_sessions | Own sessions (CRUD) | Assigned students (R) | All |
| answer_attempts | Own attempts (CRUD) | Assigned students (R) | All |
| admin_audit_logs | None | None | Read-only |
| questions | Read (no answers) | Read (no answers) | Full |

### Data Protection Features
1. **No PII in questions table** - Questions contain no student data
2. **Answer hiding** - `questions_safe` view excludes answers for students
3. **Audit logging** - All admin actions tracked in `admin_audit_logs`
4. **Guardian consent** - Under-13 tracking in profiles table
5. **Role-based access** - Enforced via RLS policies
6. **Minimal data retention** - Only essential fields stored

## Next Steps

After completing this setup:
1. ✅ Run SQL migration in Supabase
2. ✅ Configure auth providers
3. ✅ Set redirect URLs
4. 🔄 Backend implementation (Express middleware)
5. 🔄 Frontend implementation (React components)
6. 🔄 User migration
7. 🔄 Testing
8. 🔄 Documentation

## Verification Checklist

Before going live, verify:
- [ ] All tables have RLS enabled
- [ ] Students cannot see other students' data
- [ ] Teachers can only see assigned students
- [ ] Admin actions are logged
- [ ] Questions do not expose answers to students
- [ ] Under-13 consent gate works
- [ ] Google OAuth flow works
- [ ] Email/Password signup works
- [ ] Password reset works
- [ ] All tests pass

## Support

For issues or questions:
- Supabase RLS docs: https://supabase.com/docs/guides/auth/row-level-security
- Auth docs: https://supabase.com/docs/guides/auth
- FERPA guidelines: https://www2.ed.gov/policy/gen/guid/fpco/ferpa/index.html
