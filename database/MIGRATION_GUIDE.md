# Supabase Migration Guide

## Overview

This guide explains how to migrate your SAT Learning Copilot from Neon PostgreSQL (application-level enforcement) to Supabase PostgreSQL (database-level RLS).

## Prerequisites

**Required Secrets in Replit:**
- `SUPABASE_URL` ✅ (already set)
- `SUPABASE_ANON_KEY` ✅ (already set)
- `SUPABASE_SERVICE_ROLE_KEY` ✅ (already set)
- `SUPABASE_DB_URL` ✅ (already set)

## Migration Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "db:migrate:supabase": "tsx scripts/apply_migrations.ts",
    "db:verify:rls": "tsx scripts/verify_rls.ts",
    "db:check:rls": "tsx scripts/check_rls_enabled.ts",
    "test:rls": "vitest run tests/rls"
  }
}
```

## Step-by-Step Migration

### 1. Apply Schema Migrations

```bash
npm run db:migrate:supabase
```

This will:
- Create all tables with proper FKs and indexes
- Enable pgvector extension
- Apply all RLS policies
- Seed SAT taxonomy data

### 2. Verify RLS is Enabled

```bash
npm run db:check:rls
```

This checks that all user/org tables have `row_security = ON`.

### 3. Run RLS Verification Tests

```bash
npm run db:verify:rls
```

This creates test users and verifies cross-user data isolation.

### 4. Run Full RLS Test Suite

```bash
npm run test:rls
```

Comprehensive tests using Vitest + Supertest.

## What Changes

### Before (Neon + Application-Level Enforcement)

```typescript
// Middleware verifies JWT
const sessions = await db.select()
  .from(practiceSessions)
  .where(eq(practiceSessions.userId, req.user.id)); // Manual filtering
```

### After (Supabase + Database RLS)

```typescript
// Middleware verifies JWT and sets auth.uid()
const sessions = await db.select()
  .from(practiceSessions); // RLS filters automatically!
```

## Database Connection

The app will automatically use `SUPABASE_DB_URL` when available, falling back to `DATABASE_URL` (Neon) if not.

To force Supabase:
1. Update `apps/api/src/db/client.ts` to prefer `SUPABASE_DB_URL`
2. Configure connection to pass JWT for `auth.uid()` context

## Rollback Plan

If migration fails or you need to rollback:

```bash
npm run db:migrate:supabase -- --down 1  # Rollback last migration
npm run db:migrate:supabase -- --down 2  # Rollback last 2 migrations
```

**Note:** Rollback only works in non-production environments.

## Production Deployment Checklist

- [ ] Apply migrations to Supabase production database
- [ ] Verify RLS is enabled on all tables
- [ ] Run RLS verification script with real users
- [ ] Update environment to use `SUPABASE_DB_URL`
- [ ] Test authentication flow end-to-end
- [ ] Monitor for any RLS policy violations in logs

## Troubleshooting

### Migration fails on policy import

**Error:** `\i database/policies/users.sql` not found

**Solution:** Use absolute paths or run migrations from project root:
```bash
cd /path/to/project
npm run db:migrate:supabase
```

### RLS blocks admin access

**Issue:** Admin routes return empty results

**Solution:** Admin policies need `is_admin` check:
```sql
CREATE POLICY "admin_select_all"
ON table_name FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.is_admin = true
  )
);
```

### auth.uid() returns NULL

**Issue:** RLS policies see NULL user

**Solution:** Ensure JWT is passed to database connection:
```typescript
// Set JWT in request context
const client = await pool.connect();
await client.query(`SET request.jwt.claim.sub = '${userId}'`);
```

## Additional Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- `database/policies/` - All RLS policy definitions
- `tests/rls/` - Comprehensive RLS test suite
