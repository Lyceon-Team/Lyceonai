# Ingestion Deprecation Decision

Date: 2026-03-11
Owner: Platform Engineering
Status: Accepted and implemented

## Final Decision
Lyceon has no ingestion runtime in this repository. Any ingestion route, worker, and UI surface is removed or unmounted. Remaining ingestion-named schema fields are legacy compatibility artifacts only.

## Inventory (Wave 3 I1)

### Active runtime mounts
- None found.
- Verification scope: `server/index.ts`, `server/routes/**`, `apps/api/src/routes/**`.

### Dead code removed
- `apps/api/src/middleware/rate-limit.ts` (deleted)
- `apps/api/src/middleware/rateLimits.ts` (deleted)
- `packages/shared/src/docupipe.ts` (deleted)
- `packages/shared/src/docupipe-jobs.ts` (deleted)

### Runtime code quarantined/deprecated (kept with explicit non-runtime intent)
- `shared/schema.ts` legacy `ingestion_runs` and `ingestion_run_id` compatibility types/tables remain; comments updated to mark non-runtime/deprecated.
- `server/services/questionTypes.ts` retains `ingestionRunId` as legacy compatibility field with explicit deprecation note.

### Docs and roadmap claims
- Deleted ingestion-focused docs:
  - `docs/INGESTION.md`
  - `docs/INGESTION_V2_PRP.md`
  - `docs/INGESTION_V3_MIGRATION.md`
  - `docs/DOCUPIPE.md`
  - `docs/IMPLEMENTATION_TASK.md`
- Updated launch/runtime docs to remove ingestion runtime claims:
  - `README.md`
  - `docs/OPERATIONS.md`
  - `docs/AUTH_SECURITY.md`
  - `docs/ENV.md`
- Historical archives explicitly marked non-runtime:
  - `PROJECT_REPORT.md`
  - `MVP-SUMMARY.md`
  - `PRODUCTION_AUDIT_REPORT.md`
  - `CLEANUP_ACTION_PLAN.md`

### UI copy
- `client/src/types/question.ts` (comment wording no longer references ingestion internals)
- `client/src/components/questions/QuestionCard.tsx` (comment wording no longer references ingestion artifacts)

### Tests and scripts
- Deleted ingestion-specific legacy tests:
  - `tests/legacy/test-bulk-service-parsing.js`
  - `tests/legacy/test-database-consistency.js`
- Updated tests to remove deprecated ingestion endpoint/log expectations:
  - `tests/specs/rls-auth-enforcement.spec.ts`
  - `tests/specs/15_admin_logs_api.spec.ts`
- Updated smoke script to remove ingestion endpoint check:
  - `scripts/smoke.sh`

## What Remains In Scope
- Manual/admin-managed content review and curation (`/api/admin/questions/*`).
- Student practice, tutor, mastery, guardian, billing, and full-length exam runtime flows.
- Legacy schema compatibility fields for historical records only (no ingestion runtime mounts).

## Why This Reduces False Claims and Maintenance Burden
- Removes dead ingestion surfaces that suggested non-existent runtime behavior.
- Aligns docs and runbooks with actual mounted routes.
- Shrinks stale test/smoke surface area that previously referenced removed endpoints.
- Keeps only compatibility schema artifacts with explicit deprecation labeling.

## Validation Commands
Run from repo root:

```bash
corepack pnpm -s exec tsc -p tsconfig.ci.json
npx vitest run --reporter=dot --silent
rg -n "ingest|ingestion|IngestionService|ingest-v2|OCR job|job progress|rerun stage" . --glob '!node_modules' --glob '!.git'
```

## Validation Result Summary
- TypeScript CI config: PASS (`corepack pnpm -s exec tsc -p tsconfig.ci.json`)
- Vitest: PASS (`npx vitest run --reporter=dot --silent`)
- Residual grep references: confined to explicitly historical/archive docs, `shared/schema.ts` compatibility symbols, and one quarantined legacy field in `server/services/questionTypes.ts`


Detailed command outputs are archived in docs/architecture/INGESTION_DEPRECATION_VALIDATION.log.