# Lane C — Production mastery seam wiring (practice + review) — Correctness Contract

**Workstream:** Lane C per `docs/SpecAudit/40-ws2-ws3/PHASE-0-PLAN.md`; builds against the FROZEN,
corrected `contracts/ws2-ws3-mastery-seam.contract.md` (incl. amendment AM-2: `question_id text`).
**Gate set closed (owner-confirmed 2026-06-13):** #364 merged (seam contract → text); Doc 05A amended
`p_question_id uuid→text` owner-side; every `question_id`-bearing interface confirmed `text` on the live DB.
**Spec:** Doc 05A (V1.0 LOCKED, `42c1ead`) §4 (`apply_mastery_event`) / §6.2 (`canonical_mastery_events`);
Doc 05 Parent §6/§7.8; seam contract §1/§2/§3/§5/§7. Citations are `Doc 05A §S`.
**Closes (on owner-proven apply + gates green):** GAP-MA-07 family (the synchronous seam goes live),
the seam contract's §0–§5 becoming executable; spawns SP-22 (spec §6.2 stale table name).

Falsifiable post-conditions, each naming its proof mechanism: **`STRUCT`** (structural query on
fresh-apply), **`PARITY`** (production-derivation parity, bit-exact), **`TXN`** (transaction-atomicity
test), **`REPLAY`** (idempotency replay test), **`GUARD`** (a CI guard proven by a planted violation).

## A — Production `canonical_mastery_events` (Doc 05A §6.2; the real derivation)
- **A1** `canonical_mastery_events(p_student_id, p_entity_type, p_section, p_domain, p_skill)` returns the
  §6.2 10-column shape `(event_id uuid, event_source_kind text, source_family text, section, domain, skill,
  difficulty smallint, correct boolean, occurred_at timestamptz, question_id text)`, `LANGUAGE sql STABLE
  SECURITY DEFINER`, `service_role`-execute-only. It **replaces the parity harness's fixture stand-in** —
  same shape ⇒ `compute_mastery_for_entity` consumes it identically. Proof: `STRUCT` + `PARITY`.
- **A2** Two UNIONed source branches (practice + review), exactly the seam §2 read-contract:
  | source_family | event_source_kind | table | mastery-bearing filter | column map |
  |---|---|---|---|---|
  | `practice` | `practice_attempt` | `practice_session_items` | `status = 'answered'` | event_id=id, section=question_section, domain=question_domain, skill=question_skill, difficulty=question_difficulty, correct=is_correct, occurred_at=occurred_at, question_id=question_id; filter `user_id = p_student_id` |
  | `review` | `review_error_attempt` | `review_error_attempts` | (every row is an attempt) | section/domain/skill/difficulty/occurred_at/question_id direct, correct=is_correct, event_id=id; filter `student_id = p_student_id` |
  Filter clause per branch: `… AND section = p_section AND domain = p_domain AND (p_entity_type = 'domain'
  OR skill = p_skill)`. **No difficulty filter** (RB-05A-V1-17: bad data must reach the formula's validation
  block, not be silently excluded). Proof: `STRUCT` + `PARITY`.
- **A3 — `practice_attempts_v0` is stale (SP-22).** Doc 05A §6.2's *example* reads `practice_attempts_v0`
  (a Wave-1 fossil per Doc 02B §8). The frozen seam §2 + Doc 02B §8 canonical-writer map make
  `practice_session_items` the canonical practice answer table; this build reads it. The `§6.2` structural
  shape (UNION of uniform event rows) is honored; only the stale table name is corrected → **SP-22**.
- **A4 — test/full-length branch OMITTED (WS-4).** §6.2's third UNION (`test_session_answers`) is the Doc
  04 seam; those tables do not exist (WS-4 future). Omitted by scope — not stubbed. When WS-4 lands its
  answer surface, the `test` branch is added and the test-bearing §12 fixtures get production parity (see D3).

## B — `apply_mastery_event` (Doc 05A §4, VERBATIM-faithful; the RPC)
- **B1** Signature per §4.1: `(p_student_id, p_section, p_domain, p_skill, p_difficulty smallint,
  p_source_family, p_event_source_kind, p_correct, p_occurred_at, p_event_id uuid, p_question_id text,
  p_section_state text DEFAULT NULL)` → `student_skill_mastery`, `SECURITY DEFINER`, search_path locked,
  `REVOKE … FROM PUBLIC` + `GRANT EXECUTE … TO service_role`. `p_question_id` is **text** (AM-2). Proof: `STRUCT`.
- **B2** Validation order §4.2: required-field → enum (section M/RW, difficulty 1/2/3, source_family,
  event_source_kind) → `(event_source_kind→source_family)` mapping (else `MASTERY_SOURCE_KIND_FAMILY_MISMATCH`)
  → cross-field (`source_family='test' ⇒ section_state='submitted'`; `occurred_at ≤ now()+5min`) → domain/skill
  consultative (non-blocking V1.0). Failure ⇒ `MASTERY_VALIDATION_FAILED`. Proof: `STRUCT` (denial cases).
- **B3** Idempotency §4.3: (1) event-level `pg_advisory_xact_lock(hashtext('mastery_event|'||event_source_kind
  ||'|'||event_id))` under `lock_timeout='5s'`; (2) audit lookup on `(event_source_kind, event_id)` — if present,
  return existing `student_skill_mastery` row (no re-write). Proof: `REPLAY`.
- **B4** Student-skill lock §4.4: `pg_advisory_xact_lock(hashtext(student||'|'||section||'|'||domain||'|'||skill))`
  under `lock_timeout='5s'`; `MASTERY_LOCK_TIMEOUT` on timeout. Proof: `STRUCT`.
- **B5** §4.5 read constants + `encode(extensions.digest(canonicalize_mastery_constants_serialized(),'sha256'),'hex')`
  (pgcrypto in `extensions` schema, genesis); §4.6 `compute_mastery_for_entity(...,'skill',...)`. No numeric
  literal in the body (allowlist guard). Proof: `STRUCT` + `GUARD`.
- **B6** §4.7 read before-(score,level) under the lock, then upsert `student_skill_mastery` ON CONFLICT
  `(student_id,section,domain,skill)`; §4.8 insert `mastery_event_audit_log` (writes `source_family`,
  `event_source_kind`, `event_id`, `question_id text`, before/after, `constants_snapshot_hash`); the audit
  insert's `EXCEPTION WHEN unique_violation` → re-read + return existing row (idempotent re-entry, §4.11).
  Proof: `STRUCT` + `REPLAY`.
- **B7 — §4.9 downstream chain DEFERRED → TODO(05B/05C).** §4.9 calls `refresh_domain_mastery` (05B) →
  `refresh_section_projection` (05C); neither is built (AM-1 deferral). `apply_mastery_event` writes the
  **skill** tier + audit live and **omits §4.9** with an explicit `TODO(05B/05C)` — **identical to the
  Codex-accepted `recompute_skill_mastery` `TODO(05B)`**, keeping the two write paths symmetric (§5.3
  equivalence holds on `student_skill_mastery`). The downstream rollup refreshers land with the 05B/05C
  wave. Recorded as **amendment AM-3** (below); flagged to owner. Proof: `STRUCT` (no `refresh_*` call present).

## C — Seam wiring / ordering (seam §3, HALT-2)
- **C1** The caller (WS-2 practice/review write path) durably inserts the answer row into its canonical
  table, THEN calls `apply_mastery_event` **earlier-insert, same transaction** (RB-05A-V1-08). The RPC
  re-derives from `canonical_mastery_events`, which sees the just-inserted row. Falsifier: a mastery row that
  omits the just-submitted event. Proof: `TXN` + `PARITY`. (The route-layer call site is **B-WS2-2** — this
  contract owns the RPC + the ordering law it enforces, not the TS route.)

## D — Load-bearing properties (the frozen contract becoming live)
- **D1 — Transaction atomicity (`TXN`).** Answer insert + `apply_mastery_event` are one atomic unit: a
  mid-transaction failure (e.g., RAISE after the RPC) persists **neither** the answer row nor any mastery/
  audit row — no torn write on the mastery path. Proof: a test that wraps insert+RPC+RAISE in one txn and
  asserts zero rows in `practice_session_items`/`student_skill_mastery`/`mastery_event_audit_log`.
- **D2 — Idempotency replay (`REPLAY`, blocking).** Two `apply_mastery_event` calls with the same
  `(event_source_kind, event_id)` apply **exactly once**: one audit row, one mastery state, identical return.
- **D3 — Production-derivation parity (`PARITY`, blocking).** `compute_mastery_for_entity` reading the
  **production** `canonical_mastery_events` (over real `practice_session_items`/`review_error_attempts`,
  through their FKs) yields the **same** result the §12 isolation harness proved — bit-exact within §12.4
  tolerances — across the **practice/review-only fixture subset** (B1,B2,B3,B5–B14,B18,B19,B21,B22,B23,S7 =
  19 fixtures; the 12 test-bearing fixtures stay proven via the isolation stand-in and get production parity
  when WS-4 adds the `test` branch — A4). This **bridges isolation-parity to production-parity** so the
  bit-exact proof transfers to the real wiring.
- **D4 — Single-writer + tutor-exclusion (`GUARD`).** `apply_mastery_event` + `recompute_skill_mastery` are
  the only writers of `student_skill_mastery` (C-3/C-8); no tutor/LISA path reaches the mastery write (C-7).
  The existing `tutor-never-writes-mastery` + `no-hardcoded-constants` guards apply unchanged; this build
  adds no path that tests their limits.

## E — Scope boundaries (build nothing past the practice+review seam)
Practice + review only. **Diagnostic surface** stays unbuilt (SP-12). **Test/full-length** stays unbuilt
(WS-4) — A4. **§4.9 downstream rollups** (05B domain/cluster/KPI, 05C projections) deferred — B7/AM-3.
No route-layer TS (B-WS2-2). If Lane C appeared to need diagnostic or test to *function*, that's a
contract error surfaced as a HALT — none found: the practice+review seam is self-contained for the
skill tier.

## F — Gates (full Lane-C set)
`TXN` (transaction-atomicity) · `REPLAY` (idempotency) · `PARITY` (production-derivation, 19-fixture subset,
blocking CI) · single-writer grep-guard · `tutor-never-writes-mastery` · `no-hardcoded-constants` (allowlist) ·
WS-2 anti-leak posture intact (genesis-fresh-apply). Owner-run for any live apply (no `service_role` held).

## Amendments / findings
> **AM-3 (2026-06-13, Lane C).** *What:* `apply_mastery_event` omits Doc 05A §4.9's downstream refresh
> (`refresh_domain_mastery` 05B → `refresh_section_projection` 05C). *Why:* 05B/05C are deferred (AM-1); the
> sibling `recompute_skill_mastery` already defers the same call (Codex-accepted `TODO(05B)`), so omitting it
> in `apply_mastery_event` keeps the two write paths symmetric and respects the deferral. The skill tier +
> audit are written live; the parity proof (student_skill_mastery) is unaffected. *Where it lands:* the 05B/05C
> wave restores §4.9 in BOTH `apply_mastery_event` and `recompute_skill_mastery`. Flagged to owner.
- **SP-22 (new).** Doc 05A §6.2's example reads the Wave-1 fossil `practice_attempts_v0`; canonical truth is
  `practice_session_items` (Doc 02B §8 / frozen seam §2). Code reads the canonical table; reconcile the §6.2
  example to `practice_session_items` (owner-side, `docs/Spec` read-only).
