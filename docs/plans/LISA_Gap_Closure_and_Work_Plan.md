# LISA — Gap Closure & Work Plan

**Version:** V1.1
**Status:** Draft for Karl approval → on approval, becomes the working plan for Vertical C
**Date:** 2026-08-04
**Supersedes:** V1.0 (2026-08-04, chat-delivered)
**Branch:** `lisa` — all LISA / AI-tutor work routes here
**Proposed repo path:** `docs/plans/LISA_Gap_Closure_and_Work_Plan.md`

---

## 0. How to use this document

This is a **work order and audit contract**, not a specification. It defines no mechanism. Every mechanism it references is owned by a canonical document in `docs/Spec/` and is cited by exact ID and section.

| Audience | Use |
|---|---|
| **CC** | Implement work items in order. Each item names its spec source. Read the spec section; do not implement from this document's summary of it. |
| **Codex** | Audit against §5 acceptance criteria and proving mechanisms. A work item is closed only when its named proving mechanism runs and passes. |
| **Karl** | Approve, sequence, and own all irreversible operations (§6). |

**Non-restatement discipline.** Where this plan touches a mechanism another document owns, it references — it does not restate. Invariants are cited as `INV-03-NN` with Doc 03 Main V1.1 Part XI as canonical. Schema is cited as Doc 03A V3 §17. If this plan and a canonical doc appear to conflict on a mechanism's definition, **the canonical doc wins and this plan is in defect.**

---

## 1. Grounding

### 1.1 Evidence base

| Source | Establishes | Date |
|---|---|---|
| Doc 03 family + 07E + ADR-001 | The standard | uploaded 2026-08-04 |
| CC read-only inventory, SHA `9f2c57f9c2cc4ed827689acc87f11e7e4e82cefb` | Repo state | 2026-08-04 |
| Read-only SQL, project `hncolwkccbbjkfithhlo` | Live prod state | 2026-08-04 |

Nothing in this plan is inferred. Claims trace to one of the three.

### 1.2 Verified prod state

| Query | Result |
|---|---|
| `pg_class`, all non-system schemas, tutor/chat/message/conversation/memory patterns | **2 objects:** `tutor_context_runtime_config`, `tutor_context_runtime_config_history` |
| `pg_proc`, `public`, `%tutor%` / `%lisa%` | **0 routines** |
| `pg_proc`, `public`, `%reserve%` `%quota%` `%finalize%` `%budget%` `%usage%` | **1 routine:** `check_and_reserve_practice_quota` |
| `supabase_migrations.schema_migrations` | **16 rows**, latest `20260624020000_05d_governance_substrate` |
| `tutor_context_runtime_config` keys | 9 seeded; **no `vertex.model.*_alias` keys** |
| `entitlement_features` | `tutor_access` present, correctly configured |

### 1.3 Spec ledger

| Doc | Version | Status |
|---|---|---|
| Doc 03 Main — LISA (AI Tutor System) | V1.1 | CANONICAL |
| Doc 03A — Context & Memory Runtime | V3.0 | CANONICAL |
| Doc 03B — API & Runtime Flow | V4.1 | CANONICAL |
| Doc 03C — GCP Orchestration | V3.0 | CANONICAL–FINAL — **falsified by CR-03C-V3-01** |
| Doc 03C — Operations Runbook | V3.0 | Treated as locked (Karl ruling 2026-08-04) |
| Doc 03C.1 — Orchestrator Test Matrix | V1.1 | Treated as locked; **binding acceptance contract** (Karl ruling) |
| Doc 07E — Analytics Retention, Privacy & Cascade | V1.0 | LOCKED 2026-05-26 |
| Doc 03 ADR-001 — LISA Storage Architecture | V1.0 | Accepted |

### 1.4 Karl rulings applied

| # | Ruling | Effect |
|---|---|---|
| 1 | WS-L0 first | §5.1 |
| 2 | Keep `apps/workers/tutor-orchestrator/` path | §4; 03C.1 states its own path is *"planned path; verify at session 0 grounding"* — keeping the repo path is inside that allowance, not a deviation |
| 3 | GCP project `replit-cop` **is** production | Naming debt only; record in Ops Runbook so on-call is not misled |
| 4 | 03C.1 treated as locked | Binding acceptance contract for WS-L2 |
| 5 | Crisis classifier gate is required | CR-03C-V3-01 raised; WS-L2 blocked on its approval |

### 1.5 Model correction recorded

ADR-001 §6 supersedes the prior working assumption that tutor conversation content is non-verbatim. Under the **"Reading B" ruling** the canonical conversation store legitimately holds verbatim content within the retention window before pseudonymization; the non-verbatim discipline applies to logs and the retired audit side-table only.

CC's deletion of `apps/api/src/lib/tutor-log.ts` and the `TUTOR_VERBATIM_PERSIST` flag is therefore **correct**. But the sanctioned store does not exist, so LISA currently has nowhere lawful to persist a conversation.

---

## 2. The standard

Referenced, not restated.

| Domain | Canonical owner |
|---|---|
| Invariants `INV-03-01` … `INV-03-19` | **Doc 03 Main V1.1, Part XI** |
| Persistence schema (12 tutor tables) | **Doc 03A V3 §17** |
| API surface (8 endpoints) | **Doc 03B V4.1** |
| Orchestrator contract (4 routes, model aliases, routing, caching) | **Doc 03C V3 (+V3.1 per CR-03C-V3-01)** |
| Acceptance scenarios | **Doc 03C.1 V1.1 (+V1.2)** |
| Retention, cascade, age-stratification | **Doc 07E V1.0**, Doc 03 Main §14.2 |
| Platform ownership boundary (GCP vs Supabase) | **ADR-001** — GCP holds zero durable LISA state |
| Entitlement decision | **Doc 01 V8 §27.3** via `EntitlementService.canAccessFeature` (see §7 open seam) |

**Canonical tutor tables (Doc 03A V3 §17), for gap-tracking only:**
`tutor_conversations` · `tutor_messages` · `tutor_memory_summaries` · `tutor_instruction_assignments` · `tutor_question_links` · `tutor_instruction_exposures` · `tutor_injection_log` · `tutor_injection_signatures` · `tutor_error_codes` · `tutor_inference_cache` · `tutor_vertex_context_cache` · `tutor_context_runtime_config` (+`_history`)
Plus, pending CR-03C-V3-01: `tutor_crisis_signatures`.

---

## 3. Gap matrix

| # | Requirement | Prod | Repo | Gap | Sev | WS |
|---|---|---|---|---|---|---|
| G01 | 12 canonical tutor tables (03A §17) | 2 of 12 | migrations absent | 10 missing; every route writes to nothing | **P0** | L0 |
| G02 | Migration ledger reproduces prod | ends `20260624000000`-series | CC cites 3 later migrations | Objects in prod with no ledger entry, **or** CC mis-attribution. Unresolved either way | **P0** | L0 |
| G03 | Metering RPCs exist | practice only | code calls tutor / full-length / calendar RPCs | 3 verticals call absent RPCs | **P0** | L0 |
| G04 | `INV-03-16` crisis classifier every turn | — | absent | **No classifier anywhere.** 03C V3 has no such stage — see CR-03C-V3-01 | **P0** | L2 |
| G05 | `INV-03-04` / `INV-03-12` output scan at orchestrator boundary | — | scan in `tutor-runtime.ts` API layer | Wrong layer; worker can emit unscanned output on any other consumer path. *Per-route-not-structural* | **P0** | L2 |
| G06 | `INV-03-03` / `INV-03-18` entitlement every turn | row exists, no RPC | `canAccessFeature` not implemented; zero `tutor_access` refs in `.ts` | Paid gate unenforced | **P0** | L1 |
| G07 | `INV-03-02` live-exam block | column exists | route-local SQL, not the entitlement column | *Per-route-not-structural* | **P0** | L1 |
| G08 | 03C §5.2 alias indirection + Pro class | 3 Pro budget keys seeded, **0 alias keys** | `gemini-2.5-flash` hardcoded in `vertex.ts` | No Pro tier exists; budget config guards an unbuilt feature | **P0** | L0+L2 |
| G09 | 4 orchestrator routes (03C) | — | `/orchestrate`, `/compact` | Renamed; 2 async routes absent; Cloud Tasks absent so **nothing invokes `/compact`** | P1 | L2+L3 |
| G10 | `INV-03-19` 7-day soft delete + cleanup job | — | absent | No retention enforcement; compounds with 07E cascade | P1 | L3 |
| G11 | §30.1 runtime-config resolution | 9 keys seeded | **zero readers** | All 9 orphaned; config doctrine inverted | P1 | L1 |
| G12 | 8 API endpoints (03B) | — | 5 of 8 | `/messages/stream`, `/health-check`, `/quota-appeal` absent | P1 | L4 |
| G13 | One wire contract | — | **3 parallel schemas** | `shared/tutor-contract.ts`, worker `schema.ts`, `tutor-orchestrator-client.ts:4-64`. *Parallel-paths-built-differently* | P1 | L1 |
| G14 | No vanity metrics (§17 hard stop, `INV-03-11`) | — | `TutorInsights.tsx` hardcodes `Confidence=85%` | Dead but importable | P2 | L1 |

---

## 4. Disposition — keep vs rebuild

| Layer | Verdict | Basis |
|---|---|---|
| `shared/tutor-contract.ts` (21 Zod schemas) | **Keep**, conformance-audit vs 03B V4.1 | Contract-first shape is correct |
| 5 existing `/api/tutor` route paths | **Keep**, conformance-audit | Paths match 03B exactly |
| `client/src/pages/chat.tsx`, `client/src/lib/tutor-client.ts` | **Keep**, re-audit | Contract-driven, idempotent retry, no privilege leakage per own test |
| `chat-interface.tsx`, `DemoChatPreview.tsx`, `TutorInsights.tsx`, `ChatDock.tsx`, `floating-actions.tsx` | **Delete** | 390 LOC dead; `TutorInsights` is a §17 hard-stop |
| `server/lib/tutor-orchestrator-client.ts:4-64` local schema | **Delete**, import shared | Third copy of one contract |
| `apps/workers/tutor-orchestrator/` — path | **Keep** (Karl ruling 2) | Record resolved path in 03C.1 grounding |
| `apps/workers/tutor-orchestrator/` — internals | **Rebuild from 03C V3.1** | Wrong route contract, no alias indirection, no Pro class, no classifier stage, no async surface |
| DB layer | **Build** | Nothing exists |
| `server/middleware/usage-limits.ts` (System A) | **Delete** after System B verified against real prod RPCs | |

**Standing rule applied:** rebuild from spec; never reuse or patch code because it passes. The kept layers are kept because their *shape* matches spec, and they still require a conformance audit before they are trusted.

---

## 5. Workstreams

Each item: **spec source** → **acceptance criterion** → **proving mechanism**. Per the INV-06 discipline, a capability statement without a runnable proving mechanism is a drafting defect in this plan.

### 5.1 WS-L0 — Schema truth (blocks everything)

**Why first:** until prod carries the canonical schema and a live-DB gate enforces it, all 2,831 LOC of tutor tests are mocks and no audit on this surface is falsifiable. The skipped `tests/ci/tutor.schema-proof.contract.test.ts` is the gate that failed and allowed ~8,341 LOC to drift.

#### L0.1 — Migration-ledger reconciliation `[READ-ONLY]`

Prod's applied chain has 16 entries ending `20260624020000_05d_governance_substrate`. CC's inventory cites `20260625010000`, `20260626010000`, and `20260630000000_practice_quota_rpc.sql` — none in the ledger — yet `check_and_reserve_practice_quota`, the `_rl_*` helpers, and `usage_rate_limit_ledger` are live in prod.

Exactly one is true: **(a)** SQL was applied to prod outside the migration system, or **(b)** CC mis-attributed those objects.

- **Acceptance:** (a) vs (b) resolved with file:line evidence for every object in question. If (a): a written list of every prod object with no ledger provenance.
- **Proving mechanism:** `scripts/ci/migration-ledger-parity` — replays repo migrations to a throwaway DB and diffs the resulting schema against a prod introspection snapshot. Non-empty diff fails.
- **Gates:** L0.3. Do not author tutor DDL onto a schema of unknown provenance.
- **Owner:** CC (read-only) → Claude triage → Karl ruling if (a).

#### L0.2 — Legacy migration-file removal `[REPO-ONLY]`

**Correction of record:** there are no dead tutor tables in prod. A full `pg_class` sweep across all non-system schemas returns two objects, both live config tables this plan keeps. **No `DROP TABLE` migration is authored.** With no target, `DROP TABLE IF EXISTS` returns success and proves nothing — the fail-open shape, and a violation of the rule that irreversible operations require exact-target proof on real schema with a committed negative control.

The dead artifacts are repo files never applied:

| Artifact | Location |
|---|---|
| `chat_messages` | `database/migrations/0001_core_schema.sql:324` |
| `tutor_interactions` | `database/20241207_add_tutor_interactions.sql:1` |
| `tutor_memory_summaries` | referenced in pre-baseline `20260607_ws0_stop_the_bleed.sql`; **creating migration absent from repo** — broken chain |
| `_rl_estimate_tutor_cost_micros`, `check_and_reserve_tutor_budget`, `finalize_tutor_usage` | pre-baseline `20260408_rate_limit_ledger_truth.sql` |

- **Real risk being closed:** these files re-create dead objects on `supabase db reset` or a new-environment bootstrap.
- **Acceptance:** legacy `database/` directory and orphaned pre-baseline files deleted or quarantined outside the migration path; `supabase/migrations/` is the single migration root.
- **Proving mechanism:** `ci/single-migration-root` — fails if any `.sql` outside `supabase/migrations/` contains `CREATE TABLE`; plus L0.1's parity script re-run clean.

#### L0.3 — Canonical tutor schema

- **Spec source:** Doc 03A V3 §17 (tables, RLS, grants, triggers, indexes, ownership classes). `tutor_conversations` must carry `crisis_flagged BOOLEAN NOT NULL DEFAULT FALSE` and partial index `idx_tutor_conversations_crisis`.
- **Acceptance:** all 10 missing tables created exactly per §17. RLS enabled on every student-scoped table with `student_id`-bound policies per `INV-03-14`. No grant wider than spec.
- **Proving mechanism:** `tests/ci/tutor.schema-proof.contract.test.ts` extended to assert every §17 object, column, type, index, RLS policy, and grant — run against live DB, **not skipped**.

#### L0.4 — Tutor metering RPCs

- **Spec source:** Doc 03B V4.1 metering contract; `usage_rate_limit_ledger` shape already in prod.
- **Acceptance:** `check_and_reserve_tutor_budget` and `finalize_tutor_usage` exist in prod with signatures matching the call sites in `apps/api/src/lib/rate-limit-ledger.ts`. Reservation/finalize is idempotent by `dedupe_key`.
- **Proving mechanism:** `tests/ci/rate-limit-sql.contract.test.ts` extended to assert tutor RPC existence and signature against live DB; replay test proves idempotency.
- **Note:** `check_and_reserve_full_length_quota` and `check_and_reserve_calendar_quota` are also absent from prod. **Out of LISA scope** — raise as a separate program-level finding; do not fix here.

#### L0.5 — Model-alias config keys

- **Spec source:** 03C §5.2 / 03A V3 §18.7.
- **Acceptance:** `vertex.model.flash_class_alias` and `vertex.model.pro_class_alias` seeded in `tutor_context_runtime_config` with spec defaults. `classifier_class_alias` added if CR-03C-V3-01 is approved.
- **Proving mechanism:** config-key conformance assertion in the schema-proof test.

#### L0.6 — Gate promotion

- **Acceptance:** `tests/ci/tutor.schema-proof.contract.test.ts` is a **required check** on the `lisa` branch and runs against a live DB. Skipping it fails CI rather than passing silently.
- **Proving mechanism:** branch protection configuration + a negative control — deliberately drop a column on a throwaway DB and confirm the gate fails.

> **L0.6 is the point of the workstream.** Everything else in WS-L0 is undone the moment this gate can be skipped again.

#### WS-L0 non-goals
No orchestrator changes. No route changes. No client changes. No entitlement work. WS-L0 touches migrations, DB artifacts, and CI gates only.

---

### 5.2 WS-L1 — Structural gates

| Item | Spec source | Acceptance | Proving mechanism |
|---|---|---|---|
| L1.1 `canAccessFeature` chokepoint | 03A V3 §15 → Doc 01 V8 §27.3 | Single enforcement point covering `INV-03-03`, `INV-03-07`, `INV-03-08`, `INV-03-18`. **No route implements its own entitlement check.** Closes G06 + G07 structurally | Chokepoint test: every `/api/tutor` route rejects without entitlement; plus a static grep gate failing on any route-local entitlement SQL |
| L1.2 Live-exam block via entitlement column | `INV-03-02`; `entitlement_features.blocked_during_live_exam` | Enforcement reads the column through the L1.1 chokepoint, not route-local SQL | Denial test asserting the *property* across all routes, not one route |
| L1.3 Runtime-config reader | 03C §30.1; 01A Part I | All 9 seeded keys + alias keys read at runtime with LISTEN/NOTIFY invalidation. Zero hardcoded timeouts, cooldowns, budgets | Static gate: fail on literal values for any key present in `tutor_context_runtime_config` |
| L1.4 Collapse parallel schemas | 03B V4.1 | One wire contract. `tutor-orchestrator-client.ts` and worker import from `shared/` | Static gate: fail on any second definition of the orchestrator response shape |
| L1.5 Delete System A | — | `usage-limits.ts` removed; System B verified against real prod RPCs from L0.4 | Regression test asserting the module is gone |
| L1.6 Delete dead client components | §17 hard stops; `INV-03-11` | 5 files deleted | Regression test asserting absence, in the pattern of `tutor-interactions.no-verbatim.contract.test.ts` |

**Fail-closed requirement:** every gate in WS-L1 returns the safe value on unrecognized input. A filter that passes unrecognized input through is a defect, not a default. This pattern has been caught three times in this program.

---

### 5.3 WS-L2 — Orchestrator rebuild

**Blocked on CR-03C-V3-01 approval.** Do not start until the classifier design is ruled.

| Item | Spec source | Acceptance | Proving mechanism |
|---|---|---|---|
| L2.1 Route contract | 03C §3.1 | `/orchestrate/turn` + 3 `/async/*` routes | 03C.1 route scenarios |
| L2.2 Alias indirection | 03C §5.2 | `resolveProviderModel()`; **zero literal provider strings outside config**; unknown alias throws | Static gate on literal `gemini-*` strings in source |
| L2.3 Model routing | 03C §5.3.1–5.3.3 | 9-rule ordered precedence; Pro→Flash fallback; budget circuit breaker | 03C.1 routing scenarios incl. precedence order |
| L2.4 **Crisis classifier gate** | CR-03C-V3-01 §3 → 03C V3.1 §4.6 | Two-layer gate pre-generation; **no turn exempt** per `INV-03-16`; failure posture per CR §3.4 | 03C.1 V1.2 crisis scenarios incl. short/single-word/continuation turns and the degraded path |
| L2.5 Output scan relocation | `INV-03-04`, `INV-03-12`, `INV-03-17`; 03C pipeline | Scan runs at the **orchestrator boundary**, not the API layer. Failed scan blocks and substitutes safe fallback | Property test: a second consumer of the worker cannot obtain unscanned output |
| L2.6 PII guard | 03C §4.2.2 | Deterministic guard; `pii_in_envelope` → 400, SEV-2 | 03C.1 PII scenarios |
| L2.7 Context caching | 03C Part VI | Per-student composite cache; write-through order per SWE-V4-02 (mark `invalidated_at` in txn, Vertex delete after commit) | 03C.1 cache scenarios incl. the concurrency race |

**Acceptance contract:** Doc 03C.1 V1.1 (→V1.2) P0 scenarios, binding per Karl ruling 4.

---

### 5.4 WS-L3 — Async jobs and retention

| Item | Spec source | Acceptance | Proving mechanism |
|---|---|---|---|
| L3.1 Cloud Tasks | 03C Part VIII | Queues provisioned; `/async/*` invoked on schedule | Scheduled-job monitoring per INV-06 "every scheduled job monitored" |
| L3.2 Compaction | 03A V3 §9; 03C | Memory compaction runs and is observable | 03C.1 async scenarios |
| L3.3 Memory refresh | 03A V3 §9, §19 | GCP→API callback via 01A Part VII HMAC service auth | Auth failure test: unsigned callback rejected |
| L3.4 Pending reconciliation | 03C §8.5 | Sweep + handler + concurrency safety | 03C.1 §8.5 scenarios |
| L3.5 Soft-delete cleanup | `INV-03-19`; Doc 03 §14.1–14.2 | 7-day window; automatic hard delete at expiry across the 4 named tables | Executable-proof job with a committed negative control |
| L3.6 07E cascade wiring | Doc 07E V1.0 §7, §10 | Age-stratified cascade; under-13 hard-delete-everywhere | 07E-owned CI gates |

---

### 5.5 WS-L4 — Remaining API surface

`POST /api/tutor/messages/stream` · `POST /api/tutor/health-check` · `POST /api/tutor/quota-appeal`. Spec source Doc 03B V4.1. Acceptance per 03B contract tests.

---

## 6. Execution protocol

Standing per-step process. CC does not vary it.

1. Read-only audit of target surface vs spec → gap-closure plan
2. Plan is industry-standard or a Lyceon moat; as boring as possible; no reinvention
3. CC implements in repo + DB artifacts + CI, with `@spec` annotations
4. Spec-auditor inner gate + `/grill-me`
5. Push to `lisa` → **Codex independent audit against the spec surface, not the diff**
6. Close all Codex findings
7. **Karl merges and applies SQL**

**Non-negotiable:**
- Karl owns every irreversible operation. CC never applies migrations, never merges, never opens a PR on a read-only task.
- Codex audits the **whole surface** a change touches, not the diff. A standard is a property of the surface.
- CI-green is necessary, not sufficient. Until L0.6 lands, CI-green on this surface is evidence of nothing.
- Integration tests exercise real schema and real data. Mocks that bypass the schema mask schema bugs.
- Never treat a CC self-report as a Codex verdict.

---

## 7. Open seams

| # | Seam | Status |
|---|---|---|
| S1 | **`canAccessFeature` home.** 03A V3 §15 delegates to Doc 01 V8 `EntitlementService.canAccessFeature`. Prod has `entitlement_active(p_profile_id)` but no feature-gate RPC. Doc 01 V8 not in advisory context | **Blocks WS-L1.** Needs Doc 01 V8 upload or a Karl ruling on TS-service vs DB-RPC |
| S2 | **CR-03C-V3-01** crisis classifier | **Blocks WS-L2.** 4 open questions in the CR |
| S3 | **Migration-ledger provenance** (G02) | **Blocks L0.3.** Resolved by L0.1 |
| S4 | Full-length and calendar quota RPCs absent from prod | Program-level, outside LISA. Raise separately; do not fix in this plan |
| S5 | Statutory floor for conversational AI serving minors | Attach to Doc 07E **W9 legal counsel sign-off**. Not an engineering determination |
| S6 | GCP project named `replit-cop` in production | Naming debt. Record in 03C Operations Runbook so on-call is not misled |

---

## 8. Change record

| Version | Date | Change |
|---|---|---|
| V1.0 | 2026-08-04 | Initial, chat-delivered |
| V1.1 | 2026-08-04 | Rebuilt for `docs/`. Adds CR-03C-V3-01 linkage; G02 migration-ledger finding; G08 missing alias config keys; L0.2 correction of record on dead tables; per-item proving mechanisms; execution protocol; open-seam register |
