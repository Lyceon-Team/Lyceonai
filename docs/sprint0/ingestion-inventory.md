# Ingestion Inventory (Sprint 0)

## Route mounts
- `server/index.ts` registers ingestion routes (gated behind `INGESTION_ENABLED`):
  - `POST /api/ingest` → `apps/api/src/routes/ingest.ts`
  - `POST /api/ingest-llm` → `apps/api/src/routes/ingest-llm.ts`
  - `POST /api/ingest-llm/test` → `apps/api/src/routes/ingest-llm.ts`
  - `GET /api/ingest-llm/status/:jobId` → `apps/api/src/routes/ingest-llm.ts`
  - `GET /api/ingest-llm/jobs` → `apps/api/src/routes/ingest-llm.ts`
  - `POST /api/ingest-llm/retry/:jobId` → `apps/api/src/routes/ingest-llm.ts`
  - `app.use("/api/ingestion-v4", ...)` → `apps/api/src/routes/ingestion-v4.ts`

## Workers / jobs / cron
- Ingestion v2 worker pipeline: `server/services/ingestionWorker.ts`
- Dev ingestion runner script: `server/scripts/run-ingestion-dev.ts`
- Ingestion v4 always-on worker loop: `apps/api/src/ingestion_v4/services/v4AlwaysOnWorker.ts`
- Ingestion v4 queue processor: `apps/api/src/ingestion_v4/services/v4QueueWorker.ts`
- Ingestion v3/LLM job executor: `apps/api/src/ingestion/ingestionService.ts`
- Ingestion v4 proof runner script: `apps/api/scripts/v4-proof-runner.ts`

## Tests
- Ingestion v4 unit tests:
  - `apps/api/src/ingestion_v4/__tests__/v4Clustering.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/schemas.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/publisher.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/v4PdfFanout.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/v4Queue.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/clustering.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/styleBankService.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/stylePageSampler.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/styleSampler.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/domainSampler.test.ts`
  - `apps/api/src/ingestion_v4/__tests__/proof.test.ts`
