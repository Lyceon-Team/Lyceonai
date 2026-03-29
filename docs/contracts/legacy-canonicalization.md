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

### Notification authority note

- Canonical notification creation, suppression, and fanout now live behind the notification authority service.
- Read and mutation routes remain user-scoped and persist through `notifications` plus `user_notification_preferences`.
- Frontend notification polling remains low-noise: load, open, focus, reconnect.

## Compatibility-only (no new runtime ownership)

- Legacy `database/migrations/*` schema artifacts that are not mounted through `server/index.ts`.
- `apps/api/src/routes/diagnostic.ts` and `apps/api/src/services/diagnostic-service.ts` (kept as compatibility code, not mounted).
- `server/routes/legacy/diagnostic.ts` (legacy export shim only).

## Hard-killed

- Diagnostic mounted runtime surface:
  - `/api/me/mastery/diagnostic/*` is terminal-disabled by `runtimeContractDisableMiddleware("diagnostic")`.
- DB cleanup:
  - `public.diagnostic_sessions`
  - `public.diagnostic_responses`

## Remaining legacy family classification

- `accounts` vs `lyceon_accounts`
  - canonical owner: `lyceon_accounts`
  - compatibility owner: none evidenced in the active repo scan
  - new writes already prevented: yes, active account helpers only target `lyceon_*`

- `account_members` vs `lyceon_account_members`
  - canonical owner: `lyceon_account_members`
  - compatibility owner: none evidenced in the active repo scan
  - new writes already prevented: yes, active account helpers only target `lyceon_account_members`

- older `exam_*` vs `full_length_exam_*`
  - canonical owner: `full_length_exam_*`
  - compatibility owner: `exam_attempts` / `exam_sections` in legacy schema and RLS files only
  - new writes already prevented: yes in active app code; legacy definitions remain in historical SQL only

- `chat_messages` vs `tutor_interactions`
  - canonical owner: `tutor_interactions`
  - compatibility owner: `chat_messages` in legacy schema and RLS files only
  - new writes already prevented: yes, active tutor logging writes `tutor_interactions`

- `attempts` vs `answer_attempts` vs `student_question_attempts`
  - canonical owner: split by workflow
  - canonical owner detail: `answer_attempts` is runtime session progression truth for practice session-owned flows
  - canonical owner detail: `student_question_attempts` is longitudinal mastery/KPI truth ledger
  - compatibility owner: `attempts` is legacy-only and not mounted in active runtime routes
  - new writes already prevented: yes, mounted runtime paths write `answer_attempts` / `student_question_attempts`, not `attempts`

- `progress` vs mastery/KPI truth paths
  - canonical owner: `server/routes/legacy/progress.ts` as active runtime mount owner for `/api/progress/*`
  - canonical data owner: persisted KPI truth tables (`student_kpi_counters_current`, `student_kpi_snapshots`, `kpi_constants`)
  - compatibility owner: historical `progress` table assumptions in old docs/scripts only
  - new writes already prevented: yes, mounted runtime path does not write/read a `progress` table for KPI truth
