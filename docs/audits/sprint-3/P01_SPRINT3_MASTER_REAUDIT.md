# P01 Sprint 3 Mastery Re-Audit

Scope: deterministic repository audit with command-backed findings only.

## A) Provenance + green build/tests
- Repository root resolved to `/workspace/Lyceonai`.
- Current branch resolved to `work`.
- HEAD resolved to `2d9b1c6b687a3a7423f3da9049f96e7d8abc6275` (`2d9b1c6 Merge pull request #70 from Lyceon-Team/copilot/implement-true-half-life-mastery`).
- `node -v` returned `v22.21.1`; `pnpm -v` returned `10.13.1`.
- `pnpm -s run build` exited 0.
- `pnpm -s test` exited 0 with `Test Files  15 passed (15)` and `Tests  151 passed (151)`.

## B) Mastery source of truth (schema + write choke point)
- `supabase/migrations/20260211_mastery_constants.sql` exists and contains `CREATE TABLE IF NOT EXISTS public.mastery_constants`.
- Mastery schema and RPC names are present in migrations: `student_skill_mastery`, `student_cluster_mastery`, `upsert_skill_mastery`, `upsert_cluster_mastery`.
- `applyMasteryUpdate` definition is in `apps/api/src/services/mastery-write.ts`; runtime call sites found in `apps/api/src/routes/diagnostic.ts` and `server/routes/practice-canonical.ts`.
- Direct mastery table writes outside choke point: no matches for direct `.from('student_skill_mastery'| 'student_cluster_mastery').(insert|update|upsert|delete)` in `apps/api/src` and `server/routes`.
- Direct mastery RPC calls in `apps/api/src` and `server/routes`: matches only in `apps/api/src/services/mastery-write.ts` (`upsert_skill_mastery`, `upsert_cluster_mastery`).
- `MasteryEventType` runtime producers found for `PRACTICE_SUBMIT` and `DIAGNOSTIC_SUBMIT`; no route/runtime producer matches for `FULL_LENGTH_SUBMIT` or `TUTOR_RETRY_SUBMIT`.
- `TUTOR_VIEW` appears in constants and in `applyMasteryUpdate` no-op gating (`input.eventType !== MasteryEventType.TUTOR_VIEW`).

## C) True Half-Life persisted in DB
- RPC SQL fetches constants from `public.mastery_constants` via `SELECT ... FROM public.mastery_constants WHERE key = ...` in `20260211_mastery_constants.sql`.
- `server/services/score-projection.ts` contains `normalizeMasteryScore` and no matches for `DECAY_RATE = 0.95`, `0.95 ^`, or `weeksInactive` from the specified grep.
- `apps/api/src/services/mastery-projection.ts` contains `HALF_LIFE_DAYS`.

## D) Mastery scale normalization
- `20260211_mastery_constants.sql` includes comments for conversion to `[0, 100]` mastery scale.
- `server/services/score-projection.ts` includes mastery normalization helper (`normalizeMasteryScore`).

## E) Diagnostic baseline determinism
- `apps/api/src/services/mastery-constants.ts` defines `DIAGNOSTIC_TOTAL_QUESTIONS = 20` and `DIAGNOSTIC_BLUEPRINT_VERSION = 'diag_v1'`.
- `supabase/migrations/20260210_mastery_v1.sql` contains `blueprint_version ... DEFAULT 'diag_v1'`.
- `apps/api/src/services/diagnostic-service.ts` contains deterministic domain ordering (`domains.sort()`), lookback window filtering, and difficulty bucket usage/order.

## F) Edge-case tests
- `tests/mastery.true-halflife.edgecases.test.ts` contains `Deep Freeze`, `Perfect Prodigy`, `Event Weight Bias`, and `Underflow` case labels.
- Global search for `mastery.true-halflife.edgecases` matches test file and prior Sprint 3 audit artifacts.
- `pnpm -s test` run is green with 151 passed tests and no skipped tests reported in summary output.

## DB migration application evidence
- This audit verifies migration file presence and SQL linkage in-repo.
- No Supabase CLI or database schema introspection command output is present in this audit run; therefore no in-environment proof of migration application to an external target database is included in this document.
