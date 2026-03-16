# Calendar Source Of Truth

## Canonical Runtime Owners
- Student planner runtime: `apps/api/src/routes/calendar.ts`.
- Deterministic planner engine: `apps/api/src/services/calendar-planner.ts`.
- Guardian read-only calendar: `server/routes/guardian-routes.ts` (`GET /api/guardian/students/:studentId/calendar/month`).

## Canonical Planner State
- `student_study_profile`:
  - `planner_mode`
  - `daily_minutes`
  - `exam_date`
  - `full_test_cadence`
  - `preferred_study_days`
  - timezone
- `student_study_plan_days`:
  - day header, override, status, generation source, exam/taper/full-test flags
- `student_study_plan_tasks`:
  - ordered task ledger (`ordinal`)
  - task type, section, duration
  - source metadata and status
  - planner-owned vs user-owned ownership

## Deterministic Planning Inputs
- Mastery-derived skill signals (`skill_mastery`).
- Attempt recency/miss patterns (`student_question_attempts`).
- Existing plan/task history for suppression/rotation and cadence stability.
- Profile settings from `student_study_profile`.
- No LLM/AI planner path is used in runtime generation.

## Non-Negotiable Ownership Rules
- Student is the only planner writer.
- Guardian is read-only and summary-safe.
- Client cannot author override truth, planner mode truth, or completion truth.
- Day/task mutation rights are server-enforced by role + entitlement + ownership checks.

## Regeneration Rules
- Refresh (`/refresh/auto`) preserves overrides.
- Regenerate (`/regenerate`) replaces future overrides.
- Single-day regenerate/reset operates only on targeted day.
- Past days are immutable.

## Entitlement Rules
- Calendar endpoints under `/api/calendar/*` require active paid entitlement.
- Entitlement failure is explicit (`402` with `CALENDAR_PREMIUM_REQUIRED`).
- Guardian month view is separately entitlement-gated by guardian middleware.

## Telemetry Source Of Truth
- Planner telemetry is emitted only from calendar runtime into `system_event_logs`.
- Canonical event set:
  - `plan_generated`
  - `day_edited`
  - `plan_refreshed`
  - `override_applied`
  - `block_completed`

## De-duplicated Runtime Path
- `server/routes/legacy/calendar.ts` remains mount shim only.
- No alternate active planner runtime remains in `server/**` for student calendar writes.

## Validation (CAL1)
```bash
corepack pnpm -s exec tsc -p tsconfig.ci.json
npx vitest run tests/ci/calendar.ownership.contract.test.ts tests/ci/guardian-reporting.contract.test.ts tests/review-outcomes.kpi-calendar.contract.test.ts --reporter=dot --silent
rg -n "calendarRouter|/api/calendar|student_study_plan_tasks" server apps/api/src/routes apps/api/src/services
```
