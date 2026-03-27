# Legacy Table/Path Canonicalization

This file captures canonicalization decisions that are enforced by current runtime code.

## Canonical (active runtime read/write)

- `student_question_attempts`
- `student_skill_mastery`
- `student_cluster_mastery`
- `student_study_profile`
- `student_study_plan_days`
- `student_study_plan_tasks`
- `notifications`
- `usage_daily`

## Compatibility-only (no new runtime ownership)

- Legacy `database/migrations/*` schema artifacts that are not mounted through `server/index.ts`.
- `apps/api/src/routes/diagnostic.ts` and `apps/api/src/services/diagnostic-service.ts` (kept as compatibility code, not mounted).

## Hard-killed

- Diagnostic mounted runtime surface:
  - `/api/me/mastery/diagnostic/*` is terminal-disabled by `runtimeContractDisableMiddleware("diagnostic")`.
- DB cleanup:
  - `public.diagnostic_sessions`
  - `public.diagnostic_responses`

