# Neon PostgreSQL RLS Limitations

## The Problem

**Neon PostgreSQL does NOT support Row-Level Security via session GUCs** because it uses stateless connection pooling that doesn't preserve session variables across queries.

### What This Means

The common RLS pattern used with Supabase PostgreSQL:
```sql
-- Set session context
SELECT set_config('app.current_user_id', user_id, false);

-- RLS policy checks session context
CREATE POLICY user_isolation ON table_name
USING (user_id = current_setting('app.current_user_id')::uuid);
```

**This does NOT work with Neon** because:
1. Neon uses connection pooling (similar to PgBouncer)
2. Each query may use a different connection
3. Session variables don't persist between queries
4. The RLS policy can't see the user_id

## Current Implementation: Application-Level Enforcement

### How It Works

1. **JWT Verification** (Middleware Layer)
   - Supabase JWT is verified on every request
   - `req.user.id` is set from verified JWT
   - All protected routes require authentication

2. **Query Filtering** (Application Layer)
   - All database queries include `WHERE user_id = req.user.id`
   - Storage interface enforces user_id filtering
   - No cross-user data access possible

3. **Defense in Depth**
   - Middleware auth (reject unauthenticated requests)
   - Application-level WHERE clauses (filter by user_id)
   - Input validation (Zod schemas)
   - HTTPS/Cookie security (HTTP-only cookies)

### Example

```typescript
// ✅ CORRECT: Application-level filtering
async getUserPracticeSessions(userId: string) {
  return await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.userId, userId)); // Explicit user_id filter
}

// ❌ INCORRECT: Relying on RLS session context (doesn't work with Neon)
async getUserPracticeSessions() {
  // Assumes set_current_user_id() was called - won't work!
  return await db.select().from(practiceSessions);
}
```

## Security Verification

### Automated Testing
- `tests/specs/rls-auth-enforcement.spec.ts` verifies:
  - ✅ Unauthenticated requests are rejected
  - ✅ Users can only access their own data
  - ✅ Cross-user access is denied
  - ✅ Admin endpoints require admin role

### Manual Verification
1. Attempt to access another user's session ID → 403/404
2. Attempt API requests without JWT → 401
3. Verify WHERE clauses include user_id in all user-scoped queries

## Alternative Approaches

If you **absolutely need database-level RLS**, consider:

### Option 1: Use Supabase PostgreSQL
- Supabase has built-in `auth.uid()` function
- Works seamlessly with Supabase Auth
- True database-level RLS enforcement

### Option 2: Use Neon Session Mode (Not Transaction Mode)
- Requires non-pooled connection
- Set session variables before each query
- Performance trade-off (no connection pooling)

```typescript
// Create non-pooled client for session mode
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL, { 
  pooling: false,  // Disable pooling for session persistence
  arrayMode: false 
});

// Set session variable and run query
await sql`SELECT set_current_user_id(${userId})`;
const sessions = await sql`SELECT * FROM practice_sessions`;
```

### Option 3: Transaction-Scoped RLS
- Set session variable within a transaction
- All queries run in same transaction/connection
- Session variable persists for transaction duration

```typescript
await db.transaction(async (tx) => {
  // Set session context
  await tx.execute(sql`SELECT set_current_user_id(${userId})`);
  
  // Run queries - RLS will work within this transaction
  const sessions = await tx.select().from(practiceSessions);
  const attempts = await tx.select().from(answerAttempts);
  
  return { sessions, attempts };
});
```

### Option 4: Use Parameterized RLS Functions
- Pass user_id as parameter instead of session variable
- More explicit but requires modifying all RLS policies

```sql
-- Create RLS policy that takes user_id parameter
CREATE POLICY user_isolation ON practice_sessions
USING (user_id = current_setting('request.jwt.claim.sub')::uuid);

-- Set JWT claim in transaction
BEGIN;
SET LOCAL request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM practice_sessions;  -- RLS enforced
COMMIT;
```

## Recommendation

**For this SAT Learning Platform:**
- ✅ Continue using application-level enforcement (current implementation)
- ✅ Rely on comprehensive test suite for verification
- ✅ Use Supabase RLS for Supabase-hosted tables (profiles, etc.)
- ✅ Use Neon for Postgres-native tables with application-level filtering

**If you need true RLS:**
- Consider migrating to Supabase PostgreSQL for all tables
- Or use transaction-scoped RLS (Option 3) if willing to accept performance trade-off

## FERPA Compliance

**Application-level enforcement meets FERPA requirements** when:
1. ✅ All routes require authentication
2. ✅ All queries filter by authenticated user_id
3. ✅ Comprehensive tests verify no data leakage
4. ✅ Audit logs track all data access
5. ✅ Regular security reviews are conducted

The key is **verifiable isolation**, not the specific mechanism used.
