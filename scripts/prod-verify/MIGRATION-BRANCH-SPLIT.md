# No single branch holds all the migrations

**Status: blocking. Read before running any Supabase CLI command.**

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
3. **Decide the destination of `20260814000000` and `20260815000000`.** They are
   LISA-lane migrations and `lisa` is their correct integration branch under the
   branch-targeting rule, but the CLI can only reconcile from one tree. Two
   options, and this is Karl's call, not mine:
   - reconcile in two passes, once from `cleanup` and once from `lisa`, each pass
     touching only the versions its tree can see; or
   - land the two LISA files on `cleanup` first so one pass covers everything.

   Option (a) keeps branch discipline and needs care that neither pass runs
   `db push`, which acts on the whole pending set and not on the versions you had
   in mind. Option (b) is one pass but moves two LISA files into the cleanup lane.

**Until that is decided, `supabase db push` is unsafe from either branch** — from
`cleanup` it would push the seven and skip the two; from `lisa` the reverse.

## What this means for the gate

`scripts/ci/migration-inventory-gate.sh` builds its "everything applied" database
from the working tree, so on `cleanup` those two files are not applied and the
classifier correctly reports them `NOT-APPLIED`. The gate asserts exactly that
rather than pretending otherwise. Their real status on prod is still an open
question the advisor must answer read-only — the gate proves the probe
discriminates, it does not know what prod has.
