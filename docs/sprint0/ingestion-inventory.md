# Ingestion Inventory - Sprint 0

**Generated:** 2026-01-31

## Summary

The repository contains two ingestion systems:
- **Legacy v2/v3**: Routes commented out but code remains
- **Ingestion v4**: Router defined but NOT mounted, worker code exists

## 1. Route Mounts

### Active Routes: NONE
All ingestion route mounts are commented out in `server/index.ts`:
- Line 286: `// ...removed /api/ingestion-v4 route...`
- Line 288: `// ...removed all /api/ingest-v2/* deprecated endpoints...`
- Line 292: `// ...removed all /api/ingest-llm/* and /api/ingest/jobs endpoints...`

### Defined But Not Mounted

**File:** `/apps/api/src/routes/ingestion-v4.ts`
**Export:** `ingestionV4Router`
**Endpoints:** 47+ endpoints including:
- POST `/test`, `/jobs`, `/jobs/:jobId/dry-run`, `/jobs/:jobId/run-once`
- POST `/style-library`, `/queue/tick`, `/style-bank/*`, `/worker/start`
- GET `/jobs`, `/queue`, `/catalog/status`, `/worker/status`

## 2. Workers/Jobs/Cron

### Active Worker References (BROKEN - undefined functions)

**File:** `server/index.ts`
**Lines 728-733:**
```typescript
if (isWorkerEnabled()) {
  startWorker();
}
```

**Lines 736-744:** Worker control endpoints
- GET `/api/admin/worker/status` calls `getWorkerStatus()`
- POST `/api/admin/worker/stop` calls `stopWorker()`

**Problem:** These 4 functions are NOT imported or defined:
- `isWorkerEnabled()` 
- `startWorker()`
- `getWorkerStatus()`
- `stopWorker()`

**Source:** Functions exist in `/apps/api/src/ingestion_v4/services/v4AlwaysOnWorker.ts` but are not imported

### Worker Implementation Files

1. `/apps/api/src/ingestion_v4/services/v4AlwaysOnWorker.ts`
   - Exports: `startWorker()`, `isWorkerEnabled()`, `getWorkerStatus()`, `stopWorker()`
   - Runs queue processor in background

2. `/apps/api/src/ingestion_v4/services/v4QueueWorker.ts`
   - Queue item processing logic

3. `/server/services/ingestionWorker.ts`
   - Legacy v2/v3 worker (PENDING→OCR→PARSE→QA→EMBED→DONE state machine)

4. `/server/scripts/run-ingestion-dev.ts`
   - Dev testing script using `IngestionWorker` class

## 3. Test Files

### Ingestion v4 Tests (11 files in `apps/api/src/ingestion_v4/__tests__/`)

1. `clustering.test.ts`
2. `domainSampler.test.ts`
3. `proof.test.ts`
4. `publisher.test.ts` - **4 failures in baseline**
5. `schemas.test.ts` - **1 failure in baseline**
6. `styleBankService.test.ts`
7. `stylePageSampler.test.ts`
8. `styleSampler.test.ts`
9. `v4Clustering.test.ts`
10. `v4PdfFanout.test.ts`
11. `v4Queue.test.ts`

**Test Glob Pattern:** `apps/api/src/ingestion_v4/**/*.test.ts`

### Other Tests

- `/apps/api/test/rag-service.test.ts` - 1 scoring precision failure (not ingestion-specific)
- Client tests in `/client/src/__tests__/` - 2 failures (document not defined - env issue)

## 4. Core Ingestion Modules

### Legacy v2/v3 (`apps/api/src/ingestion/`)
- `ingestionService.ts`, `docaiParser.ts`, `qaService.ts`
- Routes removed but code remains

### v4 Services (`apps/api/src/ingestion_v4/services/`)
- 15+ service files for job management, clustering, publishing, style bank
- `v4AlwaysOnWorker.ts` - background worker (not imported in server/index.ts)

## 5. Import Statement Audit

### Problematic Imports

1. **server/index.ts Line 728-744:**
   - References undefined: `isWorkerEnabled`, `startWorker`, `getWorkerStatus`, `stopWorker`
   - Should import from: `apps/api/src/ingestion_v4/services/v4AlwaysOnWorker.ts`

2. **apps/api/src/routes/calendar.ts:**
   - Imports: `generateJson`, `isV4GeminiEnabled` from ingestion_v4

3. **apps/api/src/routes/ingest-llm.ts:**
   - Imports from legacy ingestion service

## Isolation Strategy

### Phase B Requirements

1. **Add INGESTION_ENABLED kill-switch**
   - Wrap worker startup (server/index.ts:728)
   - Do NOT import worker functions unless enabled
   - Prevent import-time side effects

2. **Exclude ingestion tests from CI**
   - Pattern: `apps/api/src/ingestion_v4/**/*.test.ts`
   - Pattern: `apps/api/src/ingestion/**/*.test.ts`
   - Update `vitest.config.ts` exclude list

3. **Do NOT modify ingestion internals**
   - Only gate entrypoints (routes, workers)
   - Code remains for future enablement

## Notes

- Ingestion v4 router is already defined but not mounted (isolation already 50% complete)
- Main issue: worker functions referenced but not imported (causes TS errors)
- 11 ingestion v4 tests currently run in default CI (5 fail)
- Legacy v2/v3 ingestion code is dormant (routes removed)
