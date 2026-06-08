# Legacy migrations & external SQL — pre-baseline archive

**These files are historical artifacts. None of them is canonical.** They are
retained as **provenance evidence**, not as a runnable pipeline.

The single source of truth for the deployed schema, from WS-1 forward, is
`supabase/migrations/` — the genesis baseline `00000000000000_baseline.sql` (D3,
owner-generated from production) plus numbered forward migrations. Nothing in this
folder is applied by any tool; it exists only so the *intent history* survives.

## Why retained, not deleted (ruling 2)

The platform's core provenance defect (GAP-OP-05) was exactly intent-vs-reality
drift: schema was built through an entangled mix of never-tracked migrations and
hand-run SQL, with **0 migrations recorded applied** in production (capture H1).
These files are the only written record of that intent. Deleting them would
destroy the evidence of how the deployed state came to be. They are archived
out of the apply path instead — see `docs/SpecAudit/20-ws1-provenance/WS-1-CONTRACT.md`
§4 (external-SQL inventory) and ruling 2.

## Contents

| Subfolder | Count | Origin | Status |
|---|---|---|---|
| `supabase-migrations-preBaseline/` | 61 | the former `supabase/migrations/` pipeline | never recorded as applied (capture H1: `0 applied migrations recorded`); effects that reached prod are reproduced by baseline `0000` |
| `database/` | 25 `.sql` | externally hand-run SQL (`database/{migrations,policies,seeds}/` + root) | per WS-1 §4: every object either already in prod (effect baselined) or dead; archiving loses nothing |
| `scripts/apply_migrations.ts` | 1 | a **competing** applier (read `database/migrations` + `database/seeds`; own `_migrations` table) | its `_migrations` tracking table is **absent** from prod → never run against production; unwired in `package.json`/CI |

`database/*.md` status docs were left in place (out of the `*.sql` archival scope;
candidate for the GAP-HY-11 sprawl sweep).

## Known test couplings caused by this archival (atomic-archival, by design)

Two CI contract tests read specific migration files by path; moving those files
makes those reads fail. Per the WS-1 plan this archival is kept **atomic** — the
files are not retained to satisfy the tests, and the tests are not rewritten here:

1. **`tests/ci/tutor-interactions.no-verbatim.contract.test.ts`** read
   `20260606_tutor_interactions_drop_verbatim.sql` (the never-applied column-ALTER).
   **Closed by D4**, which adds the folded-drops migration (full-table
   `DROP TABLE tutor_interactions`) and rewrites the test's assertion #3 to target
   it — a strictly stronger guarantee.
2. **`tests/ci/rate-limit-sql.contract.test.ts`** read
   `20260408_rate_limit_ledger_truth.sql` and asserts its content
   (`usage_rate_limit_ledger`, `check_and_reserve_*`, `finalize_tutor_usage`,
   window/concurrency guards). Those objects **exist in production** (capture B1),
   so they are reproduced by baseline `0000`. **No closer is scheduled yet** — this
   test must be re-pointed at the canonical source (baseline `0000`, once D3 lands)
   rather than the archived legacy file. Logged in the gap registry; flagged for the
   owner to assign a closing wave.

## Cosmetic stale references (not touched here — atomic archival)

`apps/api/src/lib/supabase.ts` prints `database/supabase-vector-setup.sql` in
`console.warn` developer hints (no file read; runtime unaffected). Path is now
stale; clean up in a later hygiene pass.
