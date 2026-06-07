# Lyceon Closure Plan — V1.0 (derived from Gap Registry V1.1)

**Rule:** this plan is derived FROM the registry; the registry stays the source of truth. Every PR cites its GAP IDs and updates registry status in the same PR. Workstream exit = all listed GAPs closed (or explicitly re-dispositioned by owner) + the named proof. Spec revisions (WS-S) run through the lock-cycle, never inline.

**Sequencing logic (pre-production, zero users, no date pressure):** stop the live exposures first (cheap, DB-only, independent of everything); restore schema provenance second (every later workstream ships migrations and needs a pipeline to ship them through); then the two rebuild programs (mastery, scoring) which share the outbox seam; correctness and lifecycle work runs parallel where it doesn't collide with the rebuilds; hygiene last. The deployed runtime keeps working throughout — nothing here requires a big-bang cutover.

---

## WS-0 — Stop the Bleed *(first; DB policies/grants + two route guards; no schema rebuilds; days not weeks)*

| GAP | Action |
|---|---|
| GAP-TB-01 | Remove anon/auth direct read of `correct_answer`/`explanation` (column privileges or safe-view + policy rewrite) |
| GAP-TB-02 | Cut PostgREST owner-read of denormalized answer columns on the three session-item tables |
| GAP-TB-03 | Enable RLS + revoke anon/auth writes on all nine tables |
| GAP-ID-11 | Auth-gate consent verify; compare `session.metadata.requestId` to body; re-derive ownership |
| GAP-TU-06 | Drop `tutor_memory_summaries_student_insert`; writes reserved for the trusted compaction path (which doesn't exist yet — table simply becomes server-only) |
| GAP-MA-09 | Constants-audit triggers → `ENABLE ALWAYS` (log table itself fixed by TB-03) |

**Exit proof:** PostgREST probe script with the anon key + an authenticated test student demonstrating: no answer/explanation readable pre-submit anywhere, no write accepted on the nine tables, consent endpoint rejects unauthenticated/unbound calls, memory-summary insert rejected. Run it in CI from here on (the first executable-proof artifact of the program).

## WS-1 — Provenance Baseline *(before any workstream that ships schema)*

| GAP | Action |
|---|---|
| GAP-OP-05 | Capture deployed schema as baseline migration 0000; one pipeline (`supabase/migrations`) forward; retire the Drizzle journal; CI gate: no DB object without repo SQL |
| GAP-MA-03 | Closes via the baseline capture (the live mastery RPC gets a tracked definition) |

**Exit proof:** `supabase db diff` between a from-scratch migration apply and production = empty (modulo data).

## WS-2 — Privacy & Lifecycle *(parallel with WS-3 after WS-1)*

| GAP | Action |
|---|---|
| GAP-OP-01 | Stand up the scheduler substrate (pg_cron for in-DB jobs; one external cron for app-level jobs) with per-job monitoring |
| GAP-TU-03 | Rewrite `deidentify_user` to cover the full deletion matrix (tutor store, Doc 05 derived tables, ledgers/audit per spec) |
| GAP-OP-03 | T+7 deletion sweep job calling the rewritten routine |
| GAP-TU-02 + GAP-TU-01 | LISA retention jobs: 7-day soft-delete substrate + purge + archival windows |
| GAP-TU-08 | Tutor age-≥13 absolute floor + Tier-1 country gate; mount via the canonical feature-gate path |
| GAP-ID-07 (MFA half) | MFA for privileged roles |

**Exit proof:** seeded test account end-to-end: request deletion → T+7 job fires → zero student-linked rows remain outside the documented retention carve-outs (executable-proof query suite). Retention jobs visible in cron run-history.

## WS-3 — Entitlement & Access Correctness *(parallel with WS-2)*

| GAP | Action |
|---|---|
| GAP-ID-09 | Entitlement gates on full-length sub-routes + weakness routes via the canonical feature-contract layer (`canAccessFeature`), replacing ad-hoc helpers |
| GAP-ID-10 | Reserve quota at session create for item[0]; reserve-before-serve everywhere |
| GAP-ID-06 | Practice quota → 40/calendar-day (America/Chicago), value in config not literal (lands with OP-02 substrate) |
| GAP-TU-05 | Tutor limits → Doc 03 §13 structure (per-min/hour/day/week/month), config-driven |
| GAP-ID-01, GAP-ID-02, GAP-ID-03 | `is_guardian_of` link-status + bounded grace (per SP-02); guardian read surface → aggregate-only; single derivation mechanism on `guardian_links` |
| GAP-ID-12, GAP-TU-04, GAP-EX-05, GAP-TU-10, GAP-TU-07 | Scope validation at conversation create; leak filter on all pre-submit surfaces + replay; remove adaptive-bucket disclosure; 429 semantics; RAG sanitizer → allowlist projection |

**Exit proof:** denial-test suite (free user, lapsed user, revoked guardian, under-13-with-consent on tutor) green in CI.

## WS-4 — Doc 05 Mastery Rebuild *(the long arc; after WS-1; OP-02 first)*

Order inside the workstream follows the spec family: constants substrate → 05A → 05B → 05C → 05D → retire legacy.

| GAP | Action |
|---|---|
| GAP-OP-02 | `*_runtime_config` + constants tables seeded with locked Doc 05 values (closes GAP-MA-10's 20→40 and GAP-MA-11's dual-active rows in the same migration set) |
| GAP-MA-01 | 05A: `apply_mastery_event` + `mastery_events` + snapshot + audit log (PL/pgSQL, DB-owned formula) |
| GAP-MA-05 | 05B: event-aggregated domain mastery + KPI refreshers + refresh audit |
| GAP-MA-04 | 05C: projections with gates, blend, snapshots, outbox/state, locked 100→25 range |
| GAP-MA-07 + GAP-EX-03 | `mastery_outbox` + consumer; all sources emit events, none write mastery directly (shared seam with WS-5 — schema lands here, scoring writer lands in WS-5) |
| GAP-MA-06 | Strip app-code literals; read from constants tables |
| GAP-MA-02, GAP-MA-08 | Retire both legacy function families + `rebuild_mastery_and_kpis` after cutover |

**Exit proof:** Doc 05 family's own acceptance criteria + a replay harness: canonical event fixtures → deployed PL/pgSQL output == reference implementation, bit-exact.

## WS-5 — Doc 04 Scoring Rebuild *(after EX-01 schema; the moat)*

| GAP | Action |
|---|---|
| GAP-EX-01 | Canonical exam schema (`test_sessions`, `score_runs` insert-once + three-layer enforcement, `scoring_model_versions`, ledgers, outboxes) alongside the running `full_length_exam_*` engine, then cut over |
| GAP-EX-02 | Doc 04B V4.3 formula in PL/pgSQL; constants in DB; Python-reference parity CI gate (the existing 1,313-scenario validation packet becomes the fixture set) |
| GAP-EX-04 | Review unlock gated on the scoring row |
| GAP-EX-06, GAP-EX-07 | Difficulty CHECK at rest; `active_status` retirement + CASCADE→RESTRICT on history-bearing FKs |
| GAP-EX-08 | Simplified-launch review scheduling (one-success graduation + `review_schedule` + config) |

**Exit proof:** reference-parity gate green (Python ↔ PL/pgSQL bit-exact on the full sweep); insert-once proof; review-unlock denial test pre-scoring-row.

## WS-6 — Architecture Consolidation *(opportunistic during WS-4/5 touchpoints; completes after)*

GAP-AR-01 (service layer — extract per-domain as WS-4/5 touch each domain rather than big-bang), GAP-ID-05 (profile single writer), GAP-ID-04 (account family consolidation + data reconciliation of the 19-vs-13 split), GAP-AR-02 (one service-role client), GAP-AR-03, GAP-AR-04 (execute the SP-03 ruling: consolidate to the named canonical tree), GAP-ID-08 (audit sink), GAP-OP-04 (IdempotencyService), GAP-AR-05.

**Exit proof:** grep-guard CI (no `.from(...).insert/update` in route files; single client import path); writer-map regeneration shows one writer per owned table.

## WS-7 — Hygiene & Legacy Sweep *(last; mostly mechanical)*

GAP-HY-01, GAP-HY-02, GAP-HY-03, GAP-HY-04, GAP-HY-05, GAP-HY-06, GAP-HY-07, GAP-HY-08, GAP-HY-09, GAP-HY-10, GAP-HY-11, GAP-TU-09, GAP-ID-07 (dead-columns half), GAP-TB-04 (residual classification). One migration series dropping legacy tables/functions/indexes/triggers after WS-4/5 cutovers prove nothing references them; seed or retire the reference tables (GAP-HY-08).

**Exit proof:** capture re-run shows zero UNSPECED objects (or each surviving one documented), zero orphaned functions, no duplicate indexes/triggers/CHECKs.

## WS-S — Spec Revisions *(lock-cycle; runs parallel from day one)*

GAP-SP-01 (Doc 02C supersession marking), GAP-SP-02 (§6.2 grace carve-out — unblocks the ID-01 implementation detail), GAP-SP-03 (canonical tree — unblocks WS-6 target), GAP-SP-04 (RLS-posture review), GAP-SP-05 (lock pending quota/budget values + standalone-RAG tier — unblocks the WS-3 config seeds).

---

## Dependency snapshot

```
WS-0 ──────────────────────────────► (independent, ship first)
WS-1 ──► WS-2 ─┐
        WS-3 ─┤ (parallel)
        WS-4 (OP-02 → 05A → 05B → 05C → seam) ─► WS-5 (EX-01 → EX-02 → cutover) ─► WS-6 (completes) ─► WS-7
WS-S ──────────────────────────────► (parallel; SP-02 feeds WS-3, SP-03 feeds WS-6, SP-05 feeds WS-3 config)
```

## Coverage check

Every OPEN gap in registry V1.1 appears in exactly one workstream above (GAP-MA-09 in WS-0; GAP-MA-03 closing via WS-1; GAP-EX-03 shared-seam noted in WS-4, delivered with WS-5; GAP-TB-04 split: broken-access fixes in WS-0 scope if trivial, residual classification in WS-7). 66/66 mapped; 9 conformant behaviors carried as CI guards where proofs exist (C-1/C-2/C-3/C-8 already have tests; C-4/C-5/C-6/C-7/C-9 get regression guards as their domains are touched).
