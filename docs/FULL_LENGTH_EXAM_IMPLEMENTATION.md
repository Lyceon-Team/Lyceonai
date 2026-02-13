# Full-Length SAT Exam Implementation Summary

## Overview

This implementation adds a complete full-length SAT exam feature to Lyceon, following the Bluebook SAT structure with adaptive testing, deterministic question selection, and server-authoritative timing.

## Database Schema

### Tables Added

1. **full_length_exam_sessions**
   - Tracks complete exam attempts
   - Fields: id, user_id, status, current_section, current_module, seed, started_at, completed_at
   - Status: not_started → in_progress → completed/abandoned
   - Seed ensures deterministic question selection

2. **full_length_exam_modules**
   - Tracks individual modules within an exam (4 modules total)
   - Fields: id, session_id, section, module_index, difficulty_bucket, target_duration_ms, started_at, ends_at, submitted_at, status
   - Adaptive difficulty determined after Module 1 performance

3. **full_length_exam_questions**
   - Maps questions to modules in deterministic order
   - Fields: id, module_id, question_id, order_index, presented_at

### 4. **full_length_exam_responses**
   - Student answers with server-side correctness computation
   - Fields: id, session_id, module_id, question_id, selected_answer, free_response_answer, is_correct, answered_at, submitted_at
   - **Unique Constraint**: (session_id, module_id, question_id) - ensures idempotent answer submission
   - Supports upsert operations for retry safety

## API Endpoints

All endpoints require Supabase authentication and enforce user ownership.

### POST /api/full-length/sessions
- Creates a new exam session
- **Idempotent**: Returns existing active session if one exists for the user (status: not_started or in_progress)
- Only creates new session if no active session exists
- Returns session with unique seed
- CSRF protected

### GET /api/full-length/sessions/current?sessionId={id}
- Returns current session state
- Includes current question (without answers/explanations - anti-leak)
- **Resume support**: Includes user's previously submitted answer for current question (if already answered)
- Response includes: `submittedAnswer: { selectedAnswer?, freeResponseAnswer? }`
- Includes time remaining for active module
- **Security**: Never returns answer, explanation, or classification fields from questions table

### POST /api/full-length/sessions/:sessionId/start
- Starts the exam (RW Module 1)
- CSRF protected

### POST /api/full-length/sessions/:sessionId/answer
- Submits answer for a question
- Idempotent (same answer twice doesn't double-count)
- Validates question belongs to current module
- CSRF protected

### POST /api/full-length/sessions/:sessionId/module/submit
- Ends current module
- Computes performance
- Sets Module 2 difficulty deterministically
- Returns next module info or break status
- CSRF protected

### POST /api/full-length/sessions/:sessionId/break/continue
- Continues from break to Math Module 1
- CSRF protected

### POST /api/full-length/sessions/:sessionId/complete
- Marks exam as completed
- Returns final scores
- CSRF protected

## Test Structure

### SAT Bluebook Format
- **Reading & Writing**
  - Module 1: 32 minutes, 27 questions
  - Module 2: 32 minutes, 27 questions (adaptive)
- **Math**
  - Module 1: 35 minutes, 22 questions
  - Module 2: 35 minutes, 22 questions (adaptive)
- **Break**: 10 minutes between RW and Math

Total: 98 questions, ~2 hours 14 minutes + break

## Adaptive Logic

### Module 2 Difficulty Thresholds

**Reading & Writing:**
- Module 1 score ≥ 18 correct (66.7% of 27) → Module 2 = Hard
- Module 1 score < 18 correct → Module 2 = Medium

**Math:**
- Module 1 score ≥ 15 correct (68.2% of 22) → Module 2 = Hard
- Module 1 score < 15 correct → Module 2 = Medium

These thresholds are defined in `apps/api/src/services/fullLengthExam.ts` as constants.

## Security Features

### 1. Auth Architecture
- Cookie-only authentication (httpOnly cookies)
- No Bearer tokens accepted
- requireSupabaseAuth middleware on all routes
- User ID from auth only (IDOR prevention)

### 2. Anti-Leak ✅ (ENHANCED)
- **Strict whitelist query**: Only safe fields returned (id, stem, section, type, options, difficulty)
- Question payloads **never** include:
  - `answer_choice` / `answer` / `answerChoice`
  - `answer_text` / `answerText`
  - `explanation`
  - `classification` (removed - could contain AI-generated answer hints)
- Server uses explicit SELECT statements to prevent accidental leakage
- Type-safe interfaces ensure no sensitive fields in response payload
- Answers only revealed after module submit (future enhancement)

### 3. Server-Authoritative Timing
- Module start/end times stored server-side
- `endsAt` computed as `startedAt + targetDurationMs`
- Answer submission rejected if time expired
- No trust of client clocks

### 4. CSRF Protection
- All POST endpoints use `csrfGuard()` middleware
- Validates Origin/Referer headers
- Consistent with existing practice endpoints

### 5. Idempotent Operations ✅ (ENHANCED)
- **Session creation**: Returns existing active session instead of creating duplicate
  - Checks for sessions with status: 'not_started' or 'in_progress'
  - Prevents multiple concurrent exam sessions per user
  - Safe to call repeatedly
- **Answer submission**: Uses upsert with unique constraint (session_id, module_id, question_id)
  - Same answer submitted twice updates existing record
  - No duplicate rows created
  - Database constraint enforces uniqueness
- **Module submit**: Returns cached result if already submitted
  - Safe to retry
  - Prevents double-submission errors
  - Returns same next module info

## Deterministic Selection

### Seed-Based Selection
- Each session has a unique seed: `${userId}_${timestamp}`
- Question selection uses deterministic hash function
- Same seed → same questions in same order
- Enables exact test reproduction

### Selection Process
1. Filter questions by section (RW or Math)
2. Filter by difficulty bucket (Module 1: medium, Module 2: adaptive)
3. Filter by type (MC questions only for now)
4. Deterministically shuffle using seed
5. Take first N questions

## Client Implementation

### Pages
- `/full-test` - Main entry point with complete exam flow

### Features Implemented ✅

**Overview Screen:**
- Exam structure breakdown (4 modules + break)
- Duration and question count information
- "Before You Begin" checklist
- Session creation

**Exam Runner (`ExamRunner.tsx`):**
- Question rendering with QuestionRenderer component
- Server-synced timer display (updates every second, syncs every 30s)
- Answer submission with idempotent retry safety
- Navigation (Next button, auto-advance)
- Progress tracking (answered/total questions)
- Auto-submit on time expiry
- Module completion with score summary

**Break Screen:**
- 10-minute break timer
- Option to continue early to Math Module 1
- Countdown display

**Results Screen:**
- Overall percentage score
- Module-by-module breakdown (RW & Math)
- Detailed scoring by module (Module 1 & 2)
- Navigation to dashboard or start new exam

**Session Management:**
- URL-based session ID for refresh support (`?sessionId=...`)
- **Resume support ✅**: Answer state restoration on page refresh
  - Client tracks `lastQuestionId` to prevent clearing on poll
  - Server returns `submittedAnswer` in current question payload
  - UI restores selected/freeResponse answers from server
  - Answers only cleared when question changes AND no submitted answer exists
- Automatic session state restoration
- Resume in progress exams
- Handle all state transitions (not_started → in_progress → break → completed)

### Components Added
- `client/src/components/full-length-exam/ExamRunner.tsx` - Main exam runner (enhanced)

## Testing

### Test Coverage ✅ (ENHANCED)
- `tests/full-length-exam.ci.test.ts` - 32 CI tests passing
  - Auth enforcement on all endpoints ✅
  - CSRF protection validation ✅
  - Input validation (UUID format, required params) ✅
  - Route structure verification ✅
  - Response format validation ✅
- `apps/api/src/services/__tests__/fullLengthExam.test.ts` - 5 service tests **NEW**
  - Session creation idempotency ✅
  - Returns existing active session instead of creating duplicate ✅
  - Only checks not_started/in_progress statuses ✅
  - Answer state restoration type safety ✅
  - Anti-leak type verification ✅
  
### Test Categories
1. **Authentication & Authorization** - 5 tests
   - Rejects unauthenticated requests
   - Enforces auth on all endpoints

2. **CSRF Protection** - 1 test
   - Validates CSRF middleware is applied

3. **Input Validation** - 3 tests
   - Rejects invalid UUIDs
   - Validates required parameters
   - Accepts valid UUIDs

4. **Route Structure** - 7 tests
   - Verifies all endpoints exist
   - Returns appropriate HTTP codes

5. **Service-Level Tests (NEW)** - 5 tests
   - Session creation idempotency
   - Active session detection
   - Answer state restoration
   - Type safety validation

5. **Response Structure** - 2 tests
   - Returns JSON errors
   - Proper content-type headers

6. **Placeholder Integration Tests** - 14 tests
   - Anti-leak verification (requires DB)
   - Deterministic selection (requires DB)
   - Idempotent operations (requires DB)
   - Timer enforcement (requires DB)
   - Adaptive logic (requires DB)
   - State machine transitions (requires DB)
   - Break flow (requires DB)

## Files Modified/Added

### Schema
- `shared/schema.ts` - Added 4 new tables + types

### Server
- `apps/api/src/services/fullLengthExam.ts` - Service layer (new)
- `server/routes/full-length-exam-routes.ts` - API routes (new)
- `server/index.ts` - Route registration (modified)

### Client
- `client/src/pages/full-test.tsx` - Main page with overview and session management (modified)
- `client/src/components/full-length-exam/ExamRunner.tsx` - Complete exam runner UI (new)

### Tests
- `tests/full-length-exam.ci.test.ts` - CI tests (new)

## Constants Reference

Located in `apps/api/src/services/fullLengthExam.ts`:

```typescript
MODULE_CONFIG = {
  rw: {
    module1: { durationMs: 1920000, questionCount: 27 },
    module2: { durationMs: 1920000, questionCount: 27 },
  },
  math: {
    module1: { durationMs: 2100000, questionCount: 22 },
    module2: { durationMs: 2100000, questionCount: 22 },
  },
}

BREAK_DURATION_MS = 600000 // 10 minutes

ADAPTIVE_THRESHOLDS = {
  rw: { hardThreshold: 18 },
  math: { hardThreshold: 15 },
}
```

## Migration Notes

### Drizzle Migration
Schema is defined in `shared/schema.ts` using Drizzle ORM.

To generate migration:
```bash
npm run db:push
```

The migration will create the 4 new tables in the Supabase database.

## Known Limitations

1. **Question Pool**
   - Current implementation only uses MC questions
   - Free response questions supported in schema but not selection logic
   - Needs sufficient questions in each difficulty bucket
   - Requires minimum: 81 RW questions (27 medium + 27 medium + 27 hard), 66 Math questions (22 medium + 22 medium + 22 hard)

2. **Scoring**
   - Raw scores only (correct count, percentage)
   - No scaled scores (200-800) implemented yet
   - No percentile calculations

3. **Navigation**
   - Sequential question flow only (Next button)
   - No backward navigation or question review
   - No "mark for review" functionality
   - Cannot skip questions (must submit empty)

## Next Steps

1. **Database Migration** ✅
   - Schema defined in `shared/schema.ts`
   - Run `npm run db:push` to create tables
   - Verify unique constraint on full_length_exam_responses

2. **Question Pool Validation**
   - Ensure sufficient questions in each difficulty bucket
   - Verify section classifications (Math, Reading, Writing)
   - Minimum required:
     - RW Medium: 27 questions
     - RW Hard: 27 questions  
     - Math Medium: 22 questions
     - Math Hard: 22 questions

3. **Enhanced Features** (Future)
   - Backward navigation between questions
   - "Mark for review" functionality
   - Question palette/overview
   - Pause/resume functionality
   - Time warnings (5 min, 1 min remaining)

4. **Integration Tests** (Requires Test Database)
   - Set up test database with sample questions
   - Implement full flow tests
   - Verify anti-leak enforcement
   - Test deterministic selection
   - Test adaptive thresholds

5. **Scaled Scoring** (Future Enhancement)
   - Research SAT raw-to-scaled conversion tables
   - Implement scoring algorithm
   - Add percentile calculations

## Security Audit Checklist

- [x] Cookie-only auth (no Bearer tokens)
- [x] CSRF protection on all POSTs
- [x] User ID from auth only (IDOR prevention)
- [x] **No answer leakage in question payloads** ✅ ENHANCED
  - [x] Strict whitelist query (only safe fields)
  - [x] Removed classification field from response
  - [x] Type-safe interfaces prevent accidental leakage
- [x] Server-authoritative timing
- [x] **Idempotent operations** ✅ ENHANCED
  - [x] Session creation returns existing active session
  - [x] Answer submission uses upsert with unique constraint
  - [x] Module submit returns cached result
- [x] Input validation (Zod schemas)
- [x] Session ownership validation
- [x] **Resume flow with answer state restoration** ✅ NEW
  - [x] Server returns submitted answers for current question
  - [x] Client restores UI state without wiping on every poll
  - [x] Only clears inputs when question changes AND no submitted answer
- [x] **Type safety - removed all `any` usage** ✅ NEW
  - [x] fullLengthExam.ts: Replaced any with proper types
  - [x] full-length-exam-routes.ts: All error handlers use `unknown`
  - [x] ExamRunner.tsx: All error handlers use `unknown`
  - [x] full-test.tsx: No any usage found
- [ ] Rate limiting (future - use existing practice limits)
- [ ] Question pool exhaustion handling

## Performance Considerations

1. **Question Selection**
   - Current: Loads 3x questions needed, shuffles in memory
   - Optimization: Pre-compute question sets by difficulty/section

2. **Response Storage**
   - Each answer creates/updates a row
   - 98 responses per exam
   - Consider response batching for UX

3. **Timer Checks**
   - Server computes time remaining on each request
   - Client should poll periodically (not every second)

## Compliance Notes

### FERPA
- Exam sessions tied to user_id
- RLS policies needed (future)
- Guardian access controls (future)

### Data Retention
- Sessions persist indefinitely
- Consider archival policy for old exams

## Documentation Links

- Problem Statement: (in issue)
- Bluebook SAT Structure: https://satsuite.collegeboard.org/digital/whats-on-the-test
- API Routes: `server/routes/full-length-exam-routes.ts`
- Service Logic: `apps/api/src/services/fullLengthExam.ts`
- Client UI: `client/src/pages/full-test.tsx`
