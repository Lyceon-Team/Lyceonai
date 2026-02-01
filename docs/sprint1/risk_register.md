# Sprint 1 Risk Register
**Date**: 2026-02-01  
**Sprint**: 1  
**Repository**: Lyceon-Team/Lyceonai

---

## Risk Assessment Methodology

**Impact Scale**: 1-5 (1 = minimal, 5 = catastrophic)  
**Likelihood Scale**: 1-5 (1 = rare, 5 = certain)  
**Risk Score**: Impact × Likelihood  
**Ship Blocker**: Yes/No (blocks production release)

---

## Top 10 Risks

### 1. Undefined Worker Functions (Runtime Crash Risk)

**Impact**: 5/5 (Server crash if worker routes accessed)  
**Likelihood**: 2/5 (Routes exist but unlikely to be called)  
**Risk Score**: 10  
**Ship Blocker**: ❌ No (dead code, routes not exposed in UI)

**Evidence**:
- **File**: `server/index.ts`, lines 728-744
- **Functions**: `isWorkerEnabled()`, `startWorker()`, `getWorkerStatus()`, `stopWorker()`
- **Status**: Called but not imported

**Root Cause**:
- Functions exist in `apps/api/src/ingestion_v4/services/v4AlwaysOnWorker.ts`
- Import statement removed when ingestion routes were disabled
- Route handlers remain but are never called (no UI exposed)

**Mitigation**:
- Option A: Remove worker route handlers (lines 728-744)
- Option B: Import functions and add feature flag guard
- Option C: Comment out worker routes like ingestion routes

**Recommendation**: Remove worker routes (Option A) to eliminate dead code.

---

### 2. Ingestion Dead Code (Maintenance & Security Risk)

**Impact**: 3/5 (Code complexity, attack surface)  
**Likelihood**: 4/5 (Code exists and is unmaintained)  
**Risk Score**: 12  
**Ship Blocker**: ❌ No (routes unmounted, no runtime impact)

**Evidence**:
- **Files**:
  - `apps/api/src/routes/ingestion-v4.ts` (47+ endpoints)
  - `apps/api/src/routes/ingest-llm.ts` (legacy)
  - `apps/api/src/routes/documents.ts` (deprecated)
  - `client/src/pages/AdminIngestPage.tsx` (UI)
  - `client/src/components/admin/AdminPDFUpload.tsx` (UI)
- **Status**: Routes unmounted (server/index.ts:286-292)

**Root Cause**:
- Ingestion deprecated but code not removed
- Frontend UI still attempts to call non-existent endpoints
- Environment variables still defined (`INGEST_ADMIN_TOKEN`, etc.)

**Mitigation**:
- Option A: Delete ingestion files entirely
- Option B: Move to `deprecated/` directory with clear documentation
- Option C: Feature-flag ingestion routes for admin-only emergency use

**Recommendation**: Move to `deprecated/` directory (Option B) with clear "DO NOT USE" documentation.

---

### 3. PUBLIC_SITE_URL Validation Crash

**Impact**: 5/5 (Production server won't start)  
**Likelihood**: 2/5 (Environment variable should be set in prod)  
**Risk Score**: 10  
**Ship Blocker**: ⚠️ Yes (if `PUBLIC_SITE_URL` not set in deployment)

**Evidence**:
- **File**: `server/index.ts`, lines 614-630
- **Code**:
  ```typescript
  if (env.NODE_ENV === 'production' && !publicSiteUrl) {
    throw new Error('PUBLIC_SITE_URL must be set in production');
  }
  ```

**Root Cause**:
- Intentional production guard
- No fallback or default value
- Not validated in CI (CI runs without `NODE_ENV=production`)

**Mitigation**:
- Option A: Add `PUBLIC_SITE_URL` to `.env.example` and deployment docs
- Option B: Add fallback to `https://lyceon.ai` in production
- Option C: Validate in CI with `NODE_ENV=production` dry-run

**Recommendation**: Option A (document) + Option C (CI validation) to catch missing vars before deployment.

---

### 4. CSRF Guard Module-Level Initialization

**Impact**: 4/5 (Server won't start if CSRF init fails)  
**Likelihood**: 1/5 (CSRF guard is simple, unlikely to fail)  
**Risk Score**: 4  
**Ship Blocker**: ❌ No (low likelihood, simple code)

**Evidence**:
- **File**: `server/index.ts`, line 78
- **Code**:
  ```typescript
  const csrfProtection = csrfGuard();
  ```

**Root Cause**:
- CSRF guard initialized at module import time
- No try-catch wrapper
- Failure would prevent server startup

**Mitigation**:
- Option A: Wrap in try-catch with fallback
- Option B: Move initialization to server startup function
- Option C: Accept current behavior (simple code, low risk)

**Recommendation**: Option C (accept current behavior) unless CSRF guard logic becomes more complex.

---

### 5. Ingestion Data in Student-Facing Tables

**Impact**: 3/5 (Data dependency on deprecated system)  
**Likelihood**: 5/5 (Currently happening)  
**Risk Score**: 15  
**Ship Blocker**: ⚠️ Yes (if new questions needed, ingestion unavailable)

**Evidence**:
- **Files**:
  - `shared/schema.ts` (questions table has `ingestionRunId` field)
  - `apps/api/src/routes/questions.ts` (student endpoints query ingested questions)
- **Endpoints**:
  - `/api/questions/recent` (authenticated, returns questions with `ingestionRunId`)
  - `/api/questions/random` (authenticated, returns questions with `ingestionRunId`)

**Root Cause**:
- Questions were created via ingestion pipeline
- Ingestion routes disabled but data remains in database
- No alternative question creation method exposed

**Mitigation**:
- Option A: Document that questions are pre-seeded (no new ingestion needed)
- Option B: Create admin-only question creation UI (manual entry)
- Option C: Re-enable ingestion routes behind admin-only flag

**Recommendation**: Option A (document) + Option B (manual creation UI for emergencies).

---

### 6. AdminReviewPage.tsx Excluded from TypeScript Check

**Impact**: 3/5 (Potential type errors in admin UI)  
**Likelihood**: 3/5 (If admin UI is used)  
**Risk Score**: 9  
**Ship Blocker**: ❌ No (admin-only UI, not critical path)

**Evidence**:
- **File**: `tsconfig.json`, `tsconfig.ci.json` (exclude `**/AdminReviewPage.tsx`)
- **Location**: `client/src/pages/AdminReviewPage.tsx`

**Root Cause**:
- Page excluded due to type errors or deprecated functionality
- Exclusion documented in both configs

**Mitigation**:
- Option A: Fix type errors and re-enable TypeScript checking
- Option B: Delete AdminReviewPage.tsx if truly deprecated
- Option C: Move to `deprecated/` with explicit exclusion documentation

**Recommendation**: Option B (delete) if page is unused, else Option A (fix types).

---

### 7. Integration Tests Not Implemented

**Impact**: 3/5 (Missing end-to-end validation)  
**Likelihood**: 5/5 (Currently not implemented)  
**Risk Score**: 15  
**Ship Blocker**: ⚠️ Yes (no integration test coverage)

**Evidence**:
- **File**: `package.json`, line 16
- **Code**:
  ```json
  "test:integration": "echo 'Integration tests with real secrets not yet configured'"
  ```
- **CI Workflow**: `.github/workflows/ci.yml`, lines 50-83 (optional job, placeholder)

**Root Cause**:
- Integration tests planned but not implemented
- Required for end-to-end auth flow validation
- Optional CI job exists but doesn't run real tests

**Mitigation**:
- Option A: Implement integration tests for critical paths (auth, billing, practice)
- Option B: Document manual testing checklist as alternative
- Option C: Defer to Sprint 2

**Recommendation**: Option A (implement) for Sprint 1 - critical for auth flow validation.

---

### 8. No RLS Enforcement at Database Level

**Impact**: 5/5 (Potential data leakage if application layer fails)  
**Likelihood**: 2/5 (Application layer is thorough)  
**Risk Score**: 10  
**Ship Blocker**: ⚠️ Yes (defense-in-depth missing)

**Evidence**:
- **File**: `server/middleware/supabase-auth.ts` (comment in authentication docs)
- **Note**: "RLS not enforced at DB level (Neon uses connection pooling), instead enforced at application layer via WHERE clauses"

**Root Cause**:
- Database (Neon) uses connection pooling
- Row-level security (RLS) not enforced by database
- Application layer must enforce all access control

**Mitigation**:
- Option A: Migrate to Supabase-hosted database (native RLS support)
- Option B: Add database-level RLS policies to Neon
- Option C: Comprehensive application-layer tests (current approach)

**Recommendation**: Option C (comprehensive tests) + Option B (investigate Neon RLS) for Sprint 2.

---

### 9. CDN KaTeX Check in Postbuild (Single Point of Failure)

**Impact**: 2/5 (Build fails if grep finds CDN reference)  
**Likelihood**: 2/5 (Unlikely unless dependency changes)  
**Risk Score**: 4  
**Ship Blocker**: ❌ No (intentional security check)

**Evidence**:
- **File**: `package.json`, line 10
- **Code**:
  ```json
  "postbuild": "! grep -RIn 'cdn.jsdelivr.net/npm/katex' dist public client/dist 2>/dev/null || (echo 'FOUND CDN KATEX - FAIL' && exit 1)"
  ```

**Root Cause**:
- Security measure to prevent external CDN usage
- Prevents XSS/supply-chain attacks via CDN
- Grep-based check is brittle

**Mitigation**:
- Option A: Replace with ESLint rule or bundler plugin
- Option B: Add exception list for allowed CDNs
- Option C: Accept current behavior (intentional build failure)

**Recommendation**: Option C (accept) - intentional security measure, working as designed.

---

### 10. Stripe Webhook Signature Verification (Production Secret Dependency)

**Impact**: 5/5 (Billing broken if signature verification fails)  
**Likelihood**: 2/5 (Webhook secret should be set in prod)  
**Risk Score**: 10  
**Ship Blocker**: ⚠️ Yes (if `STRIPE_WEBHOOK_SECRET` not set)

**Evidence**:
- **File**: `server/lib/webhookHandlers.ts` (Stripe signature verification)
- **Variable**: `STRIPE_WEBHOOK_SECRET` (required for production billing)

**Root Cause**:
- Stripe webhooks require signature verification
- Secret must be set in production environment
- No fallback or local testing mode

**Mitigation**:
- Option A: Add `STRIPE_WEBHOOK_SECRET` to deployment checklist
- Option B: Add startup validation for billing-related secrets
- Option C: Implement mock webhook mode for testing

**Recommendation**: Option A (deployment checklist) + Option B (startup validation).

---

## Risk Summary

| Risk | Impact | Likelihood | Score | Ship Blocker |
|------|--------|------------|-------|--------------|
| Undefined Worker Functions | 5 | 2 | 10 | ❌ No |
| Ingestion Dead Code | 3 | 4 | 12 | ❌ No |
| PUBLIC_SITE_URL Crash | 5 | 2 | 10 | ⚠️ Yes |
| CSRF Guard Init | 4 | 1 | 4 | ❌ No |
| Ingestion Data Dependency | 3 | 5 | 15 | ⚠️ Yes |
| AdminReviewPage Excluded | 3 | 3 | 9 | ❌ No |
| Integration Tests Missing | 3 | 5 | 15 | ⚠️ Yes |
| No DB-Level RLS | 5 | 2 | 10 | ⚠️ Yes |
| CDN KaTeX Check | 2 | 2 | 4 | ❌ No |
| Stripe Webhook Secret | 5 | 2 | 10 | ⚠️ Yes |

**Total Ship Blockers**: 5 (risks requiring mitigation before production release)

---

## Recommended Priorities for Sprint 1

### High Priority (Must Fix)

1. **Integration Tests** (Risk #7) - Implement critical auth/billing/practice tests
2. **PUBLIC_SITE_URL Validation** (Risk #3) - Add to deployment docs and CI check
3. **Stripe Webhook Secret** (Risk #10) - Add to deployment checklist and startup validation
4. **Ingestion Data Dependency** (Risk #5) - Document question seeding + create manual entry UI

### Medium Priority (Should Fix)

5. **Undefined Worker Functions** (Risk #1) - Remove dead code (lines 728-744 in server/index.ts)
6. **Ingestion Dead Code** (Risk #2) - Move to `deprecated/` directory
7. **AdminReviewPage Exclusion** (Risk #6) - Fix types or delete page

### Low Priority (Defer to Sprint 2)

8. **No DB-Level RLS** (Risk #8) - Investigate Neon RLS support
9. **CSRF Guard Init** (Risk #4) - Accept current behavior (low risk)
10. **CDN KaTeX Check** (Risk #9) - Accept current behavior (intentional)

---

**End of Risk Register**
