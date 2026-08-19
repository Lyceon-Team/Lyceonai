# Runbook — applying a migration to production

**Owner ruling Q11 (2026-08-17):** the migration-history audit is a **required
pre-flight step here**, run before every migration apply. It is deliberately NOT
scheduled and NOT in CI: it needs production credentials, and CI must not hold
those.

## Pre-flight — every time, before any apply

### 1. Migration history is consistent

Run in the SQL console:

```
scripts/prod-verify/migration-history-audit.sql
```

**Required:** every version reports `consistent — nothing to do` or
`PENDING — not applied and not recorded`.

| If any version reports | Then |
|---|---|
| `REPAIR — objects exist but the version is not recorded` | **STOP.** Something was applied by direct SQL and the runner does not know. Resolve via [`MIGRATION-HISTORY-REPAIR.md`](../../scripts/prod-verify/MIGRATION-HISTORY-REPAIR.md) before pushing, or the push will try to re-run it and fail. |
| `INVESTIGATE — recorded as applied but the objects are missing` | **STOP.** The runner believes a migration ran and its objects are gone. Do not push. Find out what dropped them. |

This is the step whose absence caused the August 2026 desync:
`20260816000000` and `20260816010000` were applied by direct SQL execution and the
runner had no record of them, which would have made the next push fail on a
duplicate constraint. Running this file costs seconds and catches that on day one
rather than a week later.

### 2. The migration has an operator artifact

Before applying a new migration, confirm it has BOTH:

- a `scripts/prod-verify/` verification file, and
- a row in the run-order table in
  [`scripts/prod-verify/README.md`](../../scripts/prod-verify/README.md).

**A migration with a CI gate and no operator artifact is a migration nobody will
remember to apply.** That is not hypothetical: `20260816020000` shipped with a CI
gate, no prod-verify file and no run-order row, and went unapplied for a week while
`mastery_derivation_gaps` did not exist and operator files referencing it failed
with `42P01`. CI stayed green the whole time, because CI provisions *every*
migration while production carries only the applied set.

### 3. The pre-apply verifier passes

Run the migration's `*-pre-apply.sql` if it has one. A `STOP` verdict means stop —
the text names the reason.

## Apply

```bash
supabase db push
```

Through the runner. **Never by pasting the migration body into the SQL console** —
that is exactly what produced the desync above. Direct execution and the runner are
two paths to the same database and only one of them updates the bookkeeping.

If the push attempts a version you believe is already applied, stop and go back to
pre-flight step 1.

## Post-apply

1. Run the migration's `*-post-apply.sql`. Required: its `OK` verdict.
2. Re-run `migration-history-audit.sql`. The version just applied must now report
   `consistent — nothing to do`.

## Rules that apply throughout

- **Karl runs only committed files.** Every statement executed against production
  exists as a reviewable file with a path. No SQL is pasted from chat.
- Every file under `scripts/prod-verify/` is pure SQL, pasteable into the console,
  and its verdict is the last result. `scripts/ci/prod-verify-console-gate.sh`
  enforces that and executes each file the way an operator does.
- Any verdict beginning `STOP` means stop. The verdict names the reason and, where
  relevant, the file to read next.

## Launch prerequisites — infrastructure that must change before real students

These are **blockers for launch**, not improvements. Each one is currently
constrained in a way that is acceptable at four pre-launch users and is not
acceptable with students on the platform.

### Vercel Pro — required before launch (owner ruling, 2026-08-17)

The project is on the Hobby plan, which permits **daily cron expressions only**.
This is a hard deploy failure, not a degradation: a more-than-daily schedule in
`vercel.json` fails the build outright with

```
Hobby accounts are limited to daily cron jobs. This cron expression (0 * * * *)
would run more than once per day.
```

Everything scheduled today is therefore daily, which is fine at current scale and
will not be. Three jobs need sub-daily frequency before real students arrive:

| Job | Why daily is not enough with students on the platform |
|---|---|
| `/api/internal/baseline-pending-sweep` | The threshold is 24h. A daily check means up to a further 24h before an operator learns a student is stuck without a baseline — a student staring at "your baseline is being calculated" for two days. |
| `/api/internal/stale-session-sweep` | Fine daily for the 7-day window today, but retention work will want a tighter loop. |
| mastery derivation gap detector | The outage it exists to catch ran for seven weeks. Detection latency is the entire value of the job. |

**Accepted for now** at four users; the ruling is explicit that this is recorded
as a launch prerequisite rather than a nice-to-have. Revisit the 24h staleness
threshold at the same time — it was chosen to sit far outside any legitimate
delay, and a shorter cron makes a shorter threshold useful.

### One alerting surface, not two (owner ruling, 2026-08-17)

`baseline_pending` past its threshold and mastery-derivation gaps are the same
category of problem: **derived state we owe a student that has not materialized.**
They get **one** operator surface — the gap-detection ledger — not one channel
each.

When the gap-detection cron route is built (it is sequenced after `20260816020000`
is applied), `student_baseline_pending` folds into it rather than keeping its own
endpoint. Do not add a third channel for the next instance of this category.

The reason is not tidiness: nothing watching one place is why the mastery outage
ran seven weeks.

## Related

- [`scripts/prod-verify/README.md`](../../scripts/prod-verify/README.md) — the file
  contract and the full run order
- [`scripts/prod-verify/MIGRATION-HISTORY-REPAIR.md`](../../scripts/prod-verify/MIGRATION-HISTORY-REPAIR.md)
  — repairing a desync once it exists
