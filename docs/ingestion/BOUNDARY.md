# Ingestion Boundary Contract

**Generated**: 2026-01-31  
**Purpose**: Define explicit boundaries between ingestion and core systems

---

## 1. Executive Summary

The ingestion system is **OPTIONAL** and **ISOLATED** from core application functionality. It MUST NOT affect:
- Authentication
- Practice mode
- Scoring/progress tracking
- AI tutoring

This document defines the contract between ingestion and other systems to prevent inadvertent coupling.

---

## 2. Ingestion System Scope

### 2.1 What Ingestion IS

**Purpose**: Background processing pipeline to extract questions from PDF documents

**Components**:
- `server/services/ingestionWorker.ts` - Background worker
- `apps/api/src/ingestion_v4/` - Pipeline implementation
- Admin control endpoints (`/api/admin/worker/*`)

**Pipeline Stages**:
1. **PENDING**: Job queued
2. **OCR**: Optical character recognition (Google Document AI or Gemini Vision)
3. **PARSE**: LLM-based question extraction
4. **QA**: Quality assurance validation
5. **EMBED**: Generate vector embeddings for RAG
6. **DONE**: Job complete

**Data Flow**:
```
PDF Upload → ingestion_runs table → Worker → questions table → embeddings
```

---

### 2.2 What Ingestion IS NOT

❌ **NOT** required for application to function  
❌ **NOT** part of the critical user path  
❌ **NOT** tested in default CI (excluded via `INGESTION_ENABLED` flag)  
❌ **NOT** allowed to block auth, practice, scoring, or tutor systems

---

## 3. Ingestion Isolation Boundaries

### 3.1 Feature Flag Enforcement

**Environment Variable**: `INGESTION_ENABLED`

| Value | Behavior |
|-------|----------|
| `undefined` or `false` (default) | Worker does NOT start, admin control endpoints return 404, tests excluded |
| `true` | Worker starts automatically, admin control endpoints enabled, tests included |

**Enforcement Locations**:
- `server/index.ts:721-745` - Worker startup conditional
- `vitest.config.ts:24-33` - Test exclusion logic
- `apps/api/src/routes/calendar.ts:6-7` - Dynamic import guard

---

### 3.2 Type-Checking Isolation

**Problem**: TypeScript attempts to compile ingestion code even when feature is disabled, causing CI failures.

**Solution**: Dynamic imports with type guards

**Example** (`apps/api/src/routes/calendar.ts`):
```typescript
// This prevents TypeScript from type-checking ingestion_v4 in CI when INGESTION_ENABLED is not set
const useLLM = process.env.INGESTION_ENABLED === 'true';
if (useLLM) {
  const { generateLLMCalendarEvents } = await import('../ingestion_v4/llm/calendar-generator');
  // Use LLM-based calendar generation
}
```

**Locations Using Dynamic Imports**:
- `apps/api/src/routes/calendar.ts` - Calendar event generation

**RULE**: Any code path importing `apps/api/src/ingestion_v4/**` MUST use dynamic imports behind `INGESTION_ENABLED` check.

---

### 3.3 Database Boundaries

#### Tables Owned by Ingestion

| Table | Purpose | Access Control |
|-------|---------|----------------|
| `ingestion_runs` | Job tracking (PENDING → DONE states) | Admin-only writes, worker reads/writes |
| `ingestion_logs` | Pipeline execution logs | Admin-only reads, worker writes |
| `style_banks` | PDF style metadata for clustering | Worker writes, admin reads |
| `domain_samplers` | Domain-based question sampling config | Worker writes, admin reads |

#### Tables Shared with Core Systems

| Table | Ingestion Access | Core System Access | Conflict Resolution |
|-------|------------------|--------------------|---------------------|
| `questions` | **Write** (inserts new questions) | **Read/Write** (CRUD by admin, read by students) | Ingestion writes to `status='pending'`, admin approves to `status='approved'` |
| `embeddings` | **Write** (generates vectors) | **Read** (RAG retrieval) | Ingestion writes after question approval, RAG reads immutable data |
| `question_metadata` | **Write** (competency labels) | **Read** (adaptive selector, RAG) | Ingestion backfills metadata, core systems treat as read-only |

**Invariant**: Ingestion NEVER modifies `status='approved'` questions or existing embeddings.

---

### 3.4 API Boundaries

#### Ingestion-Owned Endpoints

| Endpoint | Auth | Purpose | Isolation |
|----------|------|---------|-----------|
| `GET /api/admin/worker/status` | Admin | Check worker health | Returns 404 if `INGESTION_ENABLED !== 'true'` |
| `POST /api/admin/worker/stop` | Admin | Stop worker | Returns 404 if `INGESTION_ENABLED !== 'true'` |

**Contract**: These endpoints MUST NOT exist when ingestion is disabled (hard 404, not 403).

#### Core System Endpoints (Must NOT Depend on Ingestion)

| Endpoint | Ingestion Dependency | Enforcement |
|----------|---------------------|-------------|
| `/api/questions/validate` | ❌ NONE | Questions table read-only access, no ingestion logic |
| `/api/tutor/v2` | ❌ NONE | RAG retrieval from embeddings (read-only) |
| `/api/practice/*` | ❌ NONE | Questions table read-only access |
| `/api/rag/v2` | ⚠️ **WEAK**: Reads embeddings | Embeddings are static after generation, no runtime dependency |
| `/api/calendar` | ⚠️ **CONDITIONAL**: Uses LLM calendar generator if enabled | Dynamic import guard prevents type errors when disabled |

**Invariant**: Core endpoints MUST function correctly with `INGESTION_ENABLED=false` and empty `ingestion_runs` table.

---

## 4. System Contracts

### 4.1 Ingestion → Calendar

**Contract**: Calendar route MAY use LLM-based event generation if ingestion is enabled.

**Interface**:
```typescript
// apps/api/src/ingestion_v4/llm/calendar-generator.ts (OPTIONAL)
export async function generateLLMCalendarEvents(userId: string): Promise<CalendarEvent[]>
```

**Fallback**: If `INGESTION_ENABLED !== 'true'`, calendar uses rule-based event generation (default behavior).

**Boundary Enforcement**:
- Dynamic import behind feature flag check
- No type errors when ingestion code is absent
- Calendar functionality preserved in both modes

---

### 4.2 Ingestion → Adaptive Selector

**Contract**: Ingestion populates `question_metadata.competency_labels` for adaptive question selection.

**Interface**:
```typescript
// questions table schema
interface Question {
  id: string;
  competency_labels: string[]; // Written by ingestion, read by adaptive selector
  difficulty_level: number;     // Written by ingestion, read by adaptive selector
}
```

**Boundary Enforcement**:
- Adaptive selector treats `competency_labels` as read-only
- If labels are missing (ingestion never ran), adaptive selector falls back to random selection
- No runtime dependency on ingestion worker

---

### 4.3 Ingestion → RAG

**Contract**: Ingestion generates embeddings for vector search in RAG retrieval.

**Interface**:
```typescript
// embeddings table schema
interface Embedding {
  id: string;
  question_id: string;
  embedding: number[]; // 768-dimensional vector, written by ingestion
}
```

**Boundary Enforcement**:
- RAG retrieval reads embeddings table (read-only)
- If embeddings table is empty (ingestion never ran), RAG returns empty context
- No runtime dependency on ingestion worker

---

## 5. What Ingestion Can Break Without Blocking CI

### 5.1 Allowed Failures

✅ **Ingestion Worker Crashes**: Does not block CI (worker excluded from test suite)  
✅ **OCR Errors**: Does not affect core functionality  
✅ **LLM Parsing Failures**: Questions remain in `status='pending'`, not surfaced to students  
✅ **Embedding Generation Failures**: RAG falls back to keyword search or empty context  
✅ **Ingestion Test Failures**: Tests excluded by default (`INGESTION_ENABLED=false`)

---

### 5.2 Failures That MUST Block CI

❌ **Questions Table Corruption**: Would break practice mode and tutor (MUST block)  
❌ **Embeddings Table Corruption**: Would break RAG retrieval (MUST block)  
❌ **Type-Checking Failures**: If ingestion imports leak into core code (MUST block)  
❌ **Auth Bypass via Ingestion Endpoints**: Security invariant violation (MUST block)

---

## 6. What Ingestion Must NEVER Affect

### 6.1 Authentication System

**Invariant**: Ingestion MUST NOT modify or depend on:
- User authentication flow
- Session management
- Role-based access control (RBAC)
- JWT token validation

**Enforcement**:
- Ingestion endpoints use same auth middleware as core (`requireSupabaseAdmin`)
- No custom auth logic in ingestion code

---

### 6.2 Practice Mode

**Invariant**: Ingestion MUST NOT affect:
- Practice session creation
- Answer validation logic
- Session ownership checks
- Progress tracking

**Enforcement**:
- Practice routes (`/api/practice/*`) import questions read-only
- No ingestion code in `server/routes/practice-canonical.ts`
- No ingestion imports in `server/routes/questions-validate.ts`

---

### 6.3 Scoring & Progress

**Invariant**: Ingestion MUST NOT affect:
- Score projection calculations
- Competency event recording
- Weakness tracking
- Mastery calculations

**Enforcement**:
- Scoring logic in `apps/api/src/routes/progress.ts` has no ingestion imports
- Weakness/mastery routers (`apps/api/src/routes/weakness.ts`, `apps/api/src/routes/mastery.ts`) are ingestion-free

---

### 6.4 AI Tutoring (Tutor V2)

**Invariant**: Ingestion MUST NOT affect:
- Tutor prompt generation
- RAG context retrieval
- LLM interaction
- Answer leakage prevention (PRAC-002)

**Enforcement**:
- Tutor route (`server/routes/tutor-v2.ts`) has no ingestion imports
- RAG service (`apps/api/src/lib/rag-service.ts`) reads embeddings read-only
- No ingestion logic in prompt builder

---

## 7. Allowed vs. Forbidden Modifications

### 7.1 Allowed (Safe to Change)

✅ Modify ingestion pipeline logic (`apps/api/src/ingestion_v4/`)  
✅ Add new OCR providers  
✅ Change embedding model or dimensionality  
✅ Add new ingestion job states  
✅ Modify worker concurrency settings  
✅ Add admin control endpoints for ingestion debugging  
✅ Change ingestion test suite (will not affect CI unless feature enabled)

---

### 7.2 Forbidden (MUST NOT Change Without Contract Update)

❌ Import ingestion code into core routes without dynamic import guard  
❌ Make core endpoints depend on ingestion worker being active  
❌ Modify `questions.status` enum to remove 'pending' or 'approved' states  
❌ Change `embeddings` table schema without updating RAG service contract  
❌ Remove `INGESTION_ENABLED` feature flag  
❌ Force ingestion tests to run in default CI  
❌ Couple auth, practice, scoring, or tutor logic to ingestion pipeline

---

## 8. Monitoring & Validation

### 8.1 CI Validation Rules

**Rule 1**: Default CI (`INGESTION_ENABLED=false`) MUST pass without ingestion tests  
**Rule 2**: TypeScript compilation MUST NOT fail when ingestion code is excluded  
**Rule 3**: Core test suite MUST pass with empty `ingestion_runs` and `embeddings` tables

---

### 8.2 Runtime Validation

**Health Check Indicator**:
```bash
# If ingestion is disabled, this should return 404
GET /api/admin/worker/status → 404 (expected when INGESTION_ENABLED != 'true')
```

**Contract Validation**:
```bash
# Core endpoints must work without ingestion
curl /api/practice/next -H "Cookie: sb-access-token=..." → 200 OK
curl /api/tutor/v2 -H "Cookie: sb-access-token=..." -d '{"message":"help"}' → 200 OK
```

---

### 8.3 Audit Command

**Existing Audit**: `pnpm run audit:no-ingest`

**Purpose**: Ensure ingestion code has not leaked into core server/routes

**Command**:
```bash
rg -n --color=always 'api/ingest|ingestion-v4|ingest-llm' server apps | (grep . && (echo 'Ingest code found!' && exit 1) || exit 0)
```

**Expected Result**: Exit code 0 (no ingestion imports in core code)

**Exceptions** (allowed ingestion imports):
- `apps/api/src/routes/calendar.ts` (dynamic import behind feature flag)
- `server/index.ts` (worker startup conditional)

---

## 9. Future Remediation Plan

### 9.1 Short-Term (Next Sprint)

- [ ] Add runtime assertion to calendar route: if `INGESTION_ENABLED=false`, LLM calendar path MUST NOT execute
- [ ] Document RAG fallback behavior when embeddings table is empty
- [ ] Add integration test: "Core endpoints work with ingestion disabled"

### 9.2 Long-Term (Production Hardening)

- [ ] Consider moving ingestion to separate microservice
- [ ] Implement event-driven architecture for question approval → embedding generation
- [ ] Add database constraints to prevent ingestion from modifying approved questions

---

## 10. Contract Summary

| Boundary | Contract | Enforcement |
|----------|----------|-------------|
| **Type-Checking** | Core code MUST NOT import ingestion without dynamic import + feature flag check | CI TypeScript compilation |
| **Runtime** | Core endpoints MUST function with `INGESTION_ENABLED=false` | Integration tests |
| **Database** | Ingestion MUST NOT modify `status='approved'` questions | Database trigger (future) |
| **API** | Worker control endpoints MUST return 404 when ingestion disabled | Hard-coded conditional |
| **Tests** | Ingestion tests MUST NOT run in default CI | `vitest.config.ts` exclusion |

---

**Document Status**: ✅ COMPLETE  
**Last Updated**: 2026-01-31  
**Owner**: Senior Staff Engineer (Sprint 0)  
**Compliance**: This contract is MANDATORY for all future changes touching ingestion or core systems.
