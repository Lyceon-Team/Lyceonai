# `scripts/prod-verify/` — operator SQL

Every file here is run **by hand, against production, by Karl**, pasted into a SQL
console (the Supabase dashboard SQL editor or an equivalent runner). That is the
only execution environment these files target, and it constrains them hard.

## The contract every file in this directory must satisfy

1. **Pure SQL. No `psql` meta-commands.**
   `\pset`, `\echo`, `\ir`, `\set`, `\if`, `\timing`, `\x` — none of them. A SQL
   console sends the text straight to the server, which sees a bare backslash and
   fails with `42601 syntax error at or near "\"`. This is not cosmetic: the file
   does not run at all.

2. **No `:'variable'` interpolation.** Same reason — that is a `psql` client
   feature. Constants are written as literals in the file.

3. **The verdict is the LAST result.**
   Consoles commonly display only the final statement's result grid. A file whose
   verdict is followed by a listing hides the go/no-go decision behind browsing
   material. Prefer a single statement; where a file needs more than one, the
   verdict comes last.

4. **No explicit `BEGIN;` / `COMMIT;` / `ROLLBACK;`.**
   The console supplies its own transaction, and a nested `BEGIN` either warns or
   errors depending on the runner. Where a write needs to be all-or-nothing, put
   it inside a single `DO $$ ... $$` block: a `DO` block is one statement, so an
   exception raised anywhere inside it rolls back everything it did. That is the
   same guarantee, expressed in a way the console cannot break.

5. **Schema-qualify everything** — `public.`, `extensions.`. Never rely on
   `search_path`.

6. **Listings live in `*-detail.sql` companions.** The verdict file answers
   "do I proceed?"; the detail file answers "show me the rows". Separate files
   mean each is one paste, one grid, no hidden results.

CI enforces 1, 2, 4 and 5 mechanically, and **executes every file in this
directory in console mode** — see `scripts/ci/prod-verify-console-gate.sh`.

## Why this directory exists at all

Standing rule from the owner:

> Karl will not run any SQL against prod that did not come from you and is not
> committed in the repo. Every statement he executes — migrations, pre-apply
> verification, post-apply verification, purges, recompute drivers — must exist
> as a committed, reviewable `.sql` file with a path he can point at. No SQL is
> pasted from chat, ever.

## The pinned exact-target hash

`1.1-pre-apply.sql` and `1.1-post-apply.sql` each carry this literal:

```
55025a91663cc7a097deb089e9a327c2ba02de79efd8654106097c4d273ce9d9
```

It is a SHA-256, hex, over the comma-joined ordered `id` list of exactly the
repairable rows in production:

```
status IN ('answered','skipped') AND occurred_at IS NULL AND answered_at IS NOT NULL
```

**Provenance.** Advisor read-only verification against production project
`hncolwkccbbjkfithhlo`, 2026-08-16. 42 rows. Three independent runs returned the
same value and the same 42-row count, so the target set was stable at pin time.

It appears in two files because the two verifiers run at different times and each
must stand alone. They cannot drift: `scripts/ci/prod-verify-console-gate.sh`
asserts both literals are present, identical, and well-formed. That gate replaces
the `\ir` include that previously single-sourced the value — the include was a
`psql` feature and violated rule 1 above.

### A MISMATCH IS A STOP SIGNAL, NOT A STALE CONSTANT. DO NOT REGENERATE IT.

If `1.1-pre-apply.sql` reports a hash mismatch, the repairable set has **moved**
since this value was pinned. That is precisely what exact-target verification is
for, and precisely when it is doing its job.

The tempting "fix" — re-run the query, paste the new value in, proceed — destroys
the entire guarantee. It converts a proof about a known, audited set of 42
historical rows into a tautology that always passes.

A mismatch cannot be benign. The writer regression that produced NULL
`occurred_at` was fixed in `f0bc31e` (2026-08-08) and these 42 rows are
historical, so nothing in normal operation can add to or remove from this set. If
it changed, something wrote to `practice_session_items` in a way nobody expected.

**Correct response:** STOP. Run `1.1-pre-apply-detail.sql`, diff the printed row
list against the audited one, and find out what moved. Re-pin only after that
question is answered and the new set is deliberately re-audited.

## Run order

| # | File | Writes? | Expected verdict |
|---|---|---|---|
| 1 | `1.1-pre-apply.sql` | no | `OK — safe to apply 20260816000000` |
| 1a | `1.1-pre-apply-detail.sql` | no | record the 42-row list |
| 2 | *apply* `20260816000000_psi_occurred_at_backfill_and_seal.sql` | yes | — |
| 3 | `1.1-post-apply.sql` | no | `OK — 42 rows repaired, identity matches the pinned target, negative controls held, constraint enforcing` |
| 3a | `1.1-post-apply-detail.sql` | no | compare against the 1a list |
| 4 | `1.2-pre-apply.sql` | no | `OK — safe to apply 20260816010000` |
| 4a | `1.2-pre-apply-detail.sql` | no | `is_canonical` must be true on every row |
| 5 | *apply* `20260816010000_canonical_domain_checks.sql` | yes | — |
| 6 | `1.2-post-apply.sql` | no | `OK — 1.2 applied, both constraints exact AND validated` |
| 7 | `purge-seed-residue-preview.sql` | no | shows the 7 rows to be deleted |
| 8 | `purge-seed-residue.sql` | **DELETES** | `OK — residue purged` |
| 9 | `step8-preflight.sql` | no | `OK — ready to recompute` |
| 10 | `step8-recompute.sql` | **WRITES** | `OK — recompute complete` |
| 11 | `step8-verify.sql` | no | `OK — backfill rebuilt mastery end to end; 3f18cbe2 projects in both sections` |
| 11a | `step8-verify-detail.sql` | no | per-student rollup |

### Priority 0 — the live event path

The backfill proved the compute chain. `apply_mastery_event` has still never
completed in production, so the event path is unproven. This outranks everything
below.

| # | File | Writes? | Expected verdict |
|---|---|---|---|
| P0 | `live-event-verify.sql` | no | `OK — apply_mastery_event completed for a live answer; the event path works` |

Run it after answering one practice question through the app.

**Note:** once a live answer lands, `step8-verify.sql` will report STOP, because it
asserts the event-time tables are EMPTY — the correct acceptance signature for a
*pure backfill* and nothing else. That STOP is expected and is not a regression.
After the live path is exercised, `live-event-verify.sql` is the file to run.

### Migration-history reconciliation (separate track — HELD until Priority 0 clears)

`20260816000000` and `20260816010000` were applied by direct SQL execution, so the
migration runner has no record of them.

**Steps live in [`MIGRATION-HISTORY-REPAIR.md`](./MIGRATION-HISTORY-REPAIR.md).**
The decisions and rationale are in
[`MIGRATION-HISTORY-RECONCILIATION.md`](./MIGRATION-HISTORY-RECONCILIATION.md).

| # | Step | Writes? | Expected verdict |
|---|---|---|---|
| A | `migration-schema-parity.sql` — **runs FIRST, must pass** | no | `OK — prod schema matches both migrations; safe to record them as applied` |
| B | `migration-history-audit.sql` | no | `REPAIR` for both target versions |
| C | `supabase migration repair --status applied` ×2 (**CLI**, ruling Q9) | bookkeeping only | `Repaired migration history: [...] => applied` |
| D | `migration-history-audit.sql` again | no | `consistent` for both target versions |
| E | `supabase db push` — applies `20260816020000` **through the runner** | yes | — |
| F | `2.4-post-apply.sql` | no | `OK — gap detector deployed; views, ledger, function and grants all present` |

Order is load-bearing: parity before recording. Recording "these ran successfully"
before proving prod matches what they produce records a belief, not a fact — and a
version marked applied is skipped by the runner forever.

There is no `migration-history-repair.sql`. Ruling Q9 puts the repair in the CLI's
hands; hand-inserting into `supabase_migrations.schema_migrations` means guessing the
column shape the runner expects. CI fails if that file reappears.

### Gap-detector noise fix — `20260818000000`

On its first day in production the detector reported **84 gaps out of 91 answered
items**. All 84 are items the Step 8 backfill correctly rebuilt:
`backfill_recompute_student` replays history and writes no per-event
`mastery_event_audit_log` row, so "rebuilt by backfill" and "never derived" are
indistinguishable to an anti-join over that log. An alert that is 100% noise on
arrival gets muted, and a muted detector is the exact failure this workstream
exists to prevent.

| # | Step | Writes? | Expected verdict |
|---|---|---|---|
| 4.1a | `4.1-pre-apply.sql` | no | `PROCEED — the shape matches what the fix targets; apply 20260818000000` |
| 4.1b | *apply* `20260818000000_gap_detector_excludes_backfilled.sql` | yes | — |
| 4.1c | `4.1-post-apply.sql` | no | `OK — 20260818000000 applied; both branches exclude backfilled events` |

`4.1-pre-apply.sql` is the negative control for `4.1-post-apply.sql`: it records
the 84 BEFORE the change, so the 0 afterwards measures the fix rather than an
empty table. Run it first or the post-apply number proves nothing.

`4.1-post-apply.sql` asserts `open_gaps = 0` in its verdict. It also reports the
count separately so that a later non-zero reading is legible as what it is — a
genuinely un-emitted event, which is exactly what the detector is for.

**How it gets applied is an open question.** As a new migration it belongs in the
runner (`supabase db push`), but push acts on the WHOLE pending set, and the
migration-history reconciliation that would make that safe is parked. Until that
clears, applying `20260818000000` means executing its file body directly — which
is how the unrecorded-version problem was created in the first place. See owner
question 1 in the PR.

### Session lifecycle — steps 2, 1, 8 and 9 (four migrations)

Four migrations close the diagnostic-lifecycle defects. Order is load-bearing in
one place only, and it is the first row: **`resolve-duplicate-diagnostic.sql` must
have been RUN before `20260817000000` is applied.** Production holds a student with
a completed diagnostic and an in-flight one; the index builds happily over that and
then strands the in-flight session on its fortieth answer, which the student sees
as a 500. `3.1-pre-apply.sql` is the check that it was run.

The other three are independent of each other and of the reconciliation track.

| # | File | Writes? | Expected verdict |
|---|---|---|---|
| S0 | `resolve-duplicate-diagnostic-preview.sql` → `resolve-duplicate-diagnostic.sql` | **yes** | see the rows above; must be run before S1 |
| S1 | `3.1-pre-apply.sql` | no | `OK — safe to apply 20260817000000` |
| S2 | *apply* `20260817000000_diagnostic_once_only_index.sql` | yes | — |
| S3 | `3.1-post-apply.sql` | no | `OK — 20260817000000 applied; one completed diagnostic per student is enforced` |
| S4 | *apply* `20260817010000_student_diagnostic_state.sql` | yes | — |
| S5 | `3.2-post-apply.sql` | no | `OK — 20260817010000 applied; the derivation answers for the pinned student` |
| S5a | `3.2-post-apply-detail.sql` | no | record who is in which state |
| S6 | `3.3-pre-apply.sql` | no | `OK — safe to apply 20260817020000` |
| S6a | `3.3-pre-apply-detail.sql` | no | record where each `abandoned_at` comes from |
| S7 | *apply* `20260817020000_practice_session_abandoned_at.sql` | yes | — |
| S8 | `3.3-post-apply.sql` | no | `OK — 20260817020000 applied; abandoned rows repaired and sealed, completed sessions untouched` |
| S9 | *apply* `20260817030000_student_baseline_pending.sql` | yes | — |
| S10 | `3.4-post-apply.sql` | no | `OK — 20260817030000 applied; the staleness surface reads` |

`3.4-post-apply.sql` reports `stale_students` and deliberately keeps it out of the
verdict: a non-zero count is a finding about the data, not a failure of the
migration, and production is expected to show at least one until
`baseline-repair.sql` has run.

### Before every migration apply

[`docs/runbooks/migration-deploy.md`](../../docs/runbooks/migration-deploy.md) makes
`migration-history-audit.sql` a **required pre-flight step** (ruling Q11 — it needs
production credentials, so it cannot be scheduled in CI).

Any verdict beginning `STOP` means stop. The verdict text names the reason and,
where relevant, the file to read before doing anything else.
