# P00 Mastery Current State Audit (Sprint 3)

## Scope and method

This audit maps persisted mastery state, write paths, read paths, derived computations, diagnostic baseline, weighting/decay logic, tests/guards, and production gaps using only repository evidence and command proofs in `P00_MASTERY_CURRENT_STATE_PROOFS.md`.

---

## 1) Authoritative persisted state (source of truth)

### Authoritative mastery tables

1. `public.student_skill_mastery`
2. `public.student_cluster_mastery`

Both are defined in the original mastery migration and updated by Mastery v1 migration (range conversion to 0–100). Supporting event log table is `public.student_question_attempts`.

### Schema-level facts

- `student_skill_mastery` stores `(user_id, section, domain, skill)` keyed rollups with `attempts`, `correct`, `accuracy`, `mastery_score`, timestamps.
- `student_cluster_mastery` stores `(user_id, structure_cluster_id)` keyed rollups with same rollup fields.
- `mastery_score` columns were migrated from `[0,1]` style to `[0,100]` in `20260210_mastery_v1.sql`.

---

## 2) Canonical write choke point and all write paths

### Canonical choke point (explicit)

- Function: `applyMasteryUpdate(input: AttemptInput)`
- File: `apps/api/src/services/mastery-write.ts`
- Contract comments state this module is the only place allowed to write mastery tables.

### Writes executed by choke point

`applyMasteryUpdate` does three write operations:
1. Insert raw attempt into `student_question_attempts`.
2. RPC call `upsert_skill_mastery(...)` (mutates `student_skill_mastery`).
3. RPC call `upsert_cluster_mastery(...)` (mutates `student_cluster_mastery`).

### Runtime callers of `applyMasteryUpdate`

Observed call sites:
- Practice submit path: `server/routes/practice-canonical.ts` with `eventType: PRACTICE_SUBMIT`.
- Diagnostic answer path: `apps/api/src/routes/diagnostic.ts` with `eventType: DIAGNOSTIC_SUBMIT`.

### Competing or alternate mastery write locations

- None found in app code for direct writes to `student_skill_mastery` / `student_cluster_mastery` outside choke point.
- RPC functions exist at DB layer (`upsert_skill_mastery`, `upsert_cluster_mastery`) and are invoked from the choke point.

---

## 3) Read paths (mastery consumers)

### API read routes

Mounted under authenticated student/admin scope:
- `GET /api/me/mastery/summary`
- `GET /api/me/mastery/skills`
- `GET /api/me/mastery/weakest`
- Diagnostic routes under `/api/me/mastery/diagnostic/*` for session management and answers.

### Read services

- `apps/api/src/services/studentMastery.ts`:
  - `getWeakestSkills` reads `student_skill_mastery`.
  - `getWeakestClusters` reads `student_cluster_mastery`.
  - `getMasterySummary` reads and aggregates `student_skill_mastery`.
- `apps/api/src/routes/mastery.ts` reads `student_skill_mastery`, computes labels/status for response.
- `apps/api/src/routes/progress.ts` reads `student_skill_mastery` for score projection payload.

### Frontend read path

- `client/src/pages/mastery.tsx` queries `['/api/me/mastery/skills']` and renders returned section/domain/skill mastery nodes.

---

## 4) Derived computation map (display/projection only)

### Derived-only module #1

- File: `apps/api/src/services/mastery-projection.ts`
- Allowed behavior: compute decay factor and status labels.
- Explicitly not allowed: write decayed values back to stored `mastery_score`.

Formula present:
- `decay_factor = 0.5 ** (weeks_inactive / HALF_LIFE_WEEKS)`
- `decayed_mastery = stored_mastery * decay_factor`

Status thresholds from constants:
- `weak < 40`, `improving < 70`, else `proficient`; `not_started` when attempts is 0.

### Derived-only module #2

- File: `server/services/score-projection.ts`
- Allowed behavior: derive SAT projection from stored domain mastery.
- Explicitly not allowed: persistence/mutation of mastery tables.

Computation present:
- recency decay: `mastery * (0.95 ^ weeks_inactive)`
- weighted domain contributions by static section/domain weight maps
- confidence/range from attempt count via cube-root variance

### Derived-vs-persisted boundary

- Persisted mastery updates happen via DB RPCs through `applyMasteryUpdate` only.
- Decay and projection are currently read/display computations.

---

## 5) Cold start / diagnostic state (deterministic baseline)

### Is deterministic diagnostic implemented?

Yes.

### Proven facts

- Total question count constant: `DIAGNOSTIC_TOTAL_QUESTIONS = 20`.
- Blueprint version stored: `diag_v1` in both constants and `diagnostic_sessions.blueprint_version` default.
- Session persistence tables exist: `diagnostic_sessions`, `diagnostic_responses`.
- Selection rules in service:
  - split evenly between Math and RW
  - even distribution by domain within each section
  - deterministic order (`domains.sort()`, then question sort by `difficulty_bucket`, `id`)
  - excludes recently attempted questions (lookback days constant)
  - excludes questions used in prior diagnostics
- Scoring route behavior:
  - `/diagnostic/answer` grades answer by question type
  - writes response to `diagnostic_responses`
  - calls `applyMasteryUpdate(... eventType: DIAGNOSTIC_SUBMIT ...)` to initialize/update mastery.

### Where baseline is stored

- Session/question order state: `diagnostic_sessions.question_ids`, `current_index`, `completed_at`.
- Per-question outcomes: `diagnostic_responses`.
- Mastery initialization/update: `student_skill_mastery` + `student_cluster_mastery` through RPC in choke point.

---

## 6) Event weighting and half-life logic (exists vs missing)

### Existing event type set and weights

`MasteryEventType` values and `EVENT_WEIGHTS` constants:
- `PRACTICE_SUBMIT`: `1.00`
- `DIAGNOSTIC_SUBMIT`: `1.25`
- `FULL_LENGTH_SUBMIT`: `1.50`
- `TUTOR_VIEW`: `0.00`
- `TUTOR_RETRY_SUBMIT`: `0.75`

### Existing persistence formula

DB RPCs (`upsert_skill_mastery`, `upsert_cluster_mastery`) apply:
- `delta = sign * base_delta * event_weight * question_weight`
- `M_new = clamp(M_old + ALPHA * delta, 0, 100)`
- cold start `M_old = 50` when missing row.

### Existing half-life/decay logic

Two decay systems exist:
1. `apps/api/src/services/mastery-projection.ts` half-life model using `HALF_LIFE_WEEKS = 6.0` and `0.5 ** (...)`.
2. `server/services/score-projection.ts` weekly decay using fixed `DECAY_RATE = 0.95` and `0.95 ^ weeksInactive`.

### Missing runtime usage for some event types

Repository search shows runtime callers only for:
- `PRACTICE_SUBMIT`
- `DIAGNOSTIC_SUBMIT`

No runtime call site found in app/server routes for:
- `FULL_LENGTH_SUBMIT`
- `TUTOR_VIEW`
- `TUTOR_RETRY_SUBMIT`

(Enums and weights exist, but observed route/service call sites are absent in current scan outputs.)

---

## 7) Guards/tests and enforced invariants

### Enforced invariants

`tests/mastery.writepaths.guard.test.ts` enforces:
1. single choke point module `apps/api/src/services/mastery-write.ts`
2. no mastery-table write patterns outside choke point in scanned app directories
3. no direct `upsert_skill_mastery` / `upsert_cluster_mastery` RPC calls outside choke point

### Current verification status

- Build passed.
- Full test suite passed.
- Guard test is part of suite and currently green.

---

## 8) Production gaps (without changing mastery model)

1. **Unused defined event types in runtime write paths**
   - `FULL_LENGTH_SUBMIT`, `TUTOR_VIEW`, `TUTOR_RETRY_SUBMIT` have constants but no observed runtime call sites.

2. **Two different decay systems coexist**
   - Mastery projection half-life (0.5-based) and score projection 0.95-based decay both exist.
   - No single shared decay primitive is used across projection consumers.

3. **Score projection normalization risk against 0–100 mastery scale**
   - Score projection uses `200 + (600 * mastery)` directly; mastery source now 0–100 in DB migration and mastery routes.
   - No explicit normalization step found in score projection path.

4. **Diagnostic underfill behavior is warning-only**
   - If question bank cannot satisfy 20, service logs warning and proceeds with fewer questions.
   - No hard invariant or fallback selection completion logic currently enforced.

5. **No explicit integration guard that every mastery-mutating route uses `applyMasteryUpdate`**
   - Existing guard enforces table/RPC write patterns but does not assert route-level coverage for every mastery-producing workflow.

---

## 9) Evidence Ledger

| Claim | Type | Primary Evidence | Notes |
|---|---|---|---|
| Authoritative mastery tables are `student_skill_mastery` and `student_cluster_mastery` | Schema | PROOFS: CMD-C2 + migration excerpts | Both tables are explicitly created and updated across migrations. |
| Canonical write choke point is `applyMasteryUpdate` in `mastery-write.ts` | Write | PROOFS: CMD-B6 + file excerpt references | Module comments and implementation align. |
| Choke point writes attempts + skill RPC + cluster RPC | Write | PROOFS: CMD-B1, CMD-B5 + `mastery-write.ts` excerpts | Runtime persistence path is explicit. |
| Practice and diagnostic flows call `applyMasteryUpdate` | Write / Route | PROOFS: CMD-B6 + route excerpts | Event types passed are `PRACTICE_SUBMIT` and `DIAGNOSTIC_SUBMIT`. |
| Read routes for mastery are summary/skills/weakest | Route / Read | PROOFS: CMD-A2 + `apps/api/src/routes/mastery.ts` | Mounted in server index under auth guards. |
| Diagnostic baseline exists and is deterministic | Route / Derived / Schema | PROOFS: CMD-A1, CMD-C2 + diagnostic route/service excerpts | Constants and deterministic selection are in code; persistence tables exist. |
| Event weights are defined for 5 event types | Derived | PROOFS: CMD-A1 + `mastery-constants.ts` excerpt | Static numeric weights are present in constants. |
| Half-life projection exists and is marked non-persistent | Derived | PROOFS: CMD-A1 + `mastery-projection.ts` excerpt | Explicit documentation says projection only. |
| Separate recency decay exists in score projection module | Derived | PROOFS: `server/services/score-projection.ts` excerpt | Uses `DECAY_RATE = 0.95` path. |
| Single choke-point invariant is guarded by tests | Test | PROOFS: `tests/mastery.writepaths.guard.test.ts` excerpt; CMD-PROV-09 | Guard scanning test currently passes. |
| Build and tests are green for this revision | Build / Test | PROOFS: CMD-PROV-08, CMD-PROV-09 | Verified on branch `work` at stated commit. |

---

## 10) Deterministic next PR plan (top 5 gaps)

1. **Wire missing event types into runtime routes/services**
   - Files to change: route/service files handling full-length exam submission and tutor actions (create if absent), plus existing callers.
   - Invariant: every mastery-affecting event must call `applyMasteryUpdate` with explicit `MasteryEventType`.
   - Test: add route-level integration tests asserting event type propagation to choke point.
   - Success criteria: build green, tests green, grep proof shows concrete call sites for all active event types.

2. **Unify decay implementation source for projection paths**
   - Files to change: `server/services/score-projection.ts`, possibly import from `apps/api/src/services/mastery-projection.ts` or shared utility.
   - Invariant: projection decay formula originates from one module/config path.
   - Test: add unit tests asserting same decay output across projection consumers for identical inputs.
   - Success criteria: one formula path in grep; tests verify parity.

3. **Add explicit mastery scale normalization tests in score projection**
   - Files to change: `server/services/score-projection.ts` + new/updated unit tests.
   - Invariant: projection input scale is explicit and covered by tests.
   - Test: numeric fixture tests for mastery values at 0, 50, 100 with expected score bounds.
   - Success criteria: deterministic expected outputs; no out-of-range score behavior.

4. **Enforce diagnostic question-count invariant or deterministic fallback completion**
   - Files to change: `apps/api/src/services/diagnostic-service.ts`.
   - Invariant: diagnostic either (a) deterministically returns exactly 20 questions, or (b) deterministically fails with explicit error and no partial session creation.
   - Test: unit tests for insufficient bank scenario and expected deterministic behavior.
   - Success criteria: no warning-only underfill path without explicit contract.

5. **Add workflow coverage test for mastery-mutating endpoints**
   - Files to change: test suite under `tests/` and/or `apps/api/test/`.
   - Invariant: each mastery-mutating endpoint must transit through `applyMasteryUpdate`.
   - Test: targeted integration tests with spies/mocks around choke point.
   - Success criteria: failing test when any route bypasses choke point; passing in current intended paths.

