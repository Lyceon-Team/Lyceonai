# Deprecated Code Archive

## Overview

This directory contains code that has been deprecated and removed from the active codebase.

## Ingestion System (Deprecated)

**Status:** DEPRECATED - No longer supported

The ingestion system, including all v3 and v4 implementations, has been deprecated and removed from the application.

### What was removed:

- **Routes (deleted):**
  - `apps/api/src/routes/documents.ts` - Deleted deprecated ingestion route

- **Routes (never implemented in this codebase):**
  - `apps/api/src/routes/ingestion-v4.ts` - Listed in plan but did not exist
  - `apps/api/src/routes/ingest-llm.ts` - Listed in plan but did not exist

- **Admin UI (deleted):**
  - `client/src/pages/AdminIngestPage.tsx`
  - `client/src/components/admin/AdminPDFUpload.tsx`
  - `client/src/components/pdf-upload.tsx`

- **Environment variables (removed):**
  - `VITE_INGEST_ADMIN_TOKEN`
  - `INGEST_ADMIN_TOKEN`
  - `INGEST_TIMEOUT_MS`

### Important Notes:

1. **Routes are unmounted and not supported** - All ingestion endpoints have been removed from the server
2. **Do not import from this directory in runtime code** - This directory is for reference only
3. **Directory is retained for reference only** - To preserve institutional knowledge
4. **Ingestion functionality is no longer available** - The feature has been completely removed

### Migration Path:

If you need to add documents or questions to the system, use the following alternatives:
- Manual question creation through the admin portal
- Direct database operations (for bulk imports)
- Alternative content ingestion methods (to be determined)

---

**Last Updated:** February 1, 2026  
**Sprint:** Sprint 1 - Remove Ingestion Dead Code  
**PR:** #1
