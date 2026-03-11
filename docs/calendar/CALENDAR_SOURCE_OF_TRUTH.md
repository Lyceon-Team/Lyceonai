# Calendar Source Of Truth

## Canonical Runtime Owner
- Mounted runtime owner: `server/index.ts` mounts `app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter)`.
- Canonical planner logic implementation: `apps/api/src/routes/calendar.ts` (mounted via `server/routes/legacy/calendar.ts` re-export).
- Guardian calendar runtime is read-only and isolated to `server/routes/guardian-routes.ts`.

## Canonical Plan Generator
- Canonical generation endpoint: `POST /api/calendar/generate`.
- Generator computes heuristic `focus` and `tasks` from weakest-skill signals and profile `daily_minutes`.
- Generation uses row-level version bumps (`plan_version`) and preserves user ownership flags.

## Override Semantics
- Manual day edits use `PUT /api/calendar/day/:dayDate`.
- Manual edits set `is_user_override = true`.
- Any day with `is_user_override = true` is frozen against system regeneration paths.
- Explicit single-day regenerate (`POST /api/calendar/day/:dayDate/regenerate` or `/reset`) clears override lock on that one day by writing regenerated output with `is_user_override = false`.

## Auto/Custom Mode Behavior
- Global mode column: `student_study_profile.planner_mode`.
- Allowed values: `auto`, `custom`.
- Mode endpoints:
  - `GET /api/calendar/mode`
  - `PUT /api/calendar/mode`
  - `GET /api/calendar/profile` and `PUT /api/calendar/profile` also include `planner_mode`.
- Auto refresh endpoint: `POST /api/calendar/refresh/auto`.
  - `auto` mode: can regenerate non-overridden days only.
  - `custom` mode: returns suggestions only (`applied: false`) and never auto-applies changes.

## Regeneration Contracts
- Full-range regenerate (`POST /api/calendar/generate` on existing rows):
  - never rewrites overridden days.
  - reports skipped override days.
- Single-day regenerate (`POST /api/calendar/day/:dayDate/regenerate` and `/reset`):
  - recalculates exactly one day.
  - can rewrite an overridden day only because it is explicit student-triggered regeneration.

## Guardian Read-Only Rule
- Guardians are blocked from student calendar write paths by mount-time role guard (`requireStudentOrAdmin`).
- Guardian calendar route (`GET /api/guardian/students/:studentId/calendar/month`) only reads and returns data.
- No guardian calendar write or regenerate endpoint is mounted.

## Entitlement Behavior
- Locked planner write features (full regeneration, auto refresh, single-day regenerate) require active entitlement.
- Loss of entitlement does not delete or mutate existing plan history or override rows.
- Calendar read endpoints remain available so prior history and override state stay visible.

## Deprecated / Quarantined Legacy Paths
- `server/routes/legacy/calendar.ts` is a mount shim only (no planner logic).
- `POST /api/me/mastery/add-to-plan` no longer writes plan rows; it returns suggestions and points canonical writes to `/api/calendar/day/:dayDate`.
- Calendar ownership is centralized under `/api/calendar/*` to avoid dual planner truth.
