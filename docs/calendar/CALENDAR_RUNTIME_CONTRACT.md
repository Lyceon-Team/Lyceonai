# Calendar Runtime Contract

## Canonical Route Mount
- Mounted owner: `server/index.ts` -> `app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter)`.
- Canonical runtime: `apps/api/src/routes/calendar.ts`.
- `server/routes/legacy/calendar.ts` is a shim-only re-export.

## Canonical Tables
- Planner profile/settings: `student_study_profile`.
- Day header truth: `student_study_plan_days`.
- Task ledger truth: `student_study_plan_tasks`.
- Completion telemetry source: `student_question_attempts` filtered by canonical KPI event taxonomy.

## Handler Order
1. `requireSupabaseAuth`
2. `requireStudentOrAdmin`
3. entitlement check (`resolvePaidKpiAccessForUser`)
4. payload/date validation
5. deterministic planner logic (`apps/api/src/services/calendar-planner.ts`)
6. response serialization

## Entitlement + Role Gates
- Student planner endpoints are premium-gated for both read and write.
- Guardian users are denied on `/api/calendar/*`; guardian calendar access is read-only under `server/routes/guardian-routes.ts`.
- Guardian month view remains summary-only (no student task internals, no mastery internals).

## Mode + Override Truth
- Global mode: `student_study_profile.planner_mode` (`auto` | `custom`).
- Day-level lock: `student_study_plan_days.is_user_override`.
- Task-level ownership: `student_study_plan_tasks.planner_owned` + `is_user_override`.
- Manual day edits always set override and emit `day_edited` + `override_applied`.

## Horizon + Exam-Date Rules
- Default horizon: 28 days.
- Window start is clamped to today.
- If exam date exists and is earlier than horizon end, generation stops at exam date.
- Exam day is flagged via `is_exam_day`; taper day is flagged via `is_taper_day`.

## Refresh / Regenerate Semantics
- `POST /api/calendar/generate`:
  - deterministic generation for window
  - preserves overridden days
  - emits `plan_generated`
- `POST /api/calendar/refresh/auto`:
  - in `auto` mode, recomputes planner-owned non-overridden days only
  - in `custom` mode, returns `applied: false` + suggestions and does not write
  - emits `plan_refreshed`
- `POST /api/calendar/regenerate`:
  - deterministic full rebuild for today-forward window
  - replaces future overridden days
  - emits `plan_generated` with `mode: "regenerate"`
- `POST /api/calendar/day/:dayDate/regenerate`:
  - explicit single-day rebuild
- `POST /api/calendar/day/:dayDate/reset-to-auto`:
  - explicit single-day reset to planner-owned output

## Past-Day Immutability
- Day edits/regenerate/reset reject past dates.
- Generation and refresh are today-forward only.

## Completion Semantics
- Task statuses: `planned | in_progress | completed | skipped | missed`.
- Day status is derived server-side from required tasks:
  - `planned`
  - `partially_completed`
  - `completed`
  - `missed`
- `syncCalendarDayFromSessions` updates `completed_minutes` from `practice_sessions`.
- `block_completed` emits only on threshold crossing to avoid duplicate telemetry.

## Observability Events
Best-effort `system_event_logs` events:
- `plan_generated`
- `day_edited`
- `plan_refreshed`
- `override_applied`
- `block_completed`
