# LISA Tutor Surface Inventory

**SHA audited:** `9f2c57f9c2cc4ed827689acc87f11e7e4e82cefb`  
**Date:** 2026-08-04  
**Mode:** Read-only. No code changes, no recommendations.

---

## 1. Routes / Handlers

**EXISTS**

### Main server routes (`server/routes/tutor-runtime.ts`, mounted via `server/index.ts:376-382`)

All routes mounted at `/api/tutor` with middleware stack: `ragLimiter` (30 req/min) → `requireSupabaseAuth` → `requireStudentOrAdmin` → `doubleCsrfProtection`.

| Route | File:Line | Description |
|---|---|---|
| `POST /api/tutor/conversations` | `server/routes/tutor-runtime.ts:938` | Start or resume a tutor conversation; deduplicates against existing active conversations with the same scope |
| `GET /api/tutor/conversations/:conversationId` | `server/routes/tutor-runtime.ts:1063` | Retrieve a single conversation with all messages; applies anti-leak silent substitution on replay |
| `GET /api/tutor/conversations` | `server/routes/tutor-runtime.ts:1142` | List tutor conversations with cursor-based pagination and optional status/surface filters |
| `POST /api/tutor/conversations/:conversationId/close` | `server/routes/tutor-runtime.ts:1219` | Close or abandon a tutor conversation |
| `POST /api/tutor/messages` | `server/routes/tutor-runtime.ts:1284` | Main chat append — persists student message, calls orchestrator, anti-leak scans response, persists tutor reply + artifacts, finalizes rate-limit reservation. Idempotent via `client_turn_id` |

Shared `tutorHardThrottle` middleware applied at `server/routes/tutor-runtime.ts:296`.

### Orchestrator HTTP client (`server/lib/tutor-orchestrator-client.ts`)

| Export | File:Line | Description |
|---|---|---|
| `callTutorOrchestrator(payload)` | `server/lib/tutor-orchestrator-client.ts:95` | POSTs to `$TUTOR_ORCHESTRATOR_URL/orchestrate`, validates response against a **local** `orchestratorResponseSchema` (independent from shared contract), supports GCP ID token auth |

### Orchestrator worker routes (`apps/workers/tutor-orchestrator/src/`)

| Route | File:Line | Description |
|---|---|---|
| `POST /orchestrate` | `apps/workers/tutor-orchestrator/src/routes/orchestrate.ts:7` | Accepts orchestration request, calls Vertex AI, returns structured tutor response |
| `POST /compact` | `apps/workers/tutor-orchestrator/src/routes/compact.ts:1` | Memory compaction endpoint |

Worker entry point: `apps/workers/tutor-orchestrator/src/index.ts` (23 lines).  
Boundary auth middleware: `apps/workers/tutor-orchestrator/src/lib/boundary-auth.ts` (140 lines).

---

## 2. Client Surfaces

**EXISTS**

### Actively routed

| File:Line | Status | Description |
|---|---|---|
| `client/src/pages/chat.tsx:1-589` | **Active** — routed at `/chat` (App.tsx:118-125), gated by `RequireRole allow={["student","admin"]}` | Production LISA tutor chat. Bootstraps conversation on mount, renders message history, idempotent retry via `client_turn_id`, premium upgrade prompts, renders backend-driven UI hints |
| `client/src/pages/tutor.tsx:1-199` | **Active** — routed at `/tutor` (App.tsx:89), no auth gate | Static informational page: "Tutor Safety, Privacy, and Pedagogy." No chat functionality, no API calls |
| `client/src/lib/tutor-client.ts:1-169` | **Active** — consumed by `pages/chat.tsx` | Typed API client: `startTutorConversation`, `fetchTutorConversation`, `appendTutorMessage`. Validates against shared Zod schemas. Parses errors into `TutorClientRequestError` |

### Dead / unreachable

| File:Line | Status | Description |
|---|---|---|
| `client/src/components/chat-interface.tsx:1-263` | **Dead** — imported only by `floating-actions.tsx`, which is never imported | Older card-based chat widget with inline API calls (not via `tutor-client.ts`), no idempotent retry, no premium prompts, no Zod validation |
| `client/src/components/DemoChatPreview.tsx:1-33` | **Dead** — exported but never imported | Hardcoded demo chat bubble with canned Q&A, no API calls |
| `client/src/components/TutorInsights.tsx:1-67` | **Dead** — exported but never imported | Sidebar with hardcoded "Confidence=85%" bar — would violate mastery-is-earned-only invariant if wired |
| `client/src/components/ChatDock.tsx:1-27` | **Dead** — exported but never imported | Floating action button navigating to `/chat` with Framer Motion animation |

---

## 3. Shared Contracts

**EXISTS**

### `shared/tutor-contract.ts` (158 lines) — 21 Zod schemas

| Schema | File:Line | Description |
|---|---|---|
| `TutorEntryModeSchema` | `:3` | Enum: `"scoped_question" \| "scoped_session" \| "general"` |
| `TutorSourceSurfaceSchema` | `:4` | Enum: `"practice" \| "review" \| "test_review" \| "dashboard"` |
| `TutorConversationStatusSchema` | `:5` | Enum: `"active" \| "closed" \| "abandoned"` |
| `TutorRoleSchema` | `:6` | Enum: `"student" \| "tutor" \| "system"` |
| `TutorContentKindSchema` | `:7` | Enum: `"message" \| "suggestion" \| "consent_prompt" \| "system_note"` |
| `TutorScopeSchema` | `:9` | Four nullable/optional UUIDs tying conversation to practice session/question |
| `TutorStartConversationRequestSchema` | `:16` | Request body for `POST /tutor/conversations` |
| `TutorAppendMessageRequestSchema` | `:25` | Request body for message append — message text 1-4000 chars, `client_turn_id` |
| `TutorListConversationsQuerySchema` | `:33` | Query params for listing conversations |
| `TutorCloseConversationRequestSchema` | `:40` | Request body for close — status `"closed" \| "abandoned"` |
| `TutorSuggestedActionSchema` | `:44` | Follow-up action the tutor can offer |
| `TutorUiHintsSchema` | `:49` | UI rendering hints (accept/decline, freeform, suggested chip) |
| `TutorStartConversationResponseSchema` | `:55` | Response for conversation creation |
| `TutorAppendMessageResponseSchema` | `:65` | Response for message append |
| `TutorConversationMessageSchema` | `:78` | Single message in conversation history |
| `TutorFetchConversationResponseSchema` | `:88` | Full conversation fetch response |
| `TutorConversationEnvelopeSchema` | `:103` | Lightweight conversation summary for list responses |
| `TutorListConversationsResponseSchema` | `:113` | List response with envelopes + cursor |
| `TutorCloseConversationResponseSchema` | `:120` | Close response |
| `TutorErrorResponseSchema` | `:127` | Standard tutor error envelope |
| `TutorRateLimitResponseSchema` | `:136` | Rate-limit error with limit/remaining/resetAt metadata |
| `TutorRecoverableRetryErrorSchema` | `:151` | Safe-retry error — code `"TUTOR_RECOVERABLE_RETRY_REQUIRED"`, `retryable: true` |

### `shared/schema.ts` — tutor-adjacent type members only (no Zod schemas)

| Type member | File:Line | Description |
|---|---|---|
| `"ai_tutor_suggestion"` in `NotificationType` | `:35` | Notification type variant for tutor-originated suggestions |
| `"ai_tutor"` in `NotificationCategory` | `:42` | Notification category grouping for tutor events |

### `apps/workers/tutor-orchestrator/src/lib/schema.ts` (130 lines) — worker-internal schemas

| Schema | File:Line | Description |
|---|---|---|
| `resolvedScopeSchema` | `:3` | Practice session + question scope for orchestration call |
| `recentMessageSchema` | `:10` | Message context passed to orchestrator |
| `memorySummarySchema` | `:18` | Compacted memory record — summary_type, version, content_json, time window |
| `policyAssignmentSchema` | `:31` | Prompt policy/variant assignment metadata |
| `orchestrateRequestSchema` | `:41` | Full orchestration request — conversation_id, student_id, scope, messages, memory, policy, runtime_limits |
| `questionLinkSchema` | `:57` | Related-question link — relationship_type enum, difficulty_delta |
| `instructionExposureSchema` | `:74` | Instructional content exposure tracking — exposure_type, variant/version/depth metadata |
| `orchestrateResponseSchema` | `:91` | Full orchestration response — content, question_links, instruction_exposures, orchestration_meta |
| `compactRequestSchema` | `:119` | Memory compaction request |
| `compactResponseSchema` | `:124` | Compaction response |
| `OrchestrateRequest` (type) | `:128` | Inferred from `orchestrateRequestSchema` |
| `OrchestrateResponse` (type) | `:129` | Inferred from `orchestrateResponseSchema` |
| `CompactRequest` (type) | `:130` | Inferred from `compactRequestSchema` |
| `CompactResponse` (type) | `:131` | Inferred from `compactResponseSchema` |

**Note:** `server/lib/tutor-orchestrator-client.ts` defines its **own** `orchestratorResponseSchema` (lines 4-64) independently from both `shared/tutor-contract.ts` and the worker's `schema.ts`. This is a parallel schema, not a shared import.

---

## 4. GCP / Vertex Wiring

**EXISTS — orchestrator lives IN-REPO**

### In-repo orchestrator worker: `apps/workers/tutor-orchestrator/`

| File:Line | Description |
|---|---|
| `apps/workers/tutor-orchestrator/src/lib/vertex.ts:1-497` | Vertex AI client — imports `VertexAI` from `@google-cloud/vertexai`, targets GCP project `replit-cop`, region `us-central1`, model `gemini-2.5-flash`. Exports `generateTutorResponse()`. Enforces timeout via `OrchestratorTimeoutError`. Uses `responseMimeType: "application/json"` with declared `responseSchema` for structured output |
| `apps/workers/tutor-orchestrator/package.json:11` | Dependency: `@google-cloud/vertexai` ^1.11.0 |
| `apps/workers/tutor-orchestrator/cloudbuild.yaml:1-18` | Cloud Build step deploying `lyceon-tutor-orchestrator` to Cloud Run — `--no-allow-unauthenticated`, service account `lyceon-tasks-sa@replit-cop.iam.gserviceaccount.com` |
| `apps/workers/tutor-orchestrator/src/lib/boundary-auth.ts:1-140` | Inbound auth middleware — `require_bearer` mode for production, local dev passthrough |
| `apps/workers/tutor-orchestrator/src/routes/orchestrate.ts:7` | Express route calling `generateTutorResponse` |
| `apps/workers/tutor-orchestrator/src/routes/compact.ts:1-35` | Memory compaction route |

### Main server → orchestrator connection

| File:Line | Description |
|---|---|
| `server/lib/tutor-orchestrator-client.ts:98` | Reads `TUTOR_ORCHESTRATOR_URL` env var (Cloud Run service URL) |
| `server/lib/tutor-orchestrator-client.ts:95` | POSTs to `/orchestrate`, supports `gcp_id_token` auth mode via `google-auth-library` |

### Cloud Tasks

**ABSENT** — `CloudTasksClient` and `@google-cloud/tasks` have zero code presence. Extensively spec'd in Doc 03C (compaction, memory refresh, pending reconciliation) but not implemented.

---

## 5. Migrations

**EXISTS**

### Objects in production (confirmed)

| Object | Type | Source Migration:Line |
|---|---|---|
| `tutor_context_runtime_config` | TABLE | `supabase/migrations/20260610000000_ws2_config_constants.sql:38` |
| `tutor_context_runtime_config_history` | TABLE | `supabase/migrations/20260610000000_ws2_config_constants.sql:58-67` |
| `tutor_context_runtime_config_notify` | TRIGGER | `supabase/migrations/20260610000000_ws2_config_constants.sql:68-69` |
| `tutor_context_runtime_config_history_no_mutate` | TRIGGER | `supabase/migrations/20260610000000_ws2_config_constants.sql:70-71` |
| RLS enabled on both tables | RLS | `supabase/migrations/20260610000000_ws2_config_constants.sql:72-73` |
| 9 seed rows in config table | Seed data | `supabase/migrations/20260610000000_ws2_config_constants.sql:126-135` |

### Tutor references in genesis (no tutor-prefixed objects)

| Object | Type | File:Line |
|---|---|---|
| `'tutor'` in `profile_role` enum | ENUM value | `supabase/migrations/00000000000000_genesis.sql:131` |
| `'tutor_access'` entitlement feature seed | Seed data | `supabase/migrations/00000000000000_genesis.sql:202` |
| `blocked_during_live_exam` column on `entitlement_features` | Column | `supabase/migrations/00000000000000_genesis.sql:191,199` |

### Tutor-adjacent in later migrations

| Object | Migration:Line | Notes |
|---|---|---|
| `review_session_items.question_correct_answer` comment: "tutor-in-review never sees it" | `20260610020000_ws2_practice_review_runtime.sql:179` | Comment only |
| `review_error_attempts.used_tutor` column | `20260610020000_ws2_practice_review_runtime.sql:218` | Boolean, telemetry-only, never formula-facing |
| `'tutor'` in `usage_rate_limit_ledger.scope` CHECK | `20260630000000_practice_quota_rpc.sql:20` | Valid scope value |
| 7 tutor rate-limit seed rows in `rate_limit_runtime_config` | `20260610000000_ws2_config_constants.sql:143-150` | burst/hourly/daily/weekly/monthly/warning |
| Account-deletion anonymization of config tables | `20260625010000:174-175`, `20260626010000:141-142` | Nullifies profile IDs |

### Migration-only / legacy (NOT in prod)

| Object | Source | Status |
|---|---|---|
| `chat_messages` table | `database/migrations/0001_core_schema.sql:324` | Legacy pre-Supabase; never migrated |
| `tutor_interactions` table | `database/20241207_add_tutor_interactions.sql:1` | Legacy; verbatim columns dropped; not in prod |
| `tutor_memory_summaries` table | Referenced in pre-baseline `20260607_ws0_stop_the_bleed.sql` | Creation migration not in repo |
| `_rl_estimate_tutor_cost_micros()` | Pre-baseline `20260408_rate_limit_ledger_truth.sql:125` | NOT in prod |
| `check_and_reserve_tutor_budget()` | Pre-baseline `20260408_rate_limit_ledger_truth.sql:650` | NOT in prod |
| `finalize_tutor_usage()` | Pre-baseline `20260408_rate_limit_ledger_truth.sql:924` | NOT in prod |

---

## 6. Config Consumers (`tutor_context_runtime_config`)

**EXISTS — but zero runtime code reads the table**

The string `tutor_context_runtime_config` appears only in migrations, schema snapshots, spec docs, and audit docs. No `.ts` file references this table name.

### Actual 9 seeded keys (from migration `20260610000000:126-135`)

| Key | Read by runtime code? |
|---|---|
| `cost_soft_alert_usd_month` | **Orphaned** — migration/spec only |
| `cost_hard_alert_usd_month` | **Orphaned** — migration/spec only |
| `cost_hard_cap_usd_month` | **Orphaned** — migration/spec only |
| `vertex_pro_daily_budget_usd` | **Orphaned** — migration/spec only |
| `vertex_pro_budget_circuit_breaker_enabled` | **Orphaned** — migration/spec only |
| `vertex_pro_budget_circuit_breaker_warning_pct` | **Orphaned** — migration/spec only |
| `per_question_cooldown_minutes` | **Orphaned** — migration/spec only |
| `tutor_request_timeout_seconds` | **Orphaned** — migration/spec only |
| `conversation_reuse_days` | **Orphaned** — migration/spec only |

**All 9 keys are orphaned.** No runtime code reads any of them.

---

## 7. Entitlement Consumers

**ABSENT in runtime code**

| Pattern searched | Result |
|---|---|
| `tutor_access` in `.ts` files | Zero matches. Appears only in genesis seed (`genesis.sql:202`) and spec docs |
| `canAccessFeature` in `.ts` files | Zero matches. The entitlement-gating function is spec'd but not implemented |
| `blocked_during_live_exam` in `.ts` files | Zero matches. Column exists in DDL (`genesis.sql:191,199`) but no runtime enforcement |

The full-exam blocking test at `tests/tutor.runtime.contract.test.ts:1443` tests that tutor is blocked during a live exam, but the enforcement mechanism is inside the route handler's own SQL query (checking for active exam sessions), not via the `entitlement_features.blocked_during_live_exam` column.

---

## 8. Metering Consumers

**EXISTS — two parallel systems**

### System A: Older account-based metering (`server/middleware/usage-limits.ts`)

| File:Line | Description |
|---|---|
| `server/middleware/usage-limits.ts:1-120` | Express middleware factory accepting `'practice' \| 'ai_chat'`. Calls `checkUsageLimit`/`incrementUsage` from `../lib/account`. Returns 402 when limit reached. Does NOT use `usage_rate_limit_ledger` |

### System B: Spec-aligned RPC-based metering (`apps/api/src/lib/rate-limit-ledger.ts`)

| Export | File:Line | Consumers |
|---|---|---|
| `checkAndReserveTutorBudget` | `rate-limit-ledger.ts:206` | `server/routes/tutor-runtime.ts:1332` |
| `finalizeTutorUsage` | `rate-limit-ledger.ts:268` | `server/routes/tutor-runtime.ts:1558,1765,1803` |
| `estimateTokenCount` | `rate-limit-ledger.ts` | Not yet consumed |
| `estimateTutorCostMicros` | `rate-limit-ledger.ts:356` | Not yet consumed |
| `checkAndReservePracticeQuota` | `rate-limit-ledger.ts` | `server/routes/practice-canonical.ts:1048,1402` |
| `checkAndReserveFullLengthQuota` | `rate-limit-ledger.ts` | `apps/api/src/services/fullLengthExam.ts:2306` |
| `checkAndReserveCalendarQuota` | `rate-limit-ledger.ts` | `apps/api/src/routes/calendar.ts:515` |

The tutor runtime (`tutor-runtime.ts`) uses **System B** (the spec-aligned RPC system). The `usage_rate_limit_ledger` table is accessed only via Supabase RPCs; the `.ts` code never references the table name directly.

---

## 9. Tests

**EXISTS**

| File | Lines | Aspect tested |
|---|---|---|
| `tests/tutor_v2.security.test.ts` | 38 | Auth enforcement — unauthenticated and bearer-only rejection on `/api/tutor/messages` |
| `tests/tutor.runtime.contract.test.ts` | 1580 | Full contract — conversation lifecycle, scope enforcement, idempotency, replay healing, memory summaries, entitlement gating, orchestrator failure recovery, anti-leak (pre/post submit), full-exam blocking, question link persistence |
| `tests/tutor.v2.regression.test.ts` | 35 | Route regression — confirms old `/api/tutor/v2` mount is removed; canonical endpoint is auth-first |
| `tests/tutor.orchestrator-client.test.ts` | 119 | Orchestrator HTTP client — auth mode selection (local/GCP ID token), missing config failures |
| `tests/tutor.orchestrator.boundary-auth.test.ts` | 205 | Worker inbound auth — local dev passthrough, production fail-closed, bearer/shared-secret modes, compact route coverage |
| `tests/tutor.orchestrator.route.test.ts` | 84 | Orchestrator route handler — timeout→504, Vertex failure→502 |
| `tests/tutor.orchestrator.vertex-output.test.ts` | 207 | Vertex output hardening — JSON parsing, deterministic config (temperature=0, topP=1), safe failure on truncated/non-JSON/malformed/schema-mismatch |
| `tests/tutor.orchestrator.vertex-timeout.test.ts` | 87 | Timeout enforcement — slow Vertex response cut off with `OrchestratorTimeoutError` |
| `tests/ci/tutor-interactions.no-verbatim.contract.test.ts` | 99 | Static regression guard — verbatim persistence path fully eliminated, feature flag gone, dead writer deleted, genesis never re-creates `tutor_interactions` |
| `tests/ci/tutor.schema-proof.contract.test.ts` | 19 | Live DB schema proof — validates actual DB matches locked expectations (skipped without live DB) |
| `tests/ci/rate-limit-sql.contract.test.ts` | 54 | Rate-limit SQL contract — `usage_rate_limit_ledger` table structure and RPC shape |
| `client/src/pages/chat.request-payload.test.tsx` | 304 | Client integration — contract-only payloads (no privilege leakage), UI hint rendering, idempotent retry, CSRF session notice, premium denial prompt |

---

## 10. Dead / Partial Code

**EXISTS — client-side dead components; no dead server code**

### Dead client components (exported but never imported)

| File | Lines | Issue |
|---|---|---|
| `client/src/components/chat-interface.tsx` | 263 | Older chat widget, superseded by `pages/chat.tsx`. Only imported by `floating-actions.tsx`, which is itself never imported |
| `client/src/components/DemoChatPreview.tsx` | 33 | Hardcoded demo bubble, never imported |
| `client/src/components/TutorInsights.tsx` | 67 | Hardcoded "Confidence=85%" sidebar — would violate mastery-is-earned-only invariant if wired |
| `client/src/components/ChatDock.tsx` | 27 | Floating action button to `/chat`, never imported |

### Confirmed cleanups (dead code already removed)

| Item | Evidence |
|---|---|
| `apps/api/src/lib/tutor-log.ts` (verbatim writer) | Deleted; guarded by regression test `tests/ci/tutor-interactions.no-verbatim.contract.test.ts:71` |
| `TUTOR_VERBATIM_PERSIST` feature flag | Fully removed; guarded by regression test at `:64`; ledger entry at `docs/alignment/LEDGER.md:21` |

### No source-code TODOs, FIXMEs, HACKs, or stubs

All `TODO.*tutor` / `FIXME.*tutor` / `HACK.*tutor` / `stub.*tutor` matches are exclusively in spec docs, audit reports, and the alignment ledger — zero in `.ts`/`.tsx`/`.js`/`.jsx` source files.

---

## Summary

| Metric | Value |
|---|---|
| **Total tutor-related source files** | 32 (20 `.ts`/`.tsx` source + 12 test/script/config/doc) |
| **Total tutor-related LOC** | ~8,341 (source + tests + worker + scripts + config) |
| **Orphaned config keys** | All 9 keys in `tutor_context_runtime_config` are orphaned (no runtime reader) |
| **Dead/partial client paths** | `chat-interface.tsx` (263 LOC), `DemoChatPreview.tsx` (33), `TutorInsights.tsx` (67), `ChatDock.tsx` (27) — total 390 LOC dead |
| **Unimplemented spec features** | `canAccessFeature('tutor_access')` entitlement gating, `blocked_during_live_exam` enforcement via entitlement column, Cloud Tasks (compaction/memory/reconciliation), `estimateTokenCount`/`estimateTutorCostMicros` consumers |
| **Parallel/duplicate schemas** | `server/lib/tutor-orchestrator-client.ts:4-64` defines its own `orchestratorResponseSchema` independently from both `shared/tutor-contract.ts` and `apps/workers/tutor-orchestrator/src/lib/schema.ts` |
| **Parallel metering systems** | System A (`server/middleware/usage-limits.ts`, account-based) and System B (`apps/api/src/lib/rate-limit-ledger.ts`, RPC-based). Tutor runtime uses System B |
| **SHA audited** | `9f2c57f9c2cc4ed827689acc87f11e7e4e82cefb` |
