# Deletion cascade rehearsal: `review_session_items` FK failure (read-only investigation, 2026-10-01)

Register row: §8 **F-47** (fixed 2026-10-01, §5). The investigation itself changed no code. Production was read with `SELECT`s only (catalog,
function bodies, counts and dates; no names or addresses), at the owner's request in the
investigation brief.

## 1. The failure, reproduced

On `cleanup` @ `8da1bbe5` (untouched), `bash scripts/ci/deletion-cascade-rehearsal.sh` exits 3:

```
ERROR:  insert or update on table "review_session_items" violates foreign key constraint "review_session_items_queue_entry_id_fkey"
DETAIL:  Key (queue_entry_id)=(0b000001-0000-4000-8000-000000000003) is not present in table "review_schedule".
CONTEXT:  SQL statement "DELETE FROM public.profiles WHERE id = p_profile_id"
PL/pgSQL function execute_account_deletion_cascade(uuid,text) line 481 at SQL statement
SQL statement "SELECT public.execute_account_deletion_cascade(v_anon, 'anonymize')"
```

It fails in section (J), the anonymize-mode run, at the profile delete.

The constraints involved (`pg_get_constraintdef`, on the rehearsal database):

| Constraint | Referencing → referenced | Definition |
|---|---|---|
| `review_session_items_queue_entry_id_fkey` | `review_session_items` → `review_schedule` | `FOREIGN KEY (queue_entry_id) REFERENCES review_schedule(id) ON DELETE SET NULL` |
| `review_session_items_student_id_fkey` | `review_session_items` → `profiles` | `FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE SET NULL` |
| `review_schedule_student_id_fkey` | `review_schedule` → `profiles` | `FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE` |
| `review_session_items_session_id_fkey` | `review_session_items` → `review_sessions` | `FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE` |
| `review_sessions_student_id_fkey` | `review_sessions` → `profiles` | `FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE SET NULL` |

## 2. Mechanism

One `DELETE FROM profiles` fires two referential actions that both reach the same
`review_session_items` row:

1. `review_schedule` rows are cascade-deleted (`student_id … ON DELETE CASCADE`), which queues
   `queue_entry_id → NULL` on the item.
2. The item's own `student_id` is set to NULL (`… ON DELETE SET NULL`).

When (2) updates the row while its `queue_entry_id` still names the now-deleted schedule row,
PostgreSQL re-checks that unchanged FK only if the row version was written **by the current
transaction**. If the version was written by an earlier transaction, the unchanged-key check is
skipped. This is the "row inserted by our own transaction" exception in
`RI_FKey_fk_upd_check_required`. Then (1)'s queued `SET NULL` lands, and the row is consistent.

The rehearsal seeds its fixture rows and runs the cascade in **one DO block**, so the item was
written by the deleting transaction, the check runs, and it fails. Production never deletes a
row in the transaction that created it.

### Proof (local Postgres 16, every migration applied)

The same seed was used both times: one student, one practice-sourced `review_schedule` entry,
one `review_sessions` row and one `review_session_items` row with `queue_entry_id` pointing at
the entry, and a due `pending` deletion request. The production RPC,
`complete_and_anonymize_account(request, profile)`, was then run.

| Shape | Result |
|---|---|
| **A**: seed committed in transaction 1, RPC in transaction 2 (production's shape) | `completed`. Profile gone, schedule entry gone, item retained with `queue_entry_id` NULL |
| **A′**: as A, plus a `review_error_attempts` row on the item | `completed`. The attempt is retained |
| **B**: seed and RPC in one transaction (the rehearsal's shape) | The exact error above |

## 3. Production (read-only)

- **Same constraints, same delete actions.** The query above, run on production, returns
  identical rows for all eight review FKs.
- **`complete_and_anonymize_account`: body identical.** Production and the local migration
  pipeline give `md5 7c86cf6d5b86e243b3b414aa50525f7e`.
- **`execute_account_deletion_cascade`: an older body in production** (25,481 characters against
  26,877 locally). On the review tables it behaves the same:
  - the anonymize branch writes `review_error_attempts` (`client_attempt_id = NULL`) and
    `review_sessions` (`client_instance_id = NULL`);
  - it touches `review_session_items` only in the read-only actor-id sentinel `SELECT`;
  - it contains no `UPDATE public.review_session_items`;
  - the hard-delete branch deletes the items outright.
- **Triggers on the four review tables:** production has only `trg_review_item_resolve`
  (`AFTER UPDATE … WHEN status moves to answered/skipped`), the same as locally. The delete path
  never fires it.

**So the production execute path does not hit this error.** The review rows a deleting student
has were written by earlier transactions, so the unchanged-key re-check is skipped and the
deletion completes. If it ever did fail, nothing partial would be left:
`complete_and_anonymize_account` is one transaction. It rolls back, the request reverts to
`pending` (`server/lib/account-deletion-execute.ts:790-798`), and it is retried at the next 02:00
UTC run (`vercel.json` cron `0 2 * * *`). In other words it would be retried, and fail, nightly,
until fixed.

### The one pending request in production

| Field | Value |
|---|---|
| request | `ff69a937-3a6c-4801-bc24-78ca1634882a` |
| whose | the Brief 9 F-32 test account (`lyceon-qa-student-ui-f32-…@example.com`, register UI-63) |
| requested | 2026-10-01 04:18:48 UTC |
| grace ends (`scheduled_hard_delete_at`) | **2026-10-08 04:18:48 UTC** |
| first executor run that can take it | 2026-10-09 02:00 UTC |
| review rows | `review_schedule` 0, `review_sessions` 0, `review_session_items` 0 |

Not imminent, and it has no review rows, so it cannot reach this constraint at all.

## 4. What is actually wrong

1. **The rehearsal has been red since 2026-09-22.** `git bisect` (rehearsal as the test) names
   the merge `cd34a9f0` ("Merge branch 'main' into cleanup", 2026-09-22) as the first bad commit.
   Both of its parents pass:
   - `5bc19e9d` (`main` side) had the review queue and its `queue_entry_id` FK, but not the
     declarative FK actions.
   - `5fee3e9a` (`cleanup` side) had the declarative FK actions
     (`20260917130000_declarative_fk_delete_actions.sql`: `student_id … ON DELETE SET NULL`, the
     explicit null-out removed), but not the review queue.

   The merge combined the two actions on one row, and the rehearsal's single-transaction fixture
   made it fail. The rehearsal was passing at the review-queue commit itself (`63c5da71`).
2. **The rehearsal's positive run is not a CI step.** No `ci.yml` step runs
   `deletion-cascade-rehearsal.sh`, so nothing reported it.
3. **Gate G15 is a dead plant.** `scripts/ci/review-queue-gates.self-test.sh:340-349` plants
   `queue_entry_id … ON DELETE RESTRICT` and asserts that the rehearsal then fails ("RESTRICT
   makes the deletion rehearsal fail, as designed"). The rehearsal fails without the plant too,
   so G15 reads RED for the wrong reason and proves nothing about RESTRICT. This is the failure
   mode CLAUDE.md names: "A plant that fails to fail is a finding; a plant that never applied is
   nothing at all".

## 5. Ruling and fix (2026-10-01)

Owner ruling: fix all three. Done on branch `claude/rehearsal-integrity`:
- **Committed seed.** `scripts/ci/deletion-cascade-rehearsal.seed.sql` writes every fixture
  row and commits in its own `psql` call; `deletion-cascade-rehearsal.sql` then runs the
  cascade and the assertions. The positive run passes on `cleanup` (sections A–J). Running
  both files in one transaction (`psql -1`) still reproduces the §1 error, which is the
  failing observation for the new CI step.
- **Blocking CI step.** `ci.yml` job `deletion-deidentify-rehearsal` runs
  `deletion-cascade-rehearsal.sh`.
- **G15 by name.** It requires SQLSTATE `23503` on `review_session_items_queue_entry_id_fkey`
  from a delete on `review_schedule`, with three controls in the harness (unplanted; a
  `P0001`; `23503` on `review_sessions_student_id_fkey`). Removing the plant, or planting a
  different error, each turns G15 red.
