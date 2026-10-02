# Guardian Runtime Contract

(updated 2026-10-01, guardian closeout: middleware, endpoints and audit events rewritten to match the code; `requireGuardianEntitlement`, `isGuardianLinkedToStudent` and the `system_event_logs` events no longer exist.)

## Canonical Mounts
- `server/index.ts` mounts `app.use("/api/guardian", requireSupabaseAuth, doubleCsrfProtection, guardianRoutes)`. Route owner: `server/routes/guardian-routes.ts`.
- `server/index.ts` mounts `app.use("/api/students", requireSupabaseAuth, doubleCsrfProtection, studentResourceRoutes)`. Route owner: `server/routes/student-resources.ts`. Guardian reads of a student live here, not under `/api/guardian`.

## Middleware Order
Guardian-only routes (`/api/guardian/*`):
1. `requireSupabaseAuth`
2. `requireGuardianRole` (`server/middleware/guardian-role.ts`; admits `role = 'guardian'` only, admins are refused)
3. route handler (link checks against `guardian_links` inside the handler)

Guardian reads of a student (`/api/students/:studentId/*`):
1. `requireSupabaseAuth`
2. `resolveSubject` (`server/middleware/subject-resolver.ts`) → `server/services/guardian-subject.ts` → SQL `guardian_view_decision(uuid, uuid)`. Sets `req.subject` with `via: 'self'` or `via: 'guardian'`.
3. `entitlementGate` — the `requiresEntitlement` route table in `server/routes/student-resources.ts`, applied to the STUDENT's entitlement.
4. read and server-side projection (the guardian branch is chosen by `subject.via`, never by a client claim).

## Canonical Guardian Endpoints
Guardian-only:
- `GET /api/guardian/students` — roster of linked students
- `POST /api/guardian/link/redeem` — redeem a student's link code
- `DELETE /api/guardian/link/:studentId` — revoke the link

Student resources a linked guardian can read:
- `GET /api/students/:studentId/kpi/overall` — streak only for a guardian (SCL-188)
- `GET /api/students/:studentId/kpi/sections`, `/kpi/domains` — empty lists for a guardian (SCL-188)
- `GET /api/students/:studentId/mastery/domains` — gated on `mastery_detail`
- `GET /api/students/:studentId/calendar` — gated on `calendar_access`
- `GET /api/students/:studentId/tests` — gated on `exam_full_length`
- `GET /api/students/:studentId/tests/:sessionId/report` — gated on `exam_full_length`
- `GET /api/students/:studentId/projections/sections`, `/projections/snapshots`

Refused to a guardian:
- `GET /api/students/:studentId/mastery/skills` — 403 from `requireStudentOrAdmin`, before the resolver (SCL-194)
- the link-lifecycle routes on `/api/students/:studentId/link-code*` and `/links*` — `via === 'self'` only

## Allowed Guardian Payload Categories
- linked student identity summary from the roster
- the student's current streak (`currentStreakDays`)
- domain-grain mastery level per canonical domain
- calendar `{ days, facts, streak }` projection
- full-length exam list and per-attempt report shaped by `packages/shared/src/exam-guardian-report-schema.ts`

## Disallowed Guardian Payload Categories
- question text/options dumps
- correct answers or explanations
- tutor interactions/transcripts
- attempt-level answer history
- skill-level mastery and raw mastery internals (`mastery_score`, delta streams)
- question counts and accuracy from the KPI routes (SCL-188)
- full scoring internals beyond approved summaries

## Entitlement + Link Rule
Guardian access to a student's data requires:
- an authenticated caller, and
- an active `guardian_links` row for the pair, and
- an active student entitlement (both decided by `guardian_view_decision`), and
- for gated routes, the student's feature in the `requiresEntitlement` table.

Denied states fail closed and return no protected payload:
- `404` — not linked (also for a student that does not exist)
- `402` — linked, student unentitled
- `403` — not a guardian on `/api/guardian/*`, or a guardian on `/mastery/skills`
- `400` — `studentId` is not a uuid

## Observability
Guardian audit records are written to `audit_logs`:
- `guardian_subject_access` — every guardian resolution, granted or denied (`server/services/subject-access-audit.ts`). If this write fails, the read is refused with 500.
- `guardian_dashboard_viewed` — written by `GET /api/guardian/students` (`server/routes/guardian-routes.ts`).
- `guardian_link_initiated` and `guardian_link_revoked` — written by SQL `guardian_link_audit`, called inside `create_active_guardian_link_audited` and `revoke_guardian_link_audited`.

Records carry access metadata only (who, whose, which resource, which decision). No student payload.
