# Ingestion Inventory (Sprint 0)

## Route mounts / entrypoints
- `server/index.ts` shows ingestion mounts removed (no active `/api/ingest` or `/api/ingestion-v4` routes are mounted here).【F:server/index.ts†L242-L295】
- `/api/ingest` handler is defined in `apps/api/src/routes/ingest.ts` (route implementation only).【F:apps/api/src/routes/ingest.ts†L1-L40】
- `/api/ingest-llm` endpoints are defined in `apps/api/src/routes/ingest-llm.ts` (route implementation only).【F:apps/api/src/routes/ingest-llm.ts†L1-L50】
- `/api/ingestion-v4/*` router is defined in `apps/api/src/routes/ingestion-v4.ts` (route implementation only).【F:apps/api/src/routes/ingestion-v4.ts†L1-L80】

## Workers / jobs / scripts
- Ingestion v2 worker pipeline lives in `server/services/ingestionWorker.ts`.【F:server/services/ingestionWorker.ts†L1-L40】
- Dev ingestion runner script lives in `server/scripts/run-ingestion-dev.ts`.【F:server/scripts/run-ingestion-dev.ts†L1-L40】

## Tests
- Vitest ingestion v4 unit tests live in `apps/api/src/ingestion_v4/__tests__` (example: schemas test).【F:apps/api/src/ingestion_v4/__tests__/schemas.test.ts†L1-L40】
- Playwright ingestion API specs: `tests/specs/03_ingest_pdf.spec.ts` and `tests/specs/03_ingest_pdf_api_only.spec.ts`.【F:tests/specs/03_ingest_pdf.spec.ts†L1-L60】【F:tests/specs/03_ingest_pdf_api_only.spec.ts†L1-L40】
- Admin logs spec checks ingestion filter: `tests/specs/15_admin_logs_api.spec.ts`.【F:tests/specs/15_admin_logs_api.spec.ts†L140-L176】
- Auth enforcement spec references `/api/ingest/jobs`: `tests/specs/rls-auth-enforcement.spec.ts`.【F:tests/specs/rls-auth-enforcement.spec.ts†L259-L275】
