# WS-2 ↔ WS-3 Mastery Seam — Validation Contract (Lane A; DRAFT for review)

> The shared seam between WS-2 (Doc 02B runtime engines: practice/review) and WS-3
> (Doc 05 family: mastery/KPI/projections). **Plan-mode draft — defines correctness
> independently of either implementation (Doc 00 V6 §10 Phase 1). Lock this before any
> coupled (Lane C) build.** Owner rulings on the §7 HALT items are prerequisites.
>
> **Grounding:** HEAD `03fe22e`. Doc 02B `f3603b5` (V4); Doc 05A `42c1ead` (V1.0 LOCKED);
> Doc 05B/05C/05D V1.0 LOCKED; Doc 02C `f713f55` (V4, superseded for mastery by R1);
> ADR-001 `d0797ca`; Doc 02 Preamble `5e105d9`.

## 0. The seam, corrected — synchronous RPC, NOT an outbox

The event→mastery seam is specified **three ways** across the corpus; R1 (Doc 05 family
controls mastery) resolves it:

| Source | Seam it describes | Status |
|---|---|---|
| **Doc 05A §4.1 (LOCKED)** | `apply_mastery_event(...)` — sync `SECURITY DEFINER` RPC that **re-derives** mastery from canonical upstream tables (`canonical_mastery_events`), inline-refreshes 05B/05C in one txn | **CANONICAL (post-R1)** |
| Doc 02B §25 (V4) | `apply_learning_event_to_mastery(...)` sync RPC, `event_type` 6-enum payload, "boundary is exactly this call" | **SUPERSEDED** by Doc 05A (R1: 02C-gen RPC names replaced) → SP needed |
| ADR-001 §5 | review engine "emits the canonical mastery event to the Supabase `mastery_outbox`" | **STALE** — Doc 05A/05D define **no** mastery outbox; only `projection_refresh_outbox` (05C §7.7, a 04B→05C seam) → SP needed |

**Consequence:** GAP-MA-07 ("`mastery_outbox` seam does not exist") is **refuted by the
locked spec** — the locked seam is synchronous-RPC; there is nothing to build an outbox
for. Re-disposition GAP-MA-07 (§7 HALT-2).

## 1. The entry point — `apply_mastery_event` (Doc 05A §4.1, VERBATIM)

```sql
public.apply_mastery_event(
  p_student_id        uuid,
  p_section           text,        -- 'M' | 'RW'
  p_domain            text,        -- canonical SAT domain (Doc 02)
  p_skill             text,        -- canonical SAT skill (Doc 02)
  p_difficulty        smallint,    -- 1 easy | 2 medium | 3 hard
  p_source_family     text,        -- 'practice' | 'review' | 'test'  (formula-facing)
  p_event_source_kind text,        -- 'practice_attempt'|'diagnostic_attempt'|'review_error_attempt'|'full_length_answer'
  p_correct           boolean,
  p_occurred_at       timestamptz,
  p_event_id          uuid,        -- upstream event id (idempotency key)
  p_question_id       uuid,
  p_section_state     text DEFAULT NULL  -- required 'submitted' when source_family='test'
) RETURNS public.student_skill_mastery  -- SECURITY DEFINER, service_role execute-only
```

**Post-conditions (falsifiable):**
- **S1 — single entry point.** Only `apply_mastery_event` and `recompute_skill_mastery`
  may write `student_skill_mastery` (Doc 05A INV-05A-11). Falsifier: any other write path.
- **S2 — service-role only.** Execute granted to `service_role` only; RLS write-lockdown
  on the mastery tables (INV-05A-10 / Doc 02B INV-02B-06 `no_direct_write`).
- **S3 — idempotent on `(event_source_kind, event_id)`** via advisory lock +
  `UNIQUE (event_source_kind, event_id)` on `mastery_event_audit_log` (05D) + a
  unique-violation→idempotent-reentry handler (Doc 05A §4.3/§4.11, INV-05A-10).
- **S4 — re-derives, does not trust the payload as the store.** The RPC computes from
  `canonical_mastery_events` (the upstream tables), NOT from the call args alone
  (Doc 05A §6.2). The payload is routing metadata + the idempotency key.

## 2. The read-contract — `canonical_mastery_events` over WS-2's tables (THE Lane-A lock)

The seam's load-bearing half: WS-2's canonical answer tables MUST carry the denormalized
columns the WS-3 view-function reads (Doc 05A §6.2, RB-05A-V1-04/08). For each source:

| `source_family` | `event_source_kind` | WS-2/WS-4 source table | required denormalized columns |
|---|---|---|---|
| `practice` | `practice_attempt` | `practice_session_items` (WS-2) | `event_id, section, domain, skill, difficulty(1-3), correct, occurred_at, question_id` |
| `practice` | `diagnostic_attempt` | diagnostic surface (WS-2 — §7 HALT-8) | same |
| `review` | `review_error_attempt` | `review_error_attempts` (WS-2) | same (fires on correct AND incorrect retries — §7 HALT-7) |
| `test` | `full_length_answer` | `test_session_answers` (**WS-4**, Doc 04 finalization) | same; `tss.state='submitted'` gate (§7 HALT-4) |

**Post-conditions:**
- **R1 — column shape.** Each WS-2 answer table carries `(event_id uuid, section, domain,
  skill, difficulty smallint CHECK 1-3, correct boolean, occurred_at timestamptz,
  question_id uuid)` populated at write time. Falsifier: a NULL in any of these on a
  mastery-bearing row (Doc 05A §10.1-D `BLOCKING_DOC04_SEAM_GAP` analogue for WS-2).
- **R2 — `event_id` is the per-attempt UUID** that becomes the idempotency key; stable
  across retries of the same logical attempt (reconciles with Doc 02B's `client_attempt_id`
  idempotency — §7 HALT-1).
- **R3 — difficulty is the canonical 1-3 scale** (Doc 05 Parent §4.4), not the deployed 1-5.

## 3. The call-ordering precondition (RB-05A-V1-08) — non-negotiable

WS-2 MUST durably insert the upstream answer event into its canonical table **before**
calling `apply_mastery_event`; if same-transaction, the insert MUST be **earlier** in the
txn so `canonical_mastery_events` sees it. Calling before the event is visible silently
produces mastery that excludes the event (no exception raised).

- **O1.** Submit flow order: write `practice_session_items`/`review_error_attempts` row →
  THEN call the RPC (same txn, insert first). Falsifier: an integration test where the
  mastery row omits the just-submitted event.

## 4. Single-writer, audit, and anti-leak guards (carry-forward invariants)

- **G1 — single writer per table** (Doc 02B §8 / Doc 05 Parent §6): `practice-canonical.ts`
  (practice), `review-session-routes.ts` (review) own the WS-2 answer tables;
  `apply_mastery_event` owns the mastery tables. Every write path names its writer.
- **G2 — tutor never writes mastery** (Doc 05A INV-4 / Doc 03 INV-03-01 / C-7). Review
  tutor-assisted correctness counts as correct but `used_tutor` is **telemetry-only**,
  never formula-facing (Doc 02B CR-02B-16; §7 HALT-7).
- **G3 — anti-leak / aggregate-only.** `student_skill_mastery`: students read own rows,
  **column-grant-restricted to `(student_id, section, domain, skill, mastery_level,
  computed_at)`** — `mastery_score`/`acc_*`/counters hidden; **guardians have NO read
  policy** (Doc 05A §7.3/§7.4, INV-05A-12; Doc 02 Preamble INV-02-06 aggregate-only). The
  WS-0 anti-leak probe + C-3 (mastery write-lockdown) carry as CI gates.
- **G4 — constants from DB.** All formula constants live in `mastery_constants`
  (Doc 05A §9); none hardcoded (Doc 02B INV-02B-15). Each mastery row carries
  `constants_snapshot_hash` + `mastery_model_version` (Doc 05A §4.5/§4.7).
- **G5 — determinism + no-recompute-on-constants-change.** Position-based weighting
  (no calendar decay); deterministic recompute equivalence (Doc 05A §5.3); a
  `mastery_constants` edit restamps NOTHING (Doc 05D INV-05D-13). C-9 (level boundaries
  0.19/0.39/0.59/0.79) carries as a CI guard.

## 5. The downstream chain (single-transaction, synchronous)

`apply_mastery_event` → upsert `student_skill_mastery` → inline `refresh_domain_mastery`
(05B) + `refresh_{section,domain,skill,overall}_kpi` (05B) + throttled
`compute_section_projection` (05C) → audit `mastery_event_audit_log` +
`mastery_domain_refresh_audit_log` (05D), all in ONE txn; any failure rolls back the whole
(Doc 05 Parent §7.8). Projection refresh is throttled (40 events / 24h / immediate on
full-length via `projection_refresh_outbox`, the 04B→05C seam — §7 HALT-5).

## 6. What this contract does NOT own
The WS-2 session/serving/SM-2 internals (Lane B), the WS-3 formula/constants/table internals
(Lane B), and the Doc 04 scoring side (WS-4). This contract owns only the **seam**: the RPC
signature, the `canonical_mastery_events` read-contract, the ordering precondition, and the
single-writer/idempotency/audit/anti-leak guards that cross the WS-2↔WS-3 boundary.

## 7. HALT items (owner rulings required before Lane C) — see PHASE-0-PLAN §HALT
H1 RPC-name/payload supersession · H2 mastery_outbox refuted (re-dispose MA-07) ·
H3 source-weight conflict (Doc 05 wins) · H4 `test` path blocked on WS-4 ·
H5 `projection_refresh_outbox` cross-wave (04B emit is WS-4) · H6 the `canonical_mastery_events`
read-contract is the lock · H7 review emit on correct+incorrect / `used_tutor` non-formula ·
H8 diagnostic surface source.
