# Legacy Table/Path Canonicalization

This file captures canonicalization decisions that are enforced by current runtime code.

## Canonical (active runtime read/write)

- `student_kpi_rollups_current`
- `student_skill_mastery`
- `student_domain_mastery`
- `student_section_projections`
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

## Remaining legacy family classification

| legacy_family | canonical_owner | compatibility_owner | no_new_writes | runtime_status |
|---|---|---|---|---|
| `accounts` vs `lyceon_accounts` | `lyceon_accounts` | none evidenced in active repo scan | yes | canonical |
| `account_members` vs `lyceon_account_members` | `lyceon_account_members` | none evidenced in active repo scan | yes | canonical |
| older `exam_*` vs `full_length_exam_*` | `full_length_exam_*` | `exam_attempts` / `exam_sections` in legacy schema + RLS only | yes | compat-only |
| `chat_messages` vs `tutor_interactions` | `tutor_interactions` | `chat_messages` in legacy schema + RLS only | yes | compat-only |
| legacy `attempts` vs canonical attempts | `practice_session_items` | `answer_attempts` (compat-only) + `attempts` (legacy-only) | yes | canonical |
| `progress` vs mastery/KPI truth paths | `server/routes/legacy/progress.ts` (route) + KPI truth tables | historical `progress` table assumptions only | yes | canonical |

### Attempts family note

- Forbidden legacy table: `attempts` (legacy-only, no runtime ownership).
- Canonical practice truth table: `practice_session_items`.
- Compatibility-only: `answer_attempts`.
