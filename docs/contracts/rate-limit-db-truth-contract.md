# Rate-Limit DB Truth Contract

## Ownership
- Database is the final authority for quota/rate-limit decisions and abuse/cost protection.
- Server owns auth, entitlement checks, request validation, anti-leak behavior, orchestration, and user-facing error shaping.
- No client-trusted limits.
- No duplicate quota logic paths and no bypass path for DB-gated families.
- No new workflow-orchestration RPCs for practice/review/full-length.

## Premium-Required Families
- Premium entitlement is required for:
  - Tutor surfaces
  - Full-length surfaces
  - Calendar surfaces
  - Mastery/KPI premium surfaces
- Mastery is premium-gated but is not usage-rate-limited in this ledger package.

## Canonical DB Objects
- Ledger table: `public.usage_rate_limit_ledger`
- Atomic functions:
  - `public.check_and_reserve_practice_quota(...)`
  - `public.check_and_reserve_full_length_quota(...)`
  - `public.check_and_reserve_tutor_budget(...)`
  - `public.finalize_tutor_usage(...)`
  - `public.check_and_reserve_calendar_quota(...)`

## Enforced Quotas and Budgets
- Practice (free tier only): max `20` served questions in rolling `24h`.
- Full-length: max `2` qualifying starts in rolling `7d`.
- Tutor:
  - density gate + cooldown support
  - token/cost budget gate in rolling `24h`
- Calendar refresh/regeneration mutations:
  - max `3` counted actions in rolling `7d`
  - counted:
    - `calendar_refresh_auto`
    - `calendar_regenerate_full`
    - `calendar_regenerate_day`
  - not counted:
    - calendar reads
    - task edits
    - passive calendar sync from session activity
    - task completion writes
    - reset-to-auto

## Server Integration (No Bypass)
- Practice serve gate:
  - File: [practice-canonical.ts](/C:/Users/14438/projects/Lyceonai/server/routes/practice-canonical.ts)
  - Behavior: reserve before serving newly promoted item; deny on DB reject.
- Full-length start gate:
  - File: [fullLengthExam.ts](/C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts)
  - Behavior: reserve after session insert, before expensive module materialization; delete new session on deny.
- Tutor reserve/finalize:
  - File: [tutor-runtime.ts](/C:/Users/14438/projects/Lyceonai/server/routes/tutor-runtime.ts)
  - Behavior: reserve before RAG/LLM work, finalize on success/failure.
- Calendar mutation gate:
  - File: [calendar.ts](/C:/Users/14438/projects/Lyceonai/apps/api/src/routes/calendar.ts)
  - Applied only to:
    - `POST /refresh/auto`
    - `POST /regenerate`
    - `POST /day/:dayDate/regenerate`

## Canonical Denial Codes
- `PREMIUM_REQUIRED`
- `FULL_LENGTH_QUOTA_EXCEEDED`
- `PRACTICE_FREE_DAILY_QUOTA_EXCEEDED`
- `TUTOR_BUDGET_EXCEEDED`
- `TUTOR_COOLDOWN_ACTIVE`
- `TUTOR_DENSITY_LIMIT_EXCEEDED`
- `CALENDAR_REFRESH_QUOTA_EXCEEDED`
- `RATE_LIMIT_DB_UNAVAILABLE`

## Denial Response Shape
- Premium-required deny (`402`):
  - `code`, `feature`, `reason`, `entitlement { plan, status, currentPeriodEnd }`, `requestId`
- DB quota/budget deny (`402` or `429`):
  - `code`, `limitType`, `current`, `limit`, `remaining`, `resetAt`, `cooldownUntil` (when applicable), `requestId`
- DB gate unavailable (`503`):
  - `code = RATE_LIMIT_DB_UNAVAILABLE`, `message`, `requestId`

## Test Coverage Anchors
- SQL contract: [rate-limit-sql.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/rate-limit-sql.contract.test.ts)
- Practice contract: [practice-contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/practice-contract.test.ts)
- Tutor contract: [tutor.runtime.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/tutor.runtime.contract.test.ts)
- Full-length quota contract: [full-length-quota-denial.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/full-length-quota-denial.contract.test.ts)
- Calendar ownership/quota contract: [calendar.ownership.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/calendar.ownership.contract.test.ts)
- KPI/mastery premium contract: [kpi.gating.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/kpi.gating.contract.test.ts)
