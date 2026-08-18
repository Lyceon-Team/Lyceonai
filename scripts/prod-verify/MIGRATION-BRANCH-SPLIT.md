# No single branch holds all the migrations

**Status: RESOLVED on this branch, 2026-08-18. Owner ruling: land the two
LISA-only migration FILES on `cleanup`, one reconciliation pass.**

> Two passes would mean the CLI's notion of "pending" differs by branch, so each
> pass reconciles a different universe and neither ever sees the whole set — the
> same partial-view failure that produced this situation. The migration files
> only were moved, not the LISA workstream code. Presence on `cleanup` does not
> apply them; it completes the universe we reconcile from.

Karl ran `supabase migration list` from `C:\Users\14438\projects\Lyceonai` and the
local list stopped at `20260815000000`. That is not a missing pull — it is the
branch he has checked out.

## What is where

Measured with `git ls-tree -r --name-only <branch> supabase/migrations/`, not
inferred:

| Branch | Migration files | Ends at |
|---|---|---|
| `main` | 43 | `20260813000000_crisis_review_queue` |
| `questions` | 43 | identical set to `main` |
| `lisa` | 45 | `20260815000000_memory_summary_notify_function` |
| `cleanup` | 50 | `20260817030000_student_baseline_pending` |

Only `lisa` ends at `20260815000000`, so that is the checkout Karl listed from.

**`cleanup` = `main` + the seven.** All seven of `20260816000000`,
`20260816010000`, `20260816020000`, `20260817000000`, `20260817010000`,
`20260817020000`, `20260817030000` are already merged to `cleanup`. Nothing needs
to be merged to get them; they need to be *checked out*.

**`lisa` carries two files no other branch has:**

```
20260814000000_crisis_audit_log_nullable_case_id.sql
20260815000000_memory_summary_notify_function.sql
```

`cleanup` does not have them. `main` does not have them.

## The consequence, stated plainly

**No branch in this repository contains every migration that prod needs.**

- Run the CLI from `cleanup` → the runner cannot see `20260814000000` or
  `20260815000000`. A `repair` for either is impossible and a `push` will never
  apply them.
- Run the CLI from `lisa` → the runner cannot see any of the seven. Same problem,
  other end.

Whichever branch the CLI runs from silently defines the universe it is
reconciling. That is exactly the failure mode this whole workstream exists to
stop, one level up: a tool reporting confidently on a set it cannot see all of.

## What Karl must do before any CLI operation

1. `git fetch origin`
2. `git checkout cleanup && git pull origin cleanup` — this gets the seven. All
   of them are already merged; there is nothing to merge.
3. Nothing further. `20260814000000_crisis_audit_log_nullable_case_id.sql` and
   `20260815000000_memory_summary_notify_function.sql` now live on `cleanup` as
   well, so one tree sees every unrecorded version. They remain byte-identical to
   the `lisa` copies — `git show origin/lisa:<path>` was the source.

The reconciliation universe is now **37 migration files, 37 distinct versions**
(the three collisions having been renumbered), all visible from `cleanup`.

## What this means for the gate

`scripts/ci/migration-inventory-gate.sh` builds its "everything applied" database
from the working tree. Before the ruling that tree was missing the two LISA files,
so the gate asserted they read `NOT-APPLIED` — and a sample verdict rendered from
that build showed them as `NOT-APPLIED → PUSH`. **That row described the local
build, never prod.** With the files landed, the same build applies them and they
classify like any other row.

The gate proves the probe discriminates. It does not know what prod has — that is
the advisor's read-only check, one probe per row.
