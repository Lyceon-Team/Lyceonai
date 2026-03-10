# CANONICAL QUESTION SOURCE OF TRUTH

## Runtime Authority
- Runtime truth is mounted from `server/**`.
- Primary mounts:
  - `server/index.ts` -> `app.use("/api/practice", ..., practiceCanonicalRouter)`
  - `server/index.ts` -> `app.use("/api/full-length", ..., fullLengthExamRouter)`
  - `server/index.ts` -> `app.post("/api/review-errors/attempt", ..., recordReviewErrorAttempt)`

## Canonical ID Format + Helper
- Canonical question IDs must match: `SAT{M|RW}{1|2}[A-Z0-9]{6}`.
- Single helper of truth:
  - `apps/api/src/lib/canonicalId.ts`
  - `generateCanonicalId("SAT", "M" | "RW", "1" | "2")`
  - `isValidCanonicalId(id)`
- `server/services/questionTypes.ts` delegates ID generation to this helper.

## Schema Truth (Runtime Enforced)
- Runtime serving/grading paths enforce MC canonical schema:
  - `type === "mc"`
  - valid `answer_choice`
  - options contain the answer key
  - valid canonical ID format
- Enforced in:
  - `server/routes/practice-canonical.ts`
  - `apps/api/src/lib/question-validation.ts` (admin insert validation)

## Validation Truth Path
- Canonical practice validation path: `POST /api/practice/answer`.
- Review retry validation path: `POST /api/review-errors/attempt`.
- Full-length answer submission path: `POST /api/full-length/sessions/:sessionId/answer`.
- Legacy duplicate `POST /api/questions/validate` is quarantined (not mounted).

## Publish / Version Lifecycle
- Canonical lifecycle policy:
  - canonical ID is immutable and opaque
  - published question content is read-only in runtime behavior
  - fixes require same canonical ID + new version + full QA before re-serve
- Current runtime policy enforcement:
  - active serve/grade paths reject invalid canonical IDs/schemas
  - admin insert smoke path validates canonical format before insert

## Anti-Leak Retrieval Rules
- Pre-submit question retrieval must never leak answer or explanation:
  - `GET /api/practice/next` returns `correct_answer: null`, `explanation: null`
  - full-length active session retrieval omits answer/explanation fields
- Post-submit reveal allowed only in allowed context:
  - practice: `POST /api/practice/answer` may reveal `correctAnswerKey` + `explanation`
  - review retries: `POST /api/review-errors/attempt` may reveal review feedback
- Full-length reveal remains review-phase only:
  - `GET /api/full-length/sessions/:sessionId/review` is locked until completion

## Quarantined Legacy Paths
- Unmounted:
  - `POST /api/questions/validate`
- Legacy code retained but not runtime authority:
  - `server/routes/questions-validate.ts`
  - `apps/api/src/routes/questions.ts` legacy `validateAnswer` export
- Any future reactivation requires explicit contract review and anti-leak test updates.
