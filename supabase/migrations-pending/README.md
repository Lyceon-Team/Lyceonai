# `supabase/migrations-pending/` — written, reviewed, not-yet-applied migrations

Migrations here are **complete and reviewed** but **intentionally not in the active
`supabase/migrations/` pipeline yet** — they are applied **owner-run when convenient**.

## Why a separate directory

The CI migration gates all scope to `supabase/migrations/`:

- `scripts/ci/genesis-fresh-apply.sh` and the 05b / 05c / lane-c / guardian-mirror gates glob the
  **non-recursive** `supabase/migrations/*.sql`.
- `scripts/ci/no-hardcoded-constants.mjs` walks the `supabase/migrations` root.

`supabase/migrations-pending/` is a **sibling** directory — matched by none of them. Staging a
migration here keeps the fresh-apply gate green and the committed
`scripts/ci/genesis-schema.expected.sql` snapshot un-drifted until the migration is deliberately
activated.

## Activating a pending migration (owner)

1. `git mv supabase/migrations-pending/<file>.sql supabase/migrations/`
2. Regenerate `scripts/ci/genesis-schema.expected.sql` from the fresh-apply harness (the established
   genesis-extending step — same as 05B/05C did when they landed).
3. Apply to the Supabase project.

Each pending migration ships a reversible DOWN block, so activation is fully reversible.

## Contents

| File | Purpose | Contract |
|---|---|---|
| `20260617000000_notification_outbox.sql` | Notification emission foundation — `notification_outbox` table (CHECK enums + FK + insert-once + service-role RLS). No dispatcher/delivery. | `contracts/notification-outbox.contract.md` |
