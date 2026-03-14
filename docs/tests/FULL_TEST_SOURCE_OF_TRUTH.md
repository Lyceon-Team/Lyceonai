# Full Test Source Of Truth

## Route + Service Ownership
- Route mount: `server/index.ts` -> `/api/full-length`.
- Request guards and response mapping: `server/routes/full-length-exam-routes.ts`.
- Canonical runtime logic: `apps/api/src/services/fullLengthExam.ts`.

## Published Form Lifecycle
1. Form authoring happens in `test_forms` + `test_form_items` while form status is `draft`.
2. Form publish transition sets `status='published'`.
3. Published form and its items are immutable (trigger-enforced).
4. Student session creation only allows published forms.

## Fixed-Order Rule
- Runtime never derives full-test order from random candidate pools.
- Runtime reads stored order from `test_form_items` and persists it to `full_length_exam_questions`.
- Resume/replay uses persisted session rows, so order cannot drift.

## Structural Validation (Fail-Closed)
Session creation fails when:
- form does not exist.
- form is not published.
- form has no items.
- section/module/ordinal data is invalid.
- module ordinals are duplicate or non-contiguous.
- expected per-module counts are incomplete.
- referenced canonical questions are missing, unpublished, unsupported, or section-mismatched.

## Canonical Question Identity
- Source form references are canonical text IDs (`questions.canonical_id`).
- Session materialization stores runtime question UUIDs (`questions.id`) for answer and scoring joins.
- This preserves canonical text identity at form-definition layer and efficient runtime joins at session layer.

## Timing + Lock Source of Truth
- `full_length_exam_modules.started_at/ends_at/submitted_at/status` is timer + lock truth.
- `full_length_exam_sessions` controls current section/module + completion.
- Clients cannot extend timers or reopen locked sections.

## Review + Guardian Gates
- Review unlock only after completed status.
- Active/abandoned sessions remain review-locked.
- Guardian views stay summary-only and never include question-level answer truth.

## Deterministic Scoring and Mastery
- Completion invokes one canonical report/scoring path.
- Modeled score table lookup is deterministic and fail-closed.
- Mastery updates emit deterministic `FULL_LENGTH_SUBMIT` events without duplicate score ledgers.
