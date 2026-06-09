# B-WS3-1 — Mastery formula core + constants + parity — Correctness Contract

**Workstream:** WS-3 Lane B per `docs/SpecAudit/40-ws2-ws3/PHASE-0-PLAN.md`.
**Closes (on owner-proven apply + parity green):** GAP-MA-01 (canonical formula), GAP-MA-06
(constants from DB), GAP-MA-10 / GAP-MA-11 (constants seed), GAP-ID-02 (mastery RLS aggregate/
lockdown); creates the mastery/KPI/projection table shells the 05B/05C refreshers (later items)
fill.
**Spec:** Doc 05A (V1.0 LOCKED, `42c1ead`) §4/§5/§6/§7/§9/§12; Doc 05 Parent §4/§10.1; Doc 05D
§3/§4 (constants governance, audit). Citations are `Doc 05A §S`.

Falsifiable post-conditions, each naming its proving mechanism (Doc 00 §9). Proof mechanisms:
**`STRUCT`** (structural query on fresh-apply), **`PARITY`** (PL/pgSQL == Python reference ==
§12 expected, bit-exact within tolerances), **`GUARD`** (a CI guard, *proven by a planted
violation*).

## A — `mastery_constants` (formula-class; Tier-3 governance)
- **A1** `mastery_constants` (key/value) seeded with the **exact Doc 05 V1.0 values**:
  `weight_source_test=0.50`, `weight_source_practice=0.30`, `weight_source_review=0.20`;
  `difficulty_weight_easy=0.79`, `_medium=1.0`, `_hard=1.20`; `POSITION_HALF_LIFE=30`;
  `MIN_EVENTS_FOR_MASTERY=5`; `mastery_level_1_min=0.20`, `_2_min=0.40`, `_3_min=0.60`,
  `_4_min=0.80`; `mastery_min=0.0`, `mastery_max=1.0`; `ROUND_MASTERY_SCORE_DECIMALS=4`,
  `_PCT_DECIMALS=2`, `ROUND_ACCURACY_DECIMALS=6`, `ROUNDING_MODE`; `mastery_model_version='v1.0'`.
  (Verbatim list from the grounding pass.) **Formula-class only — NO operational constant here**
  (those are in `*_runtime_config`, the prior migration). Proof: `STRUCT` (values == Doc 05 locked).
- **A2** No-recompute-on-change (Doc 05D INV-05D-13): a `mastery_constants` edit restamps **no**
  existing mastery/KPI/projection row; each row carries `constants_snapshot_hash`. Change-capture:
  a `constants_audit_log`/`_history` row on change (append-only). Proof: `GUARD` (a constants edit
  touches zero `student_*_mastery` rows) + `STRUCT`.

## B — `compute_mastery_for_entity` (the formula; PL/pgSQL, DB-owned)
- **B1** Single implementation (Doc 05A INV-05A-11): the macro-average formula exists in exactly
  ONE function `compute_mastery_for_entity`; signature per §6.1
  `(p_student_id, p_entity_type 'skill'|'domain', p_section, p_domain, p_skill)` →
  `(total_events, acc_test, acc_practice, acc_review, mastery_score, mastery_pct, mastery_level)`,
  `STABLE SECURITY DEFINER`. Proof: `STRUCT`.
- **B2** **Reads every constant from `mastery_constants`** — no numeric literal in the function
  body (Doc 02B INV-02B-15). Proof: `GUARD` (`no-hardcoded-constants` over the fn body) **proven
  by a planted hardcode turning the guard red**.
- **B3** Mechanics (Doc 05A §6, verbatim): position weight `POWER(0.5,(pos-1)/POSITION_HALF_LIFE)`
  with `pos = ROW_NUMBER() OVER (ORDER BY occurred_at DESC, event_id DESC)` (deterministic
  tie-break); per-source accuracy; macro-average over present sources with
  `NULLIF(Σ present-source weights, 0)`; clamp `[mastery_min, mastery_max]`; rounding per the
  ROUND_* constants + ROUNDING_MODE; `mastery_pct`. Proof: `PARITY`.
- **B4** NULL-below-threshold (Doc 05A §6 Step 3 / INV-6): `total < MIN_EVENTS_FOR_MASTERY`
  → `mastery_score/pct/level = NULL`. Proof: `PARITY` (sparse fixtures S1..S8).
- **B5** Level lookup (§6.3): half-open intervals against the boundary constants
  (0.19→L0, 0.20→L1, 0.5999→L2, 0.60→L3, 0.7999→L3, 0.80→L4). Proof: `PARITY`.
- **B6** Deterministic recompute equivalence (Doc 05A §5.3): event-time path == recompute path
  on every column except `computed_at`/`last_event_*`. Proof: `PARITY` (recompute-equivalence test).

## C — Mastery / KPI / projection tables (RLS-lockdown; named single writer)
- **C1** Tables created with the Doc 05 schema + **RLS enabled deny-all**; each names its
  **single canonical writer**:
  | table | single writer (only writer) | reader posture |
  |---|---|---|
  | `student_skill_mastery` | `apply_mastery_event` + `recompute_skill_mastery` (INV-05A-11) | student self-read, **column-grant** to `(student_id,section,domain,skill,mastery_level,computed_at)` only; **no guardian** (INV-05A-12) |
  | `student_domain_mastery` | `refresh_domain_mastery` (05B) | aggregate; guardian aggregate-only |
  | `student_cluster_mastery` | `refresh_cluster_mastery` (05B) | aggregate |
  | `student_*_kpi` / `student_kpi_rollups_current` | `refresh_{section,domain,skill,overall}_kpi` (05B) | derived |
  | `student_section_projections` | `compute_section_projection` (05C) | derived |
  | `mastery_event_audit_log` (05D) | shared append-only; `UNIQUE(event_source_kind,event_id)` | admin |
- **C2** `mastery_score`/`acc_*`/counters NOT exposed to `authenticated`; guardians no read
  (INV-05A-12 / Doc 02 INV-02-06). Proof: `GUARD` (column-grant/RLS test) + `STRUCT`.
- **C3** Single-writer enforced: a CI grep-guard fails on a stray write to a mastery table outside
  its named writer (Doc 05A INV-2 / C-3 / C-8). Proof: `GUARD`.

## D — The PARITY hard gate (the correctness contract)
- **D1** `compute_mastery_for_entity` (PL/pgSQL) output == the committed **Python reference**
  output == the **Doc 05A §12 expected** values, **bit-exact within tolerances** (acc ±1e-6,
  score ±1e-4, pct ±0.01, level exact), across **all** B1..B23 + S1..S8 fixtures. Wired
  **blocking** in CI. Proof: `PARITY` (three-way: spec-expected anchors both impls).

## E — Guards proven by planted violations (Codex requirement)
- **E1** `no-hardcoded-constants` turns **red** when a constant literal is planted in the formula
  body (not just green on clean code). Proof: a planted-violation test asserts non-zero exit.
- **E2** `tutor-never-writes-mastery` turns **red** when a tutor path is planted with a mastery
  write. Proof: planted-violation test.

## F — Carried seam note (for Codex, non-blocking for B-WS3-1)
- **SP-17 is an ordering-guarantee verification, not an index confirmation.** The `skill_codes[1]
  = primary` decision is only safe if the question pipeline guarantees array-position-1 is the
  primary skill **by construction**. SP-17 must verify that guarantee (or escalate to an explicit
  `primary_skill` column). Flag to Codex as a seam assumption to probe — do not rubber-stamp.

## G — Out of scope (later items)
`apply_mastery_event` + `canonical_mastery_events` (Lane C, needs WS-2 answer tables); the 05B
KPI/domain refreshers and 05C projection refresher bodies (B-W3-3 / their own items); the `test`
source path (WS-4). B-WS3-1 builds the formula core + constants + table shells + the parity gate.

## H — Proof status (2026-06-10, all GREEN)
- **D1 (PARITY) — PROVEN.** `scripts/reference/mastery_reference.py --selfcheck` ⇒ Python
  reference == Doc 05A §12 expected for all 31 fixtures; `scripts/ci/mastery-parity.sh`
  (PG16) ⇒ PL/pgSQL `compute_mastery_for_entity` == Python reference == §12 expected,
  bit-exact within tolerances (acc ±1e-6, score ±1e-4, pct ±0.01, level exact). Wired
  **blocking** as the `mastery-parity` CI job. Output: `PARITY GATE PASSED — all 31 fixtures`.
- **B6 (recompute-equivalence, §12.5) — PROVEN.** The harness asserts
  `recompute_skill_mastery` == `compute_mastery_for_entity` column-for-column (single-impl,
  INV-05A-11) over every non-empty fixture.
- **E1/E2 (guards proven by planted violations) — PROVEN.** `scripts/ci/guards-selftest.sh`
  plants a hardcoded `0.50` in a PL/pgSQL function body ⇒ `no-hardcoded-constants` exits
  RED; plants a tutor/LISA `apply_mastery_event` call ⇒ `tutor-never-writes-mastery` exits
  RED; both go green once the plant is removed. Wired into the `ci` job.
- **SP-19 — RESOLVED.** The §12 mixed-fixture "global interleaving" ambiguity dissolves
  under the offset-invariance of `acc_source` (see gap-registry GAP-SP-19); the parity gate
  reproduces B16/S4 without reverse-engineering any global ordering.
- **SP-17 — CARRIED to Codex (unchanged).** `skill_codes[1] = primary` remains an
  ordering-guarantee to verify in the question pipeline, not an index to rubber-stamp.
