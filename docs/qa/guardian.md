# Guardian/Parent Profile QA Checklist

## Prerequisites
- A test student account with known credentials
- A test guardian account with known credentials
- Access to the Supabase dashboard for DB verification

---

## Phase 1: Student Link Code Visibility

### Test 1.1: Student sees their link code
1. Log in as a student
2. Navigate to Profile page
3. **Verify**: 8-character link code is displayed
4. **Verify**: Copy button works
5. **Verify**: Helper text explains sharing with parent

### Test 1.2: Guardian does NOT see link code section
1. Log in as a guardian
2. Navigate to Profile page (if accessible)
3. **Verify**: No link code section is displayed

---

## Phase 2: Guardian Signup and Redirect

### Test 2.1: Guardian signup toggle
1. Go to /login
2. Click "Sign up"
3. Toggle "I'm a parent/guardian"
4. Complete signup with valid credentials
5. **Verify**: Account created with role = 'guardian'
6. **Verify**: Redirect to /guardian (not /dashboard)

### Test 2.2: Guardian login redirect
1. Log in as existing guardian
2. **Verify**: Redirect to /guardian

### Test 2.3: Student login redirect
1. Log in as existing student
2. **Verify**: Redirect to /dashboard (not /guardian)

---

## Phase 3: Linking Flow

### Test 3.1: Link success
1. Log in as guardian
2. Navigate to /guardian
3. Enter valid student link code
4. Click "Link Student"
5. **Verify**: Success message displayed
6. **Verify**: Student appears in linked list
7. **Verify**: Can view student progress

### Test 3.2: Link idempotent (already linked)
1. Enter the same code again
2. **Verify**: Returns success (not error)
3. **Verify**: No duplicate entries in list

### Test 3.3: Invalid code - generic error
1. Enter invalid 8-character code (e.g., "XXXXXXXX")
2. **Verify**: Generic error message: "Invalid or unavailable student code"
3. **Verify**: No information leakage about code existence

### Test 3.4: Code already linked to another guardian
1. Create second guardian account
2. Try to link same student
3. **Verify**: Generic error: "Invalid or unavailable student code"
4. **Verify**: Cannot determine if code exists or is already linked

---

## Phase 4: Rate Limiting

### Test 4.1: Rate limit triggers
1. Make 11 link attempts within 15 minutes
2. **Verify**: 429 response after 10 attempts
3. **Verify**: Error message: "Too many link attempts"

---

## Phase 5: Unlinking

### Test 5.1: Unlink success
1. Click unlink button on linked student
2. Confirm in modal
3. **Verify**: Student removed from list
4. **Verify**: Can no longer view their progress

### Test 5.2: Unlink idempotent
1. Try to unlink already-unlinked student (via API)
2. **Verify**: Returns 404 or 403 (not 500)

---

## Phase 6: Security - Unauthorized Access

### Test 6.1: Guardian cannot fetch unlinked student summary
```bash
curl -X GET "https://YOUR_APP/api/guardian/students/UNLINKED_STUDENT_ID/summary" \
  -H "Cookie: YOUR_SESSION_COOKIE"
```
**Verify**: Returns 404 "Student not found"

### Test 6.2: Student cannot access guardian endpoints
1. Log in as student
2. Try to access /api/guardian/students
```bash
curl -X GET "https://YOUR_APP/api/guardian/students" \
  -H "Cookie: STUDENT_SESSION_COOKIE"
```
**Verify**: Returns 403 "Guardian role required"

### Test 6.3: Guardian cannot enumerate students by ID
1. Try sequential student IDs in summary endpoint
2. **Verify**: All return 404 (no timing differences)

---

## Phase 7: Audit Logging

### Test 7.1: Verify audit logs are created
1. Perform link/unlink operations
2. Check guardian_link_audit table:
```sql
SELECT * FROM guardian_link_audit ORDER BY occurred_at DESC LIMIT 10;
```
**Verify**: Entries exist with correct action, status, request_id

### Test 7.2: Failed attempts are logged
1. Try invalid codes
2. **Verify**: Audit log shows 'link_attempt' with status 'failure'
3. **Verify**: code_prefix shows only first 2 characters

---

## Phase 8: Database Verification

### Test 8.1: Role constraint includes guardian
```sql
SELECT conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
WHERE t.relname = 'profiles' AND c.contype = 'c';
```
**Verify**: Constraint includes 'guardian'

### Test 8.2: guardian_profile_id column exists
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'guardian_profile_id';
```
**Verify**: Column exists with type 'text'

### Test 8.3: Fresh DB migration test
1. Create a fresh Supabase project (or reset existing)
2. Apply all migrations in order:
```bash
# Apply migrations
psql $DATABASE_URL -f supabase/migrations/20260102_guardian_link_code.sql
```
3. **Verify**: No errors during migration
4. **Verify**: All guardian tables/columns/indexes created:
```sql
-- Should return: student_link_code, guardian_profile_id, role
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' AND column_name IN ('student_link_code', 'guardian_profile_id', 'role');

-- Should return: guardian_link_audit
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'guardian_link_audit';

-- Should return: generate_student_link_code trigger
SELECT tgname FROM pg_trigger WHERE tgname = 'set_student_link_code';
```

### Test 8.4: Idempotent migration test
1. Run the migration a second time
2. **Verify**: No errors (all IF NOT EXISTS clauses work)

### Test 8.5: Type consistency
```sql
-- Verify guardian_profile_id matches profiles.id type
SELECT 
  (SELECT data_type FROM information_schema.columns WHERE table_name='profiles' AND column_name='id') as profiles_id_type,
  (SELECT data_type FROM information_schema.columns WHERE table_name='profiles' AND column_name='guardian_profile_id') as guardian_profile_id_type;
```
**Verify**: Both return 'text'

---

## Phase 9: UX Polish

### Test 9.1: Empty state
1. Log in as guardian with no linked students
2. **Verify**: Helpful empty state message displayed
3. **Verify**: Instructions to get code from student

### Test 9.2: Loading states
1. **Verify**: Loading indicators during:
   - Initial page load
   - Linking operation
   - Fetching student progress

### Test 9.3: Error states
1. Disconnect network and refresh
2. **Verify**: Error message with retry button

---

## Curl Command Reference

### Link student (success)
```bash
curl -X POST "https://YOUR_APP/api/guardian/link" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION" \
  -d '{"code":"STUDENT_CODE"}'
```

### List linked students
```bash
curl -X GET "https://YOUR_APP/api/guardian/students" \
  -H "Cookie: YOUR_SESSION"
```

### Get student summary
```bash
curl -X GET "https://YOUR_APP/api/guardian/students/STUDENT_ID/summary" \
  -H "Cookie: YOUR_SESSION"
```

### Unlink student
```bash
curl -X DELETE "https://YOUR_APP/api/guardian/link/STUDENT_ID" \
  -H "Cookie: YOUR_SESSION"
```

---

## Phase 10: Sprint 1 Production Hardening Tests

### Test 10.1: Auth missing-profile auto-recovery
```sql
-- Delete profile for a test user (use supabase dashboard)
DELETE FROM profiles WHERE id = 'YOUR_TEST_USER_ID';
```
1. Navigate to dashboard while logged in
2. **Verify**: Profile is auto-created (no 500 error)
3. **Verify**: User lands on correct role-based page
4. Check logs for `profile_auto_created` message

### Test 10.2: Enum vs Text migration compatibility
```sql
-- Check role column type
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='role';
```
**Verify**: Migration works for both TEXT (with CHECK) and ENUM types

### Test 10.3: Replit domain CORS/CSRF
1. Access app via `.replit.dev` domain
2. Access app via `.replit.app` domain  
3. **Verify**: No CORS errors in console
4. **Verify**: CSRF token validates correctly
5. **Verify**: All API calls work without 403

### Test 10.4: Origin normalization
1. Make API calls with trailing slashes in Origin header
2. Make API calls with port numbers in Origin header
3. **Verify**: No false-negative CORS rejections

---

## DB Reality Check Results (Phase 0)

### Role column type
```
column_name | data_type | udt_name
------------|-----------|----------
role        | text      | text
```

### Guardian fields
```
column_name         | data_type
--------------------|----------
guardian_email      | text
guardian_profile_id | text
student_link_code   | text
```

### Constraints
```
conname                              | pg_get_constraintdef
-------------------------------------|----------------------------------------------
profiles_pkey                        | PRIMARY KEY (id)
profiles_student_link_code_key       | UNIQUE (student_link_code)
profiles_guardian_profile_id_fkey    | FOREIGN KEY (guardian_profile_id) REFERENCES profiles(id)
profiles_role_check                  | CHECK ((role = ANY (ARRAY['student'::text, 'admin'::text, 'guardian'::text])))
```

---

## Signoff

| Test | Pass | Tester | Date |
|------|------|--------|------|
| 1.1 Student sees link code | | | |
| 1.2 Guardian no link code | | | |
| 2.1 Guardian signup | | | |
| 2.2 Guardian login redirect | | | |
| 2.3 Student login redirect | | | |
| 3.1 Link success | | | |
| 3.2 Link idempotent | | | |
| 3.3 Invalid code error | | | |
| 3.4 Already linked error | | | |
| 4.1 Rate limit | | | |
| 5.1 Unlink success | | | |
| 5.2 Unlink idempotent | | | |
| 6.1 Unlinked student blocked | | | |
| 6.2 Student blocked from guardian API | | | |
| 6.3 No enumeration | | | |
| 7.1 Audit logs created | | | |
| 7.2 Failed attempts logged | | | |
| 8.1 Role constraint | | | |
| 8.2 guardian_profile_id exists | | | |
| 9.1 Empty state | | | |
| 9.2 Loading states | | | |
| 9.3 Error states | | | |
