# WS-1 (Re-Cut) — Teardown · Genesis-from-Spec · Reseed — Governing Contract

> **Status:** Phase-0/1 planning artifact (Doc 00 V6 §10 lifecycle). Owner-approved
> in shape (Karl, 2026-06-09); **no schema is applied until the owner runs the
> teardown runbook.** This contract is the governing doc for the genesis re-cut; it
> **supersedes** the provenance-baseline WS-1
> ([`../20-ws1-provenance/WS-1-CONTRACT.md`](../20-ws1-provenance/WS-1-CONTRACT.md))
> and re-cuts the execution view
> ([`../10-gap-registry/closure-plan.md`](../10-gap-registry/closure-plan.md)).
> The registry ([`../10-gap-registry/gap-registry.md`](../10-gap-registry/gap-registry.md))
> remains the source of truth for *gaps*; this doc re-cuts only their *execution*.

---

## 0. Why this supersedes the provenance baseline (the I-1 reversal)

The finalized provenance-baseline WS-1 was built on its invariant **I-1**: *"The
baseline is deployed reality, NOT the spec target … WS-1 does **not** move the
schema toward the spec. Baseline `0000` reproduces the current post-WS-0
production schema **exactly** … the empty diff is only achievable if `0000` ==
prod. Faithfulness is the whole job."* Its exit proof was a `supabase db diff`
of **fresh-apply vs production = empty**.

The owner has directed a **clean-slate teardown + genesis-from-spec rebuild**.
This **reverses I-1 outright**:

| | Provenance baseline (superseded) | Genesis re-cut (this doc) |
|---|---|---|
| `0000` source of truth | deployed prod, captured verbatim | **`docs/Spec/`** (Doc 01 V8 + 01A + 02A) |
| Direction | freeze drift, change nothing toward spec | **build the spec-correct schema natively** |
| Wrong-generation objects | reproduced faithfully (fixed later) | **never recreated** (torn down) |
| Deployed `public` schema | preserved, runtime keeps working | **dropped in-place by the owner** |
| Exit proof | fresh-apply **== prod** (empty diff) | fresh-apply is **deterministic + spec-conformant**; prod is *replaced*, then reseed is proven |

This is a deliberate strategic pivot, not a defect in the prior contract. The
prior contract correctly executed the strategy that was in force when it locked;
the strategy changed. Per corpus convention (Doc 00 V6 §15 — new-version
supersession with an explicit header), the prior contract is **retained as
provenance** and carries a SUPERSEDED banner pointing here; it is not deleted.

---

## 1. Grounding (re-run every task; STOP on hash mismatch)

```
git branch                = claude/sleepy-heisenberg-fKZvh
git rev-parse HEAD         = 59d67a40c7738b49983b7c886c93dd2e23e13eb2

Canonical docs grounded (git hash-object):
  Doc 00 V6 (constitution)  = a607d7ecd2be8506b28bf3e17c3ce81f2cdfa668   docs/Spec/Lyceon — Document 00_ Authoritative Platform Directive (V6).md
  Doc 01 V8 (identity)      = e74d83e4c9fb776778678fb0b23e582d4be73e4d   [V8.0 CANONICAL, 2959 LF; file "…Document 01_ … Guardian Trust.md" (unversioned) — the "(V6).md" sibling is the superseded V6]
  Doc 01A   (primitives)    = aa4d8b638017393406710794a34c9fc432a46eb0   [V1.0 CANONICAL, 2480 LF]
  Doc 02 Preamble           = 5e105d9a27bac73dc8d179d661ee08823ad56e93   [V3 Final, 565 LF]
  Doc 02A   (generation)    = abf153f701a631cbdc4411ffa6624faa87d2c0a4   [V6, 1722 LF]
  Doc 02B   (runtime)       = f3603b527fcd53a451abefb55e9c52c218692f52   [V4, 2392 LF]

Live-state capture (reseed source / inventory-diff input):
  docs/SpecAudit/0000-supabase-live-20260607.csv = 5bb0ffe15d52ef45a6706caaa1fd108dc5a82a2a  [post-WS-0]
```

> **Note (Doc 01 V8 git hash):** the V8 blob hash is recorded as returned by the
> grounding pass; re-verify with `git hash-object` before any implementation task
> and STOP on mismatch.

---

## 2. Locked decisions (owner rulings carried into this contract)

The §6-class strategy decisions (Karl, this session) plus the four genesis
rulings (Karl, 2026-06-09):

1. **Genesis scope** — foundational `0000` = identity (Doc 01 V8) + platform
   primitives (Doc 01A) + the content-core the reseed needs (Doc 02A `questions`,
   Doc 01 V8 `profiles`); per-domain build waves follow in dependency order
   (Doc 00 V6 §7 truth flow).
2. **Reseed/proof** — prove the clean schema (deterministic fresh-apply +
   structural conformance), then reseed questions into the anti-leak shape +
   profiles with ids intact, then prove the reseed.
3. **Registry** — re-cut WS-2..7 into spec-domain build waves (§8 below).
4. **Doc 00 V6** — provided by the owner; added to `docs/Spec/` as an
   **owner-sanctioned exception** to the read-only-corpus rule (so genesis
   annotations cite a repo path).
5. **`profiles.id` FK = `ON DELETE RESTRICT`** (Doc 01 V8 §4), overriding the
   brief's "CASCADE." Safer for in-place teardown (cannot orphan an `auth.users`
   row); reseed keys profiles to the preserved `auth.users.id`.
6. **Supabase-in-place rebuild** → genesis ships **RLS ENABLED** as target-state,
   retiring the Doc 01 V8 §14.3 Neon-pooling RLS-bypass deviation (the pooler that
   dropped `auth.uid()` is not the rebuild target). Logged as SP-04 reconciliation.
7. **Anti-leak = serving-contract + RLS, NOT column removal.** `questions` carries
   `correct_answer` + `explanation`; the reveal matrix (Doc 02 Preamble §12) is
   enforced at the serving/projection layer + RLS. Reseed **populates** those
   columns and drops only the deployed `answer_text` duplicate.
8. **Doc 01 V8 is canonical**; the stale Doc 00 V6 §3/§11 "Doc 01 V8 pending" note
   is logged as **SP-06** spec-hygiene for WS-S (Doc 00 V6 §15 itself flags such
   pending notes as update-required on lock).

---

## 3. Invariants honored (Doc 00 V6)

- **§6 anti-leak** — no `correct_answer`/`explanation`/option-metadata/distractor
  taxonomy on any pre-submit surface; enforced by genesis RLS + the serving
  projection (Doc 02 Preamble §12 reveal matrix). (skill: `anti-leak`)
- **§6 server-authoritative / single canonical owner** — every genesis table
  declares its single writer (Doc 01 V8 Appendix E; Doc 01A ownership classes).
- **§6 determinism / idempotency** — primitive `idempotency_records` lands in
  `0000` (Doc 01A §31); mutations idempotent from day one.
- **§6 guardian model** — `guardian_links` single derivation; visibility derived
  only if (link active AND entitlement active); view-only, aggregate-first
  (Doc 01 V8 §31/§38).
- **§8 reference-never-restate** — every genesis object `@spec`-annotated to its
  owning doc §; no constant/formula/schema restated outside its owner.
- **§9 executable-proof** — every claim carries a runnable proof artifact
  (fresh-apply inventory, reseed counts, anti-leak probe). No proof → no claim.
- **§10 lifecycle** — Phase 1 validation contracts in `contracts/` precede code;
  Phase 3 grill-me + Phase 4 Codex gates; anti-leak/auth/billing/minor-safety
  gates are **hard**.

---

## 4. The arc (owner-gated; nothing applied before the owner runs the teardown)

```
A  Teardown        owner-run, in-place; drop public objects only; auth.users preserved
   (runbook)       + GUARD-1 pre-drop inventory diff vs genesis-expected set
                   + GUARD-2 post-drop auth.users row-count/integrity check
        │
B  Genesis 0000    from spec: extensions → enums → identity (01 V8) → primitives
   (migration)     (01A) → content (02A `questions` + reference tables); RLS enabled
        │
C  Reseed          questions → canonical anti-leak shape (canonical_id preserved);
   (owner-run)     profiles → keyed to existing auth.users.id (ids intact)
        │
D  Exit proof      fresh-apply determinism + structural conformance (CI);
                   reseed proof (counts + FK-intact + anti-leak probe)
```

- **A — Teardown** is fully specified in
  [`TEARDOWN-RUNBOOK.md`](./TEARDOWN-RUNBOOK.md). Agents never hold
  `service_role`; the **owner executes**. The runbook carries the two
  owner-mandated guards (GUARD-1 inventory diff, GUARD-2 auth integrity).
- **B — Genesis 0000** object inventory is in §6; its correctness contract is
  [`contracts/ws1-genesis-foundation.contract.md`](../../../contracts/ws1-genesis-foundation.contract.md)
  (Phase-1, implementation-independent, Codex-auditable).
- **C — Reseed** mapping is in §7.
- **D — Exit proof** is in §9 below.

---

## 5. Genesis `0000` object inventory (foundational; by owning doc)

Built **from spec**, in dependency order. Table-level here; column/constraint
detail is the Phase-2 implementation against the Phase-1 contract. RLS **enabled**
on every user-scoped table (decision #6). Every object `@spec`-annotated.

**Owned cross-schema deps (declared first):** `create extension if not exists
vector` (placed per Doc 02A; **not** in `public` — closes GAP-HY-07 by
construction), `create extension if not exists pgcrypto`. `auth.uid()`/`auth.jwt()`
referenced read-only; the `auth` schema is never defined or migrated.

**Enums / reference:** `profile_role {student,guardian,admin,tutor,teacher}`
(Doc 01 V8 §4); content enums — section `{M,RW}`, source_type `{1,2}`, difficulty
`CHECK 1–3`, distractor-taxonomy closed enum (Doc 02A §14/§17/§18); SAT
section/skill reference tables seeded (closes GAP-HY-08 by construction).

**Identity (Doc 01 V8 — single-writer per Appendix E):**

| Table | Single writer | §cite |
|---|---|---|
| `profiles` (PK `id`→`auth.users(id)` **ON DELETE RESTRICT**) | `profile-service.ts` | §4 |
| `entitlements` | Stripe webhook handler | §20–§24 |
| `entitlement_features` | admin-mutable | §27 |
| `guardian_links` | `guardian-service.ts` | §35 |
| `guardian_consent_requests` | `consent-service.ts` | §37.2 |
| `account_deletion_requests` | `deletion-service.ts` | §40 |
| `audit_logs` (append-only) | shared append-only | §5 |

**Platform primitives (Doc 01A — service-internal, no RLS by design):**

| Object | §cite |
|---|---|
| `idempotency_records` (PK `(scope, client_key)`) | §31 |
| `rate_limit_ledger` + `rate_limit_check_and_increment` RPC | §41 |
| `abuse_score_incidents` (append-only) · `abuse_scores` | §55 |
| `service_auth_secrets` | §64 |
| `*_runtime_config` ×N + `*_runtime_config_history` + append-only/NOTIFY triggers | §2–§8 |

> Code-only primitives (logger, correlation IDs, caching, HMAC signing) are
> **not** schema — they land in app-layer waves, not `0000`.

**Content-core (Doc 02A — the reseed target):** `questions` canonical schema
(Doc 02A §16) with the anti-leak boundary enforced at the serving layer
(`correct_answer`/`explanation`/`option_metadata` server-side; pre-submit
projection = `stem/passage/options/assets` only — Doc 02 Preamble §12), plus the
`canonical_id` immutable contract (Doc 02A §14) and an at-rest
`CHECK (difficulty BETWEEN 1 AND 3)` (closes GAP-EX-06 by construction).

> Runtime-engine tables (Doc 02B practice/review/exam/tutor sessions+items) and
> the Doc 05 mastery family are **later waves**, not `0000`.

---

## 6. Reseed mapping (owner-run, after schema proven)

| Target | Source | Mapping rule |
|---|---|---|
| `questions` (280 rows) | preservation snapshot (live `public.questions`) | `canonical_id` preserved verbatim; content → `stem/passage/options/correct_answer/explanation/option_metadata`; **drop the deployed `answer_text` duplicate** (decision #7); `difficulty` clamped to 1–3 |
| `profiles` (test accounts) | preservation snapshot + live `auth.users` | reseed keyed to **existing `auth.users.id`** (no new ids; FK RESTRICT satisfied); role/demographic columns mapped to the Doc 01 V8 §4 shape |

Anti-leak is **not** a reseed concern at the column level — both answer columns
exist in the canonical table; the serving contract + RLS keep them off pre-submit
surfaces (decision #7). The reseed proof includes an anti-leak probe asserting the
pre-submit projection exposes neither.

---

## 7. Spec-domain wave re-cut (decision #3)

Replaces the incremental WS-2..7. Order = Doc 00 V6 §7 truth flow
(foundation → runtime → mastery → scoring → tutor → ops → analytics). Full
gap→wave assignment for all 66 registry gaps: [`GAP-WAVE-MAP.md`](./GAP-WAVE-MAP.md).

| Wave | Spec family | Scope (summary) |
|---|---|---|
| **WS-1** (this) | Doc 01 V8 · 01A · 02A | Teardown + genesis `0000` foundation + reseed |
| **WS-2** | Doc 02B | Runtime engines: practice/review/exam/tutor session+item tables; anti-leak serving contract |
| **WS-3** | Doc 05A–D | Mastery + KPI + projections (the wrong-generation MA stack, built correct from spec) |
| **WS-4** | Doc 04A–D | Full-length exams + scoring (the moat: 04B closed-form formula + Python-parity gate) |
| **WS-5** | Doc 03/03A–C | LISA tutor runtime, retention lifecycle, tutor entitlement gates |
| **WS-6** | Doc 06A–E | Reliability/infra/security ops: scheduling, deletion lifecycle, MFA, backup/DR |
| **WS-7** | Doc 07A–E | Analytics, warehousing, event taxonomy, dashboards |
| **WS-8** | (cross-cutting) | Architecture consolidation: service layer, single-writer enforcement, response envelopes |
| **WS-S** | lock-cycle | Spec revisions SP-01..06 (parallel; never inline) |

**Key property of the re-cut:** genesis-from-spec **closes the majority of DRIFT
gaps by construction** — the deployed wrong-generation/leaky/legacy object is torn
down and the spec-correct one is built natively, so those gaps need no separate
"fix" ticket; they are subsumed into the owning wave's build. What survives the
teardown is **app-layer code** (TS gating/serializers/service-layer — not DB) and
**spec revisions**. See the map for the closed-by-construction vs still-real split.

---

## 8. In-flight delta dispositions (provenance-baseline D1–D4)

The provenance WS-1 was mid-implementation. Under the re-cut:

| Delta | Was | Disposition under genesis |
|---|---|---|
| **D1** Drizzle severance (GAP-OP-05) | sever Drizzle wiring | **SURVIVES** — genesis pipeline is `supabase/migrations`, not Drizzle; we want Drizzle gone regardless |
| **D2** archive legacy migrations + external SQL | move out of apply path | **SURVIVES (as hygiene)** — the legacy SQL is not the genesis source either way; archiving loses nothing |
| **D3** owner-run baseline `0000` = `pg_dump` of prod | capture deployed reality | **REPLACED** — `0000` is now built from spec, not dumped from prod (the I-1 reversal) |
| **D4** folded drops on the deployed schema (`20260608_ws1_provenance_drops.sql`) | drop dead objects in prod | **MOOTED** — the teardown drops the entire `public` schema; a deployed-schema drop migration is discarded by genesis |

> **Owner git-coordination needed:** the open D4 PR (`claude/ws1-d4-folded-drops`,
> HEAD `0356408`) executes D3+D4, now superseded. Recommend **closing it as
> superseded** (the genesis re-cut replaces its purpose); D1's Drizzle-severance
> value is preserved by re-landing severance inside the genesis branch if D4 is
> closed unmerged. Flagged to the owner; not actioned here.

---

## 9. Exit proof (decision #2: prove schema, then reseed)

**Schema proof (CI, no prod creds):**
1. Fresh-apply the genesis migration(s) to a throwaway Postgres → must be
   deterministic and **structurally conformant** to the contract-derived expected
   object set (`pg_dump --schema public` normalized == committed
   `genesis-schema.expected.sql`). This is **not** diff-vs-prod (prod is replaced).
2. Structural lint: every migration matches `^[0-9]{14}_.*\.sql$`; one pipeline
   only; no `drizzle.config.ts`; RLS enabled on every user-scoped table.

**Reseed proof (owner-run, executable):**
3. After the owner applies genesis in-place and runs the reseed:
   `questions` count == 280; every `profiles.id ∈ auth.users`; the anti-leak probe
   (anon + authenticated test student) returns **no** `correct_answer`/`explanation`
   on any pre-submit surface. Outputs embedded in the closure commit.

**GUARD-1 / GUARD-2** (teardown runbook) produce their own captured proofs: the
pre-drop inventory diff (nothing dropped that genesis does not recreate or
intentionally discard) and the post-drop `auth.users` integrity check.

---

## 10. Phase model & gates (Doc 00 V6 §10)

```
Phase 0/1  this contract + GAP-WAVE-MAP + TEARDOWN-RUNBOOK + ws1-genesis-foundation.contract
           (validation contracts precede code)              ← we are here
Phase 2    implement genesis 0000 migration(s) against the contract (annotated)
Phase 3    grill-me internal self-audit (anti-leak/auth/billing) + spec-auditor
Phase 4    external Codex audit (read-only; file:line; PASS/FAIL/PARTIAL)   ← STOP gate
Phase 5    QA: anti-leak / idempotency / denial / redaction tests
Phase 6    CI gate: fresh-apply determinism + structural lint
Phase 7    owner runs teardown → genesis → reseed → exit proof              ← owner gate
```

**No Phase-2 code (no migration SQL) is written until this contract + the
foundation contract clear Phase-4 (Codex) and owner approval.** No schema reaches
the database until Phase 7, run by the owner.

---

## 11. Open findings carried forward

- **F-RECUT-01** — D4 PR git-coordination (close-as-superseded?), §8. Owner decision.
- **F-RECUT-02** — SP-06 (Doc 00 V6 §3/§11 stale "Doc 01 V8 pending" note) routes
  through WS-S lock-cycle; added to the registry SP zone.
- **F-RECUT-03** — SP-04 (Doc 01 V8 §14.3 RLS-bypass posture vs the RLS-enabled
  Supabase rebuild) is resolved in the rebuild's favor (decision #6); WS-S records
  the reconciliation.
- **F-RECUT-04** — the reseed source is the owner's preservation snapshot (outside
  the repo, never committed); the exit proof depends on it being intact.
