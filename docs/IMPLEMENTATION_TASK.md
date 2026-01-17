# Task: Implement Ingestion v2 + RAG v2 in the Learningai repo

## 1. Your role

You are an implementation agent for the Learningai monorepo.

Treat Karl as CEO and ChatGPT as CTO. They already did the architecture and decisions.

Your job is to execute the plan in this meta-prompt inside the repo.

You should:
- Prefer small, safe changes over big rewrites.
- Reuse existing code where possible (especially ingestionWorker, satParser, qaValidator, ragPipeline, schema).
- Only ask Karl questions when you are truly blocked by missing information (like a missing env var or ambiguity you cannot resolve from code/docs).

Do not:
- Re-summarize the PRPs.
- Invent new architectures.
- Delete large chunks of code without a clear reason.

---

## 2. Key files and docs (for reference only)

These already exist in the repo:
- `docs/INGESTION_V2_PRP.md` – spec for the ingestion pipeline.
- `docs/RAG_RETRIEVAL_V2_PRP.md` – spec for RAG Retrieval v2.
- `apps/api/src/config.ts` – environment config (SUPABASE, GCP, GEMINI, TOP_K…).
- `apps/api/src/routes/rag.ts` – current RAG endpoint (simple: query → embedding → matchSimilar → LLM).
- `apps/api/src/routes/ingest.ts`, `ingest-mvp.ts`, `ingest-v2.ts`, `unified-ingest.ts` – ingestion HTTP entrypoints.
- `apps/api/src/lib/embeddings.ts` – Gemini embedding + LLM.
- `apps/api/src/lib/vector.ts` – vector search helper(s).
- `apps/api/src/db/client.ts` – Drizzle DB client.
- `shared/schema.ts` – shared DB schema and canonical question types.
- `server/services/ingestionWorker.ts` – ingestion V2 worker (PENDING → OCR → PARSE → QA → EMBED → DONE).
- `server/services/ocrOrchestrator.ts` – OCR multi-engine orchestration (DocAI, Mathpix, Nougat).
- `server/services/satParser.ts` and `server/services/robust-sat-parser.ts` – SAT parsing logic.
- `server/services/qaValidator.ts` – QA checks for parsed questions.
- `server/services/ragPipeline.ts` – builds chunks and embeddings for RAG.

---

## 3. Global rules for this task

1. **Do not break existing login/auth, practice, or admin flows.**
   If you have to change an API contract, prefer adding a v2 endpoint instead of changing v1 in place, unless the change is clearly backward-compatible.

2. **Do not remove ingestion v1 / MVP routes yet.**
   We're adding Ingestion v2 and RAG v2 alongside the existing behavior until we're comfortable cutting old paths.

3. **Stick to Gemini only (no OpenAI) on the server.**
   Embeddings and LLM calls should go through `apps/api/src/lib/embeddings.ts`.

4. **Supabase is the source of truth for final questions.**
   Vector embeddings and questionEmbeddings are secondary views.

5. **No random schema changes.**
   Only modify `shared/schema.ts` in ways described below. If you need something new, add it next to existing fields instead of repurposing a field with different semantics.

6. **If you're unsure about a destructive change, stop and ask Karl.**
   Examples:
   - Dropping columns or tables.
   - Changing primary keys.
   - Deleting entire modules.

---

## 4. Ingestion v2: schema alignment

**Goal:** make the DB schema match the Ingestion v2 "QuestionDoc" concept and canonical IDs, while preserving existing behavior.

### 4.1. Update shared schema for questions

Open `shared/schema.ts` and update:

#### Question interfaces (top of file)

Extend `StudentQuestionBase` and related canonical types to include:

- `canonicalId: string` - A stable ID like `SATM1******` or more generally `<TEST><SECTION><SOURCE><ALPHANUM>`.
- `testCode?: string` (e.g. "SAT").
- `sectionCode?: string` (e.g. "M" / "RW").
- `sourceType?: number` or string enum to distinguish:
  - 1 = parsed from PDF
  - 2 = AI generated
- Optional `competencies?: { code: string; raw?: string | null }[]`.

Do not remove existing fields like `section`, `tags`, `type`. Treat these as compatible or legacy fields.

#### questions table definition

In `export const questions = pgTable("questions", { ... })`:

Add a new `canonicalId` column:
```typescript
canonicalId: text("canonical_id").unique(), // Stable canonical ID like SATM1****** or ACTR1******
```

Add new columns to match the PRP:
```typescript
testCode: text("test_code"),       // e.g. "SAT", "ACT", "AP"
sectionCode: text("section_code"), // e.g. "M", "RW"
sourceType: integer("source_type"), // 1 = parsed PDF, 2 = AI generated
competencies: jsonb("competencies"), // Array of {code, raw}
version: integer("version").default(1), // Schema version
```

Keep all existing columns (questionHash, engineUsed, sourcePdf, ingestionRunId, etc.). Do not delete or repurpose them.

#### questionEmbeddings table

In `export const questionEmbeddings = pgTable("question_embeddings", { ... })`:

Extend metadata to include canonical ID and competency codes:
```typescript
metadata: jsonb("metadata").$type<{
  section?: string;
  difficulty?: string;
  questionNumber?: number;
  canonicalId?: string;
  testCode?: string;
  sectionCode?: string;
  competencyCodes?: string[];
}>(),
```

#### Insert schemas

If needed, extend or create insert schemas for questions and questionEmbeddings so they can accept these new fields without forcing the caller to supply everything.

**Do not run migrations automatically.**
Just change the schema code. Migration execution will be handled separately.

---

## 5. Ingestion v2: canonical question shaping

**Goal:** ensure the ingestion pipeline produces canonical QuestionDoc objects that match schema / PRP fields, then upserts them into Supabase and questionEmbeddings.

### 5.1. Introduce a shared QuestionDoc type

Create a new file: `server/services/questionTypes.ts`

Add:

**A QuestionDoc interface:**
```typescript
export interface QuestionDoc {
  canonicalId: string;
  testCode: string;      // "SAT" for now
  sectionCode: string;   // e.g. "M" or "RW"
  sourceType: 1 | 2;     // 1 = PDF, 2 = AI
  stem: string;
  options: { key: string; text: string }[];
  answerChoice: "A" | "B" | "C" | "D" | null;
  explanation: string | null;
  competencies: { code: string; raw?: string | null }[];
  difficulty?: string | null;
  tags: string[];
  sourcePdf?: string | null;
  pageNumber?: number | null;
  ingestionRunId?: string | null;
  // Add any other fields that map directly to questions table
}
```

**A canonical ID generator function:**
```typescript
export function generateCanonicalId(params: {
  testCode: string;     // "SAT"
  sectionCode: string;  // "M" or "RW"
  sourceType: 1 | 2;
  uniqueSuffix?: string;
}): string {
  // You can use a short random alphanumeric suffix or hash.
  // For now, use testCode + sectionCode + sourceType + random suffix,
  // and rely on canonical_id unique constraint to enforce uniqueness.
}
```

This generator should create IDs like "SATM1A8B91Q" or a similar pattern. Do not over-optimize; it just needs to be stable and unique.

### 5.2. Wire QuestionDoc into parsing

Update `server/services/satParser.ts` (and/or `robust-sat-parser.ts`) to:
- Accept OCR text / layout as input (whatever it does now).
- Produce `ParsedQuestion[]` as it currently does.
- Add a conversion step from `ParsedQuestion` to `QuestionDoc`:
  - Map its fields to canonicalId (using generateCanonicalId), testCode = "SAT", sectionCode derived from existing section, sourceType = 1, stem, options, answerChoice, explanation, competencies (empty array for now), difficulty, tags, sourcePdf, etc.

Keep the old `ParsedQuestion` type around if needed, but the ingestionWorker should start moving toward `QuestionDoc` as the canonical internal shape fed into DB upserts and the RAG pipeline.

### 5.3. Ingestion worker writes QuestionDoc to DB

Update `server/services/ingestionWorker.ts`:
- Wherever it currently writes questions into DB (directly or via ragPipeline):
  - Make it use `QuestionDoc` objects.
  - For each QuestionDoc:
    - Upsert into the questions table using:
      - `canonicalId` as a stable unique identifier.
      - `testCode`, `sectionCode`, `sourceType`.
      - `stem`, `options`, `answerChoice`, `explanation`, `competencies`, `difficulty`, `tags`.
      - `sourcePdf`, `pageNumber`, `ingestionRunId`, `questionHash`, `engineUsed`, etc.
    - If there is already an insert call that uses `questionHash` as dedupe, keep that logic, but also enforce uniqueness on `canonicalId`.
  - You can implement upsert using Drizzle's `insert(...).onConflictDoUpdate(...)` keyed on `canonicalId` or `questionHash`.

---

## 6. Ingestion v2: RAG pipeline and embeddings

**Goal:** ensure RAGPipeline uses QuestionDoc and fills questionEmbeddings and metadata correctly.

Update `server/services/ragPipeline.ts`:
- Adjust any types to accept `QuestionDoc` or the DB question shape that now includes `canonicalId`, `testCode`, `sectionCode`, and `competencies`.
- When generating Q-chunks and E-chunks:
  - Use: `[${question.testCode}/${question.sectionCode}]` or `[Math]` etc.
  - Stem (truncated if necessary).
  - Options (summarised).
  - The embedding call should remain via `generateEmbedding` from `apps/api/src/lib/embeddings.ts`.
- When inserting into questionEmbeddings:
  - Keep the existing fields (id, questionId, chunkType, content, embedding).
  - Extend metadata to include:
    ```typescript
    metadata: {
      section: question.section,
      difficulty: question.difficulty ?? undefined,
      questionNumber: question.questionNumber ?? undefined,
      canonicalId: question.canonicalId,
      testCode: question.testCode,
      sectionCode: question.sectionCode,
      competencyCodes: question.competencies?.map(c => c.code) ?? [],
    }
    ```

**Note:** `questionEmbeddings.questionId` should be the `questions.id` PK, not `canonicalId`. `canonicalId` should only live in `questions.canonicalId` and in the metadata field.

---

## 7. RAG v2: types and service layer

**Goal:** move RAG from "simple prompt builder" to a service that returns a structured context as defined in RAG v2 PRP, while keeping the current endpoint working or adding a v2 route.

### 7.1. Add shared types for RAG

Create a new file: `apps/api/src/lib/rag-types.ts`

Add:
- `RagMode = "question" | "concept" | "strategy"`.
- `StudentProfile` type with:
  - `overallLevel?`
  - `competencyMap?` (code → {correct, incorrect})
  - `recentQuestions?` (canonicalId, correct?)
  - `primaryStyle?`, `secondaryStyle?`, `explanationLevel?`
  - `personaTags?`
- `QuestionContext`:
  - `canonicalId`, `testCode`, `sectionCode`, `sourceType`, `stem`, `options`, `answer`, `explanation`, `competencies`, `difficulty`, `tags`.
- `RagContext`:
  - `primaryQuestion: QuestionContext | null`
  - `supportingQuestions: QuestionContext[]`
  - `competencyContext: { studentWeakAreas: string[]; studentStrongAreas: string[]; competencyLabels: string[] }`
  - `studentProfile: StudentProfile | null`
- `RagQueryRequest`:
  - `userId`
  - `message`
  - `mode: RagMode`
  - `canonicalQuestionId?`
  - `testCode?`
  - `sectionCode?`
  - `studentProfile?`
- `RagQueryResponse`:
  - `{ context: RagContext; metadata: { canonicalIdsUsed: string[]; mode: RagMode } }`

You can also define zod schemas here if you want runtime validation.

### 7.2. Implement RAG service

Create a new file: `apps/api/src/lib/rag-service.ts`

Implement a `RagService` class that:
- Has dependencies:
  - DB client (`db` from `apps/api/src/db/client`).
  - Vector search helper(s) from `apps/api/src/lib/vector.ts`.
  - A stub to load student profiles (for now, returns null or a hardcoded minimal object).
- Exposes a single method:
  ```typescript
  async handleRagQuery(input: RagQueryRequest): Promise<RagQueryResponse>
  ```
- In **"question" mode**:
  - If `canonicalQuestionId` is provided:
    - Load the primary question from `questions` via `canonical_id`.
    - Use `matchSimilar` / vector search to fetch similar questions.
    - Filter by `testCode`, `sectionCode` and optionally `competencyCodes` from the primary question.
    - Map DB rows into `QuestionContext`.
    - Build `competencyContext` using `studentProfile.competencyMap` and the set of competencies appearing in the primary and supporting questions.
- In **"concept" mode**:
  - Use the message text embedding and `matchSimilar` to fetch conceptually similar questions, filtered by `testCode`, `sectionCode`.
  - Build `RagContext` with `primaryQuestion = null` and the supporting questions.
- In **"strategy" mode**:
  - Return `RagContext` with `primaryQuestion = null`, empty `supportingQuestions`, and `studentProfile` if available. Strategy content will be handled in the tutor LLM, not here.

---

## 8. RAG v2: HTTP route

**Goal:** provide a proper RAG v2 endpoint that returns `RagContext` instead of a raw LLM answer.

### Update or add routes in `apps/api/src/routes`:

**Keep existing `/api/rag` route for now.**
It currently:
- Validates a `{query, section?, topK?}` body.
- Calls embeddings → matchSimilar.
- Calls callLlm with a prompt template.
- Returns `{ answer, citations, context }`.

**Do not delete this until Karl confirms.**

**Add a new v2 route:**
Create `apps/api/src/routes/rag-v2.ts` with:
- `POST /api/rag/v2` handler.
- Body matches `RagQueryRequest` (mode, userId, message, canonicalQuestionId?, testCode?, sectionCode?, studentProfile?).
- Calls `RagService.handleRagQuery`.
- Returns `RagQueryResponse` as JSON.

**Wire the new route in `apps/api/src/index.ts`**
Import the new router and mount it under `/api/rag/v2`.

**Do not call `callLlm` in the RAG v2 route.**
This route is only responsible for building the RAG context. The AI Tutor endpoint will call the LLM using that context.

---

## 9. Student profile integration (stub for now)

For this phase, you do not need to fully implement Supabase tables for student profiles. Instead:

Create a small helper in `apps/api/src/lib/rag-service.ts` like `loadStudentProfile(userId: string): Promise<StudentProfile | null>`.

For now, it can:
- Return `null`, or
- Return a placeholder profile (e.g. `primaryStyle = "step-by-step"`, `explanationLevel = 1`), as long as it is clearly marked as a stub.

Later, we will add real Supabase tables and wire this up.

---

## 10. Testing and verification

After implementing the above:

1. **Make sure `apps/api` still builds and runs:**
   `npm run dev` from apps/api root should start without TypeScript or runtime errors.

2. **Hit the new RAG v2 endpoint with a simple request:**
   ```json
   POST /api/rag/v2
   {
     "userId": "test-user",
     "message": "I'm stuck on this math question.",
     "mode": "concept",
     "testCode": "SAT",
     "sectionCode": "M"
   }
   ```
   
   You should get:
   - `context` object with `primaryQuestion: null`, `supportingQuestions: []` or some results, `competencyContext`, and `studentProfile`.
   - `metadata.mode = "concept"` and `metadata.canonicalIdsUsed` as an array (possibly empty if no matches).

3. **Confirm that existing `/api/rag` still works as before:**
   It should still accept `{ query, section?, topK? }` and return `{ answer, citations, context }`.
