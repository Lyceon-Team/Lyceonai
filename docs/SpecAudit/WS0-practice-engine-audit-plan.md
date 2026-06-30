# WS-0 Practice Engine Audit Plan

**Spec authority:** Doc 02B Runtime Engines V4 §14–§15, §20, §22–§23, §25, §33; Doc 02 Preamble V3 §12  
**Canonical writer:** `server/routes/practice-canonical.ts`  
**Shared serializer:** `shared/question-bank-contract.ts` → `projectStudentSafeQuestion()`  
**Mastery seam:** `apps/api/src/services/mastery-write.ts` → `applyMasteryEvent()`  
**Quota:** `apps/api/src/lib/rate-limit-ledger.ts` → `checkAndReservePracticeQuota()`  
**DB schema:** `supabase/migrations/20260610020000_ws2_practice_review_runtime.sql`, `20260610000000_ws2_config_constants.sql`  
**Date:** 2026-06-27  

---

## 0. Architecture Confirmation

**Question from task brief: Is TS-resident practice runtime the intended 02B architecture, or does 02B mandate any practice logic in DB?**

**Answer: TS is correct.** Doc 02B §14 states `practice-canonical.ts` is the canonical writer. Practice session lifecycle, item selection, answer evaluation, and session state transitions all live in TS—this is session orchestration, not formula math. The only DB-resident logic is:
- `check_and_reserve_practice_quota` RPC (quota counting, correctly DB-side)
- `apply_mastery_event` RPC (mastery math, correctly DB-side per INV-02B-06)

Practice has no equivalent of mastery's PL/pgSQL formula engine. The TS-layer architecture is legitimate and spec-compliant.

---

## 1. Anti-Leak Proof Table (CRITICAL #1)

Every path that serves question content to the client, with pre/post-submit classification and proof of what's returned.

### Pre-Submit Serve Paths (MUST return correct_answer: null, explanation: null)

| # | Endpoint | File:Line | Serializer | correct_answer | explanation | option_metadata | Verdict |
|---|----------|-----------|------------|----------------|-------------|-----------------|---------|
| 1 | `GET /api/practice/sessions/:id/next` | practice-canonical.ts:1768,1795,1943 | `toStudentSafeQuestionDTO()` → `projectStudentSafeQuestion()` | **null** (hard-typed) | **null** (hard-typed) | absent | ✅ SAFE |
| 2 | `POST /api/practice/sessions/:id/resume` | practice-canonical.ts:2117 | `toStudentSafeQuestionDTO()` → `projectStudentSafeQuestion()` | **null** (hard-typed) | **null** (hard-typed) | absent | ✅ SAFE |
| 3 | `GET /api/practice/sessions/:id/state` | practice-canonical.ts:2460 | No question data returned | N/A | N/A | N/A | ✅ SAFE |
| 4 | `GET /api/sessions/open` | practice-canonical.ts:2009 | No question data returned | N/A | N/A | N/A | ✅ SAFE |
| 5 | `GET /api/questions` | questions-runtime.ts:119,144 | `QUESTION_SAFE_SELECT` (allowlist) → `projectStudentSafeQuestion()` | **null** (never fetched) | **never fetched** | never fetched | ✅ SAFE |
| 6 | `GET /api/questions/recent` | questions-runtime.ts:170,177 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 7 | `GET /api/questions/random` | questions-runtime.ts:197,221 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 8 | `GET /api/questions/feed` | questions-runtime.ts:346 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 9 | `GET /api/questions/:id` | questions-runtime.ts:387 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 10 | `GET /api/questions/by-topic` | questions-runtime.ts:631 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 11 | `GET /api/questions/by-difficulty` | questions-runtime.ts:684 | `QUESTION_SAFE_SELECT` → `projectStudentSafeQuestion()` | **null** | **never fetched** | never fetched | ✅ SAFE |
| 12 | `GET /api/questions/count` | questions-runtime.ts:246 | Count only | N/A | N/A | N/A | ✅ SAFE |
| 13 | `GET /api/questions/stats` | questions-runtime.ts:296 | Aggregate stats only | N/A | N/A | N/A | ✅ SAFE |
| 14 | `GET /api/review-errors` | questions-runtime.ts:488,555 | Attempt metadata only | N/A | N/A | N/A | ✅ SAFE |
| 15 | `GET /api/practice-topics` | practice-topics-routes.ts:23 | Static JSON | N/A | N/A | N/A | ✅ SAFE |
| 16 | `GET /api/practice-questions` | practice-topics-routes.ts:50 | `projectStudentSafeQuestion()` | **null** (stripped) | **never fetched** | never fetched | ⚠️ CODE SMELL |

### Post-Submit Reveal Paths (MAY return correct_answer + explanation)

| # | Endpoint | File:Line | What's revealed | option_metadata | Verdict |
|---|----------|-----------|-----------------|-----------------|---------|
| 17 | `POST /api/practice/answer` | practice-canonical.ts:2660,2722,2751,2811,2943 | `correctOptionId` + `explanation` | absent | ✅ CORRECT (post-submit reveal per §20) |
| 18 | `POST /api/practice/sessions/:id/skip` | practice-canonical.ts:3069,3085,3142,3205 | No answer fields | absent | ✅ SAFE |

### Anti-Leak Assessment

**Overall: PASS.** No pre-submit path returns `correct_answer`, `explanation`, or `option_metadata` to the client.

**Defense layers:**
1. **Type-level:** `StudentSafeQuestionDTO` hard-types `correct_answer: null` and `explanation: null` (practice-canonical.ts:62-63)
2. **Serializer-level:** `projectStudentSafeQuestion()` always returns `correct_answer: null, explanation: null` regardless of input (shared/question-bank-contract.ts:491-492)
3. **Query-level:** `questions-runtime.ts` uses `QUESTION_SAFE_SELECT` allowlist that never includes answer-bearing columns (lines 28-38)
4. **DB-level:** Column-level GRANT on `practice_session_items` excludes `question_correct_answer`, `question_explanation`, `question_option_metadata` from authenticated role SELECT
5. **RLS-level:** All practice tables have RLS enabled with own-row-only SELECT policies

### Gap G-AL-1: practice-topics-routes.ts fetches correct_answer unnecessarily

**File:** practice-topics-routes.ts:50  
**Issue:** SELECT includes `correct_answer` from DB, then relies on `projectStudentSafeQuestion()` to strip it downstream. Not a live leak (serializer correctly nulls it), but violates defense-in-depth. `questions-runtime.ts` correctly uses an allowlist that never fetches answer-bearing columns.  
**Severity:** Low (no actual leak). Code smell / defense-in-depth violation.  
**Fix:** Remove `correct_answer` from the SELECT clause. TS-only change.  
**Owner:** TS layer.

---

## 2. Idempotency & Resume Verification (CRITICAL #2)

### Answer Submission Idempotency

| Spec requirement (§23) | DB state | TS state | Verdict |
|-------------------------|----------|----------|---------|
| Idempotent via `client_attempt_id` | `practice_session_items.client_attempt_id` (nullable TEXT) | `findSessionItemByClientAttemptId()` lookup before write | ✅ MATCH |
| UNIQUE on `(user_id, client_attempt_id)` | `uq_practice_items_idem` UNIQUE ON `(user_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL` | Checked at TS layer; DB constraint is backstop | ✅ MATCH |
| Re-submission returns prior result | — | Lines 2660-2674: idempotent replay returns `{ ...priorResult, idempotentRetried: true }` | ✅ MATCH |

### Resume / No-Duplicate-Items

| Spec requirement (§14, §22) | Implementation | Verdict |
|-----------------------------|----------------|---------|
| Resume returns same unanswered item, not new | `serveNextForSession()` finds next pending-or-served item by ordinal | ✅ MATCH |
| No duplicate items on refresh | Prefill pattern: all items materialized at session creation; no on-demand selection | ✅ MATCH |
| Prefill immutable per INV-02B-13 | Items carry denormalized snapshot; no re-read from `questions` table | ✅ MATCH |
| `client_instance_id` for multi-tab safety | `resolveClientInstanceBinding()` returns allow/bind/conflict; 409 on conflict without force_takeover | ✅ MATCH |
| Inactivity timeout → abandoned | Spec: `practice_runtime_config.inactivity_timeout_hours` (24h) | ⚠️ GAP G-ID-1 |

### Gap G-ID-1: No automated inactivity timeout transition

**Spec:** §14 says "Inactivity timeout transitions an active session to abandoned after `practice_runtime_config.inactivity_timeout_hours`."  
**TS state:** No background job or cron that transitions stale sessions to `abandoned`. The `last_activity_at` column exists on `practice_sessions` but nothing reads it to auto-transition.  
**Impact:** Medium. Stale sessions remain "active" indefinitely, potentially interfering with the "resume most recent active session" logic and blocking new session creation if SESSION_LIMIT is reached.  
**Fix:** Implement a transition check—either lazily on session-start (check `last_activity_at > inactivity_timeout_hours` and auto-abandon) or via a periodic cron. Lazy is simpler and sufficient.  
**Owner:** TS layer.

---

## 3. Reconciliation Table: Spec §14-§15 vs DB vs TS

| # | Spec Requirement | DB State | TS State | Gap | Closure Action |
|---|-----------------|----------|----------|-----|----------------|
| 3.1 | **Session states:** created, active, completed, abandoned (§14) | `practice_sessions.status` CHECK IN ('created','active','completed','abandoned') | `PracticeLifecycleState` union type + `normalizeSessionState()` reads BOTH `status` column AND `metadata.lifecycle_state` JSONB | ⚠️ GAP G-SM-1 | Consolidate dual-state (see below) |
| 3.2 | **Prefill at creation:** all target_count items materialized (§14) | `practice_session_items` rows with ordinals | `startOrReplaySession()` runs selection once, writes all items | ✅ MATCH | — |
| 3.3 | **Snapshot immutability** (INV-02B-13) | Denormalized columns on `practice_session_items` | Grading reads from snapshot, not live `questions` table | ✅ MATCH | — |
| 3.4 | **Item statuses:** pending, served, answered, skipped (§14) | CHECK IN ('pending','served','answered','skipped') | TS uses these values | ✅ MATCH | — |
| 3.5 | **Selection: weakness-first ranking** from `student_skill_mastery` (§15 Step 2) | `student_skill_mastery` table exists | **NOT IMPLEMENTED.** Selection uses recency + random shuffle only. No mastery read. | ❌ GAP G-SEL-1 | Implement mastery-aware ranking (see below) |
| 3.6 | **Selection: freshness preference** within recency window (§15 Step 3) | — | Implemented: partitions into never-seen vs previously-seen, sorts stale oldest-first | ✅ PARTIAL | recency_window_days hardcoded? (see G-HC-1) |
| 3.7 | **Selection: seeded Fisher-Yates** for deterministic tie-break (§15 Step 4) | — | Fisher-Yates exists but uses **`crypto.randomInt()`** (unseeded). NOT deterministic. | ❌ GAP G-SEL-2 | Implement seeded shuffle (see below) |
| 3.8 | **Selection: cold-start blueprint-balanced** (§15 Step 5) | — | No blueprint-balanced sampling. Cold-start = random shuffle. | ⚠️ GAP G-SEL-3 | Implement balanced sampling |
| 3.9 | **Mode:** flow (adaptive) vs structured (filtered) (§14, §15) | `practice_sessions.mode` CHECK IN ('flow','structured') | TS accepts mode, applies filters | ✅ MATCH | — |
| 3.10 | **Default counts from config** (§14) | `practice_runtime_config` has `default_session_count_web` (20), `default_session_count_mobile` (10) | **HARDCODED** `DEFAULT_TARGET_QUESTION_COUNT = 20` at line 162 | ❌ GAP G-HC-1 | Read from config table |
| 3.11 | **Max count from config** (§13) | `practice_runtime_config.max_session_count_premium` (60) | **HARDCODED** `Math.min(200, ...)` at line 661 | ❌ GAP G-HC-2 | Read from config table |
| 3.12 | **Session limit** (concurrent) | — | **HARDCODED** `SESSION_LIMIT = 3` at line 159 | ❌ GAP G-HC-3 | Add to config table |
| 3.13 | **Rate limiter** | — | **HARDCODED** `windowMs: 60_000, max: 30` at lines 168-169 | ❌ GAP G-HC-4 | Add to config table |
| 3.14 | **Seconds per question** | — | **HARDCODED** `TARGET_SECONDS_PER_QUESTION = 90` at line 163 | ❌ GAP G-HC-5 | Add to config table |
| 3.15 | **Quota pre-cap at session creation** (§13 CR-02B-19) | — | Quota check happens per-question at serve time, NOT at session creation | ⚠️ GAP G-QU-1 | Implement pre-cap (see below) |
| 3.16 | **Zero-quota blocks session creation** (§13) | — | Session creation succeeds even with 0 remaining quota; quota exhaustion discovered at first serve | ⚠️ GAP G-QU-2 | Block creation when quota=0 |
| 3.17 | **Mastery RPC:** `apply_mastery_event` called after answer persist (§25) | `apply_mastery_event` DB function exists | `applyMasteryEvent()` called at lines 2872-2885 with correct parameters | ✅ MATCH | — |
| 3.18 | **Overnight session handling** (§13): sessions don't extend across days | — | No implementation. Active sessions survive midnight reset. | ⚠️ GAP G-ON-1 | Implement midnight-boundary auto-abandon |

### Gap G-SM-1: Dual lifecycle state (status column + metadata.lifecycle_state)

**Spec:** §14 defines four states on the session. Implies a single `status` column.  
**DB:** `practice_sessions.status` CHECK IN ('created','active','completed','abandoned').  
**TS:** `normalizeSessionState()` (line 316) reads `metadata.lifecycle_state` FIRST, falls back to `status` column. Writes update `metadata.lifecycle_state` in JSONB AND `status` column—but not always atomically.  
**Risk:** If metadata and status diverge, `normalizeSessionState()` trusts metadata (JSONB) over the DB CHECK column. This could produce phantom states invisible to DB queries/RLS.  
**Fix:** Consolidate to single source of truth. Either (a) always write `status` column and derive from it, eliminating `metadata.lifecycle_state`, or (b) document the dual-write contract and add a consistency check.  
**Owner:** TS layer + possible migration to clean stale metadata.

### Gap G-SEL-1: No weakness-first ranking

**Spec:** §15 Step 2—"rank by weakness (skills with lower mastery score in `student_skill_mastery` surface first)."  
**TS:** Selection partitions into never-seen vs previously-seen, shuffles fresh, sorts stale oldest-first. **No mastery data is read during selection.**  
**Impact:** High. Core pedagogical value of adaptive practice is missing. Students get random questions, not weakness-targeted.  
**Fix:** Add mastery read step: query `student_skill_mastery` for the student, rank eligible questions by ascending skill mastery score before applying freshness/shuffle.  
**Owner:** TS layer.

### Gap G-SEL-2: Non-deterministic shuffle

**Spec:** §15 Step 4—"Fisher-Yates shuffle seeded by a stable hash of `profile_id + filter_hash + session_id`."  
**TS:** Fisher-Yates uses `crypto.randomInt()` (truly random, not seeded). Selection is not reproducible.  
**Impact:** Medium. Violates INV-02B-07 (selection must be "reconstructable from recorded state"). Debugging "why did I get this question?" requires replay, which is impossible with unseeded random.  
**Fix:** Implement seeded PRNG using `simpleHash(profile_id + filter_hash + session_id)` as seed.  
**Owner:** TS layer.

### Gap G-SEL-3: No cold-start blueprint-balanced sampling

**Spec:** §15 Step 5—"skip the weakness ranking and apply blueprint-balanced sampling."  
**TS:** Cold-start falls through to the same random shuffle.  
**Impact:** Low (acceptable pre-launch). Blueprint-balanced improves first-session experience.  
**Fix:** When no mastery data exists, distribute selection proportionally across domains/skills per SAT blueprint.  
**Owner:** TS layer.

---

## 4. Hardcoded Constants (INV-02B-15 Violations)

| # | Constant | Location | Value | Config key needed | Exists in `practice_runtime_config`? |
|---|----------|----------|-------|-------------------|--------------------------------------|
| G-HC-1 | `DEFAULT_TARGET_QUESTION_COUNT` | practice-canonical.ts:162 | 20 | `default_session_count_web` | YES (seeded as 20) |
| G-HC-2 | Max count cap | practice-canonical.ts:661 | 200 | `max_session_count_premium` | YES (seeded as 60) — but TS uses 200, not 60 |
| G-HC-3 | `SESSION_LIMIT` | practice-canonical.ts:159 | 3 | `max_concurrent_sessions` | NO — needs migration |
| G-HC-4 | Rate limiter window | practice-canonical.ts:168 | 60_000 | `answer_rate_limit_window_ms` | NO — needs migration |
| G-HC-5 | Rate limiter max | practice-canonical.ts:169 | 30 | `answer_rate_limit_max` | NO — needs migration |
| G-HC-6 | `TARGET_SECONDS_PER_QUESTION` | practice-canonical.ts:163 | 90 | `target_seconds_per_question` | NO — needs migration |

**Fix pattern:** For G-HC-1 and G-HC-2, replace hardcoded values with reads from `practice_runtime_config`. For G-HC-3 through G-HC-6, add rows to `practice_runtime_config` via migration, then read at runtime.

---

## 5. Mastery RPC Seam Verification

### Spec §25 RPC contract vs actual implementation

| Spec field | Spec type | TS field (`applyMasteryEvent` input) | RPC parameter | Match? |
|------------|-----------|--------------------------------------|---------------|--------|
| `event_id` | uuid | `eventId: sessionItem.id` | `p_event_id` | ✅ |
| `event_type` | enum (practice_correct etc.) | `sourceFamily: "practice"` + `eventSourceKind: "practice_attempt"` | `p_source_family` + `p_event_source_kind` | ⚠️ SHAPE DIFF (see below) |
| `version` | int | **ABSENT** | **ABSENT** | ❌ GAP G-MS-1 |
| `profile_id` | uuid | `studentId: userId` | `p_student_id` | ✅ |
| `question_id` | text | `questionId: canonicalId` | `p_question_id` | ✅ |
| `session_id` | uuid | **ABSENT** | **ABSENT** | ❌ GAP G-MS-2 |
| `session_item_id` | uuid | Implicit (event_id = session_item.id) | via `p_event_id` | ⚠️ COLLAPSED |
| `occurred_at` | timestamptz | `occurredAt: now` | `p_occurred_at` | ✅ |
| `payload.difficulty` | int | `difficulty: difficultyBucket` | `p_difficulty` | ✅ |
| `payload.section` | text | `section` | `p_section` | ✅ |
| `payload.domain` | text | `domain` | `p_domain` | ✅ |
| `payload.skill_codes` | text[] | `skill` (single string) | `p_skill` | ⚠️ GAP G-MS-3 |
| `payload.selected_answer` | text | **ABSENT** | **ABSENT** | ❌ GAP G-MS-4 |
| `payload.is_correct` | bool | `correct: isCorrect` | `p_correct` | ✅ |
| `payload.used_tutor` | bool | **ABSENT** | **ABSENT** | ❌ GAP G-MS-5 |

### Mastery Seam Gaps

**G-MS-1: Missing `version` field.** Spec says event payloads carry a version for schema evolution. Not critical pre-launch but needed for contract evolution.

**G-MS-2: Missing `session_id`.** Spec includes `session_id` in the event payload. Current RPC doesn't pass it. Not needed for mastery math but useful for audit/tracing.

**G-MS-3: `skill_codes` (array) vs `skill` (string).** Spec says `skill_codes: text[]`; TS passes a single `skill` string (the first skill code). The RPC accepts a single skill. This is a deliberate simplification documented in the mastery audit (SP-17). Acceptable.

**G-MS-4: Missing `selected_answer`.** Spec includes `selected_answer` in the event payload. Not passed to RPC. Not needed for current mastery math but spec requires it.

**G-MS-5: Missing `used_tutor`.** Spec includes `used_tutor` in the event payload. Not passed to RPC. Spec says "tutor interactions don't affect mastery math" (INV-02B-11) so the flag is informational. Still a spec gap.

**Severity:** Low-to-medium. Mastery math works correctly without these fields (the core `difficulty + section + domain + skill + correct` seam is intact). The missing fields are audit/telemetry, not computational. The mastery seam from the recent fix is **intact and working**.

---

## 6. Quota Mechanics Gaps

### Gap G-QU-1: No pre-cap at session creation

**Spec §13 (CR-02B-19):** "Session creation pre-caps the target count at remaining quota. A free user with 2 questions remaining can only start a session with target up to 2."  
**TS:** Session creation succeeds with any target count; quota exhaustion is discovered per-question at serve time.  
**Impact:** Medium. User starts a 20-question session, hits quota at question 2—exactly the "mid-session surprise" CR-02B-19 was designed to prevent.  
**Fix:** At session creation for free users, query remaining quota and clamp `target_count` to `min(requested, remaining)`. Return capped count + CTA flag in response.  
**Owner:** TS layer.

### Gap G-QU-2: Zero-quota doesn't block session creation

**Spec §13:** "If a free user has 0 questions remaining and attempts to start a session, the server refuses session creation and returns a quota-exhausted response."  
**TS:** Session creation succeeds with 0 remaining; first serve returns quota-exhausted.  
**Fix:** Add quota check at session creation entry. Return 402 with countdown to reset.  
**Owner:** TS layer.

### Gap G-ON-1: No overnight session boundary

**Spec §13:** "The student does not resume across the midnight boundary; they start a fresh session with quota reset."  
**TS:** No midnight-boundary logic exists. Active sessions survive indefinitely.  
**Fix:** On resume/next-question, check if session was created before the most recent quota reset boundary. If so, auto-abandon.  
**Owner:** TS layer.

---

## 7. DB Migration Gaps vs TS-Only Gaps

### DB Migrations (Karl applies)

| # | Gap | Migration needed |
|---|-----|-----------------|
| M-1 | G-HC-3 | INSERT `max_concurrent_sessions` row into `practice_runtime_config` |
| M-2 | G-HC-4 | INSERT `answer_rate_limit_window_ms` row into `practice_runtime_config` |
| M-3 | G-HC-5 | INSERT `answer_rate_limit_max` row into `practice_runtime_config` |
| M-4 | G-HC-6 | INSERT `target_seconds_per_question` row into `practice_runtime_config` |

### TS-Only Changes (repo)

| # | Gap | Change |
|---|-----|--------|
| T-1 | G-AL-1 | Remove `correct_answer` from SELECT in practice-topics-routes.ts:50 |
| T-2 | G-HC-1, G-HC-2 | Replace hardcoded defaults with config reads from `practice_runtime_config` |
| T-3 | G-HC-3–6 | Replace hardcoded constants with config reads (after migration) |
| T-4 | G-SEL-1 | Implement weakness-first ranking via `student_skill_mastery` read |
| T-5 | G-SEL-2 | Implement seeded Fisher-Yates using `profile_id + filter_hash + session_id` |
| T-6 | G-SEL-3 | Implement cold-start blueprint-balanced sampling |
| T-7 | G-QU-1, G-QU-2 | Pre-cap quota at session creation; block creation at zero |
| T-8 | G-ON-1 | Midnight-boundary auto-abandon check |
| T-9 | G-ID-1 | Lazy inactivity timeout check (auto-abandon stale sessions) |
| T-10 | G-SM-1 | Consolidate dual lifecycle state (status column vs metadata.lifecycle_state) |
| T-11 | G-MS-1–5 | Extend mastery RPC call with missing spec fields (version, session_id, selected_answer, used_tutor) |

---

## 8. Owner Questions (Spec Ambiguity)

**Q1 (§15 Step 4 — Deterministic seed):** The spec says "seeded by stable hash of `profile_id + filter_hash + session_id`." But `session_id` is generated at creation time—if selection happens during creation, the session_id doesn't exist yet when selection starts. Should the seed use a pre-generated session_id (UUID generated before selection), or use `profile_id + filter_hash + timestamp`?

**Q2 (§13 — Quota pre-cap):** CR-02B-19 says pre-cap target_count at remaining quota. If a free user has 5 remaining and requests 20, do we (a) silently clamp to 5, (b) clamp to 5 with a CTA flag in the response, or (c) reject with a "quota too low" error requiring the client to re-request with a lower count? Spec says "surfaces a CTA at session start" which implies (b).

**Q3 (§14 — Concurrent session limit):** The spec mentions resuming the "most recent active session" but doesn't specify a hard limit on concurrent active sessions. TS currently hardcodes `SESSION_LIMIT = 3`. Is this spec-aligned or should it be 1 (only one active session at a time)?

**Q4 (§22 — Concurrent submission resolution):** Spec says "Latest valid submission before answer lock wins" for practice. TS uses idempotency key, which means different attempt keys are treated as sequential—but the first one persisted wins (not the latest). Is the current behavior (first-write-wins via UNIQUE constraint) acceptable, or should practice support answer changes within an item before moving to the next?

**Q5 (Dual lifecycle state — G-SM-1):** The `metadata.lifecycle_state` pattern appears to have been introduced for flexibility (storing additional session metadata in JSONB). Should the consolidation remove `metadata.lifecycle_state` entirely in favor of the `status` column, or is there a reason to keep both (e.g., the JSONB carries additional context not representable in a CHECK constraint)?

---

## 9. Priority-Ordered Implementation Plan

### Phase 1: Critical / Anti-Leak (do first)
1. **T-1** — Remove `correct_answer` from SELECT in practice-topics-routes.ts (defense-in-depth)

### Phase 2: Hardcoded Constants (INV-02B-15)
2. **M-1–M-4** — Migration: add missing config rows
3. **T-2, T-3** — Replace all hardcoded constants with config reads

### Phase 3: Quota Mechanics (CR-02B-19)
4. **T-7** — Pre-cap at session creation + zero-quota block
5. **T-8** — Midnight-boundary auto-abandon

### Phase 4: Selection Logic (pedagogical value)
6. **T-4** — Weakness-first ranking
7. **T-5** — Seeded Fisher-Yates
8. **T-6** — Cold-start blueprint-balanced sampling

### Phase 5: Session Lifecycle Cleanup
9. **T-9** — Inactivity timeout enforcement
10. **T-10** — Dual lifecycle state consolidation

### Phase 6: Mastery Seam Polish
11. **T-11** — Extend RPC with missing spec fields

---

## 10. What's NOT a Gap (Confirmed Correct)

- Anti-leak on all pre-submit serve paths: **verified 16 endpoints, all clean**
- Prefill-at-creation pattern: **implemented correctly**
- Snapshot immutability: **grading reads from snapshot, not live questions**
- Session state machine: **four states match spec** (dual-state is a code quality issue, not a functional gap)
- Answer submission idempotency: **DB constraint + TS lookup, both working**
- Client instance binding / multi-tab safety: **implemented with allow/bind/conflict resolution**
- Mastery RPC seam (core fields): **intact and working post-fix**
- Post-submit reveal: **correct_answer + explanation returned only after grading**
- DB RLS: **all practice tables have own-row SELECT policies**
- Column-level grants: **answer-bearing columns excluded from authenticated role**
- Rate limiting on answer submission: **30/minute via express-rate-limit**
- Grid-in support: **type-safe with empty options, numeric_entry inputMode**
