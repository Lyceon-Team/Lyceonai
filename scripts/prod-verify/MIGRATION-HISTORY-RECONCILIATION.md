# Migration history reconciliation — plan, not an instruction to run

**Status: proposed. Nothing here has been applied. Do not run anything in this
document until the sequence below has been reviewed.**

## The situation

`20260816000000` and `20260816010000` were applied to production by executing
their SQL directly rather than through the migration runner. Their objects are
present and correct — constraints exist and are validated, the backfill log holds
42 rows — but `supabase_migrations.schema_migrations` has no row for either
version.

The runner therefore still believes both are pending. The next `supabase db push`
will attempt to re-run them, and both will fail:

| Version | Failure on re-run |
|---|---|
| `20260816000000` | the backfill scope guard aborts (`PSI_BACKFILL_SCOPE_EXPANDED`), or the seal fails as a duplicate constraint |
| `20260816010000` | `ADD CONSTRAINT` fails — both constraints already exist |

A failed push is loud and recoverable, so this is not urgent in the "production is
broken" sense. It is urgent in the "the next person to ship a migration hits a
wall they did not cause" sense, which is why it should be settled before any
further migration ships.

## The asymmetry that shapes the whole plan

Recording a version as applied is **irreversible in practice**: the runner will
never look at that version again. If the claim is false — the version is marked
applied but its objects are not actually there — the migration is skipped forever
and the schema drifts permanently, silently.

That is strictly worse than the duplicate-apply failure being repaired here. So
every artifact below is built to fail closed:

- `migration-history-repair.sql` **refuses** unless it can see the objects itself.
  It does not trust the audit having been run, and it does not trust this document.
- `migration-schema-parity.sql` checks the statements a manual apply is most
  likely to have skipped — RLS, GRANT/REVOKE, the primary key — not just the
  headline constraints, because those are the ones that are invisible afterwards.

## Two mechanisms. Prefer the first.

### 1. The Supabase CLI (recommended)

```
supabase migration repair --status applied 20260816000000
supabase migration repair --status applied 20260816010000
```

This is the CLI's supported mechanism for exactly this situation. It is the
managed path and it handles the bookkeeping table's shape itself.

### 2. `migration-history-repair.sql` (committed equivalent)

The standing rule is that every statement executed against production must exist
as a committed, reviewable file. The CLI command is not such a file, so
`scripts/prod-verify/migration-history-repair.sql` exists as:

- the **reviewable record** of exactly what the CLI does, and
- the **fallback** when the CLI cannot reach the project.

It builds its `INSERT` from `information_schema` rather than hardcoding a column
list, because `supabase_migrations.schema_migrations` has changed shape across CLI
versions (older: `version` only; newer: `version`, `name`, `statements`). CI proves
it works against both.

> **Owner question 1.** Which mechanism do you want used? The two rules point in
> different directions — *managed-service first* favours the CLI, *every statement
> is a committed file* favours the SQL. My recommendation is the CLI, with the SQL
> file committed regardless as the reviewable record and the fallback. Both are in
> the repo either way; this only decides which one you run.

## Sequence

Nothing here is applied. This is the proposed order.

| # | File | Writes? | Gate before continuing |
|---|---|---|---|
| 1 | `migration-history-audit.sql` | no | both target versions must report `REPAIR — objects exist but the version is not recorded`. Any `INVESTIGATE` row stops the whole plan. |
| 2 | `migration-schema-parity.sql` | no | must report `OK — prod schema matches both migrations`. Anything else means the manual apply did not reproduce the migration — fix that first, do **not** record the version. |
| 3 | CLI `migration repair`, **or** `migration-history-repair.sql` | yes (1–2 bookkeeping rows) | verdict `OK — both versions recorded as applied; nothing was re-executed` |
| 4 | `migration-history-audit.sql` again | no | both target versions now report `consistent — nothing to do` |

Step 2 is the one that actually protects you. Step 1 tells you the runner and
reality disagree; step 2 tells you *which one is right*.

## What this plan deliberately does not do

- **It does not touch `20260816020000`.** That migration is genuinely not applied
  (see below), so it must go through the runner normally, not through repair.
  `migration-history-repair.sql` has no object check defined for it and will
  refuse by construction if anyone adds it to the target list without one.
- **It does not re-run any migration SQL.** No application table is touched.
- **It does not backfill `statements`.** The runner uses that column for its own
  diffing; claiming we executed statements we did not execute through it would be
  a second, subtler inaccuracy layered on the one being repaired. `NULL` is honest.

## Related: `20260816020000` is not applied, and that is a different problem

`mastery_derivation_gaps` does not exist on production. The migration that creates
it, `20260816020000_mastery_derivation_gap_detection.sql`, landed in commit
`2ab98bb` (PR #589) with a CI gate but **no operator-facing artifact**: no
`prod-verify` file, and no entry in the run-order table in `README.md`. It was
never on the list of things to apply, so it never got applied.

This is a documentation defect with a schema consequence, and the fix is an entry
in the run order — not a repair. Unlike the two versions above, this one has not
run, so it must be applied through the runner in the normal way.

> **Owner question 2.** Do you want `20260816020000` applied now, or deferred? It
> creates read-only observability objects (two views, a ledger table, and a
> recording function) and changes no existing behaviour, so applying it is low
> risk — but it is also the migration whose absence has been invisible for a week,
> and Q7 (nothing is scheduled to call the detector) is still unanswered. Applying
> it without a scheduler gives you a detector nobody reads. I would apply it and
> answer Q7 separately, but it is your call and I have not written a run-order
> entry that presumes the answer.

## Preventing the recurrence

The root cause is that direct SQL execution and the migration runner are two paths
to the same database, and only one of them updates the bookkeeping.
`migration-history-audit.sql` is the standing detector for the resulting drift —
it is cheap, read-only, and can be run any time. Running it before every
`supabase db push` would have caught this the day it happened.

> **Owner question 3.** Should the audit become a scheduled check rather than a
> file someone remembers to run? It cannot go in CI, because CI has no access to
> production. The honest options are a step in whatever runbook precedes a push, or
> a scheduled job with prod credentials. I have not built either — that decision
> is upstream of Q1 in the original plan (the alert-substrate question), and I do
> not want to add a second half-answer to it.
