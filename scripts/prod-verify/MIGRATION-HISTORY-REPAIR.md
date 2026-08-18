# Migration history repair — runbook

> ## Standing: this is now the largest unaddressed risk in the repo
>
> **SEVEN** migrations are applied to production and recorded by the runner as
> none of them. The next `supabase db push` — by anyone, for any reason — attempts
> to replay all seven. It fails loudly rather than corrupting anything, but it
> blocks every future schema change until this is settled.
>
> The earlier HOLD on this runbook (Priority 0, the unproven live event path) is
> **cleared**: mastery is intact at 7 attributable live events, and the four
> session-lifecycle migrations are applied and verified.

**Owner ruling Q9 (2026-08-17):** use the Supabase CLI's `migration repair`, not
hand-written SQL. Hand-inserting into `supabase_migrations.schema_migrations` means
guessing the column shape the runner expects (`statements`, `name`, version format),
and a wrong guess creates a subtler desync than the one being fixed. The
committed-file constraint is satisfied by this runbook carrying the literal
commands.

`migration-history-repair.sql` has been **deleted** for that reason. If you find a
copy, do not run it.

## Why the repair is needed

All seven were applied by executing their SQL directly. Their objects are present
and correct (proven by Step 1), but the runner has no record of any of them, so the
next `supabase db push` tries to re-run all seven:

| Version | What it created | Failure on re-run |
|---|---|---|
| `20260816000000` | backfill log, `psi_resolved_requires_occurred_at` | scope guard aborts, or the seal fails as a duplicate constraint |
| `20260816010000` | two canonical domain CHECKs | `ADD CONSTRAINT` fails — both already exist |
| `20260816020000` | gap views, ledger, index, recorder fn | `CREATE INDEX` is `IF NOT EXISTS`, but the ledger's `ADD CONSTRAINT`s are not |
| `20260817000000` | `practice_sessions_one_completed_diagnostic_uq` | `CREATE UNIQUE INDEX IF NOT EXISTS` is idempotent, but the `DIAGNOSTIC_ONCE_ONLY` preamble re-runs and re-raises if data has since changed |
| `20260817010000` | `student_diagnostic_states`, `student_diagnostic_state(uuid)` | `CREATE OR REPLACE` — idempotent, but re-running it silently reverts any hotfix made to the view since |
| `20260817020000` | `abandoned_at`, `practice_sessions_abandoned_not_completed` | `ADD CONSTRAINT` fails as a duplicate; the repair `UPDATE` re-runs over rows it already fixed |
| `20260817030000` | `student_baseline_pending` | `CREATE OR REPLACE` — same silent-revert risk as `010000` |

Two of these are worth naming separately, because "it would just fail" is not the
whole story. `CREATE OR REPLACE VIEW` **succeeds** on re-run, so a replay quietly
overwrites the live definition with the file's — which is fine today and is exactly
how a future hotfix gets un-done without an error. And `20260817000000`'s preamble
RAISEs on data it does not expect, so a replay months from now fails for a reason
that has nothing to do with the migration.

## Order is load-bearing

**Ruling Q9:** `migration-schema-parity.sql` runs FIRST and must pass. Only then
mark the versions as applied.

Recording "these ran successfully" before proving prod matches what they produce is
recording a **belief, not a fact**. And the belief is unfalsifiable afterwards: a
version marked applied is skipped by the runner forever, so if the schema does not
actually match, the drift becomes permanent and silent. That is strictly worse than
the duplicate-apply failure being repaired.

---

## Step 1 — prove prod matches the migrations (READ-ONLY, must pass)

Run in the SQL console:

```
scripts/prod-verify/migration-schema-parity.sql
```

**Required verdict:**

```
OK — prod schema matches all seven migrations; safe to record them as applied
```

That is 28 checks across the seven versions. The verdict row also reports
`checks_run`, `checks_passed`, `checks_failed`, `versions_with_deviations` and
`deviating_versions` — on a pass those read `28 / 28 / 0 / 0 / (none)`.

It checks every object the seven migrations create, including the statements a
manual apply is most likely to have skipped and which are invisible afterwards:
`ENABLE ROW LEVEL SECURITY`, the `REVOKE`/`GRANT` pair, the primary key on the
backfill log, the R2 RLS gate, each index's uniqueness and validity, and
`prosecdef` on every SECURITY DEFINER function.

**Any other verdict: STOP.** The verdict names the first failing object; run
`scripts/prod-verify/migration-schema-parity-detail.sql` for the full list. Fix the
gap first — do not proceed to Step 3. Repairing history over a schema that does not
match is the one irreversible mistake available here.

## Step 2 — confirm the drift is what you think it is (READ-ONLY)

```
scripts/prod-verify/migration-history-audit.sql
```

**Required:** all seven versions report

```
REPAIR — objects exist but the version is not recorded
```

One row per version, seven rows, same verdict on each. `20260816020000` is included:
its objects — the two gap views, the ledger table, `idx_mastery_gap_ledger_observed_at`
and `record_mastery_derivation_gap()` — were verified present on prod read-only on
2026-08-18, so it is a REPAIR like the other six, not a PENDING.

| If a target version reports | Then |
|---|---|
| `consistent — nothing to do` | already repaired. Skip to Step 5. |
| `INVESTIGATE — recorded as applied but the objects are missing` | **STOP.** Something dropped the objects or the version was recorded against a different database. Do not repair. |
| `PENDING — not applied and not recorded` for any of the seven | the objects are gone. Do not repair — this contradicts Step 1, and one of the two readings is wrong. |

## Step 3 — mark the seven versions as applied (WRITES bookkeeping only)

Run them one at a time, in version order, and read the output of each before
running the next. They are independent — a failure on one does not corrupt the
others — but stopping at the first deviation is what keeps the picture legible.

```bash
supabase migration repair --status applied 20260816000000
supabase migration repair --status applied 20260816010000
supabase migration repair --status applied 20260816020000
supabase migration repair --status applied 20260817000000
supabase migration repair --status applied 20260817010000
supabase migration repair --status applied 20260817020000
supabase migration repair --status applied 20260817030000
```

**Expected output** — one line per command:

```
Repaired migration history: [20260816000000] => applied
Repaired migration history: [20260816010000] => applied
Repaired migration history: [20260816020000] => applied
Repaired migration history: [20260817000000] => applied
Repaired migration history: [20260817010000] => applied
Repaired migration history: [20260817020000] => applied
Repaired migration history: [20260817030000] => applied
```

The CLI may first print `Connecting to remote database...`. Each command writes one
row into `supabase_migrations.schema_migrations` and **executes no migration SQL**.
No application table is touched.

**Deviations — any of these, on any of the seven:**

| Output | Meaning | Action |
|---|---|---|
| `Repaired migration history: [...] => applied` | success | continue to the next version |
| `error: failed to connect` / auth failure | the CLI cannot reach the project | fix credentials. Do NOT substitute hand-written SQL — that is what ruling Q9 excludes. |
| `Cannot find project ref` | not linked | `supabase link --project-ref <ref>` first |
| no output and a zero exit | that version may already be recorded | do NOT re-run it; verify with Step 4 |
| a line naming a version you did not type | you have a typo, or the CLI matched a prefix | **STOP.** Re-read the output before continuing — a version recorded by mistake is skipped forever. |
| anything mentioning a statement being executed | **STOP** — repair must not run migration SQL. Capture the output and stop. |
| the command hangs past ~30s | usually a network or auth prompt | Ctrl-C and re-check credentials; a partial run is safe to resume, since each version is independent |

If any version deviates, record which ones already succeeded before stopping. Step 4
tells you the true state regardless, but the list saves a round of guessing.

## Step 4 — confirm the repair (READ-ONLY)

```
scripts/prod-verify/migration-history-audit.sql
```

**Required:** all seven versions now report

```
consistent — nothing to do
```

Seven rows, one verdict each, no `REPAIR` and no `PENDING` left among them.

If a version still reports `REPAIR`, the CLI did not write the row — do not retry
blindly, check the CLI output from Step 3 for that version first.

**Then cross-check from the CLI's own side (READ-ONLY):**

```bash
supabase migration list
```

The audit reads `supabase_migrations.schema_migrations` directly; this reads it
through the runner, which is the reader that actually decides what gets replayed.
All seven versions must appear with a value in BOTH the `Local` and `Remote`
columns. A version showing `Local` but a blank `Remote` is still un-recorded from
the runner's point of view no matter what the audit says — **STOP**, and do not
run `supabase db push` until the two readings agree.

## Step 5 — from here, every migration goes THROUGH THE RUNNER

All seven versions in this runbook are already applied to production; there is
nothing left to push for them. Step 5 is therefore not an action — it is the rule
that stops this runbook from ever being needed again.

```bash
supabase db push
```

Through the runner, **not** by direct SQL. Every one of these seven exists because
that rule was broken once. After Step 4 reports `consistent` for all seven, the next
push should report that it has nothing to apply, or apply only genuinely new
versions. **If it attempts any of the seven, the repair did not take: STOP and
return to Step 4.**

`docs/runbooks/migration-deploy.md` makes `migration-history-audit.sql` a required
pre-flight before every apply, which is what catches a recurrence on day one rather
than seven migrations later.

## Step 6 — what comes after

The gap detector is deployed, so the Q1 + Q7 binding is now buildable: a Vercel cron
hitting an internal route that queries `mastery_derivation_gap_summary` and alerts
on a non-zero count, using the existing scheduler in
`server/routes/internal-cron-routes.ts`. No `pg_cron`, no second scheduler, no GCP
dependency.

**Do not build it against the view as it stands.** On 2026-08-17 the detector
reported 84 gaps out of 91 answered items — every item whose mastery came from the
Step 8 backfill, because `backfill_recompute_student` writes no per-event audit row.
An alert wired to that is 100% noise on its first day, which is how a real signal
gets muted. The exclusion ships in `20260818000000`; bind the cron after it.

Per the owner ruling of 2026-08-17, `student_baseline_pending` staleness folds into
this same surface rather than getting a channel of its own.

---

## Preventing the recurrence

**Owner ruling Q11:** the history audit is NOT scheduled — it needs production
credentials and CI must not hold those. It is a **required pre-flight step in the
deploy runbook**, run before every migration apply. See
[`docs/runbooks/migration-deploy.md`](../../docs/runbooks/migration-deploy.md).

The root cause is that direct SQL execution and the migration runner are two paths
to the same database and only one updates the bookkeeping. Running
`migration-history-audit.sql` before every push is what catches that on day one
instead of a week later.
