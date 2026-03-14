# FULL TEST SOURCE OF TRUTH

## Scope
Server runtime source of truth for full-length SAT exam flow:
- `server/routes/full-length-exam-routes.ts`
- `apps/api/src/services/fullLengthExam.ts`
- `server/routes/guardian-routes.ts`
- `server/middleware/guardian-entitlement.ts`

## Runtime Scoring Path
1. Session lifecycle
- `POST /api/full-length/sessions` creates or reuses an active session.
- `POST /api/full-length/sessions/:sessionId/start` starts RW module 1.
- `POST /api/full-length/sessions/:sessionId/answer` records idempotent answers.
- `POST /api/full-length/sessions/:sessionId/module/submit` closes a module and sets adaptive module 2 difficulty.
- `POST /api/full-length/sessions/:sessionId/complete` enforces terminal preconditions and marks completion.

2. Score computation
- `completeExam()` calls `computeAndPersistExamScores()`.
- `computeAndPersistExamScores()` calls `computeExamScores()` and upserts `full_length_exam_score_rollups`.
- `computeExamScores()` computes:
  - module and section raw scores
  - deterministic scaled section scores (`calculateScaledScore`)
  - domain breakdown (from question metadata + module question map)
  - skill diagnostics (with performance bands)
- Unanswered module questions are counted as incorrect via `full_length_exam_questions` totals.

3. Reporting surfaces
- Student report: `GET /api/full-length/sessions/:sessionId/report`
- Completion response: `POST /api/full-length/sessions/:sessionId/complete`
- Both return results from `computeCanonicalExamReport()` (re-computation from raw responses, not from rollups) to maintain strict parity. Rollups exist only for persistence/audit.

## Review Unlock Rule
Review is locked until session completion.
- Student review route: `GET /api/full-length/sessions/:sessionId/review`
- Route calls `getExamReviewAfterCompletion()`.
- Non-completed sessions return `423` with `Review locked until completion`.
- During active testing, answer/explanation fields remain unavailable.

## Guardian Visibility Rule
Guardian exam report visibility requires BOTH:
1. Active guardian link to the student (`guardian_links.status = 'active'`)
2. Active premium on the linked pair (student entitlement or guardian entitlement is active/trialing and unexpired)

Enforcement path:
- `GET /api/guardian/students/:studentId/exams/full-length/:sessionId/report`
- `requireGuardianEntitlement` resolves linked-pair access via `resolveLinkedPairPremiumAccessForGuardian(...)`
- Route performs explicit linked-student authorization check and hard-denies unauthorized access (`403`)

## Contract Outputs
Full-test result payload supports:
- Raw score (`rawScore`, plus module-level `rwScore` / `mathScore`)
- Scaled score (`scaledScore` and `overallScore.scaledTotal`)
- Domain breakdown (`domainBreakdown`)
- Skill diagnostics (`skillDiagnostics`)

## Wave 2 Follow-Up Items
1. Persist domain/skill diagnostics in a dedicated rollup table/JSON column to avoid recompute on read and improve auditability.
2. Add an explicit DB schema migration for full-length score rollup shape in `shared/schema.ts` to align typed schema with runtime table usage.
3. Add end-to-end database-backed tests for guardian report retrieval against real RLS policies.
