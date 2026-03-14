# KPI Source of Truth

## Canonical Runtime Model
- Canonical KPI generation layer: `server/services/kpi-truth-layer.ts`.
- Canonical student KPI snapshot builder: `buildCanonicalPracticeKpiSnapshot(userId)`.
- Canonical student KPI projection: `buildStudentKpiView(snapshot, includeHistoricalTrends)`.
- Canonical guardian KPI projection: `buildGuardianSummaryKpiView(snapshot)`.
- Canonical full-test KPI semantics: `buildFullTestKpis(...)` + `fullTestMeasurementModel()`.
- Runtime mounts:
  - `GET /api/progress/kpis` -> `server/routes/legacy/progress.ts`.
  - `server/routes/legacy/progress.ts` is intentionally active runtime code despite its file path name.
  - `GET /api/progress/projection` -> `server/routes/legacy/progress.ts`.
  - `GET /api/guardian/students/:studentId/summary` -> `server/routes/guardian-routes.ts`.
  - `GET /api/full-length/sessions/:sessionId/report` -> `server/routes/full-length-exam-routes.ts`.
  - `GET /api/guardian/students/:studentId/exams/full-length/:sessionId/report` -> `server/routes/guardian-routes.ts`.
  - `GET /api/admin/kpis/student/:studentId` -> `server/routes/admin-stats-routes.ts`.

## Segmentation Rules
- Student view:
  - Receives student KPI snapshot and, when entitled, historical trend surface (`recency`).
  - Receives full test analytics only through premium-gated report route.
- Guardian view:
  - Receives linked-student summary metrics only.
  - Receives guardian-safe full-test report (estimated scaled scores + explained KPI list).
  - Never receives question-level dumps, tutor interactions, mastery scores, or raw delta payloads.
- Internal/admin view:
  - Receives canonical student KPI snapshot through `/api/admin/kpis/student/:studentId`.
  - Admin bypasses paid gating and can inspect full canonical KPI payload.

## Gating Rules
- Premium KPI surfaces (explicit):
  - `mastery_hexagon`: `GET /api/me/mastery/skills`.
  - `historical_trends`: `GET /api/progress/kpis` (`recency` is removed for free tier).
  - `full_test_analytics`: `GET /api/full-length/sessions/:sessionId/report`.
- Entitlement resolver: `server/services/kpi-access.ts`.
- Guardians require active link + linked-pair premium via `requireGuardianEntitlement` (student data remains student-derived).
- Admin role bypasses entitlement gating.

## Measurement Separation Contract
- `official` metrics: externally issued scores only; not produced by Lyceon runtime.
- `weighted` metrics: deterministic transformed estimates (for example scaled estimates).
- `diagnostic` metrics: raw/behavioral study performance indicators.
- Every KPI response with user-facing metrics includes `measurementModel` with disjoint arrays (`official`, `weighted`, `diagnostic`).
- Rule: no metric id may appear in more than one measurement class.

## Explanation Contract
Every user-facing KPI metric must include deterministic rule-based text:
- `whatThisMeans`
- `whyThisChanged`
- `whatToDoNext`
- `ruleId`

No LLM-generated KPI explanations are used in runtime responses.

## KPI to Action Mapping
- `week_sessions` -> Add/maintain session cadence.
- `week_questions` -> Increase controlled volume with fixed review time.
- `week_accuracy` -> Shift next block to weakest skill remediation.
- `week_minutes` -> Increase or stabilize total focused time.
- `recency_accuracy` -> Use error tags to choose next drill set.
- `recency_pace` -> Apply pacing strategy (two-pass timing, timed sets).
- `estimated_scaled_total` -> Prioritize lower section for next study cycle.
- `estimated_scaled_rw` -> Allocate next sessions to RW weak domains.
- `estimated_scaled_math` -> Allocate next sessions to Math weak domains.
- `diagnostic_accuracy` -> Build corrective set from miss patterns.

## Deprecated or Conflicting Legacy Paths
- Deprecated active KPI computation duplication removed:
  - Guardian summary no longer computes its own ad hoc KPI math from `answer_attempts` + `question_ids`.
  - Student and guardian summaries now derive from `buildCanonicalPracticeKpiSnapshot`.
- Legacy/misaligned field usage retired from active KPI path:
  - `student_question_attempts.answered_at` reference (non-canonical timestamp name) is not used in canonical KPI route.
- Guardian weakness payload no longer includes `mastery_score`.

## Evidence Anchors
- `server/services/kpi-truth-layer.ts`
- `server/services/kpi-access.ts`
- `server/routes/legacy/progress.ts`
- `server/routes/guardian-routes.ts`
- `server/routes/full-length-exam-routes.ts`
- `server/routes/admin-stats-routes.ts`
- `apps/api/src/routes/mastery.ts`



