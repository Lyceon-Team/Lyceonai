# Migration history repair — runbook

> ## ⛔ HOLD — do not start this until Priority 0 clears
>
> `apply_mastery_event` has still never completed in production. The backfill proved
> the compute chain; the event path is unproven. Karl is answering one practice
> question to test it.
>
> **Run `live-event-verify.sql` first.** If it does not report
> `OK — apply_mastery_event completed for a live answer`, that outranks everything
> in this runbook. Fix the live path, then come back.
>
> Nothing here is urgent: a failed `supabase db push` is loud and recoverable. It
> only needs to be settled before the *next* migration ships.

**Owner ruling Q9 (2026-08-17):** use the Supabase CLI's `migration repair`, not
hand-written SQL. Hand-inserting into `supabase_migrations.schema_migrations` means
guessing the column shape the runner expects (`statements`, `name`, version format),
and a wrong guess creates a subtler desync than the one being fixed. The
committed-file constraint is satisfied by this runbook carrying the literal
commands.

`migration-history-repair.sql` has been **deleted** for that reason. If you find a
copy, do not run it.

## Why the repair is needed

`20260816000000` and `20260816010000` were applied by executing their SQL directly.
Their objects are present and correct, but the runner has no record of them, so the
next `supabase db push` will try to re-run both:

| Version | Failure on re-run |
|---|---|
| `20260816000000` | backfill scope guard aborts, or the seal fails as a duplicate constraint |
| `20260816010000` | `ADD CONSTRAINT` fails — both already exist |

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
OK — prod schema matches both migrations; safe to record them as applied
```

This checks every object the two migrations create, including the statements a
manual apply is most likely to have skipped and which are invisible afterwards:
`ENABLE ROW LEVEL SECURITY`, the `REVOKE`/`GRANT` pair, and the primary key on the
backfill log.

**Any other verdict: STOP.** The verdict names which object is wrong. Fix the gap
first — do not proceed to Step 3. Repairing history over a schema that does not
match is the one irreversible mistake available here.

## Step 2 — confirm the drift is what you think it is (READ-ONLY)

```
scripts/prod-verify/migration-history-audit.sql
```

**Required:** both `20260816000000` and `20260816010000` report

```
REPAIR — objects exist but the version is not recorded
```

`20260816020000` will report `PENDING — not applied and not recorded`. That is
correct and expected — it has genuinely never run and is handled in Step 5, not
here.

| If a target version reports | Then |
|---|---|
| `consistent — nothing to do` | already repaired. Skip to Step 5. |
| `INVESTIGATE — recorded as applied but the objects are missing` | **STOP.** Something dropped the objects or the version was recorded against a different database. Do not repair. |
| `PENDING` for `000`/`010` | the objects are gone. Do not repair — this contradicts Step 1 and one of the two readings is wrong. |

## Step 3 — mark the two versions as applied (WRITES bookkeeping only)

```bash
supabase migration repair --status applied 20260816000000
supabase migration repair --status applied 20260816010000
```

**Expected output** — one line per command, of the form:

```
Repaired migration history: [20260816000000] => applied
```

The CLI may first print `Connecting to remote database...`. It writes one row per
version into `supabase_migrations.schema_migrations` and **executes no migration
SQL**. No application table is touched.

**Deviations:**

| Output | Meaning | Action |
|---|---|---|
| `Repaired migration history: [...] => applied` | success | continue |
| `error: failed to connect` / auth failure | the CLI cannot reach the project | fix credentials. Do NOT substitute hand-written SQL — that is what ruling Q9 excludes. |
| `Cannot find project ref` | not linked | `supabase link --project-ref <ref>` first |
| no output and a zero exit | version may already be recorded | verify with Step 4 rather than re-running |
| anything mentioning a statement being executed | **STOP** — repair must not run migration SQL. Capture the output and stop. |

## Step 4 — confirm the repair (READ-ONLY)

```
scripts/prod-verify/migration-history-audit.sql
```

**Required:** both target versions now report

```
consistent — nothing to do
```

`20260816020000` still reports `PENDING`. Correct.

If a target version still reports `REPAIR`, the CLI did not write the row — do not
retry blindly, check the CLI output from Step 3 first.

## Step 5 — apply `20260816020000` THROUGH THE RUNNER

**Owner ruling Q10:** apply it now. Deployment does not require a scheduler — the
view and ledger are useful the moment they exist, and they are the reconciliation
invariant.

Through the runner, **not** by direct SQL — that is the whole point of Steps 1–4.
Applying `020` by hand would recreate the exact drift just repaired.

```bash
supabase db push
```

This should apply `20260816020000` and nothing else. If it attempts `000` or `010`,
the repair did not take: **STOP** and return to Step 4.

Then verify:

```
scripts/prod-verify/2.4-post-apply.sql
```

**Required verdict:**

```
OK — gap detector deployed; views, ledger, function and grants all present
```

## Step 6 — what comes after

With the detector deployed, the Q1 + Q7 binding becomes buildable: a Vercel cron
hitting an internal route that queries `mastery_derivation_gap_summary` and alerts
on a non-zero count, using the existing scheduler in
`server/routes/internal-cron-routes.ts`. No `pg_cron`, no second scheduler, no GCP
dependency. **Not built yet** — ruling Q1/Q7 sequences it after `020` is applied.

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
