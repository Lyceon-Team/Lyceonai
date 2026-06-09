# WS-2 / WS-3 Phase-0 — three-lane plan (PLAN MODE; no code)

> Grounded in the locked corpus (Doc 02 family + Doc 05 family + ADR-001), not summaries.
> HEAD `03fe22e`. Companion: [`../../../contracts/ws2-ws3-mastery-seam.contract.md`](../../../contracts/ws2-ws3-mastery-seam.contract.md)
> (Lane-A artifact). **Plan + contract + questions only.** After owner approval of the plan
> and the seam contract: Lane A builds first, then B/C parallelize, each per the normal loop
> (contract-first → implement → spec-auditor grill → Codex → tests → CI).

## Central finding (corrects the premise)

The event→mastery seam is **a synchronous, `service_role`-only RPC that RE-DERIVES mastery
from the upstream canonical answer tables** (`apply_mastery_event` → `canonical_mastery_events`,
inline 05B/05C refresh, one txn) — **NOT an outbox.** ADR-001 §5's `mastery_outbox` and
GAP-MA-07 are stale/refuted by the locked Doc 05A/05D; Doc 02B §25's
`apply_learning_event_to_mastery`/`event_type`-enum is the superseded 02C-gen seam (R1). The
real lock is the **`canonical_mastery_events` read-contract** — the denormalized columns
WS-2's answer tables must carry — plus the **insert-before-call** ordering. Details + the
contract: the companion file.

---

## The three lanes

### Lane A — seam contract (LOCK FIRST; blocks Lane C)

| # | Item | Waves | Closes | Depends | DB/app |
|---|---|---|---|---|---|
| A1 | The seam validation contract: `apply_mastery_event` signature + `canonical_mastery_events` read-contract + insert-before-call ordering + single-writer/idempotency/audit/anti-leak guards | WS-2+WS-3 | the seam-divergence risk; frames MA-01/MA-07 | **owner rulings on §HALT** | DB-contract (no migration) |

### Lane B — independent (NO cross-wave dependency; start in parallel immediately)

| # | Item | Wave | Closes (gap) | Depends | DB/app |
|---|---|---|---|---|---|
| B-W2-1 | Practice session+item tables; serving with anti-leak projection; idempotent submit (`client_attempt_id`); reserve-before-serve | WS-2 | TB-02(WS0✓ carry), ID-10, ID-06 | SP-05 (quota values) | DB migration + app |
| B-W2-2 | Review session+item tables; SM-2 `review_schedule` + lifecycle; review pre-submit leak filter | WS-2 | GAP-EX-08, TU-04 | SP-05 | DB migration + app |
| B-W2-3 | `practice_runtime_config` / `review_runtime_config` tables + seed | WS-2 | OP-02-adjacent, ID-06, TU-05 | **SP-05** (lock values) | DB migration |
| B-W3-1 | `mastery_constants` table + Doc 05 locked constants seed (0.50/0.30/0.20; 0.79/1.0/1.20; halflife 30; min-events 5; boundaries 0.20/0.40/0.60/0.80) | WS-3 | MA-06, MA-10, MA-11, OP-02 | — (values locked Doc 05 Parent §10.1) | DB migration |
| B-W3-2 | `compute_mastery_for_entity` formula (PL/pgSQL) + committed **Python reference** + §12 fixtures | WS-3 | MA-01 (formula) | B-W3-1 | DB (PL/pgSQL) |
| B-W3-3 | `student_skill/domain/cluster_mastery` + KPI rollup + projection tables; RLS lockdown + column grants | WS-3 | MA-01, MA-04, MA-05, ID-02 | — | DB migration |
| B-W3-4 | 05D audit tables (`mastery_event_audit_log` w/ `UNIQUE(event_source_kind,event_id)`; `mastery_domain_refresh_audit_log`); constants-governance (no-recompute, INV-05D-13); deterministic recompute | WS-3 | MA-08(→moot), MA-09(WS0✓) | B-W3-3 | DB migration |

### Lane C — coupled (waits on Lane A)

| # | Item | Waves | Closes (gap) | Depends | DB/app |
|---|---|---|---|---|---|
| C-1 | Add the `canonical_mastery_events` denormalized columns to WS-2 practice/review answer tables; wire `apply_mastery_event` call **after** the answer insert (same txn) | WS-2 | MA-07(re-disposed), EX-03(test→WS-4) | A1 | DB migration + app |
| C-2 | `apply_mastery_event` RPC + `canonical_mastery_events` view-function (read-contract over WS-2 tables) + inline 05B/05C refresh + idempotency lock/dedup | WS-3 | MA-01, MA-07 | A1, B-W3-2/3/4, C-1 | DB (PL/pgSQL) |
| C-3 | `projection_refresh_outbox` table + 05D consumer job (immediate full-length refresh). **The 04B EMIT is WS-4.** | WS-3 | MA-04, OP-01(scheduler) | A1, B-W3-3 | DB migration + app |
| C-4 | Seam integration tests (insert→RPC→mastery; idempotency replay on `(event_source_kind,event_id)`; ordering) | WS-2+WS-3 | MA-01 | C-1, C-2 | test |

---

## HALT items (numbered; owner ruling required before Lane C)

1. **H1 — RPC name + payload supersession.** Confirm the canonical seam is Doc 05A
   `apply_mastery_event` (+ `source_family`/`event_source_kind`/`correct` split), superseding
   Doc 02B §25's `apply_learning_event_to_mastery` + `event_type` enum. **Log an SP** to
   reconcile Doc 02B §25 (it still documents the 02C-gen seam). Also reconcile event-id:
   Doc 02B's `client_attempt_id` idempotency ↔ Doc 05A's `(event_source_kind, event_id)`.
2. **H2 — mastery_outbox refuted.** Confirm there is **no** mastery outbox (synchronous RPC
   is canonical, Doc 05A/05D). **Re-dispose GAP-MA-07** (registry calls the absent outbox a
   gap; the locked spec doesn't want one) and **log an SP** to amend ADR-001 §5.
3. **H3 — source-weight defect.** Deployed `mastery_constants` is test=1.5/practice=1.0/
   review=0.8; Doc 05 locks 0.50/0.30/0.20. R1 → Doc 05 wins (B-W3-1 seeds it). Confirm; the
   deployed values are GAP-MA-01's active defect (now moot — genesis bank empty, no mastery rows).
4. **H4 — `test` path blocked on WS-4.** The `test` source_family re-derives from
   `test_session_answers` denormalized by Doc 04 finalization (RB-05A-V1-04). That table +
   denormalization are **WS-4**. Confirm WS-3 builds/tests the **practice+review** paths now;
   the `test` path integrates at WS-4.
5. **H5 — `projection_refresh_outbox` cross-wave.** The table + 05D consumer are WS-3 (C-3);
   the **emit** (04B's scoring txn inserts `projection_refresh_outbox(student_id,
   'full_length_completed')`) is **WS-4**. Confirm the split.
6. **H6 — the read-contract is the lock.** Confirm WS-2's `practice_session_items` /
   `review_error_attempts` carry `(event_id, section, domain, skill, difficulty 1-3, correct,
   occurred_at, question_id)` so `canonical_mastery_events` can read them. This is Lane A's
   concrete deliverable; nothing in Lane C proceeds until it's locked.
7. **H7 — review emit semantics.** Confirm review emits on **both** correct and incorrect
   retries with `source_family='review'` (the table name `review_error_attempts` reads as
   incorrect-only — clarify it captures correct retries too), and that `used_tutor` is
   **telemetry-only**, never formula-facing (CR-02B-16 / G2).
8. **H8 — diagnostic surface.** `event_source_kind='diagnostic_attempt'` → `practice`
   (Doc 05A). Identify the diagnostic surface + its canonical answer table for the seam
   (is the baseline diagnostic a WS-2 surface, or separate?).

---

## CI-gate set per lane

**Lane A:** spec-auditor grill + Codex on the contract; the **Doc 05A §10 pre-implementation
verification gate** (RPC signatures, `mastery_constants` values == Doc 05 locked, table
shapes, the read-contract columns present) as the contract's machine acceptance.

**Lane B — WS-2:** anti-leak probe (C-1) on practice/review serving (no answer pre-submit);
idempotent-submit replay; reserve-before-serve denial (ID-10); SM-2 schedule determinism;
**genesis-fresh-apply** on every migration.

**Lane B — WS-3:** **Python-reference parity** — `compute_mastery_for_entity` bit-exact vs
the committed reference on the §12 fixtures (HARD gate); recompute-equivalence (Doc 05A §5.3);
**no-recompute-on-constants-change** (INV-05D-13); constants-from-DB lint (no hardcoded
mastery constants); single-writer grep-guard (C-3/C-8 — only `apply_mastery_event`/
`recompute_skill_mastery` write the mastery tables); mastery column-grant/RLS test (G3 —
`mastery_score`/`acc_*` not exposed to authenticated; guardians no read); C-9 level-boundary guard.

**Lane C:** seam integration — insert-before-call ordering (O1); idempotency replay on
`(event_source_kind, event_id)`; `canonical_mastery_events` read-contract; inline 05B/05C
refresh within one txn (rollback-all on failure); full-length immediate projection via
`projection_refresh_outbox`; **tutor-never-writes-mastery** grep (C-7).

**Carry-forward (all lanes touching their domain):** WS-0 anti-leak probe; the C-series
conformant guards; genesis-fresh-apply for any genesis-extending migration.
