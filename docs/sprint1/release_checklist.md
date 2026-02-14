# Sprint 1 Release Checklist
**Date**: 2026-02-01  
**Sprint**: 1  
**Repository**: Lyceon-Team/Lyceonai

---

## Pre-Release Validation

### 1. Local Development Setup

**Prerequisites**:
- Node.js 20.x
- pnpm 9.x
- PostgreSQL database (Supabase or Neon)

**Environment Variables** (copy `.env.example` to `.env`):
```bash
# Required
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-key

# Optional (for full features)
DATABASE_URL=your-postgres-connection-string
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
PUBLIC_SITE_URL=http://localhost:5000
```

**Installation**:
```bash
# Install dependencies
pnpm install --frozen-lockfile

# Expected Output
✓ Dependencies installed successfully
```

**If Installation Fails**:
- Check Node.js version: `node -v` (should be 20.x)
- Check pnpm version: `pnpm -v` (should be 9.x)
- Clear cache: `pnpm store prune && pnpm install --frozen-lockfile`

---

### 2. TypeScript Check

**Command**:
```bash
pnpm exec tsc -p tsconfig.ci.json
```

**Expected Output**:
```
✓ No TypeScript errors
```

**If Fails**:
- Check error messages for file paths and line numbers
- Fix type errors in indicated files
- Re-run: `pnpm exec tsc -p tsconfig.ci.json`
- Common issues:
  - Undefined variables (add imports)
  - Type mismatches (check function signatures)
  - Missing return types (add explicit return types)

**Acceptable Exclusions**:
- `server/legacy-server.ts` (intentionally excluded)
- `**/AdminReviewPage.tsx` (intentionally excluded)
- `**/*.test.ts`, `**/*.test.tsx` (test files)

---

### 3. Unit Tests (Deterministic)

**Command**:
```bash
pnpm test:ci
```

**Expected Output**:
```
✓ All tests passed
Test Files: XX passed (XX)
Tests: XXX passed (XXX)
Duration: XX.XXs
```

**If Fails**:
- Read test failure messages carefully
- Check for:
  - Environment variable issues (set required vars)
  - Database connection errors (check `DATABASE_URL`)
  - Missing dependencies (run `pnpm install`)
- Re-run specific test file: `pnpm vitest run <path/to/test.ts>`
- Fix code or tests as needed
- Re-run: `pnpm test:ci`

**Test Configuration**:
- **File**: `vitest.config.ts`
- **Settings**: `maxThreads: 1` (single-threaded for stability)
- **Environment**: `CI=true` (set automatically)

---

### 4. Security Regression Tests

**Command**:
```bash
pnpm test:security
```

**Expected Output**:
```
✓ All security tests passed
Test Files: 2 passed (2)
  - tests/idor.regression.test.ts
  - tests/entitlements.regression.test.ts
```

**If Fails**:
- **CRITICAL**: Do NOT ship if security tests fail
- Investigate failure:
  - IDOR (Insecure Direct Object Reference) violations
  - Entitlement bypass issues
  - Missing authentication checks
- Fix security vulnerabilities immediately
- Re-run: `pnpm test:security`
- If unsure, escalate to security team

**Security Tests Coverage**:
- `/api/admin/*` routes (require admin role)
- `/api/guardian/*` routes (require guardian role)
- Student data access (require authentication + ownership)
- Billing endpoints (require authentication + entitlement)

---

### 5. Build (Production Bundle)

**Command**:
```bash
pnpm run build
```

**Expected Output**:
```
vite v7.x.x building for production...
✓ XX modules transformed
dist/index.js  XXX.XX kB

✓ Client built successfully
✓ Server built successfully
✓ No CDN KaTeX references found (security check passed)
```

**If Fails**:

#### Build Failure (Vite)
```bash
# Error: Cannot find module 'X'
# Fix: Install missing dependency
pnpm install X

# Error: Syntax error in file Y
# Fix: Check file Y for syntax errors, fix and re-run
```

#### Build Failure (esbuild)
```bash
# Error: Cannot bundle server/index.ts
# Fix: Check for missing imports, circular dependencies
# Re-run: pnpm run build
```

#### CDN KaTeX Check Failure
```bash
# Output: "FOUND CDN KATEX - FAIL"
# Fix: Remove CDN references from code
grep -r "cdn.jsdelivr.net/npm/katex" client/src server
# Replace with local imports: import "katex/dist/katex.min.css"
```

**Build Artifacts**:
- `dist/index.js` - Server bundle
- `dist/public/` - Client static files
- `client/dist/` - Client build output

---

### 6. Development Server (Smoke Test)

**Command**:
```bash
pnpm dev
```

**Expected Output**:
```
🔧 [ENV] Environment validation starting...
✅ [ENV] Core: NODE_ENV=development, API_PORT=5000
✅ [ENV] SUPABASE_URL configured
✅ [ENV] GEMINI_API_KEY configured
🚀 Server running on http://localhost:5000
```

**Smoke Tests** (in browser or curl):

#### 1. Health Check
```bash
curl http://localhost:5000/healthz

# Expected: {"status":"ok"}
```

#### 2. Public Page (SSR)
```bash
curl http://localhost:5000/

# Expected: HTML response with <title>Lyceon</title>
```

#### 3. API Health
```bash
curl http://localhost:5000/api/health

# Expected: {"status":"ok","timestamp":"..."}
```

#### 4. Auth Endpoint (Unauthenticated)
```bash
curl http://localhost:5000/api/auth/user

# Expected: {"user":null}
```

**If Smoke Tests Fail**:
- Check server logs for errors
- Verify environment variables are set
- Check database connectivity
- Restart server: `Ctrl+C` then `pnpm dev`

---

### 7. Production Build Smoke Test

**Commands**:
```bash
# Build production bundle
pnpm run build

# Start production server
pnpm start
```

**Expected Output**:
```bash
# Build output (see step 5)

# Server startup
🔧 [ENV] Environment validation starting...
✅ [ENV] Core: NODE_ENV=production, API_PORT=5000
🚀 Production server running on http://localhost:5000
```

**Production Smoke Tests**:

#### 1. Health Check
```bash
curl http://localhost:5000/healthz

# Expected: {"status":"ok"}
```

#### 2. CSRF Protection (Should Block)
```bash
curl -X POST http://localhost:5000/api/rag \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'

# Expected: 403 (CSRF blocked - no origin header)
```

#### 3. Static Files
```bash
curl http://localhost:5000/assets/index.js

# Expected: JavaScript bundle (200 OK)
```

**If Production Tests Fail**:
- Check `NODE_ENV=production` is set
- Verify `PUBLIC_SITE_URL` is set (required in production)
- Check build artifacts exist in `dist/`
- Review server logs for errors

---

## CI Validation (GitHub Actions)

### 8. CI Pipeline Check

**Trigger**: Push to main or open PR

**Required Job Steps**:
1. Checkout
2. Setup pnpm
3. Setup Node
4. Install dependencies (`pnpm install --frozen-lockfile`)
5. TypeScript check (`pnpm exec tsc -p tsconfig.ci.json`)
6. Run tests (`pnpm test:ci`)
7. Build (`pnpm run build`)

**Expected CI Output**:
```
✓ TypeScript Check (CI) - Passed
✓ Run Tests (Deterministic CI Suite) - Passed
✓ Build - Passed
```

**If CI Fails**:

#### TypeScript Errors
- View CI logs for error details
- Fix locally: `pnpm exec tsc -p tsconfig.ci.json`
- Commit and push fixes

#### Test Failures
- View CI logs for test failure details
- Reproduce locally: `CI=true pnpm test:ci`
- Fix tests or code
- Commit and push fixes

#### Build Failures
- View CI logs for build error details
- Reproduce locally: `pnpm run build`
- Fix build issues
- Commit and push fixes

**Optional Integration Job**:
- Only runs on `main` branch
- Requires secrets (not run on forks)
- Currently placeholder (not implemented)

---

## Pre-Deployment Checklist

### 9. Environment Variables (Production)

**Critical Variables** (MUST be set):
```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GEMINI_API_KEY=YOUR_GEMINI_KEY
PUBLIC_SITE_URL=https://lyceon.ai
NODE_ENV=production
```

**Optional Variables** (recommended):
```bash
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
DATABASE_URL=postgresql://...
CORS_ORIGINS=https://lyceon.ai,https://www.lyceon.ai
CSRF_ALLOWED_ORIGINS=https://lyceon.ai,https://www.lyceon.ai
```

**Feature Flags**:
```bash
VECTORS_ENABLED=true
QA_LLM_ENABLED=true
ENABLE_UNDER_13_GATE=true
```

**Validation Command** (pre-deployment):
```bash
# Check required variables
if [ -z "$SUPABASE_URL" ]; then echo "ERROR: SUPABASE_URL not set"; exit 1; fi
if [ -z "$SUPABASE_ANON_KEY" ]; then echo "ERROR: SUPABASE_ANON_KEY not set"; exit 1; fi
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then echo "ERROR: SUPABASE_SERVICE_ROLE_KEY not set"; exit 1; fi
if [ -z "$GEMINI_API_KEY" ]; then echo "ERROR: GEMINI_API_KEY not set"; exit 1; fi
if [ -z "$PUBLIC_SITE_URL" ]; then echo "ERROR: PUBLIC_SITE_URL not set"; exit 1; fi
echo "✓ All required environment variables are set"
```

---

### 10. Database Schema Validation

**Commands**:
```bash
# Check database connectivity
curl http://localhost:5000/api/health

# Admin-only: Check database schema
curl http://localhost:5000/api/admin/db-health \
  -H "Cookie: sb-access-token=YOUR_ADMIN_TOKEN"

# Expected: {"status":"ok","tables":[...]}
```

**Manual Validation**:
1. Verify `users` table exists
2. Verify `questions` table exists with `ingestionRunId` field
3. Verify `student_attempts` table exists
4. Verify `lyceon_accounts` table exists
5. Verify `stripe_customers` table exists (if billing enabled)

**If Schema Issues**:
- Run migrations: `pnpm db:push` (development only)
- Contact database admin for production schema updates

---

### 11. Billing Integration (Stripe)

**Prerequisites**:
- Stripe account configured
- Webhook endpoint registered: `https://lyceon.ai/api/billing/webhook`
- `STRIPE_WEBHOOK_SECRET` set

**Validation Commands**:
```bash
# Check Stripe publishable key endpoint (public)
curl http://localhost:5000/api/billing/publishable-key

# Expected: {"publishableKey":"pk_..."}

# Check Stripe products (authenticated)
curl http://localhost:5000/api/billing/products \
  -H "Cookie: sb-access-token=YOUR_TOKEN"

# Expected: {"products":[...]}
```

**Webhook Testing** (Stripe CLI):
```bash
stripe listen --forward-to localhost:5000/api/billing/webhook

# Trigger test event
stripe trigger checkout.session.completed

# Expected: 200 OK response
```

---

## Post-Deployment Validation

### 12. Production Smoke Tests

**After deployment, run these tests**:

#### 1. Health Check
```bash
curl https://lyceon.ai/healthz

# Expected: {"status":"ok"}
```

#### 2. Homepage (SSR)
```bash
curl https://lyceon.ai/

# Expected: HTML with <title>Lyceon - SAT Prep Platform</title>
```

#### 3. API Health
```bash
curl https://lyceon.ai/api/health

# Expected: {"status":"ok","timestamp":"..."}
```

#### 4. CORS (Public Origin)
```bash
curl https://lyceon.ai/api/questions/recent \
  -H "Origin: https://lyceon.ai"

# Expected: 200 OK with CORS headers
```

#### 5. CSRF Protection (Invalid Origin)
```bash
curl -X POST https://lyceon.ai/api/rag \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'

# Expected: 403 Forbidden (CSRF blocked)
```

#### 6. Authentication Flow (Manual Browser Test)
1. Navigate to `https://lyceon.ai/auth/signin`
2. Sign in with test account
3. Verify redirect to dashboard
4. Check cookie `sb-access-token` is set (httpOnly)
5. Navigate to `/api/auth/user` (should return user object)

**If Production Tests Fail**:
- Check deployment logs
- Verify environment variables are set
- Check database connectivity
- Verify DNS and SSL configuration
- Review application logs for errors

---

## Rollback Plan

### If Deployment Fails

**Immediate Actions**:
1. **Revert to previous version**:
   ```bash
   # Git tag or commit SHA of last known good version
   git checkout <previous-version-tag>
   pnpm run build
   pnpm start
   ```

2. **Check error logs**:
   ```bash
   # View application logs
   tail -n 100 /var/log/lyceon/app.log
   ```

3. **Notify team**:
   - Post in #deployments channel
   - Include error messages and logs
   - Tag @engineering-lead

**Common Rollback Scenarios**:

| Issue | Rollback Action |
|-------|-----------------|
| Environment variable missing | Set variable and restart server |
| Database connection failure | Check DATABASE_URL, verify firewall rules |
| Stripe webhook issues | Verify STRIPE_WEBHOOK_SECRET, check webhook logs |
| Build artifacts corrupted | Re-run `pnpm run build`, redeploy |
| TypeScript errors in production | Revert to last known good commit |

---

## Release Sign-Off

**Before marking release as complete, verify**:

- [ ] All tests pass locally (`pnpm test:ci`)
- [ ] Security tests pass (`pnpm test:security`)
- [ ] TypeScript check passes (`pnpm exec tsc -p tsconfig.ci.json`)
- [ ] Build succeeds (`pnpm run build`)
- [ ] CI pipeline passes (GitHub Actions)
- [ ] Environment variables documented in deploy_runbook.md
- [ ] Production smoke tests pass
- [ ] Authentication flow works in production
- [ ] Billing integration tested (if enabled)
- [ ] No critical errors in application logs (first 24 hours)

**Sign-Off**:
- Engineer: _______________
- QA Lead: _______________
- Product Manager: _______________
- Date: _______________

---

**End of Release Checklist**
