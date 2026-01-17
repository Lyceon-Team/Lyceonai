# PRP — Ingestion v2 (LLM-Guided OCR Pipeline for SAT & Future Exams)

**Lyceon Learning Copilot — Internal Architecture Document**

## 1. Purpose

This PRP defines the complete ingestion system for all exam content handled by Lyceon (SAT first, later ACT, AP, MCAT, LSAT). It replaces regex-based parsing with a robust, multi-stage OCR + LLM pipeline that produces canonical, structured, versioned question objects, stored in Supabase as the single source of truth.

This document governs how the ingestion pipeline behaves, how data is shaped, how IDs are generated, how LLMs must respond, and how the system scales across exams.

## 2. Design Principles

- **Reliability over cleverness** — deterministic schema, retries, validation, versioning.
- **Canonical IDs over source IDs** — Lyceon question identity is independent of SAT numbering.
- **Supabase is the source of truth** — all finalized questions live in Supabase.
- **GCS stores raw materials** — PDFs, OCR outputs, intermediate dumps.
- **LLMs provide structure, not authority** — explanations are generated dynamically; answers must be strictly extracted.
- **Test family scalability** — schema must support all future test types without redesign.

## 3. Canonical Question Identity System

All questions generated or extracted by the pipeline receive a canonical ID in the following format:

```
<TEST><SECTION><SOURCE><ALPHANUM>
```

### 3.1 Component Definitions

| Component | Meaning | Examples |
|-----------|---------|----------|
| TEST | Full test family code | SAT, ACT, AP, MCAT, LSAT |
| SECTION | Section code | M, RW, R, S, BI, CP |
| SOURCE | 1 = PDF-extracted, 2 = AI-generated | 1 / 2 |
| ALPHANUM | 6-character alphanumeric unique ID | A9X3TQ |

### 3.2 Examples

| Purpose | ID Example |
|---------|------------|
| SAT Math (PDF) | SATM1A8B91Q |
| SAT RW (PDF) | SATRW1H92KLM |
| SAT Math (AI) | SATM2P04MTZ |
| AP Biology (PDF) | APBI1FJ44XK |

### 3.3 Student-facing Numbering

Students never see canonical IDs.

During practice or a full-length test, students only see:
```
1, 2, 3, 4 …
```

Canonical IDs are internal only.

## 4. Competency Model

### 4.1 Normalized Competency Vocabulary

All competencies extracted from PDFs are normalized into Lyceon's controlled vocabulary.

The ingestion pipeline stores:
- `competency.code` → normalized (e.g., "RW.EVI.1")
- `competency.raw` → raw extracted string (e.g., "C3")

### 4.2 Rationale

- Alignment across versions
- Future synthetic question generation
- Supports adaptive learning and dashboards

## 5. Section Labeling

Internal section codes use compact formatting:

| Section | Code |
|---------|------|
| Reading & Writing | RW |
| Math | M |
| AP Biology | BI |
| MCAT Chem/Phys | CP |

Full labels stored elsewhere.

## 6. Orchestration Architecture

Ingestion must support three interchangeable orchestrators:

### 6.1 Cloud Run Jobs (primary option)

Used for:
- Heavy OCR
- High reliability
- Ephemeral compute
- Production loads

### 6.2 n8n as a trigger layer

Used for:
- Pub/Sub → workflow
- Compatibility with older flows
- Debugging/manual runs

### 6.3 Replit API mode

Used for:
- Development
- Debugging
- Local simulation

Each mode eventually calls the same endpoint:
```
POST /api/ingest-llm
```

## 7. Pipeline Overview

### 7.1 Stages

1. Raw OCR Extraction
2. LLM Layout Profiler (lightweight model)
3. LLM Structured Extractor (Gemini-tier model)
4. Multi-page Stitcher
5. Canonicalizer (assign IDs, map competencies)
6. Validator (schema-enforced)
7. Supabase Upsert
8. Vector Upsert (RAG)
9. Job Logging & Versioning

## 8. Storage Strategy

### 8.1 GCS Stores

- PDFs
- OCR dumps
- Intermediate JSON
- Image crops (if extracted)

### 8.2 Supabase Stores

- Canonical questions
- Competencies
- Explanations
- Section metadata
- Versioning
- RAG metadata (for filtering/querying)

**Supabase = the world's truth about questions.**

## 9. Data Shape (Final Question Object)

```typescript
export interface QuestionDoc {
  canonicalId: string;               // SATM1A8B91Q
  testCode: string;                  // SAT
  sectionCode: string;               // M, RW, BI, CP...
  sourceType: 1 | 2;                 // 1 PDF, 2 AI-generated
  version: number;                   // always 1 on ingestion

  stem: string;
  options: { key: "A"|"B"|"C"|"D", text: string }[];
  answer: "A"|"B"|"C"|"D" | null;

  explanation: string;               // LLM-generated, student-friendly
  difficulty: string | null;

  competencies: {
    code: string;                    // normalized
    raw: string | null;              // extracted
  }[];

  satQuestionNumber: string | null;  // legacy, never shown

  sourcePages: number[];             // [5], [5,6], etc.
  sourcePdfPath: string;             // GCS path

  createdAt: string;
  updatedAt: string;
}
```

## 10. Multi-Page Question Logic

Use hybrid strategy:

### 10.1 Step 1 — LLM attempts merging

Layout profiler tells extractor when multi-page spans likely exist.

### 10.2 Step 2 — Pipeline post-processor

Rules:
- Same SAT question number → merge
- Page break without new question → merge
- Stem continuation detection → merge

Final result must be a single canonical question.

## 11. LLM Model Assignment

### 11.1 Lightweight LLM (schema detection)

Used for:
- Layout profiler
- Competency region detection
- Pattern recognition
- Low cost, high speed

Models recommended:
- Gemini Flash
- o3-mini
- Claude Haiku

### 11.2 Heavy LLM (final extraction)

Used for:
- Structured JSON extraction
- Explanation generation
- Competency mapping

Models recommended:
- Gemini Pro
- Claude Sonnet
- GPT-4.1 / o3-pro (optional fallback)

## 12. Output Strictness Policy

### 12.1 Strict Fields (must validate)

- `stem`
- `options` (A–D only)
- `answer`
- `canonicalId`
- `competencies.code` (normalized)

### 12.2 Relaxed Fields

- `explanation` (LLM-generated)
- raw competency labels
- `tags`
- `difficulty`
- multi-page merging assistance

**Explanation rule:**
> "Explain the answer as a tutor would. Use SAT-style clarity and reasoning."

## 13. Versioning Rules

- All ingested questions start with `version = 1`
- If an admin edits:
  - version increments: 2, 3, 4…
  - canonical ID stays the same
- Students never see version numbers
- RAG metadata includes version for traceability

## 14. Synthetic Question Standards

AI-generated questions follow identical schema except:
- `canonicalId` uses `2` (AI source)
  - e.g., `SATM2T9QZ11`
- Explanation always required
- Must declare competency codes explicitly

## 15. Supabase Upsert Logic

The ingestion pipeline must:

1. Upsert test metadata
2. Upsert section metadata
3. Upsert competencies
4. Upsert questions
5. Upsert join table question ↔ competencies
6. Trigger vector upsert

**All writes must be idempotent.**

## 16. Error Handling & Retries

Automatic retries for:
- OCR failures
- LLM invalid JSON
- Missing required fields

Retries follow exponential backoff:
```
1s → 2s → 4s → 8s → max 4 attempts
```

Hard fail if:
- Extracted question count ≤ 5 for a full SAT section
- Required fields missing after 4 attempts
- Canonical ID collision (extremely rare)

## 17. Logging & Observability

Each ingestion job logs:
- `testCode`
- `sectionCode`
- PDF path
- number of extracted items
- number of merged multi-page items
- number of AI explanations generated
- time spent per stage
- orchestration mode (Run/n8n/Replit)

Stored in Supabase table `ingestion_jobs`.

## 18. Future Compatibility

This ingestion PRP cleanly scales to:
- ACT
- GRE
- GMAT
- LSAT
- MCAT
- AP examinations (all 38 subjects)

Just update:
- `testCode`
- `sectionCode`
- competency mapping

**No structural changes required.**
