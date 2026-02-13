# Sprint 4 Audit: Full-Length Bluebook-Style Exam Ship Readiness

## 1) Executive Status

**Status: PARTIAL**

The implementation has core pieces in place (authenticated routes, server-side timing checks, deterministic seed-based selection, adaptive thresholds, and a running endpoint test suite), but it is **not yet provably production ship-ready** due to deterministic, code-verifiable gaps in state-machine hardening, idempotency under races, migration/RLS readiness, and CI signal quality.

---

## 2) Invariants (Must-Holds) With Evidence

| Invariant | Verdict | Evidence |
|---|---|---|
| Flow progression implements RW1 -> RW2 -> BREAK -> M1 -> M2 | **PASS (partial path)** | `startExam()` sets `current_section=rw,current_module=1`; `submitModule()` moves module1->module2, RW2->`break`, and `continueFromBreak()` moves to `math` module1. `submitModule()` for math module2 returns `nextModule=null`. `completeExam()` separately marks session completed. Evidence shows progression path exists, but not a strict server-enforced terminal gate sequence. |
| COMPLETE only after M2 submit | **NOT PROVEN / FAIL** | `completeExam()` checks only ownership + not already completed; it does **not** verify current state is Math Module 2 submitted. |
| Server authoritative timing (`time_left_ms` equivalent server-calculated) | **PASS** | Time remaining is calculated server-side from `ends_at` (`calculateTimeRemaining`), returned by `getCurrentSession`, and checked in `submitAnswer()` where expired modules reject with `"Module time has expired"`. |
| Auto-submit behavior for expired modules | **PASS (poll-triggered)** | `getCurrentSession()` auto-calls `submitModule()` if timeRemaining hits 0 and module is `in_progress`; client also auto-submits when timer reaches zero. |
| Deterministic selection with persisted seed | **PASS** | Session stores a generated `seed`, and module selection uses deterministic shuffle with `seed+moduleId+section+moduleIndex`. |
| Module question mapping persisted once started; no randomness after persistence | **NOT PROVEN** | Mapping is inserted into `full_length_exam_questions` at module start, then retrieved by order. However, no DB uniqueness on `(module_id, order_index)` or `(module_id, question_id)` is declared in schema for `full_length_exam_questions`, and start is not transactionally guarded against races. |
| Adaptive thresholds deterministic and documented | **PASS** | Hard thresholds are constants (`rw:18`, `math:15`), and module2 bucket derived with pure function `determineModule2Difficulty`. |
| Module2 bucket assigned exactly once and persisted | **NOT PROVEN / FAIL under repeat race** | First submit updates module2 bucket; but there is no conditional `WHERE difficulty_bucket IS NULL`, no transaction lock, and repeated/racing submits can rewrite bucket before module2 starts. |
| Current-question payload excludes `answer_choice`, `answer_text`, `explanation`, classification/hints | **PASS (for current question path)** | `getCurrentSession()` whitelists question fields to `id, stem, section, type, options, difficulty` only; no answer/explanation/classification selected. |
| Routes do not trust client userId/session ownership | **PASS** | Route handlers pass `req.user.id`; service queries enforce `.eq("user_id", userId)` on session reads. |
| CSRF on all state-changing routes (POST/PATCH/DELETE) | **PASS (for exam router)** | Every exam POST route includes `csrfProtection`; GET current-session does not. |
| Idempotent create-session | **PARTIAL** | Service returns existing active session (`not_started`,`in_progress`) before insert. But there is no DB-level unique/partial index for one-active-session, so concurrent create requests are not strongly prevented. |
| Idempotent submit-answer | **PASS (assuming DB constraint exists)** | `upsert` uses conflict target `session_id,module_id,question_id`; schema declares unique constraint on same columns in `full_length_exam_responses`. |
| Idempotent submit-module / complete | **PARTIAL / FAIL** | `submitModule()` is idempotent only when module already `submitted`; for `completeExam()`, repeated call returns 400 "already completed" rather than idempotent same payload. Also no transaction ensures one-time transition side effects. |
| Error/log leakage avoids sensitive fields | **PARTIAL / FAIL** | Routes log unknown error and return `{ error, message }` where `message` can carry internal backend details from thrown errors. |
| Schema integrity constraints for responses exist | **PASS** | Unique constraint exists for `(session_id,module_id,question_id)` in schema. |
| Schema enforces one-active-session-per-user (if required) | **FAIL** | No such DB constraint/index in `schema.ts`. |
| RLS policies for new tables exist | **NOT PROVEN / FAIL for readiness** | No located migration/policy definitions for `full_length_exam_*` tables in searched migrations/policy files. |
| Migrations for full-length tables exist/applied | **NOT PROVEN / FAIL** | No migration files found containing `full_length_exam_sessions/modules/questions/responses`. |
| CI includes typecheck | **PASS** | `.github/workflows/ci.yml` runs `pnpm exec tsc -p tsconfig.ci.json`. |
| CI includes deterministic targeted exam invariant tests | **FAIL** | CI runs `pnpm test:ci`; no evidence this includes `tests/full-length-exam.ci.test.ts`, and that file itself contains many placeholders `expect(true).toBe(true)`. |
| Resume restores exact answer state after refresh/poll | **PASS** | Server returns `submittedAnswer`; client restores state when question changes and preserves state when same question is re-polled. |
| Multi-tab/retry safety | **PARTIAL / NOT PROVEN** | Some idempotency exists (`createExamSession` soft-idempotent, answer upsert), but no transactional guard/locking for start/submit transitions; race safety not proven. |
| Route registry docs align with mounted routes | **PASS (minor naming mismatch only)** | Registry lists all 7 endpoints and `/full-test`; server mounts router at `/api/full-length`; client uses matching paths. Registry uses `:id` while code uses `:sessionId` (param name mismatch only). |

---

## 3) Prioritized Gap List (Deterministic)

### P0 (Blocker)

1. **`completeExam()` lacks terminal-state guard**
   - **Risk**: exam can be completed from non-terminal state, violating strict state machine.
   - **Fix**: enforce precondition in `completeExam()`:
     - session must be `in_progress`
     - `current_section='math'` and `current_module=2`
     - Math Module 2 status must be `submitted` (or expired+submitted transition).
     - Return 400 on invalid transition.

2. **No migration + RLS plan implemented for `full_length_exam_*` tables**
   - **Risk**: production deploy drift, missing defense-in-depth ownership controls.
   - **Fix**:
     - Add migrations for all four tables + constraints.
     - Enable RLS and add policies:
       - `full_length_exam_sessions`: `user_id = auth.uid()` for SELECT/INSERT/UPDATE/DELETE.
       - `full_length_exam_modules`: allowed via owning session join.
       - `full_length_exam_questions`: allowed via owning module->session join.
       - `full_length_exam_responses`: allowed via `session.user_id = auth.uid()`.
     - Add policy tests (read/write cross-user deny cases).

3. **Potential internal error leakage to clients**
   - **Risk**: backend internals exposed in `message` field.
   - **Fix**: return stable public errors only (no raw internal message), keep detailed error only in server logs with request id.

### P1 (High)

1. **Create-session idempotency not race-safe at DB level**
   - **Fix**: add partial unique index enforcing one active session per user (e.g., unique on `user_id` where status in active states), then handle conflict by selecting existing active row.

2. **Module2 difficulty assignment not single-write guaranteed**
   - **Fix**: update module2 bucket with predicate `difficulty_bucket IS NULL` in same transaction as module1 submit transition; if already set, return stored value.

3. **`startModule` question mapping not protected against concurrent duplicate inserts**
   - **Fix**: add unique constraints on `full_length_exam_questions` (`module_id,order_index` and/or `module_id,question_id`) and perform start in transaction/locking pattern.

4. **CI test quality for exam invariants is weak**
   - **Fix**: move full-length deterministic tests into `tests/ci` or include explicit command in CI; replace placeholder tests with mocked service/router tests.

### P2 (Medium)

1. **Client UX completeness gaps for production parity**
   - Missing review/flag and question navigation grid; no explicit multi-question review UI.
   - Results are correctness summary only; no richer review artifacts.
   - Accessibility/error-state depth is basic (loading/error text present, but no explicit keyboard/ARIA audit evidence).

2. **Strict progression documentation vs implementation mismatch**
   - Break is described as optional in UI text; ensure spec alignment and server documentation for required/optional break semantics.

---

## 4) Proof Appendix (Commands + Key Outputs)

### Discovery and code-location

1. `rg -n "full-length|full_length_exam|fullLengthExam" .`
   - Located implementation/service/routes/tests/docs files including:
     - `apps/api/src/services/fullLengthExam.ts`
     - `server/routes/full-length-exam-routes.ts`
     - `client/src/components/full-length-exam/ExamRunner.tsx`
     - `client/src/pages/full-test.tsx`
     - `shared/schema.ts`
     - `tests/full-length-exam.ci.test.ts`
     - `apps/api/src/services/__tests__/fullLengthExam.test.ts`

2. `nl -ba ... | sed -n ...` (multiple targeted reads)
   - Used to gather exact line evidence for service state machine, route guards, schema constraints, UI behavior, and tests.

### Required checks

3. `pnpm -s run typecheck`
   - Exit code: 1 (script not defined in this repo).

4. `pnpm -s run check`
   - Exit code: 0 (TypeScript check command in this repo).

5. `pnpm test tests/full-length-exam.ci.test.ts`
   - Output summary: `✓ tests/full-length-exam.ci.test.ts (32 tests)` and `32 passed`.
   - Also shows many tests are auth/route-shape and placeholders.

### CI and registry verification

6. `nl -ba server/index.ts | sed -n '450,530p'`
   - Verified router mount at `/api/full-length` with auth/role middleware.

7. `nl -ba shared/schema.ts | sed -n '340,500p'`
   - Verified full-length tables and response unique constraint.

8. `nl -ba .github/workflows/ci.yml | sed -n '1,260p'`
   - Verified CI typecheck step and generic test step.

9. `rg -n "full-length|full_length_exam|fullLengthExam" tests/ci package.json`
   - No direct exam-targeted reference in `tests/ci` scripts.

10. `rg -n "full_length_exam_sessions|full_length_exam_modules|full_length_exam_questions|full_length_exam_responses" migrations database/migrations supabase/migrations`
    - No migration hits found for full-length exam tables in searched migration directories.

---

## Additional Deterministic CI Tests Recommended (No real DB)

1. **Service unit test: `completeExam` guard**
   - Mock session state not at `math/2 submitted`; assert deterministic rejection.

2. **Service unit test: single-write module2 bucket**
   - Mock two submit calls; assert second call does not alter previously persisted bucket.

3. **Service unit test: expired-answer rejection**
   - Mock module with `ends_at < now`; assert `submitAnswer` rejects.

4. **Router test: anti-leak response contract**
   - Mock `getCurrentSession` payload and assert serializer never returns banned fields.

5. **Router test: public error hygiene**
   - Force internal throw and assert response excludes raw internal error text.
