# Three version strings are claimed by two files each

**Status: RESOLVED on this branch, 2026-08-18. Owner ruling approved the proposal
below and it has been executed with `git mv`.**

> The renames must land on `main`, `cleanup`, `questions` and `lisa` **together**,
> and **before any `repair`**. This branch carries them for `cleanup`; sibling
> branches carry them for `questions` and `lisa`; `main` receives them through
> Karl's merges of those three. Until all four agree, the collision returns at the
> next merge.

## The six files

Present on every branch — `main`, `cleanup`, `questions`, `lisa` — so this is
already merged, not a branch artefact.

| Version | File A (practice / diagnostic lane) | File B (LISA lane) |
|---|---|---|
| `20260806000000` | `_diagnostic_gate.sql` | `_tutor_dedicated_roles.sql` |
| `20260807000000` | `_diagnostic_pool_plain_invoker.sql` | `_ws_l2_context_config_keys.sql` |
| `20260812000000` | `_snapshot_kind_baseline.sql` | `_tutor_messages_idempotency_role.sql` |

Karl's earlier listing showed only two pairs; `20260812000000` appeared in the
later one. **The set is stable at three** — verified by filename prefix across all
four branches, which is the only thing that determines a collision.

## Why it blocks

`supabase_migrations.schema_migrations.version` is the **primary key**. At most
one row can ever exist per version string. So:

- `supabase migration repair --status applied 20260806000000` writes **one** row.
  That row does not say which of the two files ran. Both files then read as
  recorded, and the runner will never apply either again — including the one that
  may never have run.
- `supabase db push` derives the version from the filename prefix. Two files, one
  version: which one it applies, in what order, and what it records afterwards
  are all unspecified. Do not find out on prod.

## Neither file in any pair is "the wrong one"

This is the important part, and it is why the fix is not deletion. Every one of
the six is a real migration declaring real objects, and
`migration-inventory-classify.sql` finds a distinct discriminator for each:

| File | Discriminator | Independent of its pair? |
|---|---|---|
| `_diagnostic_gate` | `select_diagnostic_pool`, `practice_session_mode_to_event_kind` | yes |
| `_tutor_dedicated_roles` | five `tutor_*` roles + `tutor_conversations_runtime_insert` policy | yes |
| `_diagnostic_pool_plain_invoker` | `select_diagnostic_pool` is SECURITY INVOKER | yes |
| `_ws_l2_context_config_keys` | five `tutor_context_runtime_config` keys | yes |
| `_snapshot_kind_baseline` | `snapshot_kind` column + `idx_baseline_once_per_student_section` | yes |
| `_tutor_messages_idempotency_role` | the idempotency index includes `role` | yes |

Two independent workstreams each picked the day's round timestamp. That is the
whole cause. There is no duplicate work and nothing to discard.

## Resolution — renumber the LISA-lane file in each pair (EXECUTED)

```
20260806000000_tutor_dedicated_roles.sql            ->  20260806010000_tutor_dedicated_roles.sql
20260807000000_ws_l2_context_config_keys.sql        ->  20260807010000_ws_l2_context_config_keys.sql
20260812000000_tutor_messages_idempotency_role.sql  ->  20260812010000_tutor_messages_idempotency_role.sql
```

**Why the LISA file and not the other one.** A uniform rule beats three
case-by-case judgements. The practice/diagnostic files carry the ordering
relations that matter — `_diagnostic_pool_plain_invoker` must follow
`_diagnostic_gate`, and both are referenced by number from
`migration-schema-parity.sql` and from `packages/shared/src/session-mode.ts`.
Keeping their numbers stable keeps those references true. The LISA files have one
ordering relation between them (`_tutor_messages_idempotency_role` must follow
`20260806020000_tutor_schema_proof_fixes`, which drops the index it re-creates),
and the proposed slots preserve it.

**Why these specific slots.** Each is the next free 10-minute slot on the same
day, ahead of the next existing version. Lexicographic apply order is therefore
unchanged for every file: `20260806000000` → `20260806010000` → `20260806020000`
→ `20260807000000` → `20260807010000`, and `20260812000000` → `20260812010000` →
`20260813000000`.

## Hazards of renaming a migration that is already applied to prod

Stated in full, because three of these six are live on prod.

1. **The rename does not touch prod.** A migration file is not re-executed by
   being renamed. The schema is unaffected. Every hazard below is bookkeeping.
2. **Rename BEFORE any repair — this is the ordering that matters.** If a version
   is recorded under the old name and the file is then renamed, the runner sees
   the new version as pending and tries to apply it, hitting duplicate objects on
   a live schema. Today none of the six is recorded, so the hazard is theoretical
   — and it stops being theoretical the moment anyone repairs one of them.
3. **A previously-recorded old version becomes an orphan row.** It matches no
   file, so `migration list` shows it Remote-without-Local and no tool will ever
   reconcile it. Same mitigation: rename first.
4. **Silent reference breakage.** Four places in the repo name one of these files
   in prose: `packages/shared/src/session-mode.ts`, `scripts/tutor-schema-proof.ts`,
   `docs/SpecAudit/SPEC_CHANGES_LOG.md`, and
   `scripts/prod-verify/migration-inventory-classify.sql`. Only the last two name
   a file being renamed. They are comments, so nothing fails at build time —
   which is why they need a grep, not a compiler.
5. **The rename must land on every branch carrying the file** — `main`,
   `cleanup`, `questions`, `lisa`. A rename on one branch and not another
   re-creates the collision at the next merge, and a merge that sees a rename on
   one side and the original on the other can resolve to both files existing.
6. **`git mv`, not delete-and-create**, so history follows the file and the next
   reader can see it was renamed rather than rewritten.

## What was done, and what was not

**Done on this branch:** the three `git mv`s above, plus the three prose
references. `scripts/tutor-schema-proof.ts` and
`scripts/prod-verify/migration-inventory-classify.sql` were updated to the new
name because they point at the file as it is today.
`docs/SpecAudit/SPEC_CHANGES_LOG.md` was **annotated, not rewritten** — it is a
dated record of what a PR did at the time, and editing the record to match a
later rename would falsify it. The annotation names the new filename and points
here. `packages/shared/src/session-mode.ts` cites
`20260806000000_diagnostic_gate.sql`, which was not renamed; it is correct as it
stands.

**Not done:** anything on `main`. Karl owns those merges.

---

# 4. A fourth pair — `20260901000000`, caught before merge (2026-09-02)

**Status: RESOLVED before either file merged to `cleanup`. Renumbered by `git mv`
under the same rule as §1–§3.**

| Version | File A (guardian-link lane) | File B (mastery/KPI lane) |
|---|---|---|
| `20260901000000` | `_scl_080_guardian_link_code.sql` | `_kpi_quarantine_excluded_count.sql` |

Same cause as the first three: two workstreams each took the day's round
timestamp. Two independent migrations, no duplicate work, nothing to discard.

## Which one was renumbered, and why it was not a judgement call

`_scl_080_guardian_link_code` is **already applied to production** — its
`create_active_guardian_link_audited` is live, and it dropped
`create_guardian_link_audited` / `accept_guardian_link_audited` from
`20260828000000`. Renumbering an applied migration would change the version
string of work already in the database, which is the one thing a renumber must
never do. `_kpi_quarantine_excluded_count` is unapplied and unmerged, so it is
the one that moves:

```
20260901000000_kpi_quarantine_excluded_count.sql  ->  20260901010000_kpi_quarantine_excluded_count.sql
```

`+010000` on the same day, matching §1–§3 rather than moving the file to a date
it was not authored on.

## Why it was worth doing while the ledger is still hand-maintained

`supabase_migrations.schema_migrations` currently holds 16 rows with a maximum
version of `20260624020000`, so nothing in the runner would have noticed today —
Karl applies by hand through the console. That is exactly why it was worth
fixing now rather than later: the reconciliation in
`MIGRATION-HISTORY-RECONCILIATION.md` is parked so it can be done, and it keys on
`version`, which is the table's primary key. A reconciliation that writes one row
for `20260901000000` would mark **both** files recorded, and the runner would
never apply the one that had not run. The window in which this is a one-line
`git mv` closes the moment that reconciliation happens.

It is also an ambiguity in the instruction itself: with two files under one
version, "apply `20260901000000`" does not name a migration, and the operator
pre/post pair for the KPI file cites the version in its header.

## References updated with the rename

`scripts/ci/05b-kpi-quarantine-gate.mutations.sh` (which patches the migration by
path and fails STALE if it cannot find it), and the header of each half of the
operator pair, `scripts/prod-verify/kpi-quarantine-pre.sql` /
`kpi-quarantine-post.sql`. `docs/SpecAudit/SPEC_CHANGES_LOG.md` SCL-054 names the
new filename and records the renumber inline — the §1–§3 rule against rewriting a
dated record does not bite here, because that entry is still PROPOSED and the
migration has never existed under the old name in any merged tree.

`scripts/ci/genesis-schema.expected.sql` is unaffected and was re-generated to
prove it: the snapshot is `pg_dump --schema=public`, which carries no migration
filenames, so a renumber cannot move it. Byte-identical output is the evidence.
