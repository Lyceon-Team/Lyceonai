# Guardian Runtime Contract

## Canonical Mount
- `server/index.ts` mounts guardian runtime at `app.use("/api/guardian", guardianRoutes)`.
- Canonical route owner: `server/routes/guardian-routes.ts`.

## Middleware Order
Every guardian reporting surface is guarded in this order:
1. `requireSupabaseAuth`
2. `requireGuardianRole`
3. `requireGuardianEntitlement` (where premium-gated)
4. route-level linked-student ownership check (`isGuardianLinkedToStudent`)
5. server-side safe projection

## Canonical Guardian Reporting Endpoints
- `GET /api/guardian/students`
- `GET /api/guardian/students/:studentId/summary`
- `GET /api/guardian/students/:studentId/exams/full-length/:sessionId/report`
- `GET /api/guardian/students/:studentId/calendar/month`
- `GET /api/guardian/weaknesses/:studentId`

## Allowed Guardian Payload Categories
- linked student identity summary (`id`, `displayName`)
- practice/adherence aggregate KPIs
- calendar day status summary (`day_date`, `planned_minutes`, `completed_minutes`, `status`, `attempt_count`, `accuracy`, `avg_seconds_per_question`)
- full-length score summary (`estimatedScore`, KPI explanation metrics)
- weakness rollups (`competency_key`, `section`, `attempts`, `accuracy`, `priority`, `updated_at`)

## Disallowed Guardian Payload Categories
- question text/options dumps
- correct answers or explanations
- tutor interactions/transcripts
- attempt-level answer history
- raw mastery internals (`mastery_score`, delta streams)
- full scoring internals beyond approved summaries

## Entitlement + Link Rule
Guardian reporting access requires:
- guardian role, and
- active guardian/student link, and
- premium visibility allowed by canonical entitlement resolution.

Denied states fail closed with explicit status codes (`403`, `402`, `404`) and do not return protected payloads.

## Observability
Guardian reporting runtime emits safe audit events to `system_event_logs`:
- `guardian_dashboard_viewed`
- `guardian_calendar_viewed`
- `guardian_report_viewed`
- `guardian_access_denied`

Event details include request and routing context only (no protected student payload body).

