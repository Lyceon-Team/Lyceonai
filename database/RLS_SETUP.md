# PostgreSQL Row Level Security (RLS) Setup

This guide explains how to enable and configure Row Level Security for the Neon PostgreSQL database.

## Overview

The application implements RLS at two layers:
1. **Application Layer**: Middleware verifies Supabase JWT and filters queries by `req.user.id`
2. **Database Layer**: PostgreSQL RLS policies provide defense-in-depth security

## Architecture

Since we use **Neon PostgreSQL** (separate from Supabase), we cannot use Supabase's `auth.uid()` function. Instead:

1. Supabase middleware verifies JWT and attaches `req.user` to request
2. Middleware sets PostgreSQL session context: `set_current_user_id(user_id)`
3. RLS policies use `get_current_user_id()` to enforce access control

## Applying RLS Policies

### Option 1: Using Drizzle (Recommended for production)

Add the RLS SQL to a Drizzle migration:

```bash
# Generate a new migration
npm run db:generate

# Edit the generated SQL file in migrations/
# Add the contents of database/postgresql-rls-policies.sql

# Apply the migration
npm run db:push
```

### Option 2: Direct SQL Execution (Development/Testing)

Apply the RLS policies directly to your database:

```bash
# Using psql
psql $DATABASE_URL -f database/postgresql-rls-policies.sql

# Or using a database client
# Copy contents of database/postgresql-rls-policies.sql
# Execute in your database GUI (Neon Console, pgAdmin, etc.)
```

## RLS Policies Summary

### User-Scoped Tables

| Table | Policy | Description |
|-------|--------|-------------|
| `users` | users_select_own | Users can view own profile |
| `users` | users_update_own | Users can update own profile (not role) |
| `user_progress` | user_progress_manage_own | Users manage own progress |
| `practice_sessions` | practice_sessions_manage_own | Users manage own sessions |
| `answer_attempts` | answer_attempts_manage_own | Users manage own attempts via session |
| `exam_attempts` | exam_attempts_manage_own | Users manage own exam attempts |
| `exam_sections` | exam_sections_manage_own | Users manage own exam sections |
| `notifications` | notifications_read_own | Users read own notifications |

### Admin-Only Tables

| Table | Policy | Description |
|-------|--------|-------------|
| `admin_audit_logs` | admin_audit_logs_admin_only | Only admins can read |
| `system_event_logs` | system_event_logs_admin_only | Only admins can read |
| `batch_jobs` | batch_jobs_admin_only | Only admins can access |
| `batch_file_progress` | batch_file_progress_admin_only | Only admins can access |

### Public (Authenticated) Tables

| Table | Policy | Description |
|-------|--------|-------------|
| `questions` | questions_authenticated_read | All authenticated users can read |
| `questions` | questions_admin_modify | Only admins can modify |
| `documents` | documents_authenticated_read | All authenticated users can read |
| `doc_chunks` | doc_chunks_authenticated_read | All authenticated users can read |

## Custom Functions

The RLS implementation uses custom PostgreSQL functions:

- `set_current_user_id(user_id text)` - Sets current user ID in session
- `get_current_user_id()` - Gets current user ID from session
- `is_current_user_admin()` - Checks if current user is admin

These are called by the Supabase auth middleware in `server/middleware/supabase-auth.ts`.

## Testing RLS

Run the comprehensive RLS test suite:

```bash
npm run test -- tests/specs/rls-auth-enforcement.spec.ts
```

Tests verify:
- ✅ All /api/* routes require Supabase JWT authentication
- ✅ Users can only access their own data
- ✅ Cross-user data access is denied
- ✅ Admin users can access all data
- ✅ PostgreSQL session context is set correctly

## Troubleshooting

### RLS Functions Not Found

If you get errors about missing functions:

```sql
-- Run this to create the functions
SELECT set_current_user_id('test-user-id');
```

If the function doesn't exist, re-apply the migration SQL.

### RLS Policies Not Working

1. Check if RLS is enabled:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

2. Verify policies exist:
```sql
SELECT * FROM pg_policies WHERE schemaname = 'public';
```

3. Check middleware is setting context:
```sql
-- In a test request, check if context is set
SELECT current_setting('app.current_user_id', true);
```

### Performance Issues

RLS policies use indexes for optimal performance:
- `idx_user_progress_user_id`
- `idx_practice_sessions_user_id`
- `idx_exam_attempts_user_id`
- `idx_notifications_user_id`

Ensure these indexes exist:
```sql
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';
```

## Security Notes

1. **Defense in Depth**: RLS provides database-level security even if application code has bugs
2. **Service Role Bypass**: Admin operations use service role which bypasses RLS
3. **Session Context**: PostgreSQL session context is request-scoped and cleared after each request
4. **JWT Verification**: Supabase middleware verifies JWT signature before setting context

## Migration Checklist

- [ ] Apply RLS migration SQL to database
- [ ] Verify functions are created (`set_current_user_id`, `get_current_user_id`, `is_current_user_admin`)
- [ ] Confirm RLS is enabled on all tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- [ ] Check policies are created (`SELECT * FROM pg_policies`)
- [ ] Run RLS test suite (`npm run test -- tests/specs/rls-auth-enforcement.spec.ts`)
- [ ] Verify indexes exist for performance
- [ ] Test with real users in development environment
