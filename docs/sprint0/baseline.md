# Sprint 0 Baseline - CI Status

**Captured:** 2026-01-31

## CI Workflow

**Workflow File:** `.github/workflows/ci.yml`

**Workflow Name:** CI

**Trigger Events:**
- Pull requests
- Push to main branch

## CI Commands

1. `pnpm install --frozen-lockfile`
2. `pnpm run check` (TypeScript compilation)
3. Verify Secrets step (currently fails if SUPABASE_URL or GEMINI_API_KEY missing)

**Note:** Tests are not currently run in the CI workflow after the verify secrets step fails.

## package.json Scripts

- `check`: `tsc` - TypeScript compilation check
- `test`: `vitest run` - Run all tests
- `test:api`: `vitest run apps/api/test` - Run API tests
- `build`: `vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.js`

## Baseline Errors

### TypeScript Check (`pnpm run check`)

**Status:** ❌ FAILED (24 errors)

**Error Categories:**

1. **Ingestion v4 Type Errors** (4 errors)
   - `apps/api/src/ingestion_v4/services/v4Clustering.ts:649` - null vs undefined mismatch
   - `apps/api/src/ingestion_v4/services/v4Clustering.ts:821` - evidence.notes incompatibility
   - `apps/api/src/ingestion_v4/services/v4Clustering.ts:834` - evidence.notes incompatibility
   - `apps/api/src/ingestion_v4/services/v4QueueWorker.ts:92` - missing section property

2. **Auth/Middleware Type Errors** (2 errors)
   - `apps/api/src/middleware/auth.ts:23` - user type incompatibility
   - `apps/api/src/routes/calendar.ts:19` - SupabaseUser type mismatch

3. **Route Type Errors** (2 errors)
   - `apps/api/src/routes/ingestion-v4.ts:1510` - null vs undefined for CanonicalSection
   - `apps/api/src/routes/tutor-v2.ts:234` - Cannot find name 'supabaseServer'

4. **Client Type Errors** (6 errors)
   - `client/src/pages/flow-cards.tsx:327` - questionIndex property missing
   - `client/src/pages/structured-practice.tsx` (5 errors) - undefined variables

5. **Server Undefined References** (10 errors)
   - `server/index.ts` - runMigrations, getStripeSync, isWorkerEnabled, startWorker, getWorkerStatus, stopWorker
   - `server/lib/webhookHandlers.ts:308` - getStripeSync
   - `server/routes/billing-routes.ts:120` - type comparison issue

### Unit Tests (`pnpm test`)

**Status:** ❌ FAILED (17 failed / 215 passed out of 232 total)

**Failure Categories:**

1. **Integration Tests Requiring Supabase** (5 files)
   - `tests/auth.integration.test.ts` - supabaseUrl is required
   - `tests/entitlements.regression.test.ts` - supabaseUrl is required
   - `tests/practice.validate.regression.test.ts` - supabaseUrl is required
   - `tests/tutor.v2.regression.test.ts` - supabaseUrl is required
   - `tests/idor.regression.test.ts` - mock assertion failure

2. **Ingestion v4 Tests** (4 failures)
   - `apps/api/src/ingestion_v4/__tests__/publisher.test.ts` (3 failures) - undefined values for source_code and section_code
   - `apps/api/src/ingestion_v4/__tests__/schemas.test.ts` - validation not throwing error

3. **Adaptive Selector Tests** (9 failures)
   - `apps/api/src/services/__tests__/adaptiveSelector.test.ts` - supabase.from().select().not is not a function

4. **Client Tests** (2 failures)
   - `client/src/__tests__/toaster.guard.test.tsx` - document is not defined
   - `client/src/__tests__/useShortcuts.guard.test.tsx` - document is not defined

5. **RAG Service Test** (1 failure)
   - `apps/api/test/rag-service.test.ts` - scoring calculation precision issue

### Build Status

**Status:** Not tested in baseline (TypeScript check must pass first)

## Summary

- **TypeScript:** 24 compilation errors blocking CI
- **Tests:** 17 failures (7 ingestion-related, 5 integration requiring secrets, 5 other)
- **Primary Blockers:**
  1. Ingestion code runs by default (v4 tests executing)
  2. Integration tests require SUPABASE_URL but no gating exists
  3. TypeScript errors in ingestion and server code
  4. Missing references to worker/migration functions
