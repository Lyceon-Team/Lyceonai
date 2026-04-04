# Full-Length Deferred Adaptive Smoke (Hard-Kill Remains)

Purpose: smoke plan to prove deferred adaptive materialization (RW2/Math2) from persisted module-1 outcomes.

Scope: UI trigger, backend routes, and DB persistence for canonical full-length runtime.

Hard gates:
- Session start materializes only RW1 + Math1 items.
- RW2 + Math2 items are materialized only after module-1 outcomes are persisted.
- Runtime reads only persisted `full_length_exam_*` tables.

## Runtime route map
- POST `/api/full-length/sessions` (create)
- POST `/api/full-length/sessions/:sessionId/start` (start)
- POST `/api/full-length/sessions/:sessionId/answer` (submit answer)
- POST `/api/full-length/sessions/:sessionId/module/submit` (submit module)
- POST `/api/full-length/sessions/:sessionId/complete` (complete)
- GET `/api/full-length/sessions/:sessionId/report` (report)
- GET `/api/full-length/sessions/:sessionId/review` (review)

## Smoke sequence (record evidence)
1. **Create session**
   - API: POST `/api/full-length/sessions`.
   - Evidence: `sessionId`, `requestId`, response status.
   - DB: `SELECT id, status FROM full_length_exam_sessions WHERE id = '<sessionId>';`

2. **Modules created (4 total)**
   - DB: `SELECT id, section, module_index, status FROM full_length_exam_modules WHERE session_id = '<sessionId>' ORDER BY section, module_index;`
   - Evidence: 4 rows (RW1/RW2/Math1/Math2).

3. **At start: only module-1 items**
   - DB:
     - `SELECT m.section, m.module_index, count(q.id) AS question_count
        FROM full_length_exam_modules m
        LEFT JOIN full_length_exam_questions q ON q.module_id = m.id
        WHERE m.session_id = '<sessionId>'
        GROUP BY m.section, m.module_index
        ORDER BY m.section, m.module_index;`
   - Gate: module_index=1 has rows; module_index=2 has zero rows.

4. **Complete RW1**
   - API: answer RW1, then POST `/api/full-length/sessions/:sessionId/module/submit`.
   - Evidence: RW1 module marked submitted; RW2 `difficulty_bucket` persisted.
   - DB:
     - `SELECT status, submitted_at FROM full_length_exam_modules WHERE session_id = '<sessionId>' AND section = 'Reading and Writing' AND module_index = 1;`
     - `SELECT difficulty_bucket FROM full_length_exam_modules WHERE session_id = '<sessionId>' AND section = 'Reading and Writing' AND module_index = 2;`

5. **RW2 materializes after RW1 outcome**
   - DB: `SELECT count(*) FROM full_length_exam_questions q JOIN full_length_exam_modules m ON q.module_id = m.id WHERE m.session_id = '<sessionId>' AND m.section = 'Reading and Writing' AND m.module_index = 2;`
   - Gate: count > 0 only after RW1 submit.

6. **Complete Math1**
   - Same as RW1, then verify Math2 `difficulty_bucket` and materialization.

7. **Resume + runtime read safety**
   - Evidence: serve/resume/grading/review all read persisted `full_length_exam_*` tables.
   - Guard: no runtime reads from raw `questions` after any module materializes.

## Evidence template
```
Date:
Environment:
User:
SessionId:

1) Create session
- requestId:
- status:

2) Modules (4 total)
- rows:

3) Start-only module-1 items
- RW1 count:
- RW2 count:
- Math1 count:
- Math2 count:

4) RW1 complete -> RW2 bucket
- RW1 submitted_at:
- RW2 difficulty_bucket:

5) RW2 materialized
- RW2 question count:

6) Math1 complete -> Math2 bucket
- Math1 submitted_at:
- Math2 difficulty_bucket:

7) Math2 materialized
- Math2 question count:

8) Raw-bank guard
- evidence source:
- questions table reads after materialization: none
```
