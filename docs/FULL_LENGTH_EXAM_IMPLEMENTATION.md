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

4. **full_length_exam_responses**
   - Student answers with server-side correctness computation
   - Fields: id, session_id, module_id, question_id, selected_answer, free_response_answer, is_correct, answered_at, submitted_at

## API Endpoints

All endpoints require Supabase authentication and enforce user ownership.

### POST /api/full-length/sessions
- Creates a new exam session
- Returns session with unique seed
- CSRF protected

### GET /api/full-length/sessions/current?sessionId={id}
- Returns current session state
- Includes current question (without answers/explanations)
- Includes time remaining for active module

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

### 2. Anti-Leak
- Question payloads never include:
  - `answer_choice`
  - `answer_text`
  - `explanation`
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

### 5. Idempotent Operations
- Answer submission: same answer twice updates (doesn't duplicate)
- Module submit: prevents double-submission

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
- `/full-test` - Main entry point
- Shows exam overview, structure, and requirements
- Creates session and starts exam
- Placeholder for exam interface (to be completed)

### Future Enhancements
The client UI is currently a functional shell with:
- Session creation ✅
- Exam start ✅
- Overview screen ✅
- Placeholder for active exam interface (future)

Full exam interface needs:
- Question rendering with timer
- Navigation between questions
- Module submit confirmation
- Break screen
- Results summary

## Testing

### Test Coverage
- `tests/full-length-exam.ci.test.ts` - CI tests
  - Auth enforcement ✅
  - CSRF protection ✅
  - Input validation ✅
  - Placeholders for integration tests (require DB)

### Integration Tests Required
- Anti-leak verification (no answers in responses)
- Deterministic selection (same seed → same questions)
- Idempotent operations (answer submission)
- Timer enforcement (expired modules reject answers)
- Adaptive logic (correct thresholds)
- State machine transitions

## Files Modified/Added

### Schema
- `shared/schema.ts` - Added 4 new tables + types

### Server
- `apps/api/src/services/fullLengthExam.ts` - Service layer (new)
- `server/routes/full-length-exam-routes.ts` - API routes (new)
- `server/index.ts` - Route registration (modified)

### Client
- `client/src/pages/full-test.tsx` - UI implementation (modified)

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

2. **Client Interface**
   - Basic shell implemented
   - Full exam interface (question rendering, timer, navigation) not yet built
   - Break screen not yet implemented
   - Results screen basic placeholder

3. **Scoring**
   - Raw scores only (correct count)
   - No scaled scores (200-800) implemented yet
   - No percentile calculations

4. **Resume/Reconnect**
   - Session persistence implemented
   - UI reconnect flow not yet implemented
   - Timer resume logic needs client integration

## Next Steps

1. **Database Migration**
   - Run `npm run db:push` to create tables
   - Verify tables created in Supabase

2. **Question Pool Validation**
   - Ensure sufficient questions in each difficulty bucket
   - Verify section classifications (Math, Reading, Writing)

3. **Client Exam Interface**
   - Implement question rendering component
   - Add timer countdown display
   - Add question navigation
   - Add module submit confirmation
   - Add break screen
   - Add results summary

4. **Integration Tests**
   - Set up test database
   - Implement full flow tests
   - Verify anti-leak enforcement
   - Test deterministic selection
   - Test adaptive thresholds

5. **Scaled Scoring**
   - Research SAT raw-to-scaled conversion tables
   - Implement scoring algorithm
   - Add percentile calculations

## Security Audit Checklist

- [x] Cookie-only auth (no Bearer tokens)
- [x] CSRF protection on all POSTs
- [x] User ID from auth only (IDOR prevention)
- [x] No answer leakage in question payloads
- [x] Server-authoritative timing
- [x] Idempotent operations
- [x] Input validation (Zod schemas)
- [x] Session ownership validation
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
