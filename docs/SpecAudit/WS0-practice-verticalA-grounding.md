# WS-0 Practice Vertical A — Pre-Implementation Grounding

**Date:** 2026-06-27  
**Status:** Read-only, NO code changes  
**Feeds:** Step 2 (plan audit) → Step 3 (implement)

---

## TASK 1: Skill File State Report

### Finalized Skills (`.claude/skills/` — live, auto-triggered)

| Skill | Lines | Coverage | Relevant to Vertical A? |
|-------|-------|----------|------------------------|
| `anti-leak` | 62 | Full: reveal-matrix, per-endpoint enforcement, INV-02B-01 | **YES** — drives T-1 allowlist fix |
| `grill-me` | 63 | Full: adversarial self-review checklist, Codex audit mirror | **YES** — end-of-pass gate |
| `new-feature` | 48 | Full: §18 implementation order (spec→schema→domain→handler→tests→obs) | **YES** — feature build template |
| `spec-align` | 125 | Full: 6-stage pipeline with hard gates | Reference only |
| `spec-align-plan` | 72 | Full: parallel wave coordination | Reference only |
| `spec-drift` | 34 | Full: Phase 0 read-only drift report | Already done (WS-0 audit) |
| `teach-me` | 39 | CEO teaching skill | Not relevant |

### Draft Skills (`skill-drafts/` — NOT promoted, must be manually referenced)

| Skill | Lines | Coverage | Ready for Vertical A? |
|-------|-------|----------|-----------------------|
| **`practice-engine`** | 36 | Locked endpoints, invariants (no-leak, no-duplicate, deterministic selection). **Outdated:** still says "deterministic selection (mastery exists)" which CEO model revises down to ORDER BY random(). Also missing: multi-select filters, quota mechanics, session limit, close-session, count-vs-time. | **NEEDS UPDATE before implementation** |
| **`frontend`** | 62 | React/TS standards: no business logic in components, TanStack Query, no useEffect derived state, no client privilege. **General-purpose and correct** — doesn't need practice-specific updates. | **READY** (general standards) |
| `auth-entitlements` | 53 | Server-authoritative auth, guardian model. | Reference for entitlement checks |
| `determinism-idempotency` | 41 | Cross-cutting: idempotency_key, event-ledger dedup. | Reference for answer submit |
| `mastery-kpi` | 35 | Observed-events-only, no vanity metrics. | Not directly relevant (mastery seam already verified) |
| `stripe-billing` | 46 | Payment/entitlement boundary. | Reference for quota/tier checks |
| `testing-audit` | 51 | Anti-leak tests, idempotency replay, denial tests, proof bar. | **YES** — test requirements |
| `tutor-runtime` | 41 | LISA runtime, ephemeral logging, INV-03-01/05. | Not relevant to Vertical A |

### Key Finding

**`practice-engine` skill needs revision before Vertical A implementation.** Current draft references old-spec adaptive selection ("deterministic selection where mastery exists") which CEO model explicitly revises down to ORDER BY random(). It also lacks:
- Multi-select faceted filtering contract
- Count-or-time selection
- Quota mechanics (40/day free, 60/session paid)
- Session limit (5 active)
- Close-session affordance
- Config-extract requirement

**`frontend` skill is ready** — it's general-purpose React standards, not practice-specific. Sufficient to drive the UI build.

**Recommendation:** Update `practice-engine` skill to match CEO model BEFORE implementation pass, or carry the CEO model inline in the implementation plan. The skill is only 36 lines — updating it is low-effort.

---

## TASK 2: Deletion Inventory

### Architecture: Two Client Practice Hooks (both live)

The client has **two parallel practice hook implementations**, both calling the same server endpoints:

| Hook | File | Callers |
|------|------|---------|
| `useCanonicalPractice` | `client/src/hooks/useCanonicalPractice.ts` | `CanonicalPracticePage` → math-practice, reading-writing-practice, random-practice, resume-practice |
| `useAdaptivePractice` | `client/src/hooks/use-adaptive-practice.ts` | structured-practice, flow-cards |

Both hooks call the same server endpoints (`POST /api/practice/sessions`, `GET .../next`, `POST /api/practice/answer`). **This is duplication that Vertical A should consolidate into one hook.**

---

### Bucket (a): Confirmed Dead — Safe to Delete

| # | Item | Location | Proof of Death |
|---|------|----------|----------------|
| D-1 | `practice_events` insert (serve) | practice-canonical.ts:1922-1935 | Non-blocking try/catch telemetry. `practice_events` is legacy per Doc 02B §6 naming ("practice_events legacy"). Only 3 write sites in practice-canonical.ts + health-routes.ts read. No downstream consumer reads this table for business logic. **However:** health-routes.ts reads it. See B-1. |
| D-2 | `practice_events` insert (answer) | practice-canonical.ts:2836-2850 | Same as D-1. |
| D-3 | `practice_events` insert (skip) | practice-canonical.ts:3164-3177 | Same as D-1. |
| D-4 | `questionsApi.ts` practice functions | client/src/lib/questionsApi.ts | Marked `@deprecated Use useAdaptivePractice hook instead`. Grep confirms no live imports of the deprecated functions. |
| D-5 | `TARGET_SECONDS_PER_QUESTION = 90` | practice-canonical.ts:163 | Only used to compute `target_minutes` for the session response. CEO model uses count-based selection (not time), so this constant and the time-derivation logic are dead. |
| D-6 | `fisherYates()` function | practice-canonical.ts:427-434 | CEO model uses Supabase-native ORDER BY random(). Hand-rolled Fisher-Yates for selection is dead. **CAUTION:** `fisherYates` is also called at line 441 for option shuffling (`buildServedOptions`). That usage is **LIVE** — option order must still be randomized per-serve. **Verdict:** The function stays; only its usage at line 1399 (question selection) is dead. |
| D-7 | `buildDeterministicPrebuiltSet()` | practice-canonical.ts:846-872 | Builds the tiered never-seen/previously-seen selection. CEO model replaces with ORDER BY random(). Dead as a selection orchestrator. |
| D-8 | `metadata.lifecycle_state` writes | practice-canonical.ts:1752,1781,1830,1914,2243 | CEO model consolidates to `status` column only. All 5 metadata.lifecycle_state write sites are dead after consolidation. |
| D-9 | `normalizeSessionState()` metadata path | practice-canonical.ts:316-333 | After consolidation, this function simplifies to reading `status` column only. The metadata.lifecycle_state fallback branch is dead. |

### Bucket (b): Looks Dead but Has Live Caller — Must Rewire First

| # | Item | Location | Live Caller | Rewire needed |
|---|------|----------|-------------|---------------|
| B-1 | `practice_events` table reads | server/routes/health-routes.ts | Health check reads `practice_events` for liveness probe | Rewire health check to read `practice_session_items` instead (or drop the practice_events liveness check) before deleting D-1/D-2/D-3 |
| B-2 | `DEFAULT_TARGET_QUESTION_COUNT = 20` | practice-canonical.ts:162 | Used as fallback in `coerceTargetQuestionCount()` and session creation | Must be replaced with config read (`practice_runtime_config.default_session_count_web`) set to 10 per CEO model. Can't just delete. |
| B-3 | `SESSION_LIMIT = 3` | practice-canonical.ts:159 | Used in session creation to check active count | Must be replaced with config read, value changed to 5 per CEO model. Can't just delete. |
| B-4 | `coerceTargetQuestionCount()` 200 cap | practice-canonical.ts:662 | Used in `normalizeSessionSpec()` | Must change to config-driven. Paid cap = 60/session per CEO model. Free cap = remaining daily quota (pre-cap). |
| B-5 | `practiceAnswerRateLimiter` (60s/30) | practice-canonical.ts:167-178 | Mounted on answer + skip endpoints | Must be replaced with config-driven values. Can't just delete. |
| B-6 | `useAdaptivePractice` hook | client/src/hooks/use-adaptive-practice.ts | structured-practice.tsx, flow-cards.tsx | If consolidating to one hook, callers must be rewired. If keeping both hooks, this is live. |
| B-7 | `useCanonicalPractice` hook | client/src/hooks/useCanonicalPractice.ts | CanonicalPracticePage → 4 page files | Same as B-6 — consolidation requires rewiring all callers. |

### Bucket (c): Old-Spec but Still Load-Bearing — Don't Delete, Replace

| # | Item | Location | Why it's load-bearing | Action |
|---|------|----------|-----------------------|--------|
| C-1 | `projectStudentSafeQuestion()` | shared/question-bank-contract.ts:445-494 | Anti-leak serializer. Used by ALL question-serving paths. The foundation of INV-02B-01. | **PRESERVE.** Never delete. |
| C-2 | `resolveClientInstanceBinding()` | shared/question-bank-contract.ts:510-605 | Multi-tab safety. Used by session creation and resume. | **PRESERVE.** CEO model still uses client_instance_id. |
| C-3 | `toStudentSafeQuestionDTO()` | practice-canonical.ts:583-619 | Wraps `projectStudentSafeQuestion()` with session-item context for the serve response. Used at 4 callsites. | **PRESERVE.** Core anti-leak at the serve layer. |
| C-4 | `toCanonicalQuestionForServing()` | practice-canonical.ts:456-493 | Reconstructs server-side grading record from DB row. Used for answer evaluation. | **PRESERVE.** Core grading logic. |
| C-5 | `toCanonicalQuestionFromSessionItem()` | practice-canonical.ts:501-580 | Reconstructs grading record from prefilled session_item snapshot. | **PRESERVE.** Snapshot immutability (INV-02B-13). |
| C-6 | `startOrReplaySession()` | practice-canonical.ts:1175-1569 | Session creation + idempotency. **Needs heavy revision** (new selection, new quota, new config reads) but the idempotency/replay logic is load-bearing. | **REVISE, don't delete.** |
| C-7 | `serveNextForSession()` | practice-canonical.ts:1648-1951 | Question serving + quota check + mastery event emission. Load-bearing serve pipeline. | **REVISE, don't delete.** |
| C-8 | `applyMasteryEvent()` call | practice-canonical.ts:2872-2885 | Mastery seam we just verified. | **PRESERVE.** |
| C-9 | `checkAndReservePracticeQuota()` | apps/api/src/lib/rate-limit-ledger.ts | Freemium quota enforcement via DB RPC. | **PRESERVE.** CEO model extends (40/day free + 60/session paid) but the mechanism stays. |
| C-10 | `practice-topics-routes.ts` topics endpoint | server/routes/practice-topics-routes.ts:21-37 | Returns SAT domain taxonomy for filter UI. Still needed for multi-select filter population. | **PRESERVE** (but fix the correct_answer SELECT per T-1). |
| C-11 | Diagnostic 404 stub | server/index.ts:430-432 | Terminal 404 route preventing diagnostic access. Vertical B (baseline diagnostic gate) needs this path. | **PRESERVE for Vertical B.** |
| C-12 | `RuntimeContractDomain` with "diagnostic" | server/lib/runtime-contract-disable.ts:3-18 | Type includes diagnostic as a domain. Vertical B will need this. | **PRESERVE for Vertical B.** |
| C-13 | `practice_events` table (DB) | supabase migration | Health-routes reads it. Even after TS writes are removed, the table itself should not be dropped until health-routes is rewired. | **Don't drop table yet.** Rewire health-routes first (B-1), then drop in a separate migration. |

---

## TASK 3: Owner Questions (UI/Spec — need answers before implementation)

### From CEO Model

**Q6 (Filter UI pattern):** Multi-select faceted filtering (difficulty + domain + skill, multiple per facet, none = all). What UI pattern? Options:
  - (a) Chip/tag multi-select (like Gmail labels)
  - (b) Checkbox dropdowns per facet
  - (c) Sidebar filter panel with checkboxes
  - (d) Something else
  This drives component choice and layout.

**Q7 (Active-session list):** "User can END/CLOSE a session at will from the practice HOME page (needs an active-session list + close affordance)." Layout for the active-session list:
  - (a) Card list on practice home showing each active session (section, progress, started-at) with a close button
  - (b) Collapsible section at top of practice home
  - (c) Modal/drawer triggered by a "Manage Sessions" button
  - How prominent should this be vs. the "start new session" flow?

**Q8 (Close confirmation):** When a user closes/ends a session, should there be a confirmation dialog ("End this session? Your progress is saved but you won't be able to resume.") or immediate close?

**Q9 (Quota-exhausted CTA):** When a free user exhausts their 40/day quota:
  - (a) Full-page takeover with upgrade CTA + countdown to reset
  - (b) Banner/toast at top of practice page
  - (c) Modal dialog
  - Should the countdown show hours:minutes or just "Resets at midnight CT"?

**Q10 (Count-vs-time picker):** "Count OR time selection, default 10." What's the UI?
  - (a) Simple number input (question count only, no time mode for now)
  - (b) Toggle between "# questions" and "minutes" with a number input
  - (c) Preset buttons (5, 10, 15, 20, Max) like current spec, with custom input
  - What are the presets if (c)?

**Q11 (Practice page consolidation):** Client currently has 6 practice entry points (practice.tsx, math-practice, reading-writing-practice, random-practice, structured-practice, flow-cards) using two separate hooks. Should Vertical A:
  - (a) Consolidate to ONE practice page with the multi-select filter driving section/domain/skill selection (kills the per-section entry points)
  - (b) Keep the per-section entry points but update them to use the new consolidated hook
  - (c) Something else
  This has major routing implications.

### From Spec Revision

**Q12 (ORDER BY random() confirmation):** CEO model says "Supabase-native ORDER BY random()". This means the selection is truly random per session with no mastery-awareness, no freshness preference, no seeded determinism. Confirming: this is intentional for launch, and the §15 adaptive selection is explicitly post-launch? (Needed for SCL entry.)

**Q13 (Daily quota reset mechanism):** The DB RPC `check_and_reserve_practice_quota` already exists. Does it implement the midnight-America/Chicago reset, or does that need to be built? Need to verify before planning.

---

## Proposed SCL (Spec Change Log) Entries

Per CEO model, the following 02B audit "gaps" close as NOT-gaps (deferred to post-launch):

| SCL # | Spec Section | Gap ID | Status | Rationale |
|-------|-------------|--------|--------|-----------|
| SCL-P-01 | §15 Step 2 | G-SEL-1 | DEFERRED | Weakness-first ranking → post-launch. Launch = ORDER BY random(). |
| SCL-P-02 | §15 Step 4 | G-SEL-2 | DEFERRED | Seeded Fisher-Yates → post-launch. Launch = native random(). |
| SCL-P-03 | §15 Step 5 | G-SEL-3 | DEFERRED | Cold-start blueprint-balanced → post-launch. Launch = native random(). |

---

## Implementation-Ready Summary

**What Vertical A builds (confirmed CEO model):**
1. Multi-select faceted filters (difficulty + domain + skill) with jsonb WHERE…IN expansion
2. Default count = 10 (from practice_runtime_config, not hardcoded)
3. Fill via ORDER BY random() into prepopulated practice_session_items
4. Incremental answer save + resume same unfinished session (already works)
5. Quota: 40/day free (pooled), 60/session paid, both config-driven
6. Max 5 active sessions, close from home + in-session
7. Config-extract all hardcoded constants (6 items)
8. Consolidate dual lifecycle state → status column only
9. Anti-leak T-1 fix (practice-topics-routes.ts allowlist SELECT)
10. Client: consolidate two hooks, build filter UI, session list, quota UX

**What Vertical A does NOT build:**
- Adaptive selection (§15 weakness-first, seeded shuffle, cold-start) → post-launch
- Baseline diagnostic gate → Vertical B
- SM-2 review integration → already separate routes

**What Vertical A preserves (load-bearing for B and anti-leak):**
- `projectStudentSafeQuestion()`, `toStudentSafeQuestionDTO()` — anti-leak core
- `resolveClientInstanceBinding()` — multi-tab safety
- Diagnostic 404 stub + RuntimeContractDomain type — Vertical B scaffolding
- `applyMasteryEvent()` seam — mastery integration
- `practice_events` table (DB) — until health-routes rewired
