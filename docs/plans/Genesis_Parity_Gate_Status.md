# Genesis parity gate — status: BUILT, PARKED, NOT A CONTROL

**Date:** 2026-08-27 · **Owner ruling:** park it (2026-08-27) · **Revisit:** after PR #631 lands

---

## What this is, and what it is not

**It is not a control yet.** Nothing enforces it. It is not wired into CI, by
owner ruling: a gate that arrives red gets disabled, and then there is neither
the gate nor the knowledge. This document is the knowledge.

Do not describe this as "parity gated" anywhere. Genesis and production are
**known to differ** in two categories that were never reconciled — see below.

## What was built

`scripts/ci/genesis-parity-snapshot.sql` — one query, run identically against a
fresh genesis apply and against production, emitting `category|identity|detail`
per catalog object across nine categories: tables, columns, constraints,
indexes, policies, RLS, grants, function bodies and triggers.

Version tolerance was **measured, not assumed**. Production runs PG 17.6; CI
pins 16 and the local reference is 16.13. Six of nine categories digest
*identically* across that major-version boundary — including policy
`qual`/`with_check`, which was the main re-rendering risk. Function bodies use
`md5(prosrc)` rather than `pg_get_functiondef` precisely because the latter is
re-rendered by the server and its formatting moved between 16 and 17.

## Where it stands

| category | production | genesis | state |
|---|---|---|---|
| column, index, policy, rls, table, trigger | — | — | **identical** |
| grant | 106 | 105 | one residual: `canonical_skill_catalog`, allowlisted |
| constraint | 355 | 355 | same count, **different definitions — UNRECONCILED** |
| function | 53 | 53 | same count, **different bodies — UNRECONCILED** |

### The two unreconciled categories

Same count, different digest. That is consistent with rendering skew between
PG 16 and 17.6 rather than missing objects — but it has **not been established**,
and a digest cannot establish it. A digest says *different*; only a diff says
*different how*.

Chasing it was stopped by owner ruling. The method, when it resumes: two schema
dumps produced by the **same pg_dump major version**, one owner-run against
production and committed, then diffed.

The version constraint that forced this, recorded so it is not rediscovered:
**pg_dump 16 cannot dump a PG 17.6 server** — it aborts on version mismatch.
Both sides must therefore be produced by **pg_dump 17**, which can also dump
CI's PG 16 service (newer client against older server is supported). CI's
`ensure-psql16` action would need a pg17 client alongside it.

## Allowlist — four objects, all closing on one PR

Excluded by exact name on both sides. The comparison is not weakened; a fifth
drift fails on sight, and a third heading on an allowlisted id still fails.

| object | kind | expiry |
|---|---|---|
| `mastery_levels` | table | PR #631 — also carries 6 rows, so a data question too |
| `guardian_can_view_student_as` | function | PR #631 |
| `guardian_view_decision` | function | PR #631 |
| `canonical_skill_catalog` | view | PR #631 |

All four are created by migrations on `origin/cleanup`; verified 2026-08-27 by
searching that branch's migrations for each object's `CREATE`.

`canonical_skill_catalog` was **not** in the original three-object drift
inventory. It surfaced while reconciling grants — it was the entire residual
grant gap — which is the useful part: the inventory was believed complete and
was not. Treat the current four as "known", not as "all".

## What WAS reconciled and is real

Two genesis defects were found and fixed, both verified green in CI on PR #659:

1. **`entitlements_profile_id_unique`** — genesis declared `ADD CONSTRAINT`;
   production holds a unique **index**, created by
   `20260809000000_...:21` with `CREATE UNIQUE INDEX IF NOT EXISTS`. Genesis was
   corrected toward production in both genesis files. Not systemic: of the 10
   `UNIQUE` names genesis declares, the other 9 are real constraints.

2. **Missing `service_role` grants** — 17 tables, 3 sequences, 5 functions, made
   explicit in `20260827000000_explicit_service_role_grants.sql`. Cause was an
   invisible platform default (`ALTER DEFAULT PRIVILEGES` on `public` by role
   `postgres`, naming `service_role` only), which is why `anon` and
   `authenticated` matched exactly and `service_role` did not.

## Resuming

Revisit when the drift set is empty — i.e. after PR #631 lands and all four
allowlist lines are deleted. At that point:

1. Re-run the comparison. Grants should reach parity with the allowlist gone.
2. Resolve constraint and function by dump-diff, not digest.
3. Only wire it into CI once it is green. Not before.
