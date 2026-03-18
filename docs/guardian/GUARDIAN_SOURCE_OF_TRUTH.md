# Guardian Source Of Truth

## Runtime Owner
- Guardian runtime and reporting source of truth: `server/routes/guardian-routes.ts`.
- Mounted owner: `server/index.ts`.

## Relationship Truth
- Canonical guardian/student relationship truth: `guardian_links` via `server/lib/account.ts` helpers:
  - `isGuardianLinkedToStudent`
  - `getAllGuardianStudentLinks`
  - `createGuardianLink`
  - `revokeGuardianLink`

## Entitlement Truth
- Canonical premium visibility gate: `server/middleware/guardian-entitlement.ts` using linked-pair resolution from `server/lib/account.ts`.
- Guardian visibility is denied when link is missing/revoked or linked-pair entitlement is inactive.

## Reporting Builders Used By Guardian Runtime
- Practice summary projection: `server/services/kpi-truth-layer.ts`
  - `buildCanonicalPracticeKpiSnapshot`
  - `buildStudentKpiView` (guardian uses filtered shared weekly metrics only)
- Calendar month projection:
  - `apps/api/src/services/calendar-month-view.ts` -> `buildCalendarMonthView(userId, start, end, timezone)`
  - guardian route only applies entitlement/link checks and visibility filtering of returned day fields
- Full-length report summary projection:
  - `apps/api/src/services/fullLengthExam.ts` (`getExamReport`) + guardian-safe transform in `server/routes/guardian-routes.ts`
- Weakness rollup source:
  - `apps/api/src/services/mastery-derived.ts` (`getDerivedWeaknessSignals`) + guardian-safe projection in `server/routes/guardian-routes.ts`

## Non-Canonical / Disallowed for Guardian Reporting
- Client-side filtering as a security boundary.
- Raw table dumps (`select(*)`) for guardian payloads.
- Student-only write routes (calendar mutation, question submit, review submit).
- Question-level answer/reveal payloads and tutor transcripts.

## Regression Guards
- `tests/ci/guardian-reporting.contract.test.ts`
- `tests/ci/guardian.anti-leak.ci.test.ts`
- `tests/ci/guardian-full-length-report.contract.test.ts`
- `tests/ci/guardian-linking.contract.test.ts`

