# Auth & Security Architecture (Learning Copilot)

## TL;DR

* Backend-derived auth: tokens live **only in HTTP-only cookies**; React holds **no tokens**.
* `/api/profile` is the single source of truth for the UI.
* RLS on Supabase + role guards + CSRF guard.
* FERPA-grade: no token exposure to JS or storage.

## Components

* Express backend (Supabase service-role + cookie-based auth)
* React frontend (no client tokens)
* Supabase with RLS-enabled tables and `copilot` schema
* Secure OAuth flow → cookie exchange → backend-only state

## Sequence Diagram

```
User → Frontend (/login)
Frontend → Supabase OAuth
Supabase → Frontend (/auth-callback#access_token,refresh_token)
Frontend → Backend POST /api/auth/exchange-session {tokens}
Backend → Browser Set-Cookie (HttpOnly, Secure, SameSite=Lax)
Frontend → purge local/sessionStorage + clear JS memory
Frontend → Backend GET /api/profile (credentials: include)
Backend → Frontend { user: { id, email, role } }
```

## Endpoints

### Authentication Endpoints
* **POST /api/auth/exchange-session** → receives tokens from frontend, sets HttpOnly cookies, returns success
* **GET /api/profile** → returns user profile derived from cookies (single source of truth)
* **POST /api/auth/logout** → clears cookies server-side and invalidates session
* **GET /auth/callback** → Supabase OAuth callback handler

### Protected Endpoints
* **GET /api/profile** → `requireSupabaseAuth` (any authenticated user)
* **POST /api/practice/sessions** → `requireSupabaseAuth` + `requireConsentCompliance` (FERPA)
* **GET /api/admin/questions/needs-review** → `requireSupabaseAdmin` (admin only)
* **GET /api/admin/questions/statistics** → `requireSupabaseAdmin` (admin only)

### Public Endpoints
* **GET /api/questions/recent** → No auth required
* **GET /api/questions/search** → No auth required (rate limited)
* **GET /api/health** → No auth required

### CSRF Protection
All state-changing routes (POST/PUT/DELETE/PATCH) enforce strict Origin/Referer validation:
* **Blocks requests without Origin/Referer headers** → 403 Forbidden
* **Blocks requests from unauthorized origins** → 403 Forbidden
* **Exact origin comparison** → Parses URLs to extract exact origin (scheme + host + port), preventing hostname-prefix attacks like `allowed.com.evil.com`
* **Allows requests from configured ALLOWED_ORIGINS** → Proceeds to authentication
* **Fail-closed default**: If ALLOWED_ORIGINS is not set, only same-origin requests are allowed

## Cookies

### Cookie Configuration
* **sb-access-token** → HttpOnly, Secure, SameSite=Lax, Path=/
* **sb-refresh-token** → HttpOnly, Secure, SameSite=Lax, Path=/

### Cookie Attributes Explained
* **HttpOnly**: Cannot be accessed by JavaScript (XSS protection)
* **Secure**: Only sent over HTTPS in production
* **SameSite=Lax**: Prevents CSRF while allowing OAuth flows
* **Path=/**: Available across entire application

## Security Controls

### Token Security
* ✅ No tokens in JS memory, localStorage, or React state
* ✅ Tokens exist ONLY in HttpOnly cookies
* ✅ Frontend auth state derived from backend API (`/api/profile`)
* ✅ Session exchange clears localStorage/sessionStorage and JS memory

### CSRF Protection
* ✅ CSRF guard on all state-changing routes (POST/PUT/DELETE/PATCH)
* ✅ Origin/Referer header validation (blocks requests with missing or forged headers)
* ✅ **Exact origin matching**: prevents hostname-prefix bypass (e.g., app.com.evil.com)
* ✅ Fail-closed security: defaults to same-origin when ALLOWED_ORIGINS not configured
* ✅ Automatic sanitization: trims and filters empty origin entries to prevent bypass
* ✅ SameSite=Lax cookie attribute for additional protection

### Role-Based Access Control (RBAC)
* ✅ `requireSupabaseAuth` → Ensures user is authenticated
* ✅ `requireSupabaseAdmin` → Ensures user has admin role
* ✅ `requireConsentCompliance` → Ensures FERPA consent for under-13 users
* ✅ RLS policies enforce data access at database level

### Additional Security Measures
* ✅ Helmet middleware for security headers
* ✅ CORS configured with credentials and allowed origins
* ✅ Trust proxy enabled for Replit deployment
* ✅ Rate limiting on sensitive endpoints
* ✅ Cookie-parser and express.json() properly configured
* ✅ Audit logging for admin actions

## Supabase RLS Checklist

### Public Schema Tables
* ✅ `profiles` → Policies with `auth.uid()` for student access, admin full access
* ✅ `practice_sessions` → Students can manage own sessions, admins have full access
* ✅ `answer_attempts` → Students can manage own attempts, admins have full access
* ✅ `admin_audit_logs` → Admins have full access, students cannot access

### Copilot Schema Tables
* ✅ `copilot.question_embeddings` → Service role only (`auth.role() = 'service_role'`)

### RLS Policy Patterns
```sql
-- Student access to own data
CREATE POLICY "Students can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Admin full access
CREATE POLICY "Admins have full access to profiles"
  ON public.profiles FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
```

## Environment Variables

### Required Variables
```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
SUPABASE_ANON_KEY=eyJhbGci...

# API Keys
OPENAI_API_KEY=sk-...
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# Application
NODE_ENV=production
PORT=5000
BASE_URL=https://your-app.replit.app

# FERPA Compliance
ENABLE_UNDER_13_GATE=true
```

### CSRF Configuration (Important!)
```bash
# Required for CSRF protection in production
# Comma-separated list of allowed origins (no trailing commas!)
ALLOWED_ORIGINS=https://your-app.replit.app,http://localhost:5000

# If not set, CSRF guard defaults to same-origin requests only
# (derived from request host header)

# SECURITY NOTE: The guard automatically trims and filters empty entries
# to prevent bypass via misconfigured ALLOWED_ORIGINS (e.g., trailing commas)
```

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
7. Frontend calls `/api/profile` → receives user profile
8. Verify in DevTools:
   - ✅ Cookies: `sb-access-token` and `sb-refresh-token` are HttpOnly
   - ✅ LocalStorage: No `supabase.auth.token` or similar keys
   - ✅ SessionStorage: Empty
   - ✅ Network tab: `/api/profile` returns user profile

### 4. Protected Route Tests
```bash
# Anonymous user (no cookies)
curl http://localhost:5000/api/profile
# Expected: 401 Unauthorized

# Authenticated user (with cookies)
curl -H "Cookie: sb-access-token=..." http://localhost:5000/api/profile
# Expected: 200 OK with profile data

# Non-admin accessing admin route
curl -H "Cookie: sb-access-token=..." http://localhost:5000/api/admin/questions/needs-review
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

# Auth endpoint should deny unauthenticated requests (401)
curl -i http://localhost:5000/api/profile
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
