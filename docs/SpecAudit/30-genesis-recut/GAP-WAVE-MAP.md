# Genesis Re-Cut — GAP → Wave Map (all 71 registry gaps)

> **Count reconciled 2026-06-22:** this map was first cut for **66** gaps; the registry is
> now **71** (the +5 auth+deletion arc HY-12…HY-16). The arc + the WS-3 progress lead are
> folded in via the **Addendum** at the foot of this file; the body below remains the
> original 66-gap mapping. See that addendum for the explicit delta.

> Derived from [`../10-gap-registry/gap-registry.md`](../10-gap-registry/gap-registry.md)
> (V1.1, 66 gaps) under the teardown + genesis-from-spec re-cut
> ([`RECUT-CONTRACT.md`](./RECUT-CONTRACT.md)). The registry stays the source of
> truth for *gaps*; this file re-assigns their *execution* to spec-domain waves.
> Registry **status** is unchanged here — a gap flips to CLOSED only in its wave's
> owner-proven closure, citing its proof.

## The re-cut's central property

Genesis-from-spec **closes the majority of DRIFT/MISSING gaps by construction**:
the deployed wrong-generation / leaky / legacy object is torn down, and the
spec-correct object is built natively in its owning wave. What *survives* the
teardown is **app-layer code** (TypeScript gating, serializers, service layer —
not DB) and **spec revisions**. Disposition vocabulary:

| Code | Meaning |
|---|---|
| **CBC-build** | Closed by construction via a *substantial greenfield build* in the named wave (e.g. Doc 05 mastery, Doc 04B scoring) |
| **CBC-native** | Closed by the genesis DDL itself — RLS, CHECK, single-writer ownership, seeded constants, correct FK — no separate effort |
| **CBC-moot** | Legacy object simply **not recreated** by genesis; zero effort, zero residue |
| **CODE** | Still-real **app-layer** defect that survives teardown (it is TS, not schema); must be implemented in the named wave |
| **SPEC** | Spec-revision; WS-S lock-cycle only |
| **WS0✓** | Already closed in WS-0; the *patch* is mooted by teardown but genesis re-ships the protection natively, and the WS-0 probe carries forward as a **CI guard** |

**Tally (original 66-gap body):** 66 gaps → **CBC-native 18 · CBC-build 11 · CBC-moot 12 ·
CODE 13 · SPEC 6 · WS0✓ 6** (TB-04 counted once as CBC-native). Net new *build* effort
concentrates in WS-3/WS-4/WS-5/WS-6; net *code* effort in WS-2/WS-5/WS-8. The **+5 arc**
(HY-12…HY-16) adds **CODE ×3 (HY-12/13/16) · CBC-build ×1 (HY-15) · SPEC ×1 (HY-14)** —
see the Addendum.

---

## Zone TB — Database Trust Boundary

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| TB-01 | CRIT | CLOSED(WS0) | **WS0✓** | WS-1 | genesis ships anti-leak natively (serving projection + RLS, Doc 02 §12); WS-0 anon-probe → CI guard |
| TB-02 | CRIT | CLOSED(WS0) | **WS0✓** | WS-2 | denormalized answer cols on session-items not recreated leaky; serving contract owns reveal |
| TB-03 | CRIT | CLOSED(WS0) | **WS0✓** | WS-1 | 9 RLS-off tables: legacy not recreated; genesis = RLS-enabled everywhere |
| TB-04 | MED | OPEN | **CBC-native** | WS-1 | "14 deny-all tables, classify" vanishes — genesis only creates intended tables with correct posture |

## Zone MA — Mastery, KPI, Projections *(R1: rebuild to Doc 05)*

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| MA-01 | CRIT | BUILD | **CBC-build** | WS-3 | Doc 05A `apply_mastery_event` + events + snapshot + audit; wrong-gen stack torn down |
| MA-02 | HIGH | RETIRE | **CBC-moot** | WS-3 | second formula family never recreated |
| MA-03 | HIGH | PROCESS | **CBC-native** | WS-1/3 | no untracked RPC exists post-genesis — genesis IS the tracked definition |
| MA-04 | HIGH | BUILD | **CBC-build** | WS-3 | Doc 05C projections (gates, blend, snapshots, outbox, 100→25 range) |
| MA-05 | HIGH | BUILD | **CBC-build** | WS-3 | Doc 05B event-aggregated domain/KPI |
| MA-06 | HIGH | FIX-CODE | **CODE** | WS-3 | strip app-code constant literals; read from genesis `*_runtime_config` |
| MA-07 | HIGH | MISSING | **CBC-build** | WS-3 | `mastery_outbox` seam + consumer (shared with WS-4) |
| MA-08 | MED | RETIRE | **CBC-moot** | WS-3 | `rebuild_mastery_and_kpis` legacy not recreated |
| MA-09 | MED | CLOSED(WS0) | **WS0✓** | WS-1 | constants-governance triggers ship `ENABLE ALWAYS` natively |
| MA-10 | MED | FIX-DB | **CBC-native** | WS-1 | `DIAGNOSTIC_TOTAL_QUESTIONS=40` seeded from spec (not 20) |
| MA-11 | MED | FIX-DB | **CBC-native** | WS-1 | single-active `kpi_constants` seeded from spec; no UNSPECED `flowcard` |

## Zone EX — Full-Length Exams & Scoring

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| EX-01 | HIGH | MISSING | **CBC-build** | WS-4 | Doc 04 canonical exam schema (`test_sessions`, `score_runs`, ledgers, outboxes) |
| EX-02 | CRIT | BUILD(moat) | **CBC-build** | WS-4 | Doc 04B V4.3 closed-form formula in PL/pgSQL + Python-parity CI gate |
| EX-03 | HIGH | BUILD | **CBC-build** | WS-4 | events emit from the scoring transaction via outbox (with MA-07) |
| EX-04 | MED | FIX-CODE | **CODE** | WS-4 | review unlock gated on the completed `score_runs` row |
| EX-05 | MED | FIX-CODE | **CODE** | WS-2 | adaptive-bucket disclosure is **frontend** — survives teardown; remove badge + response field |
| EX-06 | MED | FIX-DB | **CBC-native** | WS-1 | `CHECK (difficulty BETWEEN 1 AND 3)` at rest in the genesis `questions` DDL |
| EX-07 | MED | MISSING | **CBC-native** | WS-4 | `active_status` retirement + CASCADE→RESTRICT on history-bearing FKs built in |
| EX-08 | MED | BUILD | **CBC-build** | WS-2 | SM-2 `review_schedule` + `review_runtime_config` (Doc 02B review engine) |

## Zone TU — Tutor / LISA / Privacy

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| TU-01 | HIGH | BUILD | **CBC-build** | WS-5 | bounded-retention guarantee (depends WS-6 scheduling) |
| TU-02 | HIGH | MISSING | **CBC-build** | WS-5 | LISA retention lifecycle (7-day soft-delete, archival, purge worker) |
| TU-03 | CRIT | FIX-DB | **CBC-build** | WS-5/6 | `deidentify_user` built correct over the full deletion matrix; legacy (targets dead table) not recreated |
| TU-04 | MED | FIX-CODE | **CODE** | WS-2 | leak filter on review pre-submit + conversation replay (app-layer) |
| TU-05 | HIGH | FIX-DB | **CBC-native** | WS-5 | tutor limits → Doc 03 §13 structure, config-driven from genesis config |
| TU-06 | HIGH | CLOSED(WS0) | **WS0✓** | WS-5 | no student-insert policy on memory summaries; trusted-writer only |
| TU-07 | LOW | FIX-CODE | **CODE** | WS-5 | RAG sanitizer → allowlist projection |
| TU-08 | HIGH | FIX-CODE | **CODE** | WS-5 | absolute age-≥13 floor + Tier-1 gate via `canAccessFeature('tutor_access')` |
| TU-09 | LOW | FIX-DB | **CBC-moot** | WS-1 | `tutor_interactions` (verbatim cols) not recreated — *the mooted D4 drop* |
| TU-10 | LOW | FIX-CODE | **CODE** | WS-5 | 429 (not 402) on tutor budget exhaustion |

## Zone ID — Identity, Guardian, Entitlement *(R2 applied)*

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| ID-01 | HIGH | FIX-DB | **CBC-native** | WS-1 | `is_guardian_of` via `guardian_links` w/ link-active + bounded grace (SP-02) |
| ID-02 | HIGH | FIX-DB | **CBC-native** | WS-1/3 | guardian RLS aggregate-only; no `mastery_score` row exposure (mastery RLS in WS-3) |
| ID-03 | MED | FIX-DB | **CBC-native** | WS-1 | single guardian-derivation mechanism (`guardian_links`), not the `profiles` pointer |
| ID-04 | HIGH | FIX | **CBC-moot** | WS-1 | account split-brain: legacy `lyceon_accounts`/`accounts` not recreated; reseed = test accounts on `auth.users` only — the 19-vs-13 data discarded |
| ID-05 | HIGH | FIX-CODE | **CBC-native + CODE** | WS-1/8 | genesis `profiles` single-writer DDL; app-code writer consolidation in WS-8 |
| ID-06 | HIGH | FIX-DB | **CBC-native** | WS-1/2 | practice quota 40/calendar-day (America/Chicago) config-driven; value from SP-05 |
| ID-07 | MED | CLEANUP+BUILD | **CBC-moot + CBC-build** | WS-1/6 | dead plaintext-auth cols on `users` not recreated; MFA built in WS-6 |
| ID-08 | MED | FIX-CODE | **CBC-native + CODE** | WS-1/8 | genesis `audit_logs` is the mandated sink; app write-wiring in WS-8 |
| ID-09 | HIGH | FIX-CODE | **CODE** | WS-2/4/5 | entitlement gates on premium routes via `canAccessFeature` (app-layer) |
| ID-10 | MED | FIX-CODE | **CODE** | WS-2 | reserve-before-serve at session create (item[0]) |
| ID-11 | CRIT | CLOSED(WS0) | **WS0✓** | WS-5 | genesis consent flow binds metadata; full guardian-identity binding deferred to WS-5 (per registry ID-11 note) |
| ID-12 | MED | FIX-CODE | **CODE** | WS-5 | validate client-supplied scope IDs at conversation create |

## Zone OP — Scheduling, Operations, Provenance

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| OP-01 | HIGH | MISSING | **CBC-build** | WS-6 | scheduling substrate (pg_cron jobs + monitoring) |
| OP-02 | HIGH | MISSING | **CBC-native** | WS-1 | `*_runtime_config` family lands in genesis `0000` (Doc 01A) |
| OP-03 | HIGH | PARTIAL | **CBC-build** | WS-6 | account-deletion auto-exec (pairs TU-03; depends OP-01) |
| OP-04 | MED | MISSING | **CBC-native** | WS-1 | `idempotency_records` + `IdempotencyService` in genesis `0000` (Doc 01A §31) |
| OP-05 | HIGH | PROCESS | **CBC-native** | WS-1 | **subsumed** — genesis IS the single-pipeline provenance; D1 Drizzle-severance survives |

## Zone AR — Architecture & Layering

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| AR-01 | HIGH | FIX-CODE | **CODE** | WS-8 | per-domain service layer (extracted as WS-2..5 touch each domain) |
| AR-02 | MED | FIX-CODE | **CODE** | WS-8 | one service-role client |
| AR-03 | MED | FIX-CODE | **CBC-native + CODE** | WS-1/8 | genesis single-writer DDL closes the schema half; app-write consolidation WS-8 |
| AR-04 | LOW | AMBIGUITY | **SPEC→CODE** | WS-S/8 | SP-03 names the canonical tree, then consolidate |
| AR-05 | LOW | FIX-CODE | **CODE** | WS-8 | consistent response envelope |

## Zone HY — Hygiene & Legacy *(teardown moots most)*

| GAP | Sev | Registry | Genesis disp. | Wave | Note |
|---|---|---|---|---|---|
| HY-01 | MED | CLEANUP | **CBC-moot** | WS-1 | legacy parallel tables not recreated |
| HY-02 | MED | CLEANUP | **CBC-moot** | WS-1 | orphan function families not recreated (*the mooted D4 fn-drops*) |
| HY-03 | LOW | CLEANUP | **CBC-moot** | WS-1 | duplicate indexes gone |
| HY-04 | MED | FIX-DB | **CBC-native** | WS-1 | genesis FKs are VALID (no `NOT VALID`) |
| HY-05 | LOW | CLEANUP | **CBC-moot** | WS-1 | double-firing triggers gone |
| HY-06 | LOW | CLEANUP | **CBC-moot** | WS-1 | `v_half_life_days` mis-shaped object gone |
| HY-07 | LOW | DRIFT | **CBC-native** | WS-1 | `vector` extension placed out of `public` |
| HY-08 | MED | MISSING | **CBC-native** | WS-1 | reference tables seeded from spec taxonomy |
| HY-09 | LOW | CLEANUP | **CBC-moot** | WS-1 | overlapping CHECKs gone |
| HY-10 | LOW | FIX-DB | **CBC-build** | WS-6 | `stripe_webhook_events` retention policy |
| HY-11 | LOW | CLOSED | **CLOSED** | — | already closed (PR #348) |

## Zone SP — Spec-Revision Items *(WS-S lock-cycle only)*

| GAP | Item | Wave |
|---|---|---|
| SP-01 | Mark Doc 02C V4 superseded by Doc 05 family | WS-S |
| SP-02 | Coding-standards §6.2 guardian grace carve-out (link-active mandatory) | WS-S |
| SP-03 | Name the canonical route/service tree (`server/` vs `apps/api/`) | WS-S |
| SP-04 | Doc 01 V8 §14.3 RLS-bypass vs RLS-enabled Supabase reality — **resolved toward RLS-enabled** (re-cut decision #6); WS-S records the reconciliation | WS-S |
| SP-05 | Lock pending quota/budget values + standalone-RAG tier | WS-S |
| **SP-06** | **NEW** — Doc 00 V6 §3/§11 stale "Doc 01 V8 pending" note → update on V8 lock (Doc 00 §15 self-flags it) | WS-S |

## Conformant register (must stay true in the rebuild — carried as CI guards)

C-1 anti-leak serializer · C-2 idempotent submit + Stripe dedup · C-3 mastery
write-lockdown · C-4 server-authoritative timer · C-5 review difficulty
normalization · C-6 stateless GCP worker · C-7 tutor never writes mastery ·
C-8 mastery write choke-point + grep-guard · C-9 level boundaries
0.19/0.39/0.59/0.79. Genesis must **preserve** each; the existing tests
(C-1/2/3/8) and new guards (C-4/5/6/7/9) gate every wave that touches the domain.

---

## Coverage check

All 66 **original-body** registry gaps appear exactly once above (HY-11 already CLOSED; the
rest mapped to a wave + genesis disposition). The 6 SP items route through WS-S. The
9 conformant behaviors carry forward as CI guards. The two mooted provenance-WS-1
drops (TU-09, HY-02 fn-set) are absorbed as **CBC-moot** — genesis never recreates
them, so the D4 drop migration is unnecessary (see RECUT-CONTRACT §8). The **+5 auth+deletion
arc (HY-12…HY-16)** and the **WS-3 progress lead** are covered in the Addendum below — total
coverage is the registry's current **71** gaps.

---

## Addendum — auth+deletion arc + WS-3 progress lead (2026-06-22)

The registry grew from the V1.1 **66** to **71 gap entries** — the **+5** auth+deletion arc
(**HY-12 … HY-16**), born after this map was first cut (the auth rebuild + GDPR/COPPA deletion
lifecycle). They are folded into their execution waves below; the WS-3 progress lead (the live
`/api/progress/*` 500 fix) is recorded as a CODE item already DONE. The registry also tracks
**21** spec-revision items (was **6** SP here; grew via SP-06…SP-25) and **9** conformant
verifications — routed through WS-S / CI guards as before, not counted as gaps.

| Gap | Sev | Disposition | Wave | Status (2026-06-22) | Note |
|---|---|---|---|---|---|
| HY-12 | MED | **CODE** | WS-8 (frontend hygiene) | OPEN | raw-string display, 8 non-auth surfaces; `SubscriptionPaywall.tsx:147` first |
| HY-13 | HIGH | **CODE** (+ governed migration) | WS-6 | BUILT + PROD-RECONCILED — activation owner-gated | deletion insert/cron/soft-lock; `account_deletion_lifecycle` = ledger row 15; flag flip + §40.3/40.4 increment pending |
| HY-14 | HIGH | **SPEC** | WS-S | RESOLVED — §40.6 spec edit pending owner | uniform 7-day per counsel; no new code |
| HY-15 | HIGH | **CBC-build** (STAGE-MIGRATION) | WS-6 | PARTIAL — core RPC applied + governed | `deidentify_user` core done; feature-table cascade OPEN (TU-03 / Doc 03A) |
| HY-16 | HIGH | **CODE** | WS-6 | PARTIAL — backend+UI+e2e shipped | global soft-lock; §40.3 spec edit + flag activation pending |
| WS-3 lead | — | **CODE** | WS-3 | DONE (#415 → `cleanup`) | `/api/progress/*` rewired off retired old-gen columns to genesis Doc-05 (event vocabulary; §10.5 breakdown drop) |

### MA-07 read-layer rebuild — column-drift class + dead-code close-out (2026-06-23)

| Gap | Sev | Disposition | Wave | Status (2026-06-23) | Note |
|---|---|---|---|---|---|
| MA-12 | HIGH | **CODE** | WS-3 | CLOSED (#419 + step-6 → `cleanup`) | GENESIS-COLUMN-DRIFT CLASS: 4 broken `student_skill_mastery` queries (non-existent columns + `user_id`→`student_id`); RAG classifier rewritten to canonical `mastery_score`; anti-leak chokepoint hardened; dead code deleted |
| HY-17 | LOW | **PROCESS** | — | OPEN | BASELINE-TEST-DEBT: 36 pre-existing test failures across 15 files; honest baseline pinned by Codex audit; not regressions |

**Count delta (explicit):** wave-map **66** gaps **+ HY-12…HY-16 (5) + MA-12 + HY-17 (2)** = registry **73** gaps.
Spec-revision items **6 → 21** (genesis re-cut + WS-2/3 Phase-0 + Lane-C revisions, SP-06…SP-25);
conformant verifications **9** (unchanged). Per-gap status detail is reconciled in
`../10-gap-registry/gap-registry.md` § "Reconciliation addendum — genesis re-cut resume".
