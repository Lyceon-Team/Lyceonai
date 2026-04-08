# Rate-Limit DB Truth Contract

## Ownership
- Database is the final authority for quota/rate-limit decisions.
- Server owns auth, role/entitlement gating, request validation, anti-leak behavior, and user-facing error shaping.
- No client-trusted limits.
- No alternate quota path is permitted for practice, full-length, or tutor.

## Canonical DB Objects
- Ledger table: `public.usage_rate_limit_ledger`
- Atomic gate functions:
  - `public.check_and_reserve_practice_quota(...)`
  - `public.check_and_reserve_full_length_quota(...)`
  - `public.check_and_reserve_tutor_budget(...)`
  - `public.finalize_tutor_usage(...)`

## Enforced Limits
- Practice (free tier only): max `20` served questions in rolling `24h`.
- Full-length: max `2` qualifying starts in rolling `7d`.
- Tutor:
  - density gate (global + session-context density window)
  - token/cost budget gate (rolling `24h`)
  - cooldown support via `cooldown_until`

## Server Integration Points (No Bypass)
- Practice serve gate:
  - File: [practice-canonical.ts](/C:/Users/14438/projects/Lyceonai/server/routes/practice-canonical.ts)
  - Location: `serveNextForSession(...)` before final response for a newly promoted queued item.
  - Behavior: on deny -> revert item back to `queued`, return structured denial.
- Full-length start gate:
  - File: [fullLengthExam.ts](/C:/Users/14438/projects/Lyceonai/apps/api/src/services/fullLengthExam.ts)
  - Location: `createExamSession(...)` after session insert, before module materialization.
  - Behavior: on deny -> delete newly created session row, throw structured quota error.
- Tutor gate/finalize:
  - File: [tutor-v2.ts](/C:/Users/14438/projects/Lyceonai/server/routes/tutor-v2.ts)
  - Location: `POST /api/tutor/v2` before RAG/LLM work and finalize after completion/failure.
  - Behavior: reserve first, finalize on success/failure with token/cost accounting.

## Error Contract
- Practice deny: `402`, code `PRACTICE_QUOTA_EXCEEDED`
- Full-length deny: `402`, code `FULL_LENGTH_QUOTA_EXCEEDED`
- Tutor density/cooldown deny: `429`, codes `TUTOR_DENSITY_EXCEEDED`, `TUTOR_SESSION_DENSITY_EXCEEDED`, `TUTOR_COOLDOWN_ACTIVE`
- Tutor budget deny: `402`, code `TUTOR_BUDGET_EXCEEDED`
- DB gate unavailable: `503`, code `RATE_LIMIT_DB_UNAVAILABLE`

Each denial response includes stable fields:
- `code`
- `limitType`
- `current`
- `limit`
- `remaining`
- `resetAt`
- `cooldownUntil` (when applicable)
- `requestId`

## Test Coverage
- SQL contract assertions (rolling windows, atomic lock, dedupe): [rate-limit-sql.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/rate-limit-sql.contract.test.ts)
- Tutor server denial + reservation finalization: [tutor.runtime.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/tutor.runtime.contract.test.ts)
- Full-length server denial shape: [full-length-quota-denial.contract.test.ts](/C:/Users/14438/projects/Lyceonai/tests/ci/full-length-quota-denial.contract.test.ts)

