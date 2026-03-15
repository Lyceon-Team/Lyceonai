# Calendar Runtime Contract

## Canonical Route Mount
- Mount owner: `server/index.ts` -> `app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter)`.
- Canonical implementation: `apps/api/src/routes/calendar.ts`.
- `server/routes/legacy/calendar.ts` is a mount shim only and contains no planner logic.

## Canonical Tables and Flags
- Profile/mode truth: `student_study_profile` (`planner_mode` = `auto | custom`, timezone, defaults).
- Plan-day truth: `student_study_plan_days`.
- Override lock: `student_study_plan_days.is_user_override`.
- KPI counted attempts: `student_question_attempts` filtered by canonical event type allowlist.

## Auth and Role Order
1. `requireSupabaseAuth`
2. `requireStudentOrAdmin`
3. Entitlement checks for premium write actions
4. Input validation
5. Calendar domain logic
6. Response serialization

## Planner Modes
- `auto`: explicit refresh/generation can update only non-overridden days.
- `custom`: auto-refresh never applies writes (`applied: false`) and returns suggestions only.
- Server computes mode and override protections; client claims are not trusted.

## Override Protection Rule
- `PUT /api/calendar/day/:dayDate` writes manual edits and sets `is_user_override = true`.
- Auto-refresh and full-range generation skip overridden days and return skipped day metadata.
- `POST /api/calendar/day/:dayDate/regenerate` and `/reset` explicitly regenerate one day and clear override only for that day (`is_user_override = false`).

## Regenerate and Refresh Semantics
- `POST /api/calendar/generate`: full-range generation; acts as regeneration when rows exist.
- `POST /api/calendar/refresh/auto`: refreshes rolling window in auto mode only; preserves overrides.
- `POST /api/calendar/day/:dayDate/regenerate`: deterministic one-day refresh.
- `POST /api/calendar/day/:dayDate/reset`: alias to one-day refresh behavior.

## Entitlement Behavior
- Premium write features are gated server-side:
  - full regeneration on existing range
  - auto refresh
  - single-day regenerate/reset
- Expired entitlement keeps calendar readable.
- Existing overrides remain preserved when entitlement is inactive.

## Guardian Boundaries
- Guardians are not allowed on `/api/calendar/*` write paths.
- Guardian calendar visibility uses `GET /api/guardian/students/:studentId/calendar/month`.
- Guardian response remains summary/structure only and does not expose mastery internals.

## Observability Events
Best-effort writes to `system_event_logs` (`source = "calendar_planner"`):
- `plan_generated`
- `day_edited`
- `plan_refreshed`
- `override_applied`
- `block_completed` (on session-derived transition into complete)

## Determinism
- Generation is deterministic for a given profile + weakest-skill input set.
- Override days are stable and excluded unless explicitly targeted.
- Custom mode prevents automatic mutation.
