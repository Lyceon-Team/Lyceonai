# WS-M — Migration Integrity & Provenance

**Version:** V1.1
**Status:** Draft for Karl approval
**Date:** 2026-08-04
**Scope:** Program-level. Not Vertical C, not LISA.
**Blocks:** WS-L0.3 (LISA tutor DDL) and all further DDL on any vertical.
**Proposed repo path:** `docs/plans/WS-M_Migration_Integrity.md`

---

## 0. Why this workstream exists

Production's applied-migration ledger stopped recording on 2026-06-25. Sixteen migration files dated `20260625000000` through `20260724010000` are present in `supabase/migrations/` and absent from `supabase_migrations.schema_migrations`, yet **every object they create is live in production**.

The CI gate that should have caught this cannot, by construction.

This is not a LISA finding. It spans the mastery engine, the account-deletion cascade, the practice pool, the content pipeline, and the metering layer — the entire applied surface. It was surfaced during LISA WS-L0.1 and is extracted here because its blast radius is the program, not the vertical.

### 0.1 Evidence

| Fact | Source |
|---|---|
| Prod ledger has 16 entries, ending `20260624020000_05d_governance_substrate` | `supabase_migrations.schema_migrations`, read-only, 2026-08-04 |
| Repo has 32 migration files; 16 applied, 16 unapplied, **0 ghosts** | CC forensic L0.1 at SHA `b60989e` |
| 14 of 14 objects sampled across all 16 unapplied files are **present in prod** | `pg_class` + `pg_proc` sweep, read-only, 2026-08-04 |
| `select_practice_pool_random` in prod returns the **v4** 16-column signature incl. `assets`, `option_metadata`, `estimated_time_seconds` | `pg_get_function_result`, read-only — matches `20260724000000` |
| `servable_questions` grants are `postgres` + `service_role` only; no `authenticated`, no `anon` | `information_schema.role_table_grants`, read-only — **security boundary intact** |
| `check_and_reserve_full_length_quota`, `check_and_reserve_calendar_quota` absent from prod despite live call sites | `pg_proc` sweep; call sites `fullLengthExam.ts:2306`, `calendar.ts:515` |

### 0.2 Root cause — a tautological gate

`scripts/ci/genesis-fresh-apply.sh` replays all 32 migrations via `psql` directly, bypassing the Supabase migration system entirely, then diffs the result against `genesis-schema.expected.sql` — **a committed snapshot of its own output.**

It never reads or writes `schema_migrations`.

The gate proves the repo's migration set is self-consistent and deterministic from scratch. It is structurally incapable of detecting divergence between the repo and production, and it passes at 100% under exactly the condition it appears to guard against.

**Named failure class: tautological test** — an assertion that passes under the regression it guards against. The ledger is therefore not merely stale; nothing in the system reads it.

### 0.3 What is NOT wrong

Stated explicitly so this workstream is not over-scoped:

- Karl owned every prod apply. The structural rule held. What failed is that the **application method does not record** — SQL-editor application produces correct schema and no ledger entry.
- Prod schema appears **converged**, not divergent: every sampled object is present and the one function whose version could be tested is at repo HEAD.
- The `servable_questions` security boundary held through the out-of-band path.

The defect is provenance and enforcement, not correctness. That distinction sets the fix scope: **verify, record, enforce** — not rebuild.

---

## 1. Invariants this workstream establishes

| ID | Invariant | Proving mechanism |
|---|---|---|
| `INV-M-01` | Production schema is reproducible from `supabase/migrations/` alone | `ci/prod-schema-parity` (M2.1) |
| `INV-M-02` | `schema_migrations` is a complete and accurate record of what is applied to prod | M1.2 verification + `ci/prod-schema-parity` |
| `INV-M-03` | Exactly one migration root exists; no `CREATE TABLE` lives outside it | `ci/single-migration-root` (M3.2) |
| `INV-M-04` | No CI gate validates a replay against a snapshot of its own output | M2.1 replaces the `genesis-schema.expected.sql` comparison |
| `INV-M-05` | Every RPC invoked from application code exists in prod with a matching signature | `ci/rpc-call-site-parity` (M4.1) |

---

## 2. Sequence

Order is load-bearing. Each step's output is the next step's input.

### M0 — Establish ground truth `[READ-ONLY]`

We know the objects exist. We do **not** know the applied SQL was byte-identical to the migration files rather than hand-edited at apply time. This is the last real unknown and it gates everything.

| # | Action | Owner | Status / Acceptance |
|---|---|---|---|
| M0.1 | Prod-side object hash snapshot via read-only introspection | Claude | **COMPLETE 2026-08-04.** 45 `public` functions captured as `md5(pg_get_functiondef(oid))` + `prosecdef`. Table/view/constraint hashes pulled on demand at M0.2 |
| M0.2 | Replay the 32 repo migrations to a throwaway DB, run the identical hash query, diff against the prod snapshot | CC (read-only, no prod credentials) | Per-object hash comparison; every mismatch classified |
| M0.3 | Triage divergences | Claude → Karl | Each divergence is one of: **repo-ahead** (file has it, prod doesn't), **prod-ahead** (prod has it, no file), **conflict** (both have it, hashes differ → hand-edited at apply time) |

**Gate:** M1 does not start until M0.3 is closed. `conflict` and `prod-ahead` findings require a Karl ruling before the ledger is repaired.

**Method note — why hashes, not `pg_dump` text diff.** A `pg_dump` output diffed against `genesis-schema.expected.sql` requires normalizing ordering, whitespace, comments, and quoting on both sides. Normalization is where a real divergence hides inside a rule someone wrote to suppress noise — the same defect shape as the tautological gate this workstream exists to fix. `pg_get_functiondef()` is canonicalized by Postgres itself: identical body, identical hash, no normalization layer. The comparison is exact and has no tuning surface.

**Access note.** CC never touches production in M0. Claude supplies the prod column read-only; CC computes the replay column locally. This separation is deliberate and holds for the whole workstream.

### M1 — Repair the record

| # | Action | Owner | Acceptance |
|---|---|---|---|
| M1.1 | `supabase migration repair --status applied <version>` for the 16 unapplied versions | **Karl** | Platform-native. Marks applied without re-running. No DDL executed |
| M1.2 | Verify ledger completeness | Claude (read-only) | `schema_migrations` returns 32 rows matching the 32 repo files exactly |

**Why repair and not squash:** repair is the platform-native mechanism for exactly this condition and executes no DDL. A baseline squash rewrites history and creates a second migration of record. Boring wins.

**Why M1 cannot precede M0:** repairing asserts *"prod equals these files."* That is precisely the claim M0 verifies. Repairing first launders an unverified assumption into the permanent record.

### M2 — Fix the gate

| # | Action | Owner | Acceptance | Proving mechanism |
|---|---|---|---|---|
| M2.1 | Build `ci/prod-schema-parity` | CC | Replays repo migrations to a throwaway DB; compares **per-object hashes** against a freshly-pulled prod introspection snapshot, not a committed expected-file. Any hash mismatch fails the build. This is the M0.2 method promoted to a scheduled gate | The gate itself |
| M2.2 | Negative control | CC | Deliberately drop a column on the throwaway DB and confirm the gate **fails**. A gate never observed failing is not known to work | Committed negative-control test |
| M2.3 | Promote to required check | Karl | Branch protection on `main` and `cleanup`; cannot be skipped silently | Branch protection config |
| M2.4 | Retire the tautological comparison | CC | `genesis-schema.expected.sql` comparison removed or demoted to a non-gating self-consistency check, clearly labelled as such | Absence assertion |

**Design constraint on M2.1:** the prod snapshot input must be generated fresh, not committed and trusted. A committed prod snapshot decays into the same defect within weeks.

### M3 — Close the bypass paths

| # | Action | Owner | Acceptance |
|---|---|---|---|
| M3.1 | Delete or quarantine legacy `database/` directory | CC | `database/migrations/0001_core_schema.sql`, `database/20241207_add_tutor_interactions.sql`, and `scripts/apply_migrations.ts` removed from the tree. CC confirmed these are inert (no wired `package.json` script, no CI reference) — inert is not the same as absent |
| M3.2 | `ci/single-migration-root` | CC | Fails if any `.sql` outside `supabase/migrations/` contains `CREATE TABLE` or `CREATE FUNCTION` |
| M3.3 | Document the apply procedure | Claude → Karl | Written into the ops runbook set: **prod applies go through the migration system.** The SQL editor is for read-only diagnosis. This is the behavioural fix M2 enforces mechanically |

**Note:** the pre-baseline archive at `docs/SpecAudit/_legacy-migrations/supabase-migrations-preBaseline/` is a documentation archive with no live reference. It stays. M3.1 targets the executable legacy path only.

### M4 — Program-level sweep

| # | Action | Owner | Acceptance |
|---|---|---|---|
| M4.1 | RPC call-site parity | CC | Every `.rpc(...)` / RPC wrapper in application code maps to a prod function with a matching signature. **Known open:** `check_and_reserve_full_length_quota` (`fullLengthExam.ts:2306`) and `check_and_reserve_calendar_quota` (`calendar.ts:515`) are absent from prod and — unlike the 16 out-of-band migrations — may never have been authored at all. Determine which |
| M4.2 | Re-verify "absent from prod" claims across the doc corpus | Claude (read-only) | Any committed finding asserting absence is re-checked against live prod. The LISA plan's §7 S4 has been re-verified and stands; others have not |
| M4.3 | Proving mechanism for M4.1 | CC | `ci/rpc-call-site-parity` — static extraction of RPC names from source, checked against a prod `pg_proc` snapshot |

---

## 3. Relationship to LISA

| LISA item | Disposition |
|---|---|
| L0.1 migration-ledger reconciliation | **Complete.** Verdict (a) confirmed. Migrated to this workstream as §0 evidence |
| L0.2 legacy migration-file removal | **Moved** to M3.1 — it is a program-level bypass path, not a LISA concern |
| L0.3 canonical tutor schema | **Blocked** on M1.2. Authoring a 17th unrecorded migration deepens the defect |
| §7 S3 (ledger provenance) | **Resolved.** Replaced by dependency on this workstream |
| §7 S4 (full-length/calendar RPCs) | **Moved** to M4.1 |

**WS-L1 is not blocked** and may proceed in parallel — its items are TypeScript chokepoints and deletions, no DDL. Karl's call whether to run it concurrently or hold the whole vertical.

---

## 4. Execution protocol

Standard per-step process applies. Specific to this workstream:

- **M1.1 is Karl-only.** It writes to prod. Not delegable. It is 16 row inserts to `supabase_migrations.schema_migrations` and can be run from the dashboard SQL editor — no CLI required, no DDL, reversible by deleting the rows.
- **CC is read-only through all of M0.** No writes until M0.3 is closed.
- **Codex audits M2.1 and M2.2 as a pair.** A gate without an observed failure is not a gate; the negative control is not optional and is not a nice-to-have.
- **No new migrations are authored anywhere in the program until M1.2 passes.** Not LISA, not full-length, not calendar.

---

## 5. Open items for Karl

1. **Does WS-L1 run in parallel with WS-M, or does the whole vertical hold?** L1 is DDL-free, so parallel is safe on the merits. Against: split attention on a program-level integrity problem.
2. **M0.3 `prod-ahead` findings, if any.** If the diff reveals objects in prod that no migration file creates, that is a materially different problem than the one this plan describes and needs a fresh ruling.
4. **Who owns M3.3?** The apply-procedure doctrine belongs in the ops runbook set. Doc 06A owns deployment/migration runbooks — confirm that is the home.

---

## 6. Change record

| Version | Date | Change |
|---|---|---|
| V1.0 | 2026-08-04 | Extracted from LISA WS-L0.1 forensic. Karl ruling: own workstream, LISA paused |
| V1.1 | 2026-08-04 | M0 method changed from `pg_dump` text diff to per-object hash parity. M0.1 executed and closed by Claude via read-only introspection. M2.1 gate design aligned to the same method. M1.1 clarified as a dashboard SQL-editor operation, no CLI dependency |
