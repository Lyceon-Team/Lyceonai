# Comprehensive Free Response (FR) Question Test Specification
## Task H: Tests that fail if FR isn't handled properly

**Generated**: 2025-09-27  
**Purpose**: Comprehensive test suite to verify Free Response question handling across the entire SAT Learning Copilot system

## Test Environment Requirements
- Backend API running (port 3001 accessible)  
- Admin authentication available
- Database connection (PostgreSQL + SQLite)
- No port conflicts (currently blocked by EADDRINUSE on port 5000)

---

## 🔴 CRITICAL SECURITY TESTS

### SEC-001: Answer Leaking Prevention
**Purpose**: Verify FR answers are NEVER exposed to client-side
```javascript
// Test: GET /api/questions?type=fr
// MUST FAIL if response contains answer_text field
assert(response.data.every(q => q.answer_text === undefined))
```

### SEC-002: Server-Side Validation Required  
**Purpose**: Ensure all answer validation is server-side only
```javascript
// Test: Submit FR answer via client-side validation
// MUST FAIL - only server endpoint should validate
```

### SEC-003: FR vs MC Answer Field Security
**Purpose**: Verify correct answer fields are omitted per type
```javascript
// FR questions: MUST NOT have answer_choice
// MC questions: MUST NOT have answer_text  
```

---

## 🎯 DISCRIMINATED UNION TYPE TESTS

### TYPE-001: Question Type Discrimination
**Purpose**: Verify system correctly identifies question types
```sql
-- Database Test: Verify discriminated union storage
SELECT type, 
       CASE WHEN type = 'mc' THEN answer_choice IS NOT NULL AND answer_text IS NULL
            WHEN type = 'fr' THEN answer_text IS NOT NULL AND answer_choice IS NULL
            ELSE FALSE END as valid_schema
FROM questions;
```

### TYPE-002: Frontend Type Rendering
**Purpose**: Verify UI renders different components per type
- **MC Questions**: Radio buttons (A/B/C/D options)
- **FR Questions**: Text input field
- **Both**: Submit button, question text, no pre-filled answers

### TYPE-003: API Type Filtering
**Purpose**: Test type-specific filtering endpoints
```javascript
// Test each endpoint returns correct question types only
GET /api/questions?type=mc  // Only MC questions
GET /api/questions?type=fr  // Only FR questions
GET /api/questions          // Both types
```

---

## 📊 ADMIN DASHBOARD TESTS (Task G Verification)

### ADMIN-001: Per-Type Metrics Display
**Purpose**: Verify admin shows separate MC and FR statistics
**Route**: `/admin/ingest/jobs`
**Required Elements**:
- Multiple Choice Questions card
- Free Response Questions card  
- Validation Failed card
- Distinct visual styling for each type

### ADMIN-002: Type Filter Functionality
**Purpose**: Test job filtering by question type
**Required Filter Options**:
- "All Jobs" (default)
- "MC Only" (jobs with only multiple choice)
- "FR Only" (jobs with only free response)
- "Mixed (MC + FR)" (jobs with both types)

**Test Steps**:
1. Load admin dashboard
2. Verify filter dropdown exists (`data-testid="select-type-filter"`)
3. Test each filter option
4. Verify jobs list updates correctly

### ADMIN-003: Job Statistics Accuracy
**Purpose**: Verify per-type counts are calculated correctly
```javascript
// Test: Job with 5 MC, 3 FR questions should show:
// multipleChoiceCount: 5
// freeResponseCount: 3  
// Mixed type classification
```

---

## 🗄️ DATABASE INTEGRITY TESTS

### DB-001: Schema Compliance
**Purpose**: Verify discriminated union database schema
```sql
-- PostgreSQL Questions Table Validation
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_name = 'questions' 
AND column_name IN ('type', 'answer_choice', 'answer_text', 'options');

-- Expected:
-- type: NOT NULL varchar
-- answer_choice: NULL varchar (MC only)
-- answer_text: NULL text (FR only)  
-- options: NULL text[] (MC only)
```

### DB-002: Data Integrity Constraints
**Purpose**: Verify discriminated union data integrity
```sql
-- MUST PASS: No records violate discriminated union rules
SELECT id FROM questions WHERE 
  (type = 'mc' AND (answer_choice IS NULL OR options IS NULL OR answer_text IS NOT NULL)) OR
  (type = 'fr' AND (answer_text IS NULL OR answer_choice IS NOT NULL OR options IS NOT NULL));
-- Should return 0 rows
```

### DB-003: Practice Session Storage
**Purpose**: Test SQLite practice tables handle both question types
```sql
-- Test answerAttempts table stores both MC and FR answers
SELECT question_type, user_answer, is_correct 
FROM answerAttempts 
WHERE question_type IN ('mc', 'fr');
```

---

## 🔄 PRACTICE WORKFLOW TESTS

### PRACTICE-001: Session Management
**Purpose**: Test practice sessions handle mixed question types
1. Start practice session: `POST /api/practice/sessions`
2. Verify session includes both MC and FR questions
3. Test answer submission for each type
4. Verify server-side validation responses

### PRACTICE-002: Answer Validation Workflow
**Purpose**: Test FR answer validation is secure and educational
```javascript
// FR Answer Validation Test
POST /api/practice/answer
{
  sessionId: "test-session",
  questionId: "fr-question-123", 
  answer: "Paris"
}

// Expected Response (MUST NOT include correct answer):
{
  isCorrect: true,
  explanation: "Correct! Paris is indeed the capital...",
  // correctAnswer: "Paris" ← MUST BE ABSENT
}
```

### PRACTICE-003: Mixed Question Session
**Purpose**: Test practice sessions with both question types
1. Create session with MC and FR questions
2. Answer MC question (radio button selection)
3. Answer FR question (text input)
4. Verify different validation logic applied
5. Verify progress tracking works for both types

---

## 📝 PDF INGESTION TESTS

### INGEST-001: FR Question Recognition
**Purpose**: Test PDF parser identifies FR questions correctly
- Upload PDF with mixed MC and FR questions
- Verify parser classifies each question type correctly
- Check database storage uses discriminated union schema

### INGEST-002: Processing Pipeline
**Purpose**: Test entire ingestion pipeline handles FR questions
1. Upload PDF with known FR questions
2. Monitor ingestion job progress  
3. Verify per-type metrics in admin dashboard
4. Check questions are queryable by type

### INGEST-003: Validation Error Handling
**Purpose**: Test FR question validation during ingestion
- Test malformed FR questions
- Verify validation error counting
- Check admin dashboard shows validation failures

---

## 🧪 INTEGRATION TESTS

### INT-001: End-to-End FR Workflow
**Purpose**: Complete FR question lifecycle test
1. **Ingest**: Upload PDF with FR questions
2. **Store**: Verify database storage (discriminated union)
3. **Serve**: Fetch FR questions via API (no answer leaking)
4. **Practice**: Attempt FR question in practice mode
5. **Validate**: Submit answer for server-side validation
6. **Report**: Verify admin metrics show FR activity

### INT-002: Security Integration
**Purpose**: Verify security across all FR touchpoints
1. Check all API endpoints never leak FR answers
2. Verify frontend never has access to correct answers
3. Test practice validation is server-side only
4. Confirm admin dashboard shows validation metrics

### INT-003: Type Filtering Integration
**Purpose**: Test filtering works across all components
1. Filter questions by type in API
2. Filter jobs by type in admin dashboard  
3. Filter practice sessions by question type
4. Verify consistent filtering behavior

---

## 🚨 FAILURE CONDITIONS

### When Tests MUST FAIL (indicating FR not properly handled):

1. **Answer Leaking**: Any student-facing endpoint returns `answer_text` 
2. **Type Confusion**: MC validation logic applied to FR questions
3. **Schema Violations**: FR questions stored without `answer_text`
4. **UI Mismatching**: FR questions render radio buttons instead of text input
5. **Filter Failures**: Type filtering returns wrong question types
6. **Metric Inaccuracy**: Admin dashboard counts don't match actual question types
7. **Validation Bypass**: Client-side answer validation accepted for FR questions

---

## 🔧 TEST EXECUTION REQUIREMENTS

### Prerequisites:
- [ ] Backend API accessible (resolve port 5000 conflict)
- [ ] Admin authentication available
- [ ] Database connections established (PostgreSQL + SQLite)
- [ ] Test data: Sample PDFs with known MC and FR questions

### Test Categories by Priority:
1. **🔴 Critical Security** (SEC-001 to SEC-003)
2. **🎯 Type Discrimination** (TYPE-001 to TYPE-003) 
3. **📊 Admin Dashboard** (ADMIN-001 to ADMIN-003)
4. **🗄️ Database Integrity** (DB-001 to DB-003)
5. **🔄 Practice Workflow** (PRACTICE-001 to PRACTICE-003)
6. **🧪 Integration** (INT-001 to INT-003)

### Success Criteria:
- All security tests pass (no answer leaking)
- Discriminated union types work correctly
- Admin dashboard shows per-type metrics and filtering
- Practice workflow handles both question types
- Database maintains data integrity

---

## 📋 CURRENT STATUS

**Backend Status**: ❌ Down (port conflict EADDRINUSE on 5000)  
**Admin Auth**: ❌ Returns 401 Unauthorized  
**Frontend**: ✅ Compiles successfully  
**Type Filtering UI**: ✅ Implemented (Task G complete)  
**Automated Tests**: ❌ Blocked by backend/auth issues  

**Recommendation**: Resolve port conflict and admin authentication to enable comprehensive automated testing.