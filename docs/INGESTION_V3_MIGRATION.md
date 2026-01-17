# Lyceon Ingestion v3 Migration Plan

## 1. Canonical Pipeline (Ingestion v3 PRP)

Source of truth:
- apps/api/src/ingestion/ingestionService.ts
- apps/api/src/ingestion/outsideSchemaGenerator.ts
- apps/api/src/ingestion/docaiClient.ts
- apps/api/src/ingestion/docaiParser.ts
- apps/api/src/ingestion/qaService.ts
- apps/api/src/ingestion/visionFallback.ts
- apps/api/src/ingestion/types.ts
- apps/api/src/prompts/ingestion_schema_generator.md
- apps/api/src/prompts/ingestion_qa_docai_only.md
- apps/api/src/prompts/ingestion_qa_reconcile.md

Canonical v3 pipeline (as implemented):

1. Infer test/section from filename or config (testCode, sectionCode).
2. Generate an `OutsideSchema` via Gemini Flash **or** fall back to `getDefaultSchema`.
3. Run Google Document AI on the PDF buffer to produce structured OCR.
4. Parse DocAI output into `QuestionDocDraft[]` using the `OutsideSchema`.
5. QA Pass 1 (DocAI only) via Gemini: label each draft as `GOOD`, `NEEDS_VISION_FALLBACK`, or `REJECT_HARD`, with optional repairs and metadata.
6. Run Vision fallback only on `NEEDS_VISION_FALLBACK` drafts, producing improved drafts from page/region-level vision extraction.
7. QA Pass 2 (Reconcile) compares DocAI + Vision drafts and decides `ACCEPTED` vs `REJECTED`; accepted drafts are converted into `QuestionDoc` objects.
8. Upsert final `QuestionDoc` items into Supabase + vector store, and persist metrics/status to `ingestion_runs`.

Public API surface (after migration):

- **Primary**: `POST /api/ingest-llm` (v3 pipeline, PDF upload, admin-only)
- **Test/debug**: `POST /api/ingest-llm/test`
- **Status**: `GET /api/ingest-llm/status/:jobId`

Optionally, we may introduce an alias:

- `POST /api/ingest/pdf` → forwards to the v3 handler (same auth + semantics)

## 2. Legacy Paths to Deprecate and Remove

These routes are non-canonical once v3 is adopted:

1. **Structured JSON ingest (v1)**
   - apps/api/src/routes/ingest.ts
   - Mounted at:
     - server/index.ts: `/api/ingest`
     - apps/api/src/index.ts: `/api/ingest`
     - server/mvp-server.ts and apps/api/src/routes-mvp.ts (MVP wrapper)

2. **Worker-based ingestion v2**
   - Route: apps/api/src/routes/ingest-v2.ts
   - Mounted at:
     - server/index.ts: `/api/ingest-v2/*`
     - apps/api/src/index.ts: `/api/ingest-v2/*`
   - Worker/services:
     - server/services/ingestionWorker.ts
     - server/services/ocrOrchestrator.ts
     - server/services/satParser.ts
     - server/services/qaValidator.ts
     - server/services/ragPipeline.ts
     - server/services/jobPersistenceSupabase.ts
     - server/scripts/run-ingestion-dev.ts
   - UI:
     - client/src/pages/AdminIngestPage.tsx
     - client/src/components/pdf-upload.tsx
     - client/src/components/admin/JobDashboard.tsx
     - Any use of `/api/ingest-v2/jobs`, `/api/ingest-v2/status/:jobId`, etc.

3. **Unified provider-chain ingestion (DocuPipe / DocAI / Nougat / Mathpix)**
   - Route:
     - apps/api/src/routes/unified-ingest.ts (`/api/ingest/unified`, `/api/ingest/providers`)
   - Provider chain:
     - apps/api/src/lib/ingestion-orchestrator.ts
     - apps/api/src/lib/provider-chain.ts
     - apps/api/src/lib/providers/index.ts
     - apps/api/src/lib/providers/docupipe-runner.ts
     - apps/api/src/lib/providers/docai-runner.ts
     - apps/api/src/lib/providers/nougat-runner.ts
     - apps/api/src/lib/providers/mathpix-runner.ts
     - apps/api/src/lib/sat-docupipe-parser.ts
     - apps/api/src/lib/docupipe-client.ts
     - packages/shared/src/docupipe.ts
     - packages/shared/src/docupipe-jobs.ts
   - Docs:
     - docs/DOCUPIPE.md
     - DOCUPIPE env references in docs/ENV.md (can be moved to “Legacy / optional” section or removed).

4. **DocuPipe ingestion PoC**
   - Route:
     - apps/api/src/routes/docupipe-ingest.ts (`/api/docupipe/ingest-poc`)
   - Mounted at:
     - server/index.ts: `/api/docupipe/ingest-poc`

5. **Deprecated / MVP / legacy servers**
   - Legacy references to ingestion in:
     - apps/api/src/routes/documents.ts (already marked deprecated)
     - server/legacy-server.ts (old ingest endpoints and process-and-ingest)
     - server/sat-pdf-processor.ts
     - server/routes/admin-stats-routes.ts (old ingestion stats hooks)
   - MVP ingest:
     - apps/api/src/routes/ingest-mvp.ts
     - apps/api/src/routes-mvp.ts
     - server/mvp-server.ts

## 3. Phase Plan

### Phase 0 – Read-only baseline

- Keep all existing endpoints live.
- Use `/api/ingest-llm/test` to validate v3 behavior across a few known SAT PDFs.
- Confirm that v3 successfully upserts `QuestionDoc` into Supabase and vectors.
- Confirm `ingestion_runs` rows for v3 jobs look correct (metrics, timings, status).

### Phase 1 – Introduce stable v3 alias and feature flag

- Add `POST /api/ingest/pdf` as an alias to `ingestLlm` (same admin auth).
- Add a simple env flag (e.g. `INGESTION_MODE=v3|legacy`) if needed for controlled rollout.
- Ensure the new alias is documented in docs/ENV.md and docs/IMPLEMENTATION_TASK.md.

### Phase 2 – Switch internal callers (UI, scripts, n8n) to v3

- Update admin UI and internal tools to use v3:
  - `client/src/pages/AdminIngestPage.tsx`: call `/api/ingest-llm` (or `/api/ingest/pdf`) instead of `/api/ingest-v2/upload`.
  - `client/src/components/pdf-upload.tsx`: same change.
  - `client/src/components/admin/JobDashboard.tsx`: replace `/api/ingest-v2/*` job polling with `/api/ingest-llm/status/:jobId` and an updated job list view (reading from `ingestion_runs` directly).
- Update any automation (n8n, scripts, curl snippets) to use v3.

At the end of this phase, **no first-party client should call v1/v2/unified/docupipe ingest endpoints**.

### Phase 3 – Soft-disable legacy endpoints

- In server/index.ts and apps/api/src/index.ts:
  - Comment out or guard:
    - `/api/ingest`
    - `/api/ingest-v2/*`
    - `/api/ingest/unified`
    - `/api/docupipe/ingest-poc`
    - `/api/ingest-mvp*`
  - Keep a short log message or 410/503 stub if you want a transitional period:
    - e.g., respond with `{ error: "Deprecated – use /api/ingest-llm instead" }`.
- Verify that:
  - The app still boots.
  - RAG/tutor endpoints still work.
  - Admin ingest UI uses only v3.

### Phase 4 – Hard cleanup (code and docs)

Once we’re confident v3 is stable and no callers depend on legacy paths:

- Delete legacy route files:
  - apps/api/src/routes/ingest.ts
  - apps/api/src/routes/ingest-v2.ts
  - apps/api/src/routes/unified-ingest.ts
  - apps/api/src/routes/docupipe-ingest.ts
  - apps/api/src/routes/ingest-mvp.ts
  - apps/api/src/routes-mvp.ts
- Delete v2 worker and OCR stack if truly unused:
  - server/services/ingestionWorker.ts
  - server/services/ocrOrchestrator.ts
  - server/services/satParser.ts
  - server/services/qaValidator.ts
  - server/services/ragPipeline.ts
  - server/services/jobPersistenceSupabase.ts
  - server/scripts/run-ingestion-dev.ts
- Delete provider-chain and docupipe integration:
  - apps/api/src/lib/ingestion-orchestrator.ts
  - apps/api/src/lib/provider-chain.ts
  - apps/api/src/lib/providers/*
  - apps/api/src/lib/sat-docupipe-parser.ts
  - apps/api/src/lib/docupipe-client.ts
  - packages/shared/src/docupipe.ts
  - packages/shared/src/docupipe-jobs.ts
- Delete deprecated servers and utilities if truly unused:
  - server/legacy-server.ts
  - server/mvp-server.ts
  - server/sat-pdf-processor.ts
  - server/routes/admin-stats-routes.ts (or trim ingestion parts only)
- Update docs:
  - docs/IMPLEMENTATION_TASK.md: mark v1/v2/unified/docupipe as removed.
  - docs/DOCUPIPE.md: either delete or move to an “archive” section.
  - docs/ENV.md: move DOCUPIPE_*, NOUGAT, MATHPIX settings under a “Legacy / optional” heading or remove if not needed.

### Phase 5 – DB and telemetry cleanup (optional, later)

- Consider deprecating legacy tables like `ingestion_jobs` if unused (keep `ingestion_runs` as canonical).
- Update any admin analytics or dashboards that referenced v2-specific statuses (e.g. `ocr_mathpix_patch`, `ocr_nougat_fallback`) to rely instead on v3 metrics in `IngestionJobMetrics`.
- Confirm RAG/tutor behavior uses only canonical `QuestionDoc` + embeddings.

