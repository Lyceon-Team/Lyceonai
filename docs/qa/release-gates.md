# Guardian Feature Release Gates

## Pre-Launch Checklist

Before launching the Guardian/Parent Profile feature, verify all of the following:

---

## 1. DB Proof Queries (Run in Supabase SQL Editor)

### 1.1 Profiles Column Types
```sql
SELECT column_name, data_type, udt_name 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'profiles'
AND column_name IN ('id', 'role', 'guardian_profile_id', 'student_link_code')
ORDER BY column_name;
```
**Expected (Production):**
```
column_name         | data_type     | udt_name
guardian_profile_id | uuid          | uuid
id                  | uuid          | uuid
role                | USER-DEFINED  | profile_role
student_link_code   | text          | text
```

### 1.2 Role Enum Values
```sql
SELECT enumlabel FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'profile_role'
ORDER BY enumsortorder;
```
**Expected:** `student`, `guardian`, `admin`

### 1.3 FK Constraint on guardian_profile_id (REQUIRED)
```sql
SELECT tc.constraint_name, tc.constraint_type, ccu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_schema = 'public' AND tc.table_name = 'profiles' 
  AND tc.constraint_type = 'FOREIGN KEY' AND ccu.column_name = 'guardian_profile_id';
```
**Expected:** 1 row with `FOREIGN KEY` on `guardian_profile_id`

### 1.4 Self-Reference Constraint
```sql
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema = 'public' AND table_name = 'profiles' 
  AND constraint_name = 'profiles_guardian_not_self';
```
**Expected:** 1 row with `profiles_guardian_not_self`

### 1.5 Triggers on Profiles
```sql
SELECT trigger_name, event_manipulation, action_timing 
FROM information_schema.triggers 
WHERE event_object_table = 'profiles'
AND trigger_name LIKE '%link_code%'
ORDER BY event_manipulation;
```
**Acceptable outputs:**

Either of these patterns is valid:

**Pattern A (separate trigger names):**
```
trigger_name                  | event_manipulation | action_timing
set_student_link_code         | INSERT             | BEFORE
set_student_link_code_update  | UPDATE             | BEFORE
```

**Pattern B (same trigger name, both events):**
```
trigger_name                  | event_manipulation | action_timing
set_student_link_code         | INSERT             | BEFORE
set_student_link_code         | UPDATE             | BEFORE
```

**Required:**
- At least one INSERT trigger with `action_timing = BEFORE`
- At least one UPDATE trigger with `action_timing = BEFORE`
- Trigger function must be `generate_student_link_code()`

### 1.6 Student Link Code Index
```sql
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'profiles' AND indexname LIKE '%link_code%';
```
**Expected:** `profiles_student_link_code_key` with `WHERE student_link_code IS NOT NULL`

### 1.7 Guardian Link Audit Table Types
```sql
SELECT column_name, data_type, udt_name 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'guardian_link_audit'
ORDER BY ordinal_position;
```
**Expected:** `guardian_profile_id` and `student_profile_id` match `profiles.id` type

### 1.8 Guardian Link Audit Indexes
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'guardian_link_audit';
```
**Expected:** Includes:
- `idx_guardian_link_audit_guardian`
- `idx_guardian_link_audit_student`
- `idx_guardian_link_audit_request_id`

### 1.9 Type Consistency Check
```sql
SELECT 
  (SELECT udt_name FROM information_schema.columns 
   WHERE table_schema='public' AND table_name='profiles' AND column_name='id') AS profiles_id,
  (SELECT udt_name FROM information_schema.columns 
   WHERE table_schema='public' AND table_name='profiles' AND column_name='guardian_profile_id') AS profiles_gpid,
  (SELECT udt_name FROM information_schema.columns 
   WHERE table_schema='public' AND table_name='guardian_link_audit' AND column_name='guardian_profile_id') AS audit_gpid;
```
**Expected:** All three match (`uuid` in prod, `text` in dev)

---

## 2. Type Mismatch Remediation

If guardian_link_audit was created with TEXT but profiles.id is UUID, you must manually remediate:

```sql
-- CAUTION: This drops and recreates the audit table. Only run if no critical audit data exists.
DROP TABLE IF EXISTS public.guardian_link_audit CASCADE;
-- Then re-run the migration to recreate with correct types.
```

---

## 3. API Verification

### 3.1 requestId in All Guardian Responses
```bash
grep -c "requestId" server/routes/guardian-routes.ts
```
**Expected:** 40+ occurrences

### 3.2 Role Assignment Hardening
```bash
grep -n "allowedAutoRoles\|admin_role_blocked" server/middleware/supabase-auth.ts
```
**Expected:** Shows `allowedAutoRoles = ['student', 'guardian']` and admin blocking

### 3.3 No Unused Join Tables
```bash
grep -r "guardian_student_links" --include="*.ts" --include="*.sql" .
```
**Expected:** No matches

---

## 4. Smoke Test

### Unauthenticated Mode
```bash
npx tsx scripts/guardian-smoke-test.ts
```
**Expected:** Verifies /healthz and 401 responses with requestId

### Authenticated Mode
```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/guardian-smoke-test.ts
```
**Expected:** Full flow test (link, list, summary, unlink)

---

## 5. Server Health

```bash
curl -s http://localhost:5000/healthz
```
**Expected:** `{"status":"ok"}`

---

## 6. Guardian Auth Behavior

```bash
curl -s http://localhost:5000/api/guardian/students | jq .
```
**Expected:** `{"error":"Authentication required","requestId":"..."}`

---

## 7. CSRF Allowlist (Check Server Boot Logs)
```
[CSRF] Allowed origins (raw): [
  'https://lyceon.ai',
  'https://www.lyceon.ai',
  'https://*.replit.dev',
  'http://localhost:5173',
  'http://localhost:5000'
]
```

---

## 8. Security Checklist

- [ ] Admin role cannot be auto-assigned
- [ ] Only `student` and `guardian` are allowed auto-roles
- [ ] FK constraint exists on guardian_profile_id
- [ ] Self-reference constraint prevents guardian = self
- [ ] Generic error for invalid codes (no info leak)
- [ ] Durable rate limiting: 10 attempts / 15 min per guardian
- [ ] CSRF/CORS: Replit domains + lyceon.ai allowed

---

## 9. Linking Model (Source of Truth)

**Authoritative:** `profiles.guardian_profile_id` (FK to profiles.id)

**Constraints:**
- `profiles_guardian_profile_id_fkey` - FK to profiles.id
- `profiles_guardian_not_self` - CHECK (guardian_profile_id IS NULL OR guardian_profile_id <> id)

**NOT used:** `guardian_student_links` join table

---

## Commands Summary

```bash
# 1. Apply migration
supabase db push
# OR: psql $DATABASE_URL -f supabase/migrations/20260102_guardian_link_code.sql

# 2. Start server
npm run dev

# 3. Run smoke test (unauth)
npx tsx scripts/guardian-smoke-test.ts

# 4. Run smoke test (auth)
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/guardian-smoke-test.ts
```

---

## Rollback Plan

1. Clear `guardian_profile_id` from affected profiles
2. Review `guardian_link_audit` for suspicious patterns

---

## 10. Guardian Audit Schema Verification

### 10.1 List guardian_link_audit columns

```sql
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'guardian_link_audit'
ORDER BY ordinal_position;
```

**Expected canonical columns:**
- `id` (uuid)
- `occurred_at` (timestamptz)
- `guardian_profile_id` (uuid)
- `student_profile_id` (uuid, nullable)
- `action` (text)
- `outcome` (text)
- `student_code_prefix` (text, nullable)
- `request_id` (text, nullable)
- `metadata` (jsonb, nullable)

### 10.2 Last 20 audit rows

```sql
SELECT 
  id,
  occurred_at,
  guardian_profile_id,
  student_profile_id,
  action,
  outcome,
  student_code_prefix,
  request_id,
  metadata
FROM guardian_link_audit
ORDER BY occurred_at DESC
LIMIT 20;
```

### 10.3 Action/outcome counts

```sql
SELECT 
  action,
  outcome,
  COUNT(*) as count
FROM guardian_link_audit
GROUP BY action, outcome
ORDER BY action, outcome;
```

### 10.4 Canonical Schema Verification

```bash
# Verify no old column names in code
rg -n "status.*blocked\|reason.*Exceeded\|code_prefix" server --type ts | grep -v "\.test\." || echo "OK: No legacy column references"

# Verify canonical columns are used
rg -n "outcome.*rate_limited\|student_code_prefix" server --type ts
```

**Expected:** 
- First grep returns nothing (or "OK")
- Second grep shows `durable-rate-limiter.ts` and `guardian-routes.ts` using canonical columns
