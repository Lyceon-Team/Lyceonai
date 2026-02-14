# Sprint 1 Sub-Branch Plan
**Date**: 2026-02-01  
**Sprint**: 1 (Post Sprint 0 Completion)  
**Repository**: Lyceon-Team/Lyceonai

---

## Overview

Sprint 1 focuses on eliminating ship blockers identified in the audit snapshot and risk register. Each PR is designed to be **small, boring, and deterministic** with clear acceptance criteria.

**Total PRs**: 7  
**Timeline**: 1-2 weeks  
**Risk Mitigation**: Addresses 5 ship blockers from risk register

---

## PR #1: Remove Ingestion Dead Code

**Branch**: `sprint1/remove-ingestion-dead-code`  
**Ship Blocker**: Risk #2 (Ingestion Dead Code)  
**Complexity**: Low  
**Estimated Time**: 2-3 hours

### Objective

Remove or archive deprecated ingestion code that is no longer used in production.

### Files to Touch

**Delete**:
- `apps/api/src/routes/ingestion-v4.ts` (47+ endpoints, unmounted)
- `apps/api/src/routes/ingest-llm.ts` (legacy ingestion)
- `apps/api/src/routes/documents.ts` (deprecated)
- `client/src/pages/AdminIngestPage.tsx` (UI calls non-existent endpoints)
- `client/src/components/admin/AdminPDFUpload.tsx` (UI for ingestion)
- `client/src/components/pdf-upload.tsx` (shared PDF upload component)
- `server/index.ts` lines 728-744 (worker function calls)

**Update**:
- `.env.example` - Remove `VITE_INGEST_ADMIN_TOKEN`, `INGEST_ADMIN_TOKEN`, `INGEST_TIMEOUT_MS`
- `apps/api/src/middleware/bearer-auth.ts` - Remove `INGEST_ADMIN_TOKEN` reference
- Remove navigation links to AdminIngestPage in client routing

**Archive** (Move to `deprecated/` directory):
- `apps/api/src/ingestion_v4/` (entire directory)
- Document in `deprecated/README.md` why code was deprecated

### Acceptance Tests

**Before PR**:
```bash
# Verify routes are unmounted
grep -n "ingestion-v4\|ingest-llm" server/index.ts
# Expected: Comments only (lines 286-292)

# Verify worker functions are undefined
grep -n "isWorkerEnabled\|startWorker" server/index.ts
# Expected: Lines 728-744 (undefined functions)
```

**After PR**:
```bash
# Verify files deleted
ls apps/api/src/routes/ingestion-v4.ts
# Expected: No such file or directory

# Verify worker routes removed
grep -n "isWorkerEnabled\|startWorker" server/index.ts
# Expected: No matches

# Build succeeds
pnpm run build
# Expected: ✓ Client built successfully, ✓ Server built successfully

# Tests pass
pnpm test:ci
# Expected: ✓ All tests passed
```

**Manual Verification**:
1. Navigate to `/admin` in browser
2. Verify no "Ingest" or "PDF Upload" links
3. Check server logs for no references to ingestion routes

---

## PR #2: Implement Integration Tests

**Branch**: `sprint1/add-integration-tests`  
**Ship Blocker**: Risk #7 (Integration Tests Missing)  
**Complexity**: Medium  
**Estimated Time**: 8-12 hours

### Objective

Implement end-to-end integration tests for critical authentication and billing flows.

### Files to Touch

**Create**:
- `tests/integration/auth.integration.test.ts` - Auth flow tests
- `tests/integration/billing.integration.test.ts` - Billing flow tests
- `tests/integration/practice.integration.test.ts` - Practice flow tests
- `tests/integration/setup.ts` - Test setup and teardown

**Update**:
- `package.json` - Update `test:integration` script
- `vitest.config.ts` - Add integration test configuration
- `.github/workflows/ci.yml` - Update integration job (already exists)

### Test Coverage

**Auth Flow** (`auth.integration.test.ts`):
```typescript
describe('Authentication Integration', () => {
  it('should sign up new user with email/password', async () => {
    // POST /api/auth/signup
    // Verify user created in database
    // Verify cookie set
  });

  it('should sign in existing user', async () => {
    // POST /api/auth/signin
    // Verify cookie set
    // GET /api/auth/user (verify user returned)
  });

  it('should sign out user', async () => {
    // POST /api/auth/signout
    // Verify cookie cleared
    // GET /api/auth/user (verify user null)
  });

  it('should reject invalid credentials', async () => {
    // POST /api/auth/signin with wrong password
    // Expected: 401 Unauthorized
  });

  it('should enforce CSRF protection on auth endpoints', async () => {
    // POST /api/auth/signup with invalid origin
    // Expected: 403 Forbidden
  });
});
```

**Billing Flow** (`billing.integration.test.ts`):
```typescript
describe('Billing Integration', () => {
  it('should retrieve Stripe publishable key', async () => {
    // GET /api/billing/publishable-key
    // Expected: 200 OK with key
  });

  it('should create checkout session for guardian', async () => {
    // POST /api/billing/checkout (authenticated guardian)
    // Expected: 200 OK with session URL
  });

  it('should reject billing access for students', async () => {
    // POST /api/billing/checkout (authenticated student)
    // Expected: 403 Forbidden
  });

  it('should handle Stripe webhook events', async () => {
    // POST /api/billing/webhook with test event
    // Verify database updated
  });
});
```

**Practice Flow** (`practice.integration.test.ts`):
```typescript
describe('Practice Integration', () => {
  it('should retrieve next question for student', async () => {
    // GET /api/practice/canonical/next (authenticated student)
    // Expected: 200 OK with question
  });

  it('should submit answer and track attempt', async () => {
    // POST /api/practice/canonical/answer (authenticated student)
    // Verify attempt recorded in database
    // Expected: 200 OK with feedback
  });

  it('should reject practice access for unauthenticated users', async () => {
    // GET /api/practice/canonical/next (no auth)
    // Expected: 401 Unauthorized
  });
});
```

### Acceptance Tests

**Before PR**:
```bash
# Integration tests are placeholder
pnpm test:integration
# Expected: "Integration tests with real secrets not yet configured"
```

**After PR**:
```bash
# Integration tests run (requires secrets)
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export SUPABASE_ANON_KEY=...
pnpm test:integration
# Expected: ✓ All integration tests passed

# TypeScript check passes
pnpm exec tsc -p tsconfig.json
# Expected: ✓ No TypeScript errors

# CI passes (integration job)
# GitHub Actions should run integration tests on main branch
```

**Manual Verification**:
1. Run `pnpm test:integration` locally with secrets
2. Verify database records created during tests
3. Verify tests clean up after themselves (no orphaned data)

---

## PR #3: Add Environment Variable Validation to CI

**Branch**: `sprint1/ci-env-validation`  
**Ship Blocker**: Risk #3 (PUBLIC_SITE_URL Validation Crash)  
**Complexity**: Low  
**Estimated Time**: 2-3 hours

### Objective

Add CI check to validate that all required production environment variables are documented and testable.

### Files to Touch

**Create**:
- `scripts/validate-env-vars.ts` - Script to validate environment variables

**Update**:
- `.github/workflows/ci.yml` - Add env var validation step
- `docs/sprint1/deploy_runbook.md` - Document all required env vars (already done)

### Script Logic

**`scripts/validate-env-vars.ts`**:
```typescript
#!/usr/bin/env tsx

const REQUIRED_PROD_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GEMINI_API_KEY',
  'PUBLIC_SITE_URL',
];

const OPTIONAL_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'DATABASE_URL',
  'CORS_ORIGINS',
];

// Check that all required vars are documented in .env.example
// Check that deploy_runbook.md lists all required vars
// Exit 1 if any missing
```

### Acceptance Tests

**Before PR**:
```bash
# No env var validation in CI
# .github/workflows/ci.yml has no env var check
```

**After PR**:
```bash
# CI includes env var validation
pnpm exec tsx scripts/validate-env-vars.ts
# Expected: ✓ All required environment variables documented

# TypeScript check passes
pnpm exec tsc -p tsconfig.json
# Expected: ✓ No TypeScript errors

# CI passes
# GitHub Actions should validate env vars in CI job
```

**Manual Verification**:
1. Check `.env.example` includes all required vars
2. Check `deploy_runbook.md` documents all required vars
3. Run validation script locally

---

## PR #4: Fix AdminReviewPage TypeScript Errors

**Branch**: `sprint1/fix-admin-review-page`  
**Ship Blocker**: Risk #6 (AdminReviewPage Excluded)  
**Complexity**: Medium  
**Estimated Time**: 4-6 hours

### Objective

Fix TypeScript errors in AdminReviewPage.tsx and re-enable type checking, or delete if page is unused.

### Decision Tree

**Option A**: Fix type errors and re-enable
- Investigate why page was excluded
- Fix type errors
- Remove exclusion from `tsconfig.json` and `tsconfig.ci.json`
- Add tests

**Option B**: Delete page if unused
- Verify page is not linked in navigation
- Verify no critical functionality in page
- Delete `client/src/pages/AdminReviewPage.tsx`
- Remove exclusion from tsconfig files

### Files to Touch

**If Option A (Fix)**:
- `client/src/pages/AdminReviewPage.tsx` - Fix type errors
- `tsconfig.json` - Remove `**/AdminReviewPage.tsx` from exclude
- `tsconfig.ci.json` - Remove `**/AdminReviewPage.tsx` from exclude

**If Option B (Delete)**:
- Delete `client/src/pages/AdminReviewPage.tsx`
- `tsconfig.json` - Remove `**/AdminReviewPage.tsx` from exclude
- `tsconfig.ci.json` - Remove `**/AdminReviewPage.tsx` from exclude
- Remove any navigation links to page

### Acceptance Tests

**Before PR**:
```bash
# AdminReviewPage excluded from type checking
grep "AdminReviewPage" tsconfig.json tsconfig.ci.json
# Expected: Found in exclude arrays
```

**After PR (Option A - Fix)**:
```bash
# AdminReviewPage included in type checking
grep "AdminReviewPage" tsconfig.json tsconfig.ci.json
# Expected: No matches

# TypeScript check passes
pnpm exec tsc -p tsconfig.ci.json
# Expected: ✓ No TypeScript errors (including AdminReviewPage)

# Build succeeds
pnpm run build
# Expected: ✓ Client built successfully
```

**After PR (Option B - Delete)**:
```bash
# File deleted
ls client/src/pages/AdminReviewPage.tsx
# Expected: No such file or directory

# TypeScript check passes
pnpm exec tsc -p tsconfig.ci.json
# Expected: ✓ No TypeScript errors

# Build succeeds
pnpm run build
# Expected: ✓ Client built successfully
```

**Manual Verification**:
1. Navigate to `/admin` in browser
2. Verify no broken links
3. Check admin UI functionality

---

## PR #5: Add Deployment Checklist Automation

**Branch**: `sprint1/deployment-automation`  
**Ship Blocker**: Risk #10 (Stripe Webhook Secret)  
**Complexity**: Low  
**Estimated Time**: 3-4 hours

### Objective

Add automated deployment checklist to validate environment before production startup.

### Files to Touch

**Create**:
- `scripts/pre-deploy-check.ts` - Pre-deployment validation script

**Update**:
- `server/index.ts` - Add pre-deploy check call in production
- `package.json` - Add `predeploy` script

### Script Logic

**`scripts/pre-deploy-check.ts`**:
```typescript
#!/usr/bin/env tsx

// Validate all required env vars are set
// Validate database connectivity
// Validate Supabase connectivity
// Validate Stripe configuration (if enabled)
// Exit 1 if any checks fail

const checks = {
  envVars: () => { /* check required vars */ },
  database: () => { /* test DB connection */ },
  supabase: () => { /* test Supabase API */ },
  stripe: () => { /* test Stripe API */ },
};

// Run all checks, report results
```

### Acceptance Tests

**Before PR**:
```bash
# No automated deployment checks
# Server starts even with missing env vars (production crash)
```

**After PR**:
```bash
# Pre-deployment check script exists
pnpm predeploy
# Expected: ✓ All deployment checks passed (or fails with clear error)

# Production startup includes validation
NODE_ENV=production pnpm start
# Expected: ✓ Environment validation complete (or fails if vars missing)

# TypeScript check passes
pnpm exec tsc -p tsconfig.json
# Expected: ✓ No TypeScript errors
```

**Manual Verification**:
1. Run `pnpm predeploy` with missing `PUBLIC_SITE_URL`
2. Verify script exits with error
3. Set all required vars and re-run
4. Verify script passes

---

## PR #6: Document Question Seeding Process

**Branch**: `sprint1/document-question-seeding`  
**Ship Blocker**: Risk #5 (Ingestion Data Dependency)  
**Complexity**: Low  
**Estimated Time**: 2-3 hours

### Objective

Document that questions are pre-seeded and provide manual question creation process for emergencies.

### Files to Touch

**Create**:
- `docs/sprint1/question_management.md` - Question seeding and management documentation
- `scripts/create-question-manual.ts` - Script for manual question creation

**Update**:
- `README.md` - Link to question management docs

### Documentation Content

**`docs/sprint1/question_management.md`**:
```markdown
# Question Management

## Overview
- Questions are pre-seeded from ingestion runs
- Ingestion routes are deprecated and disabled
- New questions can be added manually via admin script

## Pre-Seeded Questions
- Database contains XXX questions from ingestion
- Questions include SAT Math and Reading sections
- Metadata includes difficulty, subject, topic

## Manual Question Creation (Emergency)
- Use `scripts/create-question-manual.ts`
- Requires admin credentials
- Supports all question types (multiple choice, fill-in, etc.)

## Adding Questions to Database
1. Prepare question data (JSON format)
2. Run: `pnpm exec tsx scripts/create-question-manual.ts --file questions.json`
3. Verify: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM questions"`
```

### Acceptance Tests

**Before PR**:
```bash
# No documentation on question seeding
# No manual question creation script
```

**After PR**:
```bash
# Documentation exists
ls docs/sprint1/question_management.md
# Expected: File exists

# Script exists
ls scripts/create-question-manual.ts
# Expected: File exists

# Script can create question
pnpm exec tsx scripts/create-question-manual.ts --help
# Expected: Usage instructions

# TypeScript check passes
pnpm exec tsc -p tsconfig.json
# Expected: ✓ No TypeScript errors
```

**Manual Verification**:
1. Read `question_management.md`
2. Run `create-question-manual.ts` with test data
3. Verify question appears in database
4. Verify question accessible via `/api/questions` endpoint

---

## PR #7: Add Database RLS Investigation Notes

**Branch**: `sprint1/rls-investigation`  
**Ship Blocker**: Risk #8 (No DB-Level RLS) - Investigation Only  
**Complexity**: Low  
**Estimated Time**: 2-3 hours

### Objective

Document current RLS situation and investigate Neon RLS support for Sprint 2.

### Files to Touch

**Create**:
- `docs/sprint1/rls_investigation.md` - RLS investigation and recommendations

**Update**:
- `docs/sprint1/risk_register.md` - Update Risk #8 with investigation findings

### Investigation Checklist

1. **Current State**:
   - Document that RLS is enforced at application layer
   - List all queries with WHERE clauses for access control
   - Identify potential bypass risks

2. **Neon RLS Support**:
   - Research Neon documentation for RLS
   - Test RLS policy creation in Neon
   - Document any limitations or caveats

3. **Supabase Alternative**:
   - Document Supabase RLS features
   - Estimate migration effort
   - List pros/cons vs. current Neon setup

4. **Recommendations**:
   - Recommend approach for Sprint 2
   - Document testing strategy
   - Estimate implementation time

### Acceptance Tests

**After PR**:
```bash
# Investigation document exists
ls docs/sprint1/rls_investigation.md
# Expected: File exists

# Risk register updated
grep "RLS" docs/sprint1/risk_register.md
# Expected: Investigation findings included

# No code changes (investigation only)
git diff --name-only
# Expected: Only documentation files
```

**Manual Verification**:
1. Read `rls_investigation.md`
2. Verify recommendations are actionable
3. Review risk register update

---

## Summary Table

| PR | Branch | Ship Blocker | Files | Tests | Time |
|----|--------|--------------|-------|-------|------|
| #1 | `sprint1/remove-ingestion-dead-code` | Risk #2 | 10+ | Build, unit | 2-3h |
| #2 | `sprint1/add-integration-tests` | Risk #7 | 5+ | Integration | 8-12h |
| #3 | `sprint1/ci-env-validation` | Risk #3 | 3 | CI | 2-3h |
| #4 | `sprint1/fix-admin-review-page` | Risk #6 | 3 | TypeScript | 4-6h |
| #5 | `sprint1/deployment-automation` | Risk #10 | 3 | Deploy | 3-4h |
| #6 | `sprint1/document-question-seeding` | Risk #5 | 3 | Manual | 2-3h |
| #7 | `sprint1/rls-investigation` | Risk #8 | 2 | N/A | 2-3h |

**Total Estimated Time**: 23-34 hours (3-5 days)

---

## Merge Strategy

### PR Order

1. **PR #1** - Remove dead code (no dependencies)
2. **PR #3** - CI env validation (no dependencies)
3. **PR #4** - AdminReviewPage fix (no dependencies)
4. **PR #6** - Question seeding docs (no dependencies)
5. **PR #7** - RLS investigation (no dependencies)
6. **PR #5** - Deployment automation (depends on PR #3)
7. **PR #2** - Integration tests (last, validates all changes)

### Merge Criteria

Each PR must pass:
- ✅ TypeScript check (`pnpm exec tsc -p tsconfig.ci.json`)
- ✅ Unit tests (`pnpm test:ci`)
- ✅ Build (`pnpm run build`)
- ✅ CI pipeline (GitHub Actions)
- ✅ Code review (1 approval)

---

## Sprint 1 Completion Criteria

**All PRs merged** ✅  
**5 ship blockers addressed** ✅  
**All acceptance tests pass** ✅  
**Documentation complete** ✅  
**CI pipeline green** ✅  
**Integration tests implemented** ✅  
**Production deployment validated** ✅  

---

**End of Sprint 1 Sub-Branch Plan**
