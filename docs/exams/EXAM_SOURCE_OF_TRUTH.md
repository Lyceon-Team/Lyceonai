# EXAM SOURCE OF TRUTH

## Scope
Runtime truth anchor for full-length exams is mounted from `server/**` and executed in `apps/api/src/services/fullLengthExam.ts`.

Canonical mount points:
- `server/index.ts` -> `app.use("/api/full-length", requireSupabaseAuth, requireStudentOrAdmin, fullLengthExamRouter)`
- `server/index.ts` -> `app.use("/api/guardian", guardianRoutes)`
- `server/routes/full-length-exam-routes.ts`
- `server/routes/guardian-routes.ts`
- `server/middleware/guardian-entitlement.ts`

## Canonical Runtime Paths
- Session create/start:
  - `POST /api/full-length/sessions`
  - `POST /api/full-length/sessions/:sessionId/start`
- Server-authoritative section timing/state:
  - `GET /api/full-length/sessions/current`
  - `POST /api/full-length/sessions/:sessionId/module/submit`
  - `POST /api/full-length/sessions/:sessionId/break/continue`
- Idempotent answer submission:
  - `POST /api/full-length/sessions/:sessionId/answer`
- Completion + scoring:
  - `POST /api/full-length/sessions/:sessionId/complete`
  - `GET /api/full-length/sessions/:sessionId/report`
- Review unlock:
  - `GET /api/full-length/sessions/:sessionId/review`
- Guardian visibility:
  - `GET /api/guardian/students/:studentId/exams/full-length/:sessionId/report`

## Canonical Scoring Path
Single authoritative computation path:
1. `completeExam()` validates terminal state and marks session completed.
2. `computeAndPersistExamScores()` calls `computeExamScores()` and upserts `full_length_exam_score_rollups`.
3. `computeExamScores()` is the canonical result builder for:
   - raw score (`rawScore`, `rwScore`, `mathScore`, `overallScore`)
   - scaled score (`scaledScore`, `overallScore.scaledTotal`)
   - domain breakdown (`domainBreakdown`)
   - skill diagnostics (`skillDiagnostics`)
4. `getExamReport()` and completed-session idempotent returns also use `computeExamScores()` via `computeCanonicalExamReport()`.
   - **Note**: Runtime returns do NOT read rollups for response shaping; they re-compute the canonical report from raw responses to maintain exact parity with the first-completion result. Rollups are persisted for audit and storage only.

Invariant: raw, scaled, domain, and skill outputs are emitted from the same computation path.

## Completion and Review-Unlock Contract
- Completion is allowed only when:
  - session status is `in_progress`
  - session pointer is `math` module 2
  - math module 2 status is `submitted`
- Review is locked until authoritative completion:
  - `getExamReviewAfterCompletion()` checks session status `completed`
  - non-completed access returns lock error and route maps to `423`
- No answer/explanation leakage during active test:
  - `getCurrentSession()` returns safe question fields only
  - full answer fields are only projected in post-completion review paths

## Guardian Visibility Rule
Guardian exam-report access requires both:
1. Active guardian<->student link (`guardian_links.status = 'active'`)
2. Active student entitlement (paid + active/trialing + not period-expired)

Guardian payment does not create guardian-owned access; visibility is always derived from the linked student's entitlement.

Enforcement stack:
- `requireGuardianEntitlement` gates linked student + entitlement
- Guardian route re-checks explicit link authorization
- Guardian response sanitizes report to summary-only scoring fields (no question-level dumps)

## Downstream Mastery and Planning Integration
- Full-length module submission emits canonical mastery events through `applyMasteryUpdate()` with `MasteryEventType.TEST_PASS or MasteryEventType.TEST_FAIL`.
- Replay/idempotent module submissions (`status === submitted`) do not emit duplicate mastery writes.
- Planning/calendar surfaces consume canonical mastery/study tables downstream:
  - `apps/api/src/routes/calendar.ts`
  - `apps/api/src/routes/mastery.ts`

Deterministic guarantee: downstream planning signals are derived from canonical persisted mastery/study data, not client-side exam scoring state.

## Deprecated or Quarantined Paths
- Quarantined (not mounted runtime review unlock path): direct use of `getExamReview()` without completion gate.
  - Runtime must use `getExamReviewAfterCompletion()` through `/api/full-length/sessions/:sessionId/review`.
- Deprecated scoring fallback pattern (rollup-only response formatting) has been removed from active runtime return paths.
  - Rollups remain persistence/audit storage, not an alternate report-shape source.
