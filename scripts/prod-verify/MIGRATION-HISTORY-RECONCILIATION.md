# Migration history reconciliation — decisions and rationale

**Owner rulings received 2026-08-17. This document records the decisions and the
reasoning behind them. The operational steps live in
[`MIGRATION-HISTORY-REPAIR.md`](./MIGRATION-HISTORY-REPAIR.md) — go there to run
anything.**

> ## ⛔ HOLD — Priority 0 outranks this whole track
>
> `apply_mastery_event` has still never completed in production. Run
> `live-event-verify.sql` first. If the live path still fails, it outranks
> everything here. Nothing in this track is urgent — a failed `supabase db push` is
> loud and recoverable.

## The situation

`20260816000000` and `20260816010000` were applied to production by executing their
SQL directly rather than through the migration runner. Their objects are present and
correct — constraints exist and are validated, the backfill log holds 42 rows — but
`supabase_migrations.schema_migrations` has no row for either version.

The runner therefore still believes both are pending, and the next
`supabase db push` will attempt to re-run them. Both will fail: the backfill scope
guard aborts, and `ADD CONSTRAINT` hits a duplicate.

## The asymmetry that shapes every decision below

Recording a version as applied is **irreversible in practice**: the runner will
never look at that version again. If the claim is false — marked applied but the
objects are not really there — the migration is skipped forever and the schema
drifts permanently and silently.

That is strictly worse than the duplicate-apply failure being repaired. Every
decision below falls out of that asymmetry.

---

## Q9 — mechanism: the Supabase CLI, not hand-written SQL

**Ruling:** use `supabase migration repair --status applied <version>`.

Hand-inserting into `supabase_migrations.schema_migrations` means guessing the
column shape the runner expects — `statements`, `name`, the version format. A wrong
guess creates a subtler desync than the one being fixed: the row exists, the runner
reads it differently than intended, and now two things are wrong instead of one.
The platform-native tool owns that shape; we should not model it.

**Consequence:** `migration-history-repair.sql` is **deleted**. The committed-file
constraint is satisfied by `MIGRATION-HISTORY-REPAIR.md` carrying the literal
commands, their expected output, and what each deviation means.
`scripts/ci/migration-history-gate.sh` fails if that SQL file reappears, so it
cannot drift back in as a tempting shortcut.

### Order is load-bearing

**Ruling:** `migration-schema-parity.sql` runs FIRST and must pass. Only then mark
the versions applied.

Recording "these ran successfully" before proving prod matches what they produce is
recording **a belief, not a fact** — and per the asymmetry above, that belief
becomes unfalsifiable the moment it is written.

This is why gate case R2 exists: it disables RLS on the backfill log and requires
parity to STOP. Runbook step 1 is the only thing standing between a hand-applied
schema and an irreversible recording, so parity being *strict* is the property that
matters, not parity merely existing.

## Q10 — apply `20260816020000` (the gap detector): yes, now

**Ruling:** deployment does not require a scheduler. The view and ledger are useful
the moment they exist, and they are the reconciliation invariant.

**Sequence:** parity → repair `000`/`010` → apply `020` **through the runner**, so
history stays consistent going forward. Applying `020` by hand would recreate the
exact drift being repaired.

Verified afterwards by `2.4-post-apply.sql`, which is new — the original defect was
that this migration shipped with a CI gate and no operator artifact at all.

## Q11 — scheduling the history audit: no

**Ruling:** it requires production credentials, which CI must not hold. It becomes a
**required pre-flight step in the deploy runbook**, run before every migration
apply: [`docs/runbooks/migration-deploy.md`](../../docs/runbooks/migration-deploy.md).

## Q1 + Q7 — collapsed, and the gap detector answers both

**Ruling:** bind as Vercel cron → internal route that queries the gap view and
alerts on a non-zero count, using the **existing** scheduler in
`server/routes/internal-cron-routes.ts`. No `pg_cron`, no second scheduler, no GCP
dependency.

This measures the invariant directly rather than counting log lines, which is why it
supersedes the metrics-substrate question rather than answering it.

**Not built yet** — the ruling sequences it after `020` is applied. It is the next
piece of work once the runbook completes.

## Q2 / Q4 / Q5 — closed

Recorded here so they are not re-raised:

- **Q2** = option (a): quarantine `refresh_section_kpi` + `refresh_overall_kpi`
  only. Phase 4, spec cycle.
- **Q4** = `excluded_event_count` is operator-only, per Doc 05 Parent acceptance #20.
- **Q5** = closed by the two-branch schema-shape assertion already shipped and green.

---

## Why the root cause recurs without the runbook

Direct SQL execution and the migration runner are two paths to the same database,
and only one of them updates the bookkeeping. Nothing in CI can see production, so
nothing in CI can catch the divergence.

`migration-history-audit.sql` is the detector, and Q11 puts it where it will
actually run: as a pre-flight step before every apply. It costs seconds and would
have caught this on day one instead of a week later.

A second, related root cause is worth naming because it caused the `020` omission
independently: **a migration with a CI gate and no operator artifact is a migration
nobody will remember to apply.** The deploy runbook now requires both a
`prod-verify` file and a run-order row before any migration is applied.
