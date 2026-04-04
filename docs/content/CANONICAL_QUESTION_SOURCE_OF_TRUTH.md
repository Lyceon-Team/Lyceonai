# CANONICAL QUESTION SOURCE OF TRUTH

## Runtime Source Of Truth
- Mounted runtime authority is `server/**`.
- Question/review handlers mounted by the production server:
  - `server/index.ts` mounts `/api/questions*` handlers directly from `server/routes/questions-runtime.ts`.
  - `server/index.ts` mounts `/api/practice/*` from `server/routes/practice-canonical.ts`.
  - `server/index.ts` mounts `/api/review-errors/attempt` from `server/routes/review-session-routes.ts` (session-item anchored submit).
  - `server/index.ts` mounts `/api/full-length/*` from `server/routes/full-length-exam-routes.ts`.

## Canonical Tables
- `public.questions`
  - Runtime question source for retrieval, serving, grading, and full-length forms.
- `public.question_versions`
  - Canonical publish/version ledger for immutable published-question history.
- `public.answer_attempts`
  - Practice attempt truth (submit/reveal gating).
- `public.review_error_attempts`
  - Review workflow attempts.
- `public.full_length_exam_*`
  - Full-length session/module/question/response truth.

## Canonical ID Helper
- Canonical ID truth is centralized in:
  - `shared/question-bank-contract.ts`
- Required format:
  - `SAT{M|RW}{1|2}{XXXXXX}`
- Generation rules:
  - Random uppercase alphanumeric suffix length = 6.
  - Assigned only at publish time by `server/services/question-publish.ts`.
  - Collision checked before finalize.

## Canonical Lifecycle
- Lifecycle states: `draft -> qa -> published`.
- Publish/version service:
  - `server/services/question-publish.ts`
  - `publishQuestion(...)`:
    - validates canonical MC schema
    - assigns canonical ID if missing
    - blocks duplicate canonical ID
    - writes published snapshot to `question_versions`
  - `versionPublishedQuestion(...)`:
    - blocks canonical ID mutation
    - increments version
    - transitions edited published item back to `qa`
    - writes version snapshot to `question_versions`

## Anti-Leak Contract
- Pre-submit student-safe retrieval:
  - `server/routes/questions-runtime.ts`
  - `server/routes/practice-topics-routes.ts`
  - `server/routes/practice-canonical.ts` (`/next`, `/sessions/:id/next`)
  - Contract: `correct_answer: null`, `explanation: null` in student-safe payloads.
- Post-submit reveal:
  - `server/routes/practice-canonical.ts` (`POST /api/practice/answer`)
  - Reveal allowed only after valid owned-session submission.
- Full-length review:
  - `apps/api/src/services/fullLengthExam.ts`
  - Pre-completion uses explicit safe field allowlist only.
  - Post-completion adds answer/explanation projection.

## Canonical Schema Contract
- Question type: `multiple_choice` only in active student runtime paths.
- MC options: exactly 4 options, keys `A|B|C|D`, exactly one valid correct answer key.
- Section code canonical target: `M` or `RW`.
  - Compatibility normalization still accepts legacy `MATH` reads where present.
- Published retrieval/serving filters require `status = published`.

## Compatibility + Deprecation Notes
- `server/routes/review-errors-routes.ts` is legacy/unmounted and quarantined from active runtime mount; canonical submit route is `server/routes/review-session-routes.ts`.
- `/api/questions/validate` is intentionally unmounted in runtime (`404` contract).
- Runtime validation/reveal authority is:
  - `POST /api/practice/answer`
  - `POST /api/review-errors/attempt`
  - `POST /api/full-length/sessions/:sessionId/answer`

## Contract Tests
- `tests/ci/questions.anti-leak.ci.test.ts`
- `tests/ci/canonical-content.publish.contract.test.ts`
- `tests/practice.validate.regression.test.ts`
- `tests/ci/practice-contract.test.ts`
- `tests/ci/full-length-review-lock.contract.test.ts`
- `tests/ci/full-length-exam.smoke.test.ts`
