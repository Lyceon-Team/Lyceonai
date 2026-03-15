# Auth and Security Architecture (Server Truth)

## TL;DR

- `profiles` is the only runtime profile source of truth.
- `/api/profile` is the only hydration endpoint used by client runtime.
- Supabase auth runtime is canonicalized in:
  - `server/middleware/supabase-auth.ts`
  - `server/routes/supabase-auth-routes.ts`
  - `server/routes/google-oauth-routes.ts`
- No runtime role-switch feature exists in product surfaces.
- Operational fallback for role corrections is `support@lyceon.ai`.
- Missing/legacy profile roles are normalized to `student`.
- Admin provisioning is fail-closed unless `ADMN_PASSCODE` is configured and explicitly provided to `POST /api/auth/admin-provision`.

## Canonical Runtime Surface

### Auth middleware (token resolution + user attachment)
- `server/middleware/supabase-auth.ts`
  - Resolves auth from `sb-access-token` cookie only.
  - Rejects `Authorization: Bearer ...` for user-facing auth paths.
  - Loads/creates `profiles` row and attaches `req.user`.
  - Applies role guards via `requireSupabaseAuth`, `requireSupabaseAdmin`, `requireStudentOrAdmin`.

### Auth routes
- `server/routes/supabase-auth-routes.ts`
  - `POST /api/auth/signup`
  - `POST /api/auth/signin`
  - `POST /api/auth/signout`
  - `POST /api/auth/consent`
  - `POST /api/auth/refresh`
  - `POST /api/auth/admin-provision` (guarded; not part of normal signup/signin)
  - `GET /api/auth/debug`

### Google OAuth routes
- `server/routes/google-oauth-routes.ts`
  - `GET /api/auth/google/start`
  - `GET /auth/google/callback`
  - `GET /api/auth/google/debug`

### Profile hydration routes
- `server/index.ts` + `server/routes/profile-routes.ts`
  - `GET /api/profile` (hydration payload)
  - `PATCH /api/profile` (profile completion/update)

## Removed/Blocked Legacy Paths

<<<<<<< HEAD
- `GET /api/auth/user` is intentionally absent and should return `404`.
- `POST /api/auth/exchange-session` is intentionally absent and should return `404`.
- Any auth flow that relies on client-held access/refresh tokens is legacy and non-canonical.
=======
### Protected Endpoints
* **GET /api/profile** → `requireSupabaseAuth` (any authenticated user)
* **POST /api/practice/sessions** → `requireSupabaseAuth` + `requireConsentCompliance` (FERPA)
* **POST /api/documents/upload** → `requireSupabaseAdmin` (admin only)
* **POST /api/documents/process-and-ingest** → `requireSupabaseAdmin` (admin only)
* **GET /api/admin/questions/needs-review** → `requireSupabaseAdmin` (admin only)
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

## Runtime Flow

### Email/password sign-in
1. Client calls `POST /api/auth/signin`.
2. Server signs in with Supabase Auth.
3. Server sets `sb-access-token` and `sb-refresh-token` as HTTP-only cookies.
4. Client hydrates via `GET /api/profile`.

### Google OAuth sign-in
1. Client/browser requests `GET /api/auth/google/start`.
2. Server redirects to Google OAuth with state cookie.
3. Google redirects to `GET /auth/google/callback`.
4. Server exchanges code, signs in with Supabase, sets HTTP-only cookies.
5. Client hydrates via `GET /api/profile`.

### Profile hydration
1. Client calls `GET /api/profile` with cookies.
2. `requireSupabaseAuth` enforces authentication.
3. Response includes canonical runtime user payload.

## Security Controls

### Cookie-only auth
- Accepted auth cookies: `sb-access-token`, `sb-refresh-token`.
- User-facing auth rejects bearer headers.
- Tokens are not returned in hydration responses.

### CSRF protection
- State-changing auth endpoints enforce CSRF via origin checks.
- `GET` routes remain readable without CSRF headers.

### Role and access enforcement
- Server-side role checks are enforced by middleware and route guards.
- Guardian/student/admin behavior is server-authoritative.
- Missing profile role values are normalized server-side to `student`.
- Profile PATCH rejects direct role mutation requests and returns support-mediated guidance.
- No in-product runtime role-switch endpoint is exposed.

### Admin provisioning guard
- `POST /api/auth/admin-provision` is the only runtime path that can write an admin role.
- Requests fail closed when `ADMN_PASSCODE` is missing.
- Requests fail closed when the provided passcode does not match `ADMN_PASSCODE`.
- Signup/metadata/fallback bootstrap paths cannot create admins.

## Verification Checklist

### Endpoint truth checks
```bash
curl -i http://localhost:5000/api/auth/user
# expected: 404

curl -i http://localhost:5000/api/auth/exchange-session
# expected: 404

curl -i http://localhost:5000/api/profile
# expected: 401 without auth cookie
```

### CI contract checks
- `tests/ci/auth.ci.test.ts`
- `tests/ci/routes.ci.test.ts`
- `tests/ci/security.ci.test.ts`
- `tests/ci/auth-surface.contract.test.ts`

## Non-goals / intentional gaps

- In-product role switching is not implemented by design.
- Role correction and account-state exceptions are handled operationally via `support@lyceon.ai`.

<<<<<<< HEAD
=======
### Optional Variables
```bash
EMBEDDINGS_MODEL=text-embedding-3-small
```

## Verification Steps

### 1. Run the Application
```bash
npm run build
npm start
```

### 2. Run Smoke Tests
```bash
chmod +x scripts/smoke.sh
./scripts/smoke.sh http://localhost:5000
```

### 3. Auth Flow Verification
1. Navigate to `/login`
2. Click "Sign in with Google OAuth"
3. Complete OAuth flow → redirected to `/auth-callback`
4. Frontend calls `/api/auth/exchange-session` with tokens
5. Backend sets HttpOnly cookies
6. Frontend clears localStorage/sessionStorage
7. Frontend calls `/api/auth/user` → receives user profile
8. Verify in DevTools:
   - ✅ Cookies: `sb-access-token` and `sb-refresh-token` are HttpOnly
   - ✅ LocalStorage: No `supabase.auth.token` or similar keys
   - ✅ SessionStorage: Empty
   - ✅ Network tab: `/api/auth/user` returns user profile

### 4. Protected Route Tests
```bash
# Anonymous user (no cookies)
curl http://localhost:5000/api/profile
# Expected: 401 Unauthorized

# Authenticated user (with cookies)
curl -H "Cookie: sb-access-token=..." http://localhost:5000/api/profile
# Expected: 200 OK with profile data

# Non-admin accessing admin route
curl -H "Cookie: sb-access-token=..." http://localhost:5000/api/documents/upload
# Expected: 403 Forbidden (if not admin)
```

### 5. CSRF Verification
```bash
# Cross-site POST (no Origin/Referer) - SHOULD BE BLOCKED
curl -X POST http://localhost:5000/api/auth/signout
# Expected: 403 Forbidden (csrf_blocked)

# Forged Origin - SHOULD BE BLOCKED
curl -X POST http://localhost:5000/api/auth/signout \
  -H "Origin: https://evil.com"
# Expected: 403 Forbidden (csrf_blocked)

# Same-site POST (with valid Origin) - SHOULD SUCCEED
curl -X POST http://localhost:5000/api/auth/signout \
  -H "Origin: http://localhost:5000" \
  -H "Cookie: sb-access-token=..."
# Expected: 401 Unauthorized (if no cookie) or 200 OK (if authenticated)
```

### 6. Supabase RLS Verification
```sql
-- In Supabase SQL Editor
-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'practice_sessions', 'answer_attempts');

-- Verify policies exist
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public';
```

## CI Test Hints

### Integration Tests
```bash
# Run all auth integration tests
npx jest -i tests/auth.integration.test.ts

# Run with coverage
npx jest -i tests/auth.integration.test.ts --coverage
```

### Build Checks
```bash
# Health check should return 200
curl -f http://localhost:5000/api/health || exit 1

# Auth endpoint should return 200
curl -f http://localhost:5000/api/auth/user || exit 1
```

### Pre-deployment Checklist
- [ ] All tests pass
- [ ] Smoke tests pass (including CSRF checks)
- [ ] Cookies are HttpOnly and Secure
- [ ] No tokens in localStorage/sessionStorage
- [ ] **CSRF guard active on state-changing routes**
- [ ] **ALLOWED_ORIGINS configured for production**
- [ ] RLS policies deployed to Supabase
- [ ] Environment variables configured
- [ ] Rate limiting configured
- [ ] Admin audit logging enabled

## Rollback Procedures

### Emergency Rollback
If auth system fails in production:

1. **Disable Cookie Exchange** (temporary fix):
   ```typescript
   // In server/routes/supabase-auth-routes.ts
   // Comment out cookie setting in /api/auth/exchange-session
   ```

2. **Revert to Previous Deployment**:
   ```bash
   # In Replit deployment dashboard
   # Rollback to previous working version
   ```

3. **Restore RLS Policies** (if needed):
   ```bash
   psql $SUPABASE_DATABASE_URL < docs/RLS_POLICIES.sql
   ```

### Database Rollback
If RLS policies cause issues:

```sql
-- Temporarily disable RLS (emergency only)
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions DISABLE ROW LEVEL SECURITY;

-- Re-enable after fix
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
```

## Security Incident Response

### Suspected Token Leak
1. Immediately revoke all sessions in Supabase dashboard
2. Rotate `SUPABASE_SERVICE_ROLE_KEY`
3. Force password reset for all users
4. Review audit logs for unauthorized access

### CSRF Attack Detected
1. Check Origin/Referer validation is active
2. Review rate limiting configuration
3. Analyze attack patterns in logs
4. Tighten CORS policy if needed

### Unauthorized Data Access
1. Review RLS policies for gaps
2. Check admin audit logs
3. Verify role assignments in profiles table
4. Revoke compromised admin accounts

## FERPA Compliance Notes

### Under-13 User Protection
* All practice endpoints enforce `requireConsentCompliance` middleware
* Under-13 users without guardian consent receive 403 Forbidden
* Consent status stored in `profiles` table (RLS-protected)
* Audit logs track all consent changes

### Data Privacy
* No PII in client-side JavaScript
* All user data queries use RLS
* Admin actions logged for audit trail
* User data deletion supported (FERPA right to forget)

## Performance Considerations

### Cookie Size
* Access tokens ~500-1000 bytes
* Refresh tokens ~500-1000 bytes
* Total cookie overhead: ~2KB per request
* Acceptable for most use cases

### Session Validation
* Backend validates cookies on every request
* Supabase client caches user profile for 60 seconds
* RLS policies add minimal query overhead
* Consider Redis for session caching at scale

## Future Enhancements

### Planned Improvements
- [ ] Implement refresh token rotation
- [ ] Add session device tracking
- [ ] Implement 2FA for admin users
- [ ] Add IP-based rate limiting
- [ ] Implement session timeout warnings
- [ ] Add security event notifications

### Monitoring
- [ ] Track auth success/failure rates
- [ ] Monitor cookie rejection rates
- [ ] Alert on unusual admin activity
- [ ] Dashboard for security metrics

---

**Last Updated**: October 10, 2025  
**Document Owner**: Development Team  
**Security Review**: Pending
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
