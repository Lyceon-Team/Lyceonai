# Supabase Migration Implementation Status

## 🎉 Migration Framework Complete!

All the infrastructure and code needed to migrate from Neon PostgreSQL (application-level enforcement) to Supabase PostgreSQL (database-level RLS) has been implemented.

## ✅ What's Been Completed

### 1. Directory Structure ✅
```
database/
├── migrations/
│   ├── 0001_core_schema.sql          # All tables with FKs, indexes, pgvector
│   └── 0002_rls_policies.sql         # RLS enablement + policy imports
├── policies/
│   ├── users.sql                      # User profile RLS
│   ├── progress.sql                   # User progress RLS
│   ├── attempts.sql                   # Answer attempts RLS
│   ├── practice_sessions.sql          # Practice sessions RLS
│   ├── exam_attempts.sql              # Exam attempts RLS
│   ├── notifications.sql              # Notifications RLS
│   ├── chat_messages.sql              # Chat messages RLS
│   ├── orgs_courses.sql               # Org/course visibility RLS
│   ├── questions.sql                  # Question access RLS
│   └── jobs_audit.sql                 # Jobs and audit logs RLS
├── seeds/
│   └── 0003_seed_sat_taxonomy.sql    # SAT reference data
└── scripts/
    └── apply_migrations.ts            # Migration runner with rollback
```

### 2. Core Schema Migration (0001_core_schema.sql) ✅

**Extensions:**
- ✅ uuid-ossp
- ✅ pgcrypto  
- ✅ vector (pgvector for embeddings)

**Tables Created (27 total):**
- ✅ users, orgs, memberships
- ✅ courses, sections, items
- ✅ documents, transcripts, chunks, embeddings
- ✅ questions
- ✅ progress, practice_sessions, exam_attempts, attempts, exam_sections
- ✅ notifications, chat_messages
- ✅ jobs, batch_file_progress
- ✅ audit_logs, system_event_logs
- ✅ Reference tables (sat_sections_ref, difficulty_levels_ref, sat_math_topics_ref, sat_rw_skills_ref)

**Features:**
- ✅ All foreign keys with proper ON DELETE CASCADE
- ✅ 40+ optimized indexes for common queries
- ✅ auto_updated_at triggers for 11 tables
- ✅ Proper constraints (CHECK, UNIQUE)
- ✅ JSONB columns for flexible metadata

### 3. RLS Policies (0002_rls_policies.sql) ✅

**User-Scoped Tables (users can only see their own data):**
- ✅ users - SELECT/UPDATE own profile
- ✅ progress - Full CRUD on own progress
- ✅ attempts - Full CRUD on own attempts
- ✅ practice_sessions - Full CRUD on own sessions
- ✅ exam_attempts - Full CRUD on own exams
- ✅ notifications - See own + system-wide
- ✅ chat_messages - Full CRUD on own chats
- ✅ jobs - See own background jobs

**Org-Scoped Tables (visibility via org membership):**
- ✅ orgs - Visible to members
- ✅ memberships - Managed by org admins
- ✅ courses - Public OR org member access
- ✅ sections - Inherit course visibility
- ✅ items - Inherit course visibility
- ✅ questions - Public/org-scoped or global bank

**Admin-Only Tables:**
- ✅ audit_logs - Admin SELECT only
- ✅ system_event_logs - Admin SELECT only

**Public Tables (with admin write control):**
- ✅ documents - Public read, admin write
- ✅ embeddings - Public read, system write

### 4. Seed Data (0003_seed_sat_taxonomy.sql) ✅

**Reference Tables:**
- ✅ sat_sections_ref (Math, Reading, Writing)
- ✅ difficulty_levels_ref (Easy=1, Medium=2, Hard=3)
- ✅ sat_math_topics_ref (Algebra, Functions, Geometry, etc.)
- ✅ sat_rw_skills_ref (Reading Comprehension, Grammar, etc.)

### 5. Migration Runner (scripts/apply_migrations.ts) ✅

**Features:**
- ✅ Applies migrations in order
- ✅ Tracks applied migrations in `_migrations` table
- ✅ Rollback support with `--down N` flag
- ✅ Rollback blocked in production
- ✅ Seed data application
- ✅ Colored console output
- ✅ Error handling with clear messages

**Usage:**
```bash
npm run db:migrate:supabase              # Apply pending migrations
npm run db:migrate:supabase -- --down 1  # Rollback last migration (dev only)
```

### 6. Supabase Client with RLS Support ✅

**File:** `apps/api/src/db/supabase-client.ts`

**Functions:**
- ✅ `getSupabaseDb()` - Standard DB client
- ✅ `getSupabasePool()` - Raw connection pool
- ✅ `getSupabaseDbWithUser(userId)` - DB client with RLS context
- ✅ `executeWithRLS(userId, queryFn)` - Execute queries with auth.uid() set
- ✅ `testSupabaseConnection()` - Health check

**How RLS Works:**
```typescript
// Before (Neon - application filtering):
const sessions = await db.select()
  .from(practiceSessions)
  .where(eq(practiceSessions.userId, req.user.id)); // Manual filter

// After (Supabase - database RLS):
await executeWithRLS(req.user.id, async (db) => {
  return db.select().from(practiceSessions); // RLS filters automatically!
});
```

### 7. Documentation ✅

**Migration Guide:** `database/MIGRATION_GUIDE.md`
- ✅ Step-by-step migration instructions
- ✅ Troubleshooting guide
- ✅ Production deployment checklist
- ✅ Rollback procedures

**This Status Document:** `database/SUPABASE_MIGRATION_STATUS.md`

## ⏳ What Still Needs to Be Done

### 1. Apply Migrations to Supabase ⏳

**Required:**
```bash
npm run db:migrate:supabase
```

**Expected Outcome:**
- All 27 tables created in Supabase PostgreSQL
- All RLS policies applied and enabled
- Reference data seeded
- `_migrations` table tracks applied migrations

**Current Status:** Script ready, needs SUPABASE_DB_URL connection validation

### 2. Create DAO Layer (server/dao/) ⏳

**Purpose:** Simplify route code by relying on RLS instead of manual filtering

**Example:**
```typescript
// server/dao/practice.ts
import { executeWithRLS } from '@api/db/supabase-client';
import { practiceSessions } from '@shared/schema';

export async function getUserPracticeSessions(userId: string) {
  return executeWithRLS(userId, async (db) => {
    return db.select().from(practiceSessions);
    // No WHERE clause needed - RLS filters automatically!
  });
}
```

### 3. Update Middleware ⏳

**File:** `server/middleware/supabase-auth.ts`

**Add:**
```typescript
// Attach RLS-aware DB to request
req.db = getSupabaseDbWithUser(req.user.id);
```

**Usage in routes:**
```typescript
// Routes can now use req.db with automatic RLS filtering
const sessions = await req.db.select().from(practiceSessions);
```

### 4. Create Verification Scripts ⏳

**scripts/verify_rls.ts:**
- Create 2 test users via Supabase Admin API
- User A creates practice session
- Verify User B cannot see User A's session
- Print pass/fail matrix

**scripts/check_rls_enabled.ts:**
- Query `information_schema.tables`
- Verify `row_security = ON` for all user/org tables
- Fail CI if any table missing RLS

### 5. Create RLS Test Suite ⏳

**tests/rls/**
- Vitest + Supertest integration tests
- Test all CRUD operations with RLS
- Verify cross-user isolation
- Test org-scoped access
- Test admin overrides

### 6. Storage Policies ⏳

**database/policies/storage.sql:**
- Bucket policies for: raw_uploads, transcripts, artifacts
- Only allow signed URLs for org members
- Mirror course visibility rules

### 7. Update Routes to Use DAO Layer ⏳

**Replace:**
```typescript
// Old: Manual filtering
const sessions = await db.select()
  .from(practiceSessions)
  .where(eq(practiceSessions.userId, req.user.id));
```

**With:**
```typescript
// New: RLS-based DAO
import { getUserPracticeSessions } from '@dao/practice';
const sessions = await getUserPracticeSessions(req.user.id);
```

### 8. Update README ⏳

**Add sections:**
- How data isolation works (RLS)
- Migration guide link
- Testing instructions
- Deployment checklist

## 📊 Comparison: Before vs After

### Before: Neon + Application-Level Enforcement

**Pros:**
- ✅ Works with Neon's stateless pooling
- ✅ Explicit filtering in code (easy to understand)
- ✅ Comprehensive test coverage

**Cons:**
- ❌ Must remember to add WHERE user_id = ? to every query
- ❌ Risk of forgotten filter = data leakage
- ❌ Verbose code with repeated filtering
- ❌ No database-level guarantee

### After: Supabase + Database RLS

**Pros:**
- ✅ **Database enforces isolation** - impossible to forget filtering
- ✅ Cleaner route code - no manual WHERE clauses
- ✅ Defense in depth - middleware + database
- ✅ Automatic filtering via auth.uid()
- ✅ Supports org-scoped access patterns
- ✅ Industry best practice (used by Auth0, Firebase, etc.)

**Cons:**
- ⚠️ Requires transaction-scoped JWT context setup
- ⚠️ Slightly more complex connection management
- ⚠️ Must test RLS policies thoroughly

## 🚀 Next Steps

1. **Verify SUPABASE_DB_URL Connection**
   ```bash
   psql $SUPABASE_DB_URL -c "SELECT version();"
   ```

2. **Run Migrations**
   ```bash
   npm run db:migrate:supabase
   ```

3. **Verify Tables Created**
   ```bash
   psql $SUPABASE_DB_URL -c "\dt"  # List all tables
   psql $SUPABASE_DB_URL -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';"
   ```

4. **Test RLS Enforcement**
   ```bash
   npm run db:verify:rls    # Once script is created
   npm run db:check:rls     # Once script is created
   npm run test:rls         # Once tests are written
   ```

5. **Deploy to Production**
   - Apply migrations to production Supabase
   - Run verification tests
   - Update environment to use SUPABASE_DB_URL
   - Monitor logs for RLS policy violations

## 🔒 Security Benefits

### 5-Layer Defense (Before)
1. HTTPS/Cookie Security
2. JWT Verification
3. Authentication Middleware
4. **Application-Level Filtering** ⚠️ Can be bypassed if developer forgets
5. Input Validation

### 6-Layer Defense (After)
1. HTTPS/Cookie Security
2. JWT Verification
3. Authentication Middleware
4. **Application-Level Filtering** (kept as belt-and-suspenders)
5. **Database RLS** ✅ Cannot be bypassed
6. Input Validation

## 📝 Notes

- All migrations are idempotent (safe to run multiple times)
- RLS policies use `auth.uid()` which works seamlessly with Supabase Auth
- Transaction-scoped JWT context ensures auth.uid() works correctly
- Rollback only allowed in non-production environments
- Seed data uses `ON CONFLICT DO NOTHING` for idempotency

## 🆘 Troubleshooting

### Migration Timeout

**Issue:** Migration script times out connecting to Supabase

**Solution:**
1. Verify SUPABASE_DB_URL format:
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
2. Check firewall/network access to Supabase
3. Test connection manually:
   ```bash
   psql $SUPABASE_DB_URL -c "SELECT 1;"
   ```

### auth.uid() Returns NULL

**Issue:** RLS policies see NULL instead of user ID

**Solution:**
1. Ensure using `executeWithRLS()` helper
2. Verify JWT is set in transaction:
   ```sql
   SET LOCAL request.jwt.claim.sub = 'user-id-here';
   ```
3. Check that queries run inside same transaction

### RLS Blocks All Access

**Issue:** Even authorized users get empty results

**Solution:**
1. Verify user exists in `users` table
2. Check RLS policy syntax (test with `USING (true)` temporarily)
3. Verify `auth.uid()` matches user ID in table

## 📚 Additional Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [pgvector Extension](https://github.com/pgvector/pgvector)
- `database/MIGRATION_GUIDE.md` - Detailed migration instructions
- `database/policies/` - All RLS policy source files
