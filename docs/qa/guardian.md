# Guardian/Parent Profile QA Checklist

## Prerequisites
- A test student account with known credentials
- A test guardian account with known credentials
- Access to the Supabase dashboard for DB verification

---

(updated 2026-10-01, guardian closeout: phases 1, 3–8 and the curl reference rewritten to test the code-redeem flow, the `/api/students/:studentId/*` reads and the `audit_logs` records that exist now. The `/summary` endpoint, `POST /api/guardian/link`, the `guardian_link_audit` table and `20260102_guardian_link_code.sql` do not exist.)

## Phase 1: Student Link Code Visibility

### Test 1.1: Student sees their link code
1. Log in as a student
2. Navigate to Profile → Settings tab
3. **Verify**: a 6-character link code is displayed (`StudentLinkCodePanel`; alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`)
4. **Verify**: Copy button works
5. **Verify**: Helper text explains sharing with a parent

### Test 1.2: Guardian does NOT see link code section
1. Log in as a guardian
2. Navigate to Profile → Settings tab
3. **Verify**: No link code section is displayed (the panel renders for `currentRole === "student"` only)

---

## Phase 2: Guardian Signup and Redirect

### Test 2.1: Guardian signup
1. Go to /login
2. Click "Sign up" and complete signup with valid credentials
3. On /profile/complete, choose the guardian role and give a date of birth
4. **Verify**: Account has role = 'guardian'
5. **Verify**: Redirect to /guardian (not /dashboard)

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
2. Navigate to /guardian and open the Add student dialog
3. Enter the student's current link code and submit
4. **Verify**: `POST /api/guardian/link/redeem` answers 201
5. **Verify**: Student appears in the roster (`GET /api/guardian/students`)
6. **Verify**: Can open /guardian/:studentId for that student
7. **Verify**: The student's code has changed (a code redeems once; the student gets a fresh one)

### Test 3.2: Already linked
1. Have the student show their new code
2. Enter it as the same guardian
3. **Verify**: 409 "You are already linked to that student."
4. **Verify**: No duplicate entries in the roster

### Test 3.3: Invalid code - generic error
1. Enter a 6-character code that is not live (e.g. "XXXXXX")
2. **Verify**: 400 "That code is not valid. Ask your student for a current one." (`GUARDIAN_LINK_CODE_REFUSED`)
3. **Verify**: No information leakage about code existence

### Test 3.4: Spent code entered by another guardian
1. Create a second guardian account
2. Enter the code already redeemed in Test 3.1
3. **Verify**: The same 400 as Test 3.3
4. **Verify**: Cannot tell a spent code from an expired or never-real one

---

## Phase 4: Rate Limiting

### Test 4.1: Rate limit triggers
1. Submit codes past the `guardian_link_code_entry` bucket limit (seeded at 10 per 86400 s by `supabase/migrations/20260901000000_scl_080_guardian_link_code.sql`; read the live limit from config first)
2. **Verify**: 429 response once the limit is reached

---

## Phase 5: Unlinking

### Test 5.1: Unlink success
1. Open /guardian/students, click Remove on a linked student
2. Confirm in the dialog
3. **Verify**: Student removed from the roster
4. **Verify**: Reads of that student now answer 404

### Test 5.2: Unlink an already-revoked link
1. Call `DELETE /api/guardian/link/STUDENT_ID` again (via API)
2. **Verify**: 409 "This link is not active" (not 500)
3. Call it for a student this guardian was never linked to
4. **Verify**: 404

---

## Phase 6: Security - Unauthorized Access

### Test 6.1: Guardian cannot read an unlinked student
```bash
curl -X GET "https://YOUR_APP/api/students/UNLINKED_STUDENT_ID/kpi/overall" \
  -H "Cookie: YOUR_SESSION_COOKIE"
```
**Verify**: Returns 404 "No such student, or you do not have access to them"

### Test 6.2: Student cannot access guardian endpoints
1. Log in as student
2. Try to access /api/guardian/students
```bash
curl -X GET "https://YOUR_APP/api/guardian/students" \
  -H "Cookie: STUDENT_SESSION_COOKIE"
```
**Verify**: Returns 403 "Guardian role required"

### Test 6.3: Guardian cannot enumerate students by ID
1. Try random uuids on `/api/students/:studentId/kpi/overall`
2. **Verify**: All return 404 (a non-uuid returns 400)

### Test 6.4: Linked student without an entitlement
1. Link a guardian to a student with no active entitlement
2. Call `/api/students/STUDENT_ID/kpi/overall`
3. **Verify**: 402 `PAYMENT_REQUIRED`; the UI shows the lapsed state

### Test 6.5: Guardian gets the streak only, and no skills
1. As a linked guardian of an entitled student, call `/api/students/STUDENT_ID/kpi/overall`
2. **Verify**: body carries `currentStreakDays` and no counters or accuracy (SCL-188)
3. Call `/api/students/STUDENT_ID/mastery/skills`
4. **Verify**: 403 (SCL-194)

---

## Phase 7: Audit Logging

### Test 7.1: Verify audit logs are created
1. Link, read one student page, then unlink
2. Check `audit_logs`:
```sql
SELECT action, actor_profile_id, target_profile_id, context, created_at
FROM audit_logs
WHERE action IN ('guardian_link_initiated', 'guardian_link_revoked',
                 'guardian_dashboard_viewed', 'guardian_subject_access')
ORDER BY created_at DESC LIMIT 20;
```
**Verify**: one `guardian_link_initiated` and one `guardian_link_revoked` row (written by SQL `guardian_link_audit`), a `guardian_dashboard_viewed` row, and `guardian_subject_access` rows with `context.request_id` set

### Test 7.2: Denied reads are logged
1. Repeat Test 6.1
2. **Verify**: a `guardian_subject_access` row with `context.decision = 'not_linked'`
3. **Verify**: `context` holds access metadata only (decision, resource, via, request_id) — no student data

---

## Phase 8: Database Verification

### Test 8.1: Role type includes guardian
```sql
SELECT enum_range(NULL::public.profile_role);
```
**Verify**: Includes 'guardian'

### Test 8.2: guardian_links shape
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'guardian_links' AND column_name IN ('guardian_profile_id', 'student_profile_id', 'status');
```
**Verify**: both profile ids are `uuid`; `status` is `text` (CHECK allows 'active', 'revoked')

### Test 8.3: Fresh DB migration test
1. Run the guardian PG suites; they build a database from genesis + every migration:
```bash
PGHOST=... pnpm exec vitest run tests/ci/guardian-link-code.pg.ci.test.ts tests/ci/guardian-denial-sweep.pg.ci.test.ts
```
2. **Verify**: No errors during migration and all tests pass

### Test 8.4: Closeout drops are in place
```sql
-- Should return 0 rows (dropped by 20261017000000_guardian_closeout_dead_rls_and_consent_column.sql, SCL-196)
SELECT proname FROM pg_proc
WHERE proname IN ('guardian_can_view_student', 'guardian_can_view_student_as');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'consent_given_at';

-- Should return 1 row: the one derivation the server calls
SELECT proname FROM pg_proc WHERE proname = 'guardian_view_decision';
```

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
curl -X POST "https://YOUR_APP/api/guardian/link/redeem" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION" \
  -d '{"code":"STUDENT_CODE","acceptParentGuardianTerms":true}'
```

### List linked students
```bash
curl -X GET "https://YOUR_APP/api/guardian/students" \
  -H "Cookie: YOUR_SESSION"
```

### Read a linked student's data
```bash
curl -X GET "https://YOUR_APP/api/students/STUDENT_ID/kpi/overall" \
  -H "Cookie: YOUR_SESSION"
curl -X GET "https://YOUR_APP/api/students/STUDENT_ID/mastery/domains" \
  -H "Cookie: YOUR_SESSION"
curl -X GET "https://YOUR_APP/api/students/STUDENT_ID/calendar" \
  -H "Cookie: YOUR_SESSION"
curl -X GET "https://YOUR_APP/api/students/STUDENT_ID/tests" \
  -H "Cookie: YOUR_SESSION"
```

### Unlink student
```bash
curl -X DELETE "https://YOUR_APP/api/guardian/link/STUDENT_ID" \
  -H "Cookie: YOUR_SESSION"
```

Mutating calls also need the CSRF token the app sends; both mounts sit behind `doubleCsrfProtection`.

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

## DB Reality Check (current schema)

(updated 2026-10-01, guardian closeout: the earlier Phase 0 capture showed `profiles.role` and `guardian_profile_id` as `text` and a `profiles_role_check`; the genesis schema now defines them as below.)

- `profiles.role` is `public.profile_role` (enum: 'student', 'guardian', 'admin', 'tutor', 'teacher').
- `profiles.guardian_profile_id` is `uuid`, FK to `profiles(id)`. It is legacy and is not used for authorization.
- `profiles.student_link_code` is `text`, with a partial UNIQUE index `profiles_student_link_code_key`.
- `guardian_links` is the link truth: `CHECK (guardian_profile_id <> student_profile_id)` (`guardian_not_self`) and one active row per pair (`unique_active_guardian_link`).

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
| 3.2 Already linked | | | |
| 3.3 Invalid code error | | | |
| 3.4 Spent code error | | | |
| 4.1 Rate limit | | | |
| 5.1 Unlink success | | | |
| 5.2 Unlink already revoked | | | |
| 6.1 Unlinked student blocked | | | |
| 6.2 Student blocked from guardian API | | | |
| 6.3 No enumeration | | | |
| 6.4 Unentitled student 402 | | | |
| 6.5 Streak only, no skills | | | |
| 7.1 Audit logs created | | | |
| 7.2 Denied reads logged | | | |
| 8.1 Role constraint | | | |
| 8.2 guardian_links shape | | | |
| 8.3 Fresh DB migration | | | |
| 8.4 Closeout drops | | | |
| 9.1 Empty state | | | |
| 9.2 Loading states | | | |
| 9.3 Error states | | | |
