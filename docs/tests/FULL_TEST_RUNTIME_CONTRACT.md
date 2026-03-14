# Full Test Runtime Contract

## Canonical Runtime
- Route mount: `server/index.ts` mounts `fullLengthExamRouter` at `/api/full-length`.
- Canonical route handlers: `server/routes/full-length-exam-routes.ts`.
- Canonical domain logic: `apps/api/src/services/fullLengthExam.ts`.

## Canonical Tables
- `full_length_exam_sessions`: authoritative exam-session header state, ownership, client instance, and timing anchors.
- `full_length_exam_modules`: authoritative module lifecycle and module timer lock state.
- `full_length_exam_questions`: immutable served order for each module in a session.
- `full_length_exam_responses`: idempotent answer truth per `(session_id, module_id, question_id)`.
- `full_length_exam_score_rollups`: completion-time score rollup projection.

## Route Contract
- `POST /api/full-length/sessions`
  - Creates or replays one active session for the authenticated student.
  - Enforces supported `test_form_id` and binds `client_instance_id`.
- `GET /api/full-length/sessions/current?sessionId=...&client_instance_id=...`
  - Returns authoritative resume state from server-owned timers and module/session truth.
- `POST /api/full-length/sessions/:sessionId/start`
- `POST /api/full-length/sessions/:sessionId/answer`
- `POST /api/full-length/sessions/:sessionId/module/submit`
- `POST /api/full-length/sessions/:sessionId/break/continue`
- `POST /api/full-length/sessions/:sessionId/complete`
- `GET /api/full-length/sessions/:sessionId/report`
- `GET /api/full-length/sessions/:sessionId/review`

## Session State Machine
- Session lifecycle: `not_started -> in_progress -> completed`.
- Terminal non-complete branch: `abandoned` only.
- Break is represented by `current_section = 'break'` with `status = 'in_progress'`.

## Timer + Lock Semantics
- Module timers are server-owned via `full_length_exam_modules.started_at` and `ends_at`.
- Break timer is server-owned via `full_length_exam_sessions.break_started_at`.
- Expired modules auto-submit on resume/read and are denied for answer mutation.
- Submitted modules are locked and read-only for answers.

## Anti-Leak Contract
- Active exam payloads never include `correct_answer` or `explanation`.
- Review endpoints remain locked until session `status = 'completed'`.
- Post-completion review reveals full answer/explanation fields through allowlisted projection.

## Multi-Tab Contract (`client_instance_id`)
- Session writes are bound to one `client_instance_id`.
- Same client instance may replay/resume safely.
- Different or missing client instance on a bound active session fails with deterministic conflict.

## Idempotency Contract
- Session creation is replay-safe and returns the same active session.
- Answer submission is idempotent per `(session, module, question)`; first write wins.
- Completion is idempotent; replay recomputes canonical report without duplicate state mutation.

## Scoring Contract
- One canonical scoring path: `computeCanonicalExamReport()` in `fullLengthExam.ts`.
- Section scaled scores use modeled score tables from `fullLengthScoreTables.ts`.
- Missing or inconsistent score-table totals fail closed.
- `total scaled = rw scaled + math scaled`.
- Domain/skill diagnostics are derived deterministically from response + metadata rows.

## Mastery + Guardian Semantics
- Module submit emits canonical mastery updates via `applyMasteryUpdate()` with `FULL_LENGTH_SUBMIT`.
- Guardian full-length visibility is summary-only via `server/routes/guardian-routes.ts` and entitlement/link guards.
- Guardian routes never expose question-level answer dumps.

## Observability Events
- Canonical events emitted by full-length service:
  - `test_started`
  - `section_started`
  - `answer_submitted`
  - `test_completed`
  - `score_computed`

## Deferred / Out of Scope
- Published-form table management (draft/published form authoring lifecycle) is not present in this runtime.
- Runtime enforces a single supported canonical form id while preserving existing active mount behavior.
