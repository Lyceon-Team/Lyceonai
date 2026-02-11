# P00 Exams Current State Audit (Sprint 4)

## 1. Grounding

- Repo root: `/workspace/Lyceonai`
- Branch: `work`
- Git status (at audit run): clean (no staged/unstaged tracked-file deltas before this audit)
- Node: `v22.21.1`
- pnpm: `10.13.1`
- Build: passing
- Tests: passing (`15` files, `151` tests)

## 2. Spec anchors

- PDF-04: Full-Length Exams & Scoring
- PDF-02: Canonical Content / Anti-leak
- PDF-08: Auth / Roles / Entitlements
- PDF-05: Mastery event discipline

> This audit reports **current repository reality** against those locked anchors.

## 3. Current DB reality

### Expected exam-core tables from spec vs actual

Expected (per locked exam spec):
- `test_forms`
- `test_form_items`
- `test_sessions`
- `sat_score_tables` (or equivalent)
- response/attempt tables for full-length exam submissions

Observed in `supabase/migrations`:
- **Not found**: `test_forms`, `test_form_items`, `test_sessions`, `sat_score_tables`
- Exam-adjacent found:
  - `student_question_attempts` (generic attempt log)
  - `diagnostic_sessions`
  - `diagnostic_responses`
  - mastery rollup tables (`student_skill_mastery`, `student_cluster_mastery`)

### Columns / indexes / constraints (current exam-adjacent reality)

- `diagnostic_sessions` includes: `student_id`, `blueprint_version`, `question_ids[]`, `current_index`, `completed_at`, timestamps; with indexes on `(student_id)` and `(student_id, completed_at)`.
- `diagnostic_responses` includes: `session_id`, `question_canonical_id`, `question_index`, `is_correct`, `selected_choice`, `time_spent_ms`, `answered_at`; with unique `(session_id, question_index)` and index on `session_id`.
- `student_question_attempts` includes canonical question id + metadata snapshot (`exam`, `section`, `domain`, `skill`, etc.), `session_id`, correctness, timing.

### RLS policies (current exam-adjacent reality)

- RLS is enabled on:
  - `student_question_attempts`
  - `student_skill_mastery`
  - `student_cluster_mastery`
  - `diagnostic_sessions`
  - `diagnostic_responses`
- Policies are user-owned read/write plus service-role bypass.
- No RLS evidence exists for absent full-length exam tables because those tables do not exist.

### Mismatch vs spec

- Full-length exam schema is **not implemented** in migrations (core exam tables missing).

## 4. Current API reality

### Endpoint map discovered (exam/assessment relevant)

| Method | Path | Handler file | Auth/role gate | Notes |
|---|---|---|---|---|
| POST | `/api/me/mastery/diagnostic/start` | `apps/api/src/routes/diagnostic.ts` (`/start`) | Mounted with `requireSupabaseAuth + requireStudentOrAdmin` in `server/index.ts` | Starts diagnostic session |
| GET | `/api/me/mastery/diagnostic/next` | `apps/api/src/routes/diagnostic.ts` (`/next`) | Same | Returns current diagnostic question |
| POST | `/api/me/mastery/diagnostic/answer` | `apps/api/src/routes/diagnostic.ts` (`/answer`) | Same | Grades answer, updates session, emits mastery update |

### Full-length exam API surface required by spec vs actual

Spec-expected full-length endpoints (start/serve/submit/complete/review gate) were **not found**.

- Search for `api/tests`, `/tests`, `test_sessions`, `test_forms`, `sat_score_tables` in `apps/api/src` returned no matches.
- No Express route group for `/api/tests/*` exists in current server mounting.

### Entitlement and role check locations in current assessment flow

- Diagnostic routes are role-gated by server mount (`requireSupabaseAuth`, `requireStudentOrAdmin`).
- No explicit exam entitlement middleware (`requireEntitlement`/equivalent for full-length exam access) was found in exam-style routes.

## 5. Anti-leak enforcement

### What exists now

- Diagnostic question delivery (`/diagnostic/next`) queries only student-safe fields (no answer choice key or explanation).
- Practice answer validation path (`/api/questions/validate`) conditionally reveals explanation/answer only for admin or verified prior submission.
- Tutor v2 path has explicit scrub behavior (`answer: null`, `explanation: null`) when reveal policy disallows disclosure.

### Spec anti-leak contract vs current behavior

Spec target:
- Pre-submit exam payload: `correct_answer: null`, `explanation: null`
- Post-submit review only after completion gate

Current gaps:
- No full-length exam serve/review pipeline exists to enforce this contract.
- Diagnostic `/answer` currently returns explanation immediately on incorrect response (not a full-length flow, but contrary to strict “no explanation during active test” style behavior).
- Some general question mapping includes `explanation` in student-facing objects (practice context), so anti-leak is mode-dependent today, not globally standardized under a test-session contract.

## 6. Timing model

### Observed timing behavior

- Diagnostic session lifecycle tracks `completed_at` and `current_index`.
- Per-answer timing is captured as `time_spent_ms` on `diagnostic_responses` and `student_question_attempts`.
- No server-authoritative full-length timing model (`started_at` + section clocks + expiry policy) found for exam sessions.

### Late/expiry policy

- No full-length session deadline/expiry policy implementation found (no exam session deadline/timeout write path).
- Diagnostic flow blocks answers once `completed_at` is set, but this is completion-state gating, not a timed full-length policy.

## 7. Scoring pipeline

### Required by spec vs actual

Spec requires raw-by-section, scaled conversion through score tables, and official/diagnostic-labeled breakdowns.

Current state:
- No full-length scoring pipeline modules found (no `test_sessions` scoring, no `sat_score_tables` reads, no conversion table store for full tests).
- Existing scoring-like logic in repo is mastery projection/read models and diagnostic correctness handling, not SAT full-length raw→scaled conversion.

## 8. Mastery integration

### Current event model observed

- `MasteryEventType` enum includes `FULL_LENGTH_SUBMIT`, but there is no discovered runtime full-length exam completion route calling it.
- Diagnostic route emits `DIAGNOSTIC_SUBMIT` via `applyMasteryUpdate`.
- Practice flow uses the same canonical choke-point pattern (from prior Sprint 3 implementation).

### Choke point discipline

- `apps/api/src/services/mastery-write.ts` is explicitly the canonical single write choke point.
- Guard tests exist to prevent direct writes outside that service.

### Practice vs test separation

- Event constants support separation (`PRACTICE_SUBMIT`, `DIAGNOSTIC_SUBMIT`, `FULL_LENGTH_SUBMIT`), but full-length/test submit runtime path is currently absent.

## 9. Test coverage

### Tests found touching relevant areas

- `apps/api/test/mastery-writepaths.guard.test.ts` and `tests/mastery.writepaths.guard.test.ts`: enforce single mastery write path.
- `tests/mastery.true-halflife.edgecases.test.ts`: validates deterministic mastery math / event weighting constants.
- No dedicated full-length exam API test suite found (start/serve/submit/complete/review-gate/scoring).

### What current tests prove

- Mastery write discipline is guarded.
- Mastery constants include weighting for `FULL_LENGTH_SUBMIT`.

### Missing must-have tests (relative to locked exam spec)

- Anti-leak contract tests for full-length pre-submit payload shaping.
- Review-gate tests asserting review allowed only after completed full-length session.
- Idempotency tests for submit endpoints in full-length flow.
- Timing/expiry tests for server-authoritative session clocks.
- Raw→scaled conversion correctness tests against stored SAT score tables.
- Completion emits exactly one mastery event (`test_pass`/`test_fail` or spec-final mapping) via canonical choke point.

## 10. Explicit gaps

1. **Core full-length exam schema missing**: `test_forms`, `test_form_items`, `test_sessions`, score-table store absent.
2. **Full-length API missing**: no `/api/tests/*` equivalent start/serve/submit/complete/review routes.
3. **Canonical anti-leak for test mode not present end-to-end**: no exam session delivery/review gate implementation.
4. **Server-authoritative full-length timing model missing**: no session deadlines/expiry logic for full tests.
5. **Raw→scaled SAT scoring pipeline missing**: no conversion table usage and no full-length score artifact persistence.
6. **Full-length mastery emission path missing**: enum supports it, runtime route does not currently emit on exam completion.
7. **Spec-required full-length acceptance tests missing**.

## 11. Recommended next PR boundaries

- **PR-A (Schema + API scaffolding + anti-leak contract)**
  - Add full-length core tables (`test_forms`, `test_form_items`, `test_sessions`, answer rows, `sat_score_tables`) with RLS.
  - Add `/api/tests` routes for start, serve, submit-answer, complete, and review.
  - Enforce strict anti-leak payload shaping and completion-gated review contract.

- **PR-B (Timing + scoring + mastery completion integration)**
  - Implement server-authoritative timing (start/expiry/late policy).
  - Implement raw→scaled scoring pipeline using stored conversion tables.
  - Emit full-length mastery event through `applyMasteryUpdate` from single completion choke point.

- **PR-C (Validation hardening + tests + proofs)**
  - Add end-to-end tests for anti-leak, review gating, idempotency, timing expiry behavior, scoring correctness, and mastery emission discipline.
  - Add audit/proofs updates and regression guards.
