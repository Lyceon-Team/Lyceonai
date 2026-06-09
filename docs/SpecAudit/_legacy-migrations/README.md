# Legacy migrations — retained as provenance, NONE canonical

These are the pre-genesis `supabase/migrations/*.sql` files (61), archived out of the
apply path by the **WS-1 genesis re-cut** (Phase 2). They are kept as historical
evidence of intent on a platform whose core defect was intent-vs-reality drift —
**deleting them would destroy that provenance**. None is canonical.

## Why they are not in the pipeline

Under the teardown + genesis-from-spec rebuild
([`../30-genesis-recut/RECUT-CONTRACT.md`](../30-genesis-recut/RECUT-CONTRACT.md)),
the single source of truth for the schema is **`docs/Spec/`**, rendered into
`supabase/migrations/00000000000000_genesis.sql` (built from spec, NOT captured
from deployed prod). These legacy files described the *deployed* schema's
incremental history, which the teardown discards. They never reach a database
again.

## Pipeline state after Phase 2

`supabase/migrations/` contains exactly one file — the genesis foundation
(`00000000000000_genesis.sql`). Later waves (Doc 02B runtime, Doc 05 mastery,
Doc 04 scoring, …) append new `YYYYMMDDHHMMSS_*.sql` migrations through this one
pipeline. The fresh-apply gate (`scripts/ci/genesis-fresh-apply.sh`) proves the
pipeline applies from scratch and matches `scripts/ci/genesis-schema.expected.sql`.

## Contents

`supabase-migrations-preBaseline/` — the 61 archived `*.sql` files, names unchanged.
