# Guardian Source Of Truth

(updated 2026-10-01, guardian closeout: references to deleted files, helpers and middleware replaced with what exists now.)

## Runtime Owner
- Guardian-only routes (roster, link redeem, unlink): `server/routes/guardian-routes.ts`, mounted at `/api/guardian`.
- Guardian reads of a student's data: `server/routes/student-resources.ts`, mounted at `/api/students`. The same handler serves the student and a linked guardian.
- Mounted owner: `server/index.ts`.

## Relationship Truth
- Canonical guardian/student relationship truth: the `guardian_links` table.
- Read helpers in `server/lib/account.ts`: `getAllGuardianStudentLinks`, `getGuardianLinkForStudent`, `getAnyGuardianLinkForPair`, `getGuardianLinkById`, `getActiveGuardianLinksForStudent`.
- Writes go through audited SQL functions, called from `server/lib/account.ts`:
  - `createActiveGuardianLink` → `public.create_active_guardian_link_audited`
  - `revokeGuardianLink` → `public.revoke_guardian_link_audited`
- Link codes: `server/lib/student-link-code.ts` (issue, read, single-use redeem).

## Access Truth
- One derivation: SQL `public.guardian_view_decision(uuid, uuid)`, executable by `service_role` only.
- Called by `server/services/guardian-subject.ts` (`resolveGuardianViewDecision`), which is called by `resolveSubject` in `server/middleware/subject-resolver.ts`.
- `resolveSubject` puts the subject on `req.subject` (`via: 'self'` or `via: 'guardian'`). Unlinked → 404. Linked but student unentitled → 402.
- Per-feature gate: the `requiresEntitlement` route table in `server/routes/student-resources.ts` (`entitlementGate`), applied to the STUDENT's entitlement.
- Guardian visibility is denied when the link is missing or revoked, or the student's entitlement is inactive.

## Reporting Builders Used By Guardian Reads
- KPI: `server/services/canonical-runtime-views.ts` → `readGuardianKpiOverall` (streak only, SCL-188). `kpi/sections` and `kpi/domains` return empty lists for a guardian.
- Calendar: `server/services/calendar/read-service.ts` → `readGuardianCalendar` (`{ days, facts, streak }`).
- Full-length exam results: `server/services/exam-runtime-service.ts` (`listExamFormsWithCompletion`) and `server/services/exam-report-service.ts` (`readExamReport`), shaped by `toGuardianExamList` / `toGuardianExamReport` in `packages/shared/src/exam-guardian-report-schema.ts`.
- Domain mastery: `apps/api/src/services/mastery-view.ts` → `readDomainMasteryView` (domain grain only). `/mastery/skills` refuses a guardian with 403 (SCL-194).

## Non-Canonical / Disallowed for Guardian Reporting
- Client-side filtering as a security boundary.
- Raw table dumps (`select(*)`) for guardian payloads.
- Student-only write routes (calendar mutation, question submit, review submit).
- Question-level answer/reveal payloads and tutor transcripts.

## Regression Guards
- `tests/ci/guardian-reporting.contract.test.ts`
- `tests/ci/guardian.anti-leak.ci.test.ts`
- `tests/ci/subject-resolver.contract.test.ts`
- `tests/ci/student-resources.contract.test.ts`
- `tests/ci/guardian-denial-sweep.pg.ci.test.ts`
- `tests/ci/guardian-exam-results.handler-pg.ci.test.ts`
- `tests/ci/guardian-link-code.pg.ci.test.ts`
- `tests/ci/guardian-access-audit.pg.ci.test.ts`
