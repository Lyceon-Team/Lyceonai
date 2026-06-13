# 05B/05C Rollup Wave — Domain Mastery + KPI + Section Projection (State A) — Correctness Contract

**Workstream:** WS-3 05B/05C rollup wave; completes the spine `apply_mastery_event` → skill → **domain → KPI → projection**, retiring **AM-3**. Builds against the live, proven Lane-C seam.
**Plan + HALT rulings:** owner-approved 2026-06-13 (this contract is the contract-first artifact for that plan).
**Spec:** Doc 05B (V1.0 LOCKED) §2/§3/§4/§5/§6/§7/§9/§10; Doc 05C (V1.0 LOCKED) §2/§3/§4/§5/§6/§7/§8; Doc 05 Parent §4.2/§6/§7.8. Citations are `Doc 05B §S` / `Doc 05C §S`.
**Closes (on owner-proven apply + gates green):** the `recompute_skill_mastery`/`apply_mastery_event` **TODO(05B)**; **AM-3** (apply_mastery_event §4.9 re-opened). **Carries (named forward-refs):** AM-1 cluster (HALT-2 → registry decision item); 05C blend States B/C + outbox consumer + 04B read surface (WS-4); 05C 24h time-sweep + outbox (05D).

Proof mechanisms: **`STRUCT`** (structural query on fresh-apply), **`PARITY`** (PL/pgSQL == Python reference == spec fixtures, bit-exact), **`TXN`** (atomicity probe), **`REPLAY`** (idempotency), **`LAT`** (hot-path + spike latency), **`GUARD`** (CI guard proven by a planted violation).

## A — `refresh_domain_mastery` (Doc 05B §4)
- **A1** `refresh_domain_mastery(p_student_id, p_section, p_domain)` → `student_domain_mastery`, `SECURITY DEFINER`, search_path locked, `REVOKE…FROM PUBLIC` + `GRANT EXECUTE…TO service_role`. Computes via **the existing** `compute_mastery_for_entity(p_student_id, 'domain', p_section, p_domain, NULL)` — **INV-05B-13 / INV-05A-11: the ONE formula impl, NOT a skill roll-up**. Validation → domain advisory lock → constants+hash → compute → before-read → upsert `student_domain_mastery` → audit → §4.9 KPI chain. Proof: `STRUCT` + `PARITY`.
- **A2 — consume-don't-fork.** Re-aggregates *events* at domain grain via `canonical_mastery_events(entity_type='domain')`; does **not** read `student_skill_mastery`. Proof: `GUARD` (05B SQL must not reference `student_skill_mastery` as a read source) + `PARITY` (`test_domain_mastery_equals_event_aggregation`: multi-skill domain ≠ skill roll-up).
- **A3** No numeric formula literal in the body (calls compute; reads constants). Proof: `GUARD` (no-hardcoded-constants over the 05B formula functions).

## B — KPI refreshers (Doc 05B §4.9 / §6) — all four, synchronous
- **B1** `refresh_section_kpi(student,section)`, `refresh_domain_kpi(student,section,domain)`, `refresh_skill_kpi(student,section,domain)` (refreshes **all** skills in the domain), `refresh_overall_kpi(student)` — each `SECURITY DEFINER`, service_role-only, the **single writer** of its table (`student_section_kpi` / `student_domain_kpi` / `student_skill_kpi` / `student_overall_kpi`). Called by `refresh_domain_mastery` §4.9 in the same txn. Recency-window constants read from the constants table (INV-05B-15) — no literals. Proof: `STRUCT` + `PARITY` (KPI streak/edge fixture) + `GUARD`.
- **B2 — KPI is a materialized derivative, never a source of truth** (INV-05B-14). Proof: `GUARD`.

## C — `student_domain_mastery` + KPI tables (Doc 05B §5/§7/§10)
- **C1** `student_domain_mastery` (B-WS3-1 shell) gains its refresh + **guardian-readable** RLS (entitlement-gated: active link AND active student entitlement) + column grants (`mastery_level` to student-self AND linked-guardian; `mastery_score`/`acc_*` admin/internal only — INV-05A-12). 4 KPI tables net-new, RLS deny-all + service-role write + guardian read on section/domain/overall; **`student_skill_kpi` student-self only** (no guardian). Proof: `STRUCT` + `GUARD` (column-grant/RLS).

## D — `compute_section_projection` (Doc 05C §5/§6) — STATE A only this wave (HALT-1)
- **D1** `compute_section_projection(p_student_id, p_section, p_now)` → `student_section_projections` (current) + append `student_section_projection_snapshots` (append-only; Q6 = the audit trail), one txn. **State A only:** `mastery_term = SECTION_MIN_SCORE + (Σ_domains domain_mastery×domain_weight)×(SECTION_MAX_SCORE−SECTION_MIN_SCORE)`; range = evidence band; clamp [SECTION_MIN,SECTION_MAX]; round to `PROJECTION_*_ROUND_TO`. `SECURITY DEFINER`, service_role-only. Proof: `STRUCT` + `PARITY` (§6 worked examples, incl. Example 2 Math **480 (380–580)**).
- **D2 — consume-don't-fork (INV-05C-A1/A2).** Reads `student_domain_mastery.mastery_score` (05B output) + `read_projection_constants()`; **never** calls `compute_mastery_for_entity`, never re-scores. The 04B blend (States B/C) is a **named deploy-gated forward-ref** (WS-4) — State A has no 04B dependency. Proof: `GUARD` (05C must not call `compute_mastery_for_entity`) + `STRUCT`.
- **D3 — projection constants operational, excluded from the formula hash** (INV-05C-16): `SECTION_MIN_SCORE=200`, `SECTION_MAX_SCORE=800`, 8 domain weights (§4.2), `PROJECTION_REFRESH_EVENT_THRESHOLD=40`, `PROJECTION_REFRESH_TIME_THRESHOLD_HOURS=24`, `PROJECTION_*_ROUND_TO=10`, evidence-band constants — seeded into `mastery_constants`, read via `read_projection_constants()`, **NOT** in `canonicalize_mastery_constants`'s hash list. No literals. Proof: `GUARD` + `STRUCT`.
- **D4** `student_section_projections` + `_snapshots` guardian-readable (entitlement-gated, same-row read — no reroute/recompute, INV-05C-P3/§2.5); snapshots append-only (no UPDATE/DELETE except 05D cascade — INV-05C-17). Proof: `STRUCT` + `GUARD`.

## E — Throttle + §4.9 re-open (Doc 05C §8; Doc 05B §4.9; Doc 05A §4.9)
- **E1** `student_projection_refresh_state` (05C-owned: `events_since_projection_refresh`, `last_projection_refresh_at`) + a 05C-owned increment fn `bump_projection_refresh_counter(student, section)`. `apply_mastery_event` §4.9: `refresh_domain_mastery` (always) **then** `bump_projection_refresh_counter`; when `events_since_projection_refresh ≥ PROJECTION_REFRESH_EVENT_THRESHOLD` it calls `compute_section_projection(student, section, now())` in the **same txn** and resets the counter. The **24h time-trigger** and **full-length outbox consumer** are carried (05D / WS-4). All in `apply_mastery_event`'s single transaction. Proof: `STRUCT` + `TXN` + `LAT`.

## F — D1/D2/D3 re-proof with §4.9 wired (the load-bearing gate)
- **F1 `TXN` (atomicity).** The mid-txn-failure probe asserts `student_skill_mastery`, `student_domain_mastery`, **all 4 KPI tables**, `student_section_projections`, and `_snapshots` are **all 0** after rollback (skill+domain+KPI+projection are one unit, or none). The D1b non-derived-event probe still refuses before any downstream write.
- **F2 `REPLAY` (idempotency).** Same `(event_source_kind, event_id)` twice → exactly one row in skill+domain+each KPI; projection idempotent (duplicate refresh = identical snapshot, §8.5).
- **F3 `LAT` (latency — sharpened per HALT-4).** Assert BOTH the **common-path** (skill+domain+4 KPI, no projection) AND the **every-40th spike-path** (the throttled projection-firing txn) stay within the spec ceiling. If the spike blows budget, the gate FAILS (surface → throttle-tune or async), not production.
- **F4 `PARITY` (skill unchanged).** Re-run skill isolation (31/31) + production (19) with §4.9 live — proves the refreshers don't perturb skill mastery.

## G — Parity gates (each formula, same bar as 31/31 skill)
- **G1 domain-mastery-parity** (`PARITY`): Python reference = the same V1.0 formula at domain grain over the 31 §12 vectors re-expressed at domain grain; bit-exact three-way; blocking. Plus INV-05B-13 event-aggregation test.
- **G2 kpi-parity** (`PARITY`): Python reference of the KPI streak/edge fixture; three-way; blocking.
- **G3 projection-parity** (`PARITY`): Python reference of the State-A blend (mastery-term + evidence band + clamp + round) over Doc 05C §6 worked-example fixtures; three-way; blocking. States B/C deferred (WS-4).

## H — Out of scope (carried, named)
AM-1 cluster mastery (no 05-family spec home — HALT-2, registry decision item); 05C blend States B/C + outbox **consumer** + 04B `full_length_section_scores` read surface (WS-4 deploy-gated forward-refs); 05C 24h time-sweep + outbox emit (05D / 04B); SP-21/22/23 (owner-side Doc 05A spec-drift).
