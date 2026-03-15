# Full Test Runtime Contract

## Canonical Runtime Mount
- `server/index.ts` mounts `fullLengthExamRouter` at `/api/full-length`.
- Canonical handlers: `server/routes/full-length-exam-routes.ts`.
- Canonical domain runtime: `apps/api/src/services/fullLengthExam.ts`.

## Canonical Tables
- `public.test_forms`: immutable published/draft form headers.
- `public.test_form_items`: fixed ordered canonical question references by `(form_id, section, module_index, ordinal)`.
- `public.full_length_exam_sessions`: session state + ownership + timer anchors + bound `client_instance_id`.
- `public.full_length_exam_modules`: per-module lifecycle, lock state, and server timer fields.
- `public.full_length_exam_questions`: materialized fixed module order for each session.
- `public.full_length_exam_responses`: idempotent answer truth.
- `public.full_length_exam_score_rollups`: completion-time score projection.

## Start Session Contract
- Route: `POST /api/full-length/sessions`.
- Input: `test_form_id` (optional UUID), `client_instance_id` (optional UUID).
- Runtime behavior:
  - checks auth + ownership and active-session replay rules.
  - enforces `test_form_id` exists and `status='published'`.
  - when `test_form_id` omitted, resolves latest published form.
  - loads canonical ordered items from `test_form_items`.
  - validates structural completeness/contiguity; fail-closed on invalid form.
  - materializes fixed order into `full_length_exam_questions` exactly once.

## Timing / Lock Contract
- Timers are server-derived from module/session timestamps.
- Module transitions and lock states are server-only.
- Expired modules auto-submit and reject additional mutation.
- Section submit and completion remain idempotent and deterministic.

## Anti-Leak Contract
- Active exam payloads do not include `correct_answer` or `explanation`.
- Review stays locked until session `status='completed'`.
- Review endpoint is read-only after completion.

## Full-Test Ordering Contract
- Published forms are immutable.
- Question order is fixed by `test_form_items.section + module_index + ordinal`.
- Full-test runtime never reshuffles published form items.
- Client-provided order is ignored.

## Canonical Question-ID Contract
- `test_form_items.question_id` stores canonical text IDs (`questions.canonical_id`).
- Runtime resolves canonical IDs to `questions.id` before session materialization.
- Runtime fails closed on missing/unpublished/section-mismatched question references.

## Idempotency + Client Instance Contract
- Session creation replays one active session per user.
- Bound `client_instance_id` prevents cross-tab/cross-client mutation.
- Answer submission is idempotent per `(session_id, module_id, question_id)`.

## Guardian Visibility Contract
- Guardian full-test endpoints are summary-only with link + entitlement checks.
- No question-level answer dump for guardians.

## Scoring Contract
- One canonical scoring path: `computeCanonicalExamReport()`.
- Scaled scores come from modeled score tables.
- Missing/inconsistent tables fail closed.
- Official scores and diagnostic signals remain separated.
