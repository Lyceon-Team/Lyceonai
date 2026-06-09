# B-WS2-1 — WS-2 practice/review runtime tables (DDL) — Correctness Contract

**Workstream:** WS-2 Lane B (Doc 02B runtime engines). **Schema layer only** — the serving-path
TS + routes are B-WS2-2; the mastery RPC wiring (`canonical_mastery_events` / `apply_mastery_event`)
is Lane C.
**Builds against:** the **FROZEN** WS-2↔WS-3 mastery seam (`contracts/ws2-ws3-mastery-seam.contract.md`,
frozen 2026-06-10) and the genesis foundation (`supabase/migrations/00000000000000_genesis.sql`).
**Spec:** Doc 02B V4 (`f3603b5`) §8 (Canonical Tables + Writer Map line 317-332), §14 (Practice
Engine; Session Items Prefill line 609-620), §16 (Review Engine + SM-2 + Review Schedule line
750-760), §20 (Reveal Matrix), §10 (INV-02B-01/02/06/13/15); Doc 02 Preamble V3 §12 (reveal matrix).
Citations are `Doc 02B §S` / `seam §S`.

Falsifiable post-conditions, each naming its proving mechanism. Proof mechanisms:
**`STRUCT`** (structural query on fresh-apply against the local PG16 cluster), **`GUARD`** (a CI
guard), **`DEFERRED`** (a named acceptance test deferred because its precondition — a populated
`public.questions` — does not exist by design at this layer).

Migration: `supabase/migrations/20260610020000_ws2_practice_review_runtime.sql` (header carries the
`LYCEON-MIGRATION-REVIEWED` marker the write hook requires).

---

## A — Tables + columns exist per §8/§14/§16

- **A1** All **6** canonical tables exist on fresh-apply: `practice_sessions`,
  `practice_session_items`, `review_sessions`, `review_session_items`, `review_error_attempts`,
  `review_schedule` (Doc 02B §8 Practice/Review Runtime line 253-270). None pre-existed in genesis.
  Proof: `STRUCT` (6/6 present) — **PASS**.
- **A2** `practice_sessions` envelope (Doc 02B §14): `id uuid PK`, `user_id→profiles(id)`,
  `mode CHECK('flow','structured')`, `filters jsonb DEFAULT '{}'`, `target_count int CHECK >0`,
  `platform CHECK('web','mobile')`, `client_instance_id text`, `status DEFAULT 'created'
  CHECK('created','active','completed','abandoned')` (§14 line 599 lifecycle),
  `created_at/updated_at/last_activity_at NOT NULL DEFAULT now()`, `completed_at`. Proof: `STRUCT`.
- **A3** `practice_session_items` snapshot (Doc 02B §14 line 611-620; immutable per INV-02B-13):
  `id uuid PK`, `session_id→practice_sessions ON DELETE CASCADE`, `user_id→profiles`, `ordinal int`,
  `question_id text→questions(id)`, the denormalized snapshot
  (`question_stem`, `question_passage`, `question_options jsonb`, `question_correct_answer`,
  `question_explanation`, `question_option_metadata jsonb`, `question_domain`, `question_skill`,
  `question_difficulty smallint CHECK 1-3`, `question_section CHECK 'M'|'RW'`),
  `status DEFAULT 'pending' CHECK('pending','served','answered','skipped')`, and the on-submission
  columns (`selected_answer`, `is_correct`, `outcome CHECK 'correct'|'incorrect'|'skipped'`,
  `time_spent_ms`, `client_attempt_id`, `answered_at`, `served_at`). Proof: `STRUCT`.
- **A4** `review_sessions` envelope (Doc 02B §16): `id uuid PK`, `student_id→profiles`,
  `status CHECK('active','completed','abandoned')`, `source_origin CHECK('practice','full_test')`
  (§16 line 706 — missed in practice OR exam), `client_instance_id`, `created_at/updated_at`.
  Proof: `STRUCT`.
- **A5** `review_session_items` snapshot (Doc 02B §16): same denormalized question_* snapshot shape
  as A3, plus `retry_mode CHECK('same_question','similar_question')` (§16 line 708 — original-item
  replay at launch), `status CHECK('queued','served','answered','skipped')`, `ordinal int`,
  `session_id→review_sessions ON DELETE CASCADE`, `student_id→profiles`,
  `question_id text→questions(id)`. Proof: `STRUCT`.
- **A6** `review_error_attempts` (Doc 02B §8 line 268 / §16): `id uuid PK`,
  `session_item_id→review_session_items ON DELETE CASCADE`, `student_id→profiles`,
  `question_id text→questions(id)`, `selected_answer`, `is_correct boolean NOT NULL`,
  `seconds_spent`, `client_attempt_id`, `used_tutor boolean NOT NULL DEFAULT false`. Proof: `STRUCT`.
- **A7** `review_schedule` (Doc 02B §16 line 750-760; CR-02B-23): `id uuid PK`, `student_id→profiles`,
  `question_id text→questions(id)`, `repetition_count int NOT NULL DEFAULT 0`,
  `interval_days int NOT NULL DEFAULT 0`, `ease_factor numeric NOT NULL` (**no default — see F1**),
  `next_review_at timestamptz`, `status DEFAULT 'active' CHECK('active','graduated','retired')`,
  `first_missed_session_id uuid`, `created_at/updated_at`, `UNIQUE (student_id, question_id)`
  (per-(profile,question), §16 line 752). Proof: `STRUCT`.

## B — Seam read-contract columns present + non-NULL posture (seam §2 R1)

- **B1** `practice_session_items` carries every seam column (seam §2 R1 table, `practice_attempt`):
  `event_id = id (uuid)`, `correct = is_correct`, `section = question_section`,
  `domain = question_domain`, `skill = question_skill`, `difficulty = question_difficulty (1-3)`,
  `occurred_at` (added — no snapshot equivalent; the writer sets it = `answered_at`),
  `question_id` (TEXT — see G1). A SQL comment block in the migration maps each seam name → column
  so Lane C's `canonical_mastery_events` is unambiguous and adds **no** redundant duplicate columns.
  Proof: `STRUCT` (all present).
- **B2** `review_error_attempts` carries every seam column **as first-class denormalized columns**
  (seam §2 R1, `review_error_attempt`): `section`, `domain`, `skill`, `difficulty smallint CHECK 1-3`
  are **NOT NULL**; `occurred_at timestamptz NOT NULL DEFAULT now()`; `is_correct NOT NULL`
  (= seam `correct`); `event_id = id`. Lane C reads these **without a join**. Proof: `STRUCT`
  (section/domain/skill/difficulty/occurred_at/is_correct all `is_nullable = NO`) — **PASS**.
- **B3** R1 non-NULL posture (seam §2 R1 falsifier: a NULL in any seam column on a mastery-bearing
  row). On `review_error_attempts` the seam columns are NOT NULL **structurally** (every row is
  mastery-bearing — review fires on correct AND incorrect, H7). On `practice_session_items` the
  snapshot section/domain/skill/difficulty are NOT NULL structurally; `is_correct`/`occurred_at` are
  NULL only on `pending`/`served`/`skipped` rows, which are **not** mastery-bearing — the writer
  populates them at submission (the `answered` transition). The not-NULL-on-mastery-bearing-rows
  guarantee for practice is the **writer's** post-condition (B-WS2-2), backstopped by the seam's own
  `compute_mastery_for_entity` validation gate (`MASTERY_HISTORICAL_DATA_INVALID` on any NULL seam
  field). Proof: `STRUCT` (review NOT NULL) + carried to B-WS2-2 (practice write-time population).
- **B4** difficulty is the canonical **1-3** scale (seam R3 / Doc 05 Parent §4.4): every difficulty
  column (`question_difficulty`, `difficulty`) is `smallint CHECK BETWEEN 1 AND 3`. Proof: `STRUCT`.

## C — Idempotency (INV-02B-02 / §14 line 646 / seam R2)

- **C1** `practice_session_items`: partial `UNIQUE (user_id, client_attempt_id) WHERE
  client_attempt_id IS NOT NULL` (`uq_practice_items_idem`) — §14 line 646 / INV-02B-02. Proof:
  `STRUCT` (index def) — **PASS**.
- **C2** `review_error_attempts`: partial `UNIQUE (student_id, client_attempt_id) WHERE
  client_attempt_id IS NOT NULL` (`uq_review_attempts_idem`). Proof: `STRUCT` — **PASS**.
- **C3** `event_id` (= the answer-row PK `id`, seam §7 H6) is the per-attempt UUID minted at insert;
  `client_attempt_id` is the client idempotency key (seam R2 reconciles the two). Proof: `STRUCT`
  (`id uuid PK DEFAULT gen_random_uuid()` on both answer tables).

## D — RLS + single-writer (Doc 02B §8 Writer Map / INV-02B-01/06 / seam G1)

- **D1** All 6 tables have `ROW LEVEL SECURITY` **enabled** (deny-all baseline). Proof: `STRUCT`
  (6/6 `rowsecurity = t`) + `GUARD` (genesis-fresh-apply A.4 "every public table has RLS enabled")
  — **PASS**.
- **D2** Writes are **service_role only** — `GRANT SELECT,INSERT,UPDATE,DELETE` to `service_role` on
  all 6; **no** INSERT/UPDATE/DELETE grant to `anon`/`authenticated`. The canonical writer runs as
  service_role. Proof: `STRUCT` (each of 6 = `DELETE,INSERT,SELECT,UPDATE` for service_role) —
  **PASS**.
- **D3** Student own-row read: a SELECT policy `USING (... = auth.uid())` on each table —
  `practice_*` keyed on `user_id`, `review_*` keyed on `student_id`. Proof: `STRUCT` (6/6 policies
  present) — **PASS**.
- **D4** Single canonical writer named per table in a SQL comment (Doc 02B §8 line 321-322 / seam G1):
  `practice_sessions` + `practice_session_items` → `practice-canonical.ts`;
  `review_sessions` + `review_session_items` + `review_error_attempts` + `review_schedule` →
  `review-session-routes.ts`. Proof: `STRUCT` (comments present in migration body).

## E — Anti-leak column grant (Doc 02B §20 / INV-02B-01 / Doc 02 Preamble §12)

- **E1** Schema-level gate: the column-level `GRANT SELECT` to `authenticated` on
  `practice_session_items` and `review_session_items` **EXCLUDES** `question_correct_answer`,
  `question_explanation`, `question_option_metadata` (pre-submit-internal; the route projects the
  post-submit reveal in B-WS2-2). The snapshot tables receive **no** table-wide grant to
  authenticated — only the explicit student-safe column list. Proof: `STRUCT` (the 3 internal
  columns have zero `authenticated`/SELECT privilege rows; 21 safe columns granted on
  `practice_session_items`; no table-level grant) — **PASS**.
- **E2** Live schema-gate probe (column-grant enforcement, run on empty tables): `SET ROLE
  authenticated; SELECT question_correct_answer/explanation/option_metadata` is **denied** on both
  snapshot tables (permission error before any row is read); a student-safe column (`question_stem`)
  is **allowed**. Proof: `STRUCT` (live probe) — **PASS** (3/3 denied per table; stem allowed).
- **E3** **DEFERRED runtime acceptance test** — `ws2-snapshot-antileak-runtime`: with a populated
  `public.questions` and a real prefilled snapshot row, assert the served pre-submit DTO carries
  `correct_answer = null / explanation = null` and that `authenticated` cannot read the internal
  snapshot columns from a real row. **Deferred** because `public.questions` is intentionally empty by
  design at this layer (genesis A4) — there is no real row to probe. This is named here as the
  deferred test, **not** claimed as run. Carried to B-WS2-2 (route construction) / the WS-0 anti-leak
  probe family.

## F — No hardcoded constants (INV-02B-15 / seam G4)

- **F1** No tuned SM-2 constant is a column DEFAULT. `review_schedule.ease_factor` has **NO** numeric
  default (`column_default` is NULL, column is NOT NULL) — the engine (B-WS2-2) sets it from
  `review_runtime_config.sm2_initial_ease_factor` (2.5 at launch, in the config migration) at insert.
  `interval_days`/`repetition_count` default `0` — a **structural** zero (the pre-first-success state,
  not a tuned constant; the first-success interval comes from `sm2_initial_interval_days` at runtime).
  Proof: `STRUCT` (`ease_factor` default empty/NOT NULL) — **PASS**.
- **F2** The migration trips **no** SQL-function-body or app-code constant in
  `scripts/ci/no-hardcoded-constants.mjs` (this migration creates no functions and bakes no literal
  from the denylist: 2.5, 1.3, 6, etc.). Proof: `GUARD` (`node scripts/ci/no-hardcoded-constants.mjs`
  → `NO-HARDCODED-CONSTANTS: PASS`) — **PASS**.

## G — Review-emit semantics + lane discipline (seam §7 H7/H8 / G2)

- **G1** Review emits on **correct AND incorrect** retries (seam §7 H7): `review_error_attempts`
  carries `is_correct boolean NOT NULL` (records both outcomes), with the seam columns NOT NULL on
  every row — the table is the per-attempt outcome store regardless of correctness. Proof: `STRUCT`.
- **G2** `used_tutor` is **telemetry-only, never formula-facing** (Doc 02B §16 line 784 / CR-02B-16 /
  seam G2): present as `used_tutor boolean NOT NULL DEFAULT false`; it is **not** in the seam §2 R1
  read-contract column set, so `canonical_mastery_events` does not read it into the formula. Proof:
  `STRUCT` (column present; not in seam set) + carried (Lane C must not read it).
- **G3** Diagnostic surface **NOT built** (seam §7 H8 / SP-12): no diagnostic tables created here.
  The seam's `diagnostic_attempt` source is blocked on SP-12 and intentionally absent. Proof:
  `STRUCT` (only the 6 named tables created; no `diagnostic_*`).
- **G4** Lane discipline: no `apply_mastery_event` / `canonical_mastery_events` / RPC wiring created
  (Lane C); no mastery tables touched (B-WS3-1 owns them); no serving-path TS/routes (B-WS2-2). Proof:
  `STRUCT` (this migration creates only the 6 DDL tables + their RLS/grants/indexes).

## H — Genesis snapshot stays green (genesis-extending)

- **H1** Genesis fresh-apply gate reproduces the committed expected schema (now including the 6 new
  tables) and is deterministic across two independent applies; every public table (incl. the 6 new)
  is RLS-enabled. Proof: `GUARD` (`PGPORT=5433 ... bash scripts/ci/genesis-fresh-apply.sh` →
  `GENESIS FRESH-APPLY GATE: PASS`; `scripts/ci/genesis-schema.expected.sql` regenerated) — **PASS**.

---

## Findings (surfaced, NOT silently resolved)

- **FINDING A — `question_id` TYPE MISMATCH (seam reconciliation needed BEFORE Lane C wires the RPC).**
  Genesis `public.questions.id` is **TEXT** — the canonical SAT id. Genesis line 466:
  `id            TEXT PRIMARY KEY CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$'),`.
  The **FROZEN** seam §2 R1 (contract line 75) lists `question_id uuid`:
  `question_id uuid)\` populated at write time. Falsifier: a NULL in any of these on a` —
  and Doc 05A `apply_mastery_event` declares `p_question_id uuid` (seam §1 line 43), and B-WS3-1
  `mastery_event_audit_log.question_id` is `uuid` (mastery migration line 276). This item uses
  `question_id **text**` (FK to `questions.id`) — the canonical truth. The seam's `uuid` typing of
  `question_id` is therefore a **seam mismatch that must be reconciled before Lane C wires the
  `apply_mastery_event` call** (Lane C will need either a text↔uuid bridge, a seam amendment to TEXT,
  or to drop `question_id` from the uuid-typed audit column). `event_id` is unaffected — it is the
  answer-row PK (`uuid`), consistent across both sides. → **candidate new SP item** (recommend an
  SP to reconcile seam `question_id uuid` ↔ genesis `questions.id text` + Doc 05A `p_question_id uuid`).
- **FINDING B — SP-17 (single canonical skill = `skill_codes[1]`).** The single skill denormalized
  into `question_skill`/`skill` is `questions.skill_codes[1]` (1-indexed primary). The seam's
  single-skill mastery PK `(student_id, section, domain, skill)` (seam §7 H6) requires exactly one
  skill per event. This is an **ordering guarantee** the writer (B-WS2-2) must honor — that
  `skill_codes[1]` is genuinely the canonical primary for SAT items — **to verify, not rubber-stamp**
  (genesis A7 treats `skill_codes` as an open `text[]` with no closed taxonomy / ordering contract).
  The schema only provides the single-skill column; the ordering correctness is B-WS2-2's + SP-17's.
- **FINDING C — other seam needs before Lane C.** (1) `occurred_at` is **added** on
  `practice_session_items` (no snapshot equivalent in §14 line 616, which lists section/domain/skill/
  difficulty but not an event-time) — the writer must set it = `answered_at`; the seam reads it as the
  mastery event time. (2) The seam §2 R1 `practice`/`diagnostic_attempt` row points at a "diagnostic
  surface (WS-2 — §7 HALT-8)" that is **absent from Doc 02B** and blocked on **SP-12** — Lane C cannot
  wire the diagnostic path until SP-12 pins it (do not build it here). (3) Doc 02B §25's
  `apply_learning_event_to_mastery` (referenced by INV-02B-06 / Writer Map line 326) is **superseded**
  by Doc 05A `apply_mastery_event` per seam §7 H1 → **SP-15**; the WS-2 writer (B-WS2-2) must call the
  Doc 05A RPC, not the superseded §25 name.

## Gaps closed (on owner-proven apply)

- The WS-2 practice + review **schema layer** (Doc 02B §8/§14/§16): the 6 canonical tables with the
  immutable snapshot pattern (INV-02B-13), the seam-bearing answer tables carrying the §2 R1
  read-contract columns, idempotency uniques (INV-02B-02), RLS deny-all + service-role-only writes +
  student own-row read, the schema-level anti-leak column gate (§20 / INV-02B-01), single-writer
  comments (§8 Writer Map), and the SM-2 `review_schedule` with constants-from-config (INV-02B-15).
- **NOT closed here (by design):** the serving-path TS + routes (B-WS2-2), the mastery RPC wiring +
  `canonical_mastery_events` (Lane C), the diagnostic surface (SP-12), the `question_id` type
  reconciliation (Finding A — new SP), SP-17 ordering verification (Finding B).
