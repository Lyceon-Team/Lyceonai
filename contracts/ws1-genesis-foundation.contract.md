# WS-1 (Re-Cut) — Genesis Foundation — Correctness Contract

**Workstream:** WS-1 genesis re-cut per
`docs/SpecAudit/30-genesis-recut/RECUT-CONTRACT.md`
**Defines correctness of:** genesis migration `0000` (identity + platform
primitives + content-core), built **from spec**, and the reseed.
**Spec evidence (not deployed state):** Doc 01 V8 (`e74d83e…`), Doc 01A
(`aa4d8b6…`), Doc 02 Preamble (`5e105d9…`) / 02A (`abf153f…`) / 02B (`f3603b5…`),
Doc 00 V6 (`a607d7e…`). Citations are `Doc NN §S`.

This contract enumerates **falsifiable post-conditions** that define correctness
**independent of implementation** (Doc 00 V6 §10 Phase 1). Each names its proving
mechanism (Doc 00 V6 §9 executable-proof). Unlike WS-0 (which proved against the
deployed capture), genesis proves against **spec** — the proof is that a
from-scratch apply yields the spec-correct schema, RLS-enabled, anti-leak-clean,
and the reseed lands with ids intact.

**Proving mechanisms (no `service_role` held by agents):**
- **`STRUCT`** — structural query against a **fresh-apply** throwaway Postgres
  (`information_schema` / `pg_catalog`), run in CI. Falsifiable, deterministic.
- **`PROBE`** — anti-leak probe (anon + authenticated test student) against the
  **owner-applied** rebuilt project, post-reseed (mirrors `ws0-probe.ts`).
- **`SNAP`** — normalized `pg_dump --schema public` of the fresh-apply == committed
  `genesis-schema.expected.sql` (the durable "no DB object without repo SQL" gate).

---

## A — Shared post-conditions

- **A.1 (determinism)** A from-scratch apply of the genesis pipeline to an empty
  Postgres succeeds with no error and is **byte-identical** across two runs
  (`SNAP` equal on repeat). Proof: `SNAP`.
- **A.2 (one pipeline)** Every file under `supabase/migrations/` matches
  `^[0-9]{14}_.*\.sql$` (plus the `0000` genesis); no `drizzle.config.ts`; no
  DDL-issuing script outside the pipeline except the kept read-only RLS guard
  (`scripts/ci/check_rls_enabled.ts`). Proof: structural lint (`STRUCT`).
- **A.3 (owned deps)** — the **owned** extensions `vector` and `pgcrypto` ARE
  declared in `0000`, placed in the **`extensions` schema** (NOT `public`, which
  closes GAP-HY-07 — vector out of public). `pgcrypto` backs `digest()`/uuid;
  `vector` backs the later embedding store (there is no `questions.embedding` column
  in Doc 02A §16). Only **platform-managed** extensions (pg_cron, pg_net, …) are
  excluded. No `CREATE ROLE`/`ALTER ROLE` in any migration (platform owns roles).
  Proof: `STRUCT` (`pg_extension` → `extnamespace = 'extensions'`) + grep
  (no `CREATE ROLE`). The `--schema public` SNAP is unaffected (extensions live
  outside the public scope), so the CI Postgres service must provide pgvector
  (`pgvector/pgvector:pg16`).
- **A.4 (RLS-enabled posture)** **Every** `public` table has `rowsecurity = true`
  — **including the Doc 01A primitives** (they are RLS-enabled **deny-all**, NOT
  RLS-off). The difference is policies, not RLS state: user-scoped tables carry a
  self-row SELECT policy (e.g. `profiles_select_self`); the Doc 01A service-internal
  tables carry **no policies and no anon/authenticated grants**, i.e. deny-all to
  every non-service-role (service_role bypasses RLS). This is the most-locked
  posture — Doc 00 "data protection by default", Doc 01A §49 (students don't see
  abuse scores) / §64 (secrets never exposed). Proof: `STRUCT` over `pg_tables`
  (all `rowsecurity=true`).

---

## B — Identity (Doc 01 V8)

- **B.1 (`profiles` PK→auth FK, RESTRICT)** `profiles.id` is PK and a FK to
  `auth.users(id)` with `ON DELETE RESTRICT` (Doc 01 V8 §4; re-cut decision #5).
  Falsifier: any other delete action (CASCADE/SET NULL/NO ACTION) fails this.
  Proof: `STRUCT` over `pg_constraint` (`confdeltype = 'r'`).
- **B.2 (`profile_role` enum)** Type `profile_role` is an enum with exactly
  `{student, guardian, admin, tutor, teacher}` (Doc 01 V8 §4). Proof: `STRUCT`
  over `pg_enum`.
- **B.3 (identity table set)** `public` contains exactly the Doc 01 V8 identity
  tables — `profiles`, `entitlements`, `entitlement_features`, `guardian_links`,
  `guardian_consent_requests`, `account_deletion_requests`, `audit_logs` — and
  **none** of the legacy split-brain tables (`users`, `accounts`,
  `account_members`, `lyceon_accounts`, `lyceon_account_members`) (closes
  GAP-ID-04, GAP-HY-01 by construction). Proof: `STRUCT`.
- **B.4 (single guardian derivation)** Guardian visibility derives **only** from
  `guardian_links` (status-active) — no RLS policy or function references
  `profiles.guardian_profile_id` for guardian *authorization* (Doc 01 V8 §31/§35;
  closes GAP-ID-01/03). Falsifier: a guardian-read policy whose `USING` reads the
  denormalized pointer. Proof: `STRUCT` over `pg_policies` text.
- **B.5 (guardian aggregate-only)** No guardian-role RLS policy grants row-level
  SELECT on per-attempt tables or on `student_skill_mastery.mastery_score`
  (Doc 01 V8 §38; Doc 02 INV-02-06; closes GAP-ID-02). Proof: `PROBE` (guardian
  JWT) + `STRUCT`.
- **B.6 (entitlement student-scoped)** `entitlements` is keyed by student
  `profile_id`; there is no guardian entitlement row — guardian premium derives
  from a linked student's entitlement (Doc 01 V8 §31). "Payment ≠ permissions":
  an `entitlements` row does not by itself grant a feature (Doc 00 V6 §6). Proof:
  `STRUCT`.
- **B.7 (no dead plaintext-auth columns)** No `password`,
  `two_factor_secret`, or `password_reset_token` columns exist on any identity
  table (closes the GAP-ID-07 dead-columns half). Proof: `STRUCT`.

## C — Platform primitives (Doc 01A)

- **C.1 (idempotency)** `idempotency_records` exists with PK `(scope, client_key)`
  (Doc 01A §31; closes GAP-OP-04). Proof: `STRUCT`.
- **C.2 (rate-limit ledger + RPC)** `rate_limit_ledger` and the atomic
  `rate_limit_check_and_increment` RPC exist (Doc 01A §41). Proof: `STRUCT`.
- **C.3 (abuse scoring)** `abuse_score_incidents` (append-only) and `abuse_scores`
  exist; neither is student-readable (Doc 01A §49/§55/§57). Proof: `STRUCT` +
  `PROBE`.
- **C.4 (config doctrine)** The `*_runtime_config` family + `*_runtime_config_history`
  exist with append-only history triggers and config-change NOTIFY (Doc 01A §2–§8;
  closes GAP-OP-02). Constants live in these tables, **not** as literals. Proof:
  `STRUCT`.
- **C.5 (service-internal deny-all)** The Doc 01A primitive tables
  (`idempotency_records`, `rate_limit_ledger`, `abuse_score_incidents`,
  `abuse_scores`, `service_auth_secrets`, `*_runtime_config*`) are **RLS-enabled
  with no policies and no `anon`/`authenticated` grants** — deny-all to every
  non-service-role. They are exempt from the user-scoped SELECT *policy* (no self-row
  read like `profiles`), **NOT** from RLS itself. This satisfies Doc 01A's access
  intent (§49 students don't see abuse scores; §64 secrets never exposed; Doc 00
  data-protection-by-default) via the most-locked mechanism. Doc 01A expresses this
  as ownership-class governance + non-visibility, not literal RLS DDL (0 `ENABLE ROW
  LEVEL SECURITY` statements in Doc 01A) → tracked as **SP-10**. Proof: `STRUCT`
  (`rowsecurity=true` **and** zero anon/auth grants).

## D — Content-core (Doc 02A) — the anti-leak gate

- **D.1 (`questions` canonical shape)** `public.questions` exists with the Doc 02A
  §16 columns incl. `correct_answer`, `explanation`, `option_metadata`, and **no**
  `answer_text` column (re-cut decision #7 — the leaky duplicate is dropped).
  Proof: `STRUCT`.
- **D.2 (difficulty CHECK at rest)** `questions.difficulty` carries
  `CHECK (difficulty BETWEEN 1 AND 3)` (Doc 02A §17; closes GAP-EX-06). Proof:
  `STRUCT` over `pg_constraint`.
- **D.3 (`canonical_id` immutable contract)** Question id matches the locked
  `SAT{M|RW}{1|2}XXXXXX` format (Doc 02A §14) and is preserved verbatim through
  reseed. Proof: `STRUCT` (regex over reseeded ids) + reseed proof.
- **D.4 (ANTI-LEAK — pre-submit projection)** On every pre-submit surface, the
  served payload contains **only** `stem`/`passage`/`options`/`assets` — never
  `correct_answer`, `explanation`, `option_metadata`, distractor taxonomy,
  `source_type`, `source_lineage`, or `generation_attribution` (Doc 02 Preamble
  §12 reveal matrix; Doc 00 V6 §6; **hard gate**). Enforced at the serving
  projection + RLS, not by column absence. Falsifier: any pre-submit response, via
  anon **or** authenticated student, exposing either answer column. Proof: `PROBE`
  (mirrors `ws0-probe.ts` TB-01/TB-02) — **must stay green**, this is the
  invariant the whole platform exists to protect. (skill: `anti-leak`)
- **D.5 (reference taxonomy seeded)** SAT section/skill/difficulty reference tables
  are seeded from the Doc 02A taxonomy (closes GAP-HY-08 — no empty deny-all ref
  tables). Proof: `STRUCT` (row counts > 0) + `SNAP`.

---

## E — Reseed post-conditions (owner-run; Doc 00 V6 §9)

- **E.1 (questions count)** `SELECT count(*) FROM public.questions = 280`. Proof:
  owner-run query, output embedded in closure.
- **E.2 (profiles FK-intact)** `SELECT count(*) FROM profiles p LEFT JOIN auth.users u
  ON p.id=u.id WHERE u.id IS NULL = 0` (every reseeded profile keys to a preserved
  auth user; no orphans — FK RESTRICT precondition). Proof: owner-run query.
- **E.3 (anti-leak holds post-reseed)** D.4 `PROBE` is green **after** reseed —
  reseeding the answer columns did not open a pre-submit leak. Proof: `PROBE`.

---

## F — What this contract does NOT cover (later waves)

Runtime-engine tables (Doc 02B — WS-2), the Doc 05 mastery family (WS-3), Doc 04
scoring (WS-4), Doc 03 LISA (WS-5), Doc 06 ops (WS-6), Doc 07 analytics (WS-7),
and all app-layer **CODE** gaps (entitlement gating, serializers, service layer —
[`GAP-WAVE-MAP.md`](../docs/SpecAudit/30-genesis-recut/GAP-WAVE-MAP.md)) are out of
genesis `0000` scope. This contract governs the foundation only.

**Explicitly deferred identity object:** `guardian_link_audit` (Doc 01 V8 §35,
"Shared append-only" in Appendix E) — its exact column DDL is not pinned in the
sections grounded for this pass, so genesis does **not** invent it; it lands in a
precise identity follow-up alongside the `guardian-service.ts` writer, not the
foundation.

**Migration spec-fidelity adaptations** A1–A9 (each annotated in
`supabase/migrations/00000000000000_genesis.sql`) are the canonical renderings of
directional/illustrative spec DDL into runnable Postgres; the genesis fresh-apply
gate proves them. Two carry candidate spec clarifications escalated to the owner:
**A1/SP-08** (`GENERATED ALWAYS` not Postgres-valid for `age()`; rendered as
write-maintained columns + trigger — note a `STORED` generated column would also be
stale, so GAP-OP-01 is needed either way) and **A5** (`stripe_cancellation_status`
sourced from Doc 01 V8 §40.2.1 prose, not the Appendix B.6 DDL block).
