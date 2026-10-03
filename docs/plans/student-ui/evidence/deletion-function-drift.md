# F-48: `execute_account_deletion_cascade` drift between production and the pipeline (read-only, 2026-10-02)

Register row: §8 **F-48** (the drift, its cause, its impact and the owner-run fix).
Production was read with `SELECT`s only: catalog, function bodies, and aggregate counts. No
identifiers were returned.

## 1. Every migration that defines the function, in file order

Body hashes are `md5` of the dollar-quoted body with CRs stripped, which is how `prosrc` is
compared below.

| Migration | Body chars | md5 (no CR) |
|---|---|---|
| `20260625010000_05d_account_deletion_cascade.sql` | 17,680 | `bef95a748b71625c82e64d7aff4e1816` |
| `20260626010000_05e_anonymize_disposition.sql` | 21,495 | `167f97a912af5dc28c914b1ba1f22f30` |
| `20260903010000_drop_notification_outbox.sql` | 21,518 | `92af1893d0bb26ee2c613417e2fe195d` |
| `20260917000000_deletion_evidence_bundle.sql` | 24,938 | `f618092663c690a15955d76868091eda` |
| `20260917130000_declarative_fk_delete_actions.sql` | 20,304 | `3097cc4b41ac778af06de489c795ef0e` |
| `20260930080000_exam_deletion_cascade.sql` | 25,463 | `23b52972c92dc6c2c302e59e4ab8445f` |
| `20260930090000_exam_shell_server.sql` | 25,942 | `6b70e8c6a4e3535b2a65a4e4cac898c8` |
| `20260930100000_exam_child_tables.sql` | 25,018 | `e6eb9141c34e59c02472ba7a2f268e13` ← **production** |
| `20261005000000_actor_id_integrity_sentinel.sql` | 27,986 | `2297410e34957bcb6c3ec5432fdc8f7a` |
| `20261008000000_deletion_cascade_restore_exam_table_walk.sql` | 26,877 | `64f73da341bfe2deb44ecf95a8780933` ← **pipeline (last definer)** |

## 2. Both bodies, computed the same way

```
production  md5(replace(prosrc, chr(13), '')) = e6eb9141c34e59c02472ba7a2f268e13
            md5(prosrc)                       = a2be7426cd76c1114f99fdc118ceb5fa
            length(prosrc) = 25,481  (25,018 characters + 463 CRs; has_cr = true)
pipeline    md5(replace(prosrc, chr(13), '')) = 64f73da341bfe2deb44ecf95a8780933   (26,877 characters, no CRs)
```

The "25,481 vs 26,877" figure compared a CR-bearing length with a CR-free one. Normalised, the
bodies are 25,018 and 26,877 characters.

## 3. The difference, and what it does

`diff` of the `20260930100000` body against the `20261008000000` body shows **one hunk**: the
anonymize-mode INV-05E-07 sentinel, which runs before identity is severed.

| | Production (E9 sentinel) | Pipeline (SCL-151 sentinel) |
|---|---|---|
| Tables checked | 7 listed + `exam_child_tables.student_column` rows (2) | every public table with `actor_id` and `user_id`/`student_id`, from the catalog |
| Refuses when | `actor_id IS NULL` | `actor_id IS NULL OR actor_id <> <this profile's actor_id>` |
| Floor | none | raises if fewer than 7 tables are discovered |

In production both sets are the same 9 tables (`mastery_domain_refresh_audit_log`,
`mastery_event_audit_log`, `practice_session_items`, `practice_sessions`, `review_error_attempts`,
`review_session_items`, `review_sessions`, `score_runs`, `test_sessions`).

**Data left behind:** none. Every DELETE and UPDATE, the order of operations and the
`exam_child_tables` walk are identical. No table or column is deleted or anonymized by the
pipeline's version and not by production's.

**What the weaker guard allows:** production would anonymize a profile whose retained rows carry a
WRONG actor_id. That case exists in production today. `actor_id_integrity_violations()` returns
6 rows:

| Table | Kind | Rows |
|---|---|---|
| `practice_sessions` | actor_id equals the row's own `user_id`; is a `profiles.id`; matches no actor | 1 |
| `practice_session_items` | the same three kinds | 40 |

They are one `diagnostic` session (status `active`) and its 40 items, created 2026-09-26, for a
live, non-test student with no pending deletion request. Every other session created since
2026-09-24 carries the correct actor_id, including the two diagnostics of 2026-09-27, so the
writer is fixed.
This row was written in the gap between `20261006000000` (the data correction, 2026-09-25) and
the writer fix reaching production.

If that student were deleted now, production's cascade would retain the 41 rows with
`user_id = NULL` and `actor_id =` the deleted profile's own id: a grouping key equal to the identity
key it exists to replace. The pipeline's cascade would refuse (fail closed), and the request would
stay `pending` and be retried nightly until the rows were repaired.

## 4. How production diverged

**Out-of-order application.** No migration was skipped by file order, and none was partially applied.

- `20261005000000` is applied. Production's `actor_id_integrity_violations()` matches its body
  exactly (`356f32052c17bf54e7f1951cd586d883`, 3,645 characters), and that migration is its only
  definer. The owner reported it applied on 2026-09-25 (recorded in `20261008000000`'s header).
- `20260930100000` is applied. `public.exam_child_tables` exists with its 9 rows, and the live
  cascade body walks it.
- The live cascade body is `20260930100000`'s, not `20261005000000`'s. In file order the later
  file wins, so `20260930100000` must have been applied **after** `20261005000000` and overwrote
  the SCL-151 sentinel.
- `20261008000000` exists to repair exactly this overwrite (its header: "a later-sorting
  migration overwrote"). Its body is not live, so it was either never applied or applied before
  `20260930100000`. `supabase_migrations.schema_migrations` has 0 rows at or after
  `20260930000000` (it stopped recording in June), so it cannot distinguish the two. Either way,
  applying it now is the fix.

So "no unapplied migrations" can be true of every file and still leave this state: what
production runs depends on the order the files were applied, not on whether they were.

## 5. The owner-run fix (not applied)

1. `supabase/migrations/20261006000000_actor_id_data_correction.sql`, as-is.
   - It is idempotent.
   - Part A repairs live rows (`user_id IS NOT NULL AND actor_id = user_id`) from `profiles`,
     which covers the 41.
   - Part B deletes only identity-less orphans with no known actor; there are none now.
   - It raises and refuses to commit if any violation remains.
2. `supabase/migrations/20261008000000_deletion_cascade_restore_exam_table_walk.sql`, as-is.
   It is `CREATE OR REPLACE` plus grants only, and idempotent.
3. Verify:
   ```sql
   SELECT count(*) FROM public.actor_id_integrity_violations();   -- expect 0
   SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
    WHERE oid = 'public.execute_account_deletion_cascade(uuid,text)'::regprocedure;
   -- expect 64f73da341bfe2deb44ecf95a8780933
   ```

Order matters: (1) before (2), or a deletion for that student is refused until the rows are fixed.
