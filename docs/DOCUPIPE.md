# DocuPipe Integration Guide

> **DEPRECATED (Dec 2024):** DocuPipe integration has been removed. The ingestion pipeline now uses Ingestion v3 with DocAI-primary extraction and Gemini Vision fallback. See `replit.md` for current architecture. All code referenced below has been deleted.

---

## Historical Overview (Archived)

DocuPipe was an external document processing service that provided OCR and document understanding capabilities. This integration was removed in Dec 2024 as part of the v3 migration.

### Architecture Summary

**Codebase Findings:**
- Canonical question type: `QAItem` (QAItemMC | QAItemFR) in `packages/shared/src/types.ts`
- Existing ingestion: `POST /api/ingest` (direct JSON) and `POST /api/ingest-v2/upload` (PDF upload)
- DB: Supabase PostgreSQL with `questions` table
- No existing GCS helper found - PoC uses direct base64 upload

**DocuPipe Flow:**
1. Upload PDF → DocuPipe processes document
2. Standardization → Applies SAT schema to extract structured data
3. Parse → Convert to canonical `QAItem` format
4. Ingest → Upsert to questions table with embeddings

## Environment Variables

Add these to your `.env` file:

```bash
# DocuPipe API Configuration (required for DocuPipe features)
DOCUPIPE_API_KEY=your_api_key_here
DOCUPIPE_API_BASE_URL=https://app.docupipe.ai
DOCUPIPE_SAT_SCHEMA_ID=your_sat_schema_id
DOCUPIPE_WEBHOOK_SECRET=your_webhook_secret  # For future webhook validation
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DOCUPIPE_API_KEY` | Yes | Secret API key for X-API-Key header |
| `DOCUPIPE_API_BASE_URL` | No | API base URL (default: https://app.docupipe.ai) |
| `DOCUPIPE_SAT_SCHEMA_ID` | Yes | Schema ID for SAT practice test extraction |
| `DOCUPIPE_WEBHOOK_SECRET` | No | Shared secret for webhook validation (future) |

## SAT Schema Structure

The DocuPipe SAT schema should be configured to output this structure:

```typescript
interface SatDocuPipeSchemaOutput {
  questions: {
    rawQuestionText: string;      // Question stem
    page?: number | null;         // PDF page number
    sectionLabel?: string | null; // "Math", "Reading", "Writing"
    questionNumber?: string | null;
    options?: string[] | null;    // ["Option A text", "Option B text", ...]
    answerCandidate?: string | null; // "A", "B", "C", or "D"
    explanationText?: string | null;
  }[];
  answerKeyTable?: {
    questionNumber: string;
    answer: string;               // "A", "B", "C", or "D"
  }[];
}
```

## API Endpoint

### POST /api/docupipe/ingest-poc

Full DocuPipe ingestion PoC endpoint.

**Authentication:** Requires `INGEST_ADMIN_TOKEN` Bearer token.

**Request Body (base64 mode):**
```json
{
  "base64": "<base64-encoded-pdf>",
  "filename": "sat_practice_test.pdf"
}
```

**Request Body (GCS mode - TODO):**
```json
{
  "bucket": "your-gcs-bucket",
  "path": "path/to/sat_practice_test.pdf"
}
```

**Response:**
```json
{
  "documentId": "dp_doc_abc123",
  "standardizationId": "dp_std_xyz789",
  "questionCount": 44,
  "questions": [
    {
      "id": "docupipe-dp_std_xyz789-0",
      "type": "mc",
      "stem": "If 2x + 4 = 11, what is the value of x?",
      "options": [
        {"key": "A", "text": "3.5"},
        {"key": "B", "text": "4"},
        {"key": "C", "text": "5"},
        {"key": "D", "text": "7.5"}
      ],
      "answer_choice": "A",
      "section": "Math",
      "explanation": null,
      "source": {"path": "sat_practice_test.pdf", "page": 1},
      "tags": ["Math"],
      "version": 1,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

## Running the PoC

1. Set environment variables (see above)

2. Start the server:
```bash
npm run dev
```

3. Convert your PDF to base64:
```bash
base64 -i sat_practice_test.pdf | tr -d '\n' > pdf_base64.txt
```

4. Call the endpoint:
```bash
curl -X POST http://localhost:5000/api/docupipe/ingest-poc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_INGEST_ADMIN_TOKEN" \
  -d "{
    \"base64\": \"$(cat pdf_base64.txt)\",
    \"filename\": \"sat_practice_test.pdf\"
  }"
```

## File Structure

```
packages/shared/src/
├── docupipe.ts          # DocuPipe API types
└── docupipe-jobs.ts     # Internal job tracking types

apps/api/src/
├── lib/
│   ├── docupipe-client.ts      # DocuPipe API client
│   └── sat-docupipe-parser.ts  # SAT question parser
└── routes/
    └── docupipe-ingest.ts      # Ingest PoC endpoint
```

## Production TODOs

1. **Replace polling with webhooks**
   - Configure DocuPipe Workflows to send webhooks on job completion
   - Add webhook handler endpoint with DOCUPIPE_WEBHOOK_SECRET validation

2. **Persist job state**
   - Store `DocuPipeIngestJob` in Supabase/Firestore for tracking
   - Enable retry/resume for long-running jobs

3. **Add GCS integration**
   - Wire up GCS helper to read PDFs from bucket
   - Support `{bucket, path}` input mode

4. **Upsert to database**
   - Call existing `/api/ingest` logic or `upsertQuestions()` service
   - Generate embeddings for vector search

5. **Error handling improvements**
   - Add retry logic for transient failures
   - Better error messages for schema mismatches

## Field Mapping Reference

| DocuPipe Field | Canonical Field | Notes |
|----------------|-----------------|-------|
| `rawQuestionText` | `stem` | Required, question text |
| `options[]` | `options[{key, text}]` | Mapped to A,B,C,D in order |
| `answerCandidate` | `answer_choice` | Normalized to A/B/C/D |
| `explanationText` | `explanation` | Optional |
| `page` | `source.page` | PDF page number |
| `sectionLabel` | `section` | Normalized: Math/Reading/Writing |
| `questionNumber` | `rawId` | Original question number |
| `answerKeyTable` | - | Overrides answerCandidate if present |
