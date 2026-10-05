# Quota migrations: additivity check (before #1073 merges)

Owner ruling (Karl, standing; restated 2026-10-05): "quota migration 20261023000000 checked for additivity and applied by Karl right before #1073 merges if it isn't". #1073 now carries two migrations that replace `public.check_and_reserve_practice_quota`; both are checked here. Production deployment state is **unverified from here** (this session never reads production; the `schema_migrations` ledger is not evidence, see CLAUDE.md).

| Migration | Purpose | Top-level statements | Signature / return / security / ACL vs previous body | Schema or data change | Body md5 (CR-normalised `prosrc`) |
|---|---|---|---|---|---|
| `20260630000000_practice_quota_rpc.sql` §4 | the body before #1073 (served questions, UTC midnight) | — | — | — | `981f5c39b321f58e807c05bd1f54111b` |
| `20261023000000_practice_quota_chicago_submitted.sql` | OQ-43 / F-61: submitted answers, America/Chicago midnight | `BEGIN`, `CREATE OR REPLACE FUNCTION`, `REVOKE`, `GRANT`, `COMMIT` | identical: `(uuid, uuid, uuid, uuid, boolean, text, timestamptz) RETURNS jsonb`, `SECURITY DEFINER`, `search_path = public`, `REVOKE … FROM PUBLIC` / `GRANT … TO service_role` | none (the one `INSERT` is the function's runtime serve-log write, unchanged from the previous body) | `4ad626ac5b280c8ba2944c4b7ade7808` |
| `20261024000000_practice_quota_skips_count_diagnostic_exempt.sql` | OQ-50 (SCL-209): skips count, diagnostic exempt, window on `occurred_at` | same five | identical to the above | none (same runtime `INSERT`, line 259) | `3280430166fd61987c6a77ed91f2ac88` |

**Additive:** yes, both. Each is a same-signature `CREATE OR REPLACE` (so no overload is left behind), restating the existing ACL. No table, column, constraint, index or row is created, altered or written by either migration. Both read `practice_runtime_config.quota_reset_timezone`, seeded as `"America/Chicago"` by `20260610000000_ws2_config_constants.sql:83`, and fail closed if it is missing. The last migration defining the function is `20261024000000` (`grep -ln 'FUNCTION public\.check_and_reserve_practice_quota' supabase/migrations/*.sql | sort | tail -1`). The genesis fresh-apply gate passes with both applied in order (expected schema regenerated in `c798628c`).

**Rollback:** `20261024000000` → re-run `20261023000000`; `20261023000000` → re-run §4–§5 of `20260630000000`.

## For Karl: is it live? (owner-run, against the database being asked about)

```sql
select md5(replace(p.prosrc, E'\r', '')) as body_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'check_and_reserve_practice_quota';
```

- `981f5c39…` → neither migration is applied: apply `20261023000000`, then `20261024000000`.
- `4ad626ac…` → `20261023000000` is live: apply `20261024000000`.
- `32804301…` → both are live.
- exactly one row is expected; more than one means an overload exists and needs a look before applying anything.

Apply right before #1073 merges (the client and server in #1073 expect the `20261024000000` rules: skips count, diagnostic exempt).
