# Teardown Runbook — Genesis Re-Cut (OWNER-RUN)

> **This is an owner-run runbook. Agents never hold `service_role`/`postgres`
> credentials and never execute teardown.** Claude Code authors and reviews the
> exact SQL + checks; the **owner executes** against the live Supabase project and
> returns the captured outputs. Governed by
> [`RECUT-CONTRACT.md`](./RECUT-CONTRACT.md) §4 (arc A) and Doc 00 V6 §10.6
> (proof-before-change). **Irreversible in-place** — the owner's preservation
> snapshot is the only recovery net.

## Scope (what is dropped, what is preserved)

- **Dropped:** every object in the **`public`** schema (tables, views, functions,
  types, triggers, policies, sequences) — the deployed wrong-generation/leaky/legacy
  surface. Genesis rebuilds `public` from spec.
- **Preserved (untouched):** the **`auth`** schema and **`auth.users`** (the test
  accounts the reseed keys to); all 14 platform-managed schemas (`storage`,
  `realtime`, `vault`, `cron`, `extensions`, `graphql*`, `net`, `pgbouncer`,
  `stripe`, `copilot`, `supabase_functions`, `supabase_migrations`, `pgbouncer`);
  platform roles (`anon`/`authenticated`/`service_role`/`postgres`/`supabase_*`);
  the `pgcrypto` extension (lives in `extensions`, so `gen_random_uuid()` survives).
- **Note — `vector` extension:** currently installed **in `public`** (GAP-HY-07),
  so `DROP SCHEMA public CASCADE` drops it. Genesis re-creates `vector` *out of*
  `public` (closing HY-07 by construction). No non-`public` schema depends on the
  public `vector` objects (only legacy `public.question_embeddings`, which genesis
  does not recreate).

---

## Step 0 — Pre-flight (STOP gates)

```sql
-- 0a. Preservation snapshot must exist and be verified BEFORE anything is dropped.
--     (Owner confirms out-of-band: questions=280, profiles snapshot, full-data net.)
-- 0b. Record the pre-teardown auth.users baseline for GUARD-2:
SELECT count(*) AS auth_users_before FROM auth.users;            -- record this number
SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;     -- record these rows
```

**STOP if** the preservation snapshot is not confirmed intact. There is no other
recovery path — the teardown is in-place and irreversible.

---

## GUARD-1 — Pre-DROP inventory diff (owner-mandated)

*Nothing is dropped unknowingly: every object to be dropped must be either (a)
recreated by genesis, or (b) on the intentional-discard (legacy) list.*

```sql
-- 1a. Capture the full public-object inventory immediately before teardown.
SELECT 'table'    AS kind, table_name AS name FROM information_schema.tables       WHERE table_schema='public'
UNION ALL SELECT 'view',     table_name FROM information_schema.views               WHERE table_schema='public'
UNION ALL SELECT 'function', routine_name FROM information_schema.routines          WHERE routine_schema='public'
UNION ALL SELECT 'type',     t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','c')
ORDER BY kind, name;
```

**Diff procedure (owner + CC, before Step 2):**
1. CC produces the **genesis-expected object set** from the foundation contract
   (`contracts/ws1-genesis-foundation.contract.md`) and the
   [`GAP-WAVE-MAP.md`](./GAP-WAVE-MAP.md) **CBC-moot** list (the intentional
   discards).
2. Diff the Step-1a inventory against `recreated-by-genesis ∪ intentional-discard`.
3. **STOP if** any live object falls in *neither* bucket — that is an unknown
   object; investigate (is it a dependency a later wave needs?) before dropping.
   Capture the diff output; it is embedded in the closure commit as GUARD-1 proof.

---

## Step 2 — Teardown (owner-run; `postgres`/`service_role`)

```sql
-- Clean-slate the owned surface. auth.* and all platform schemas are untouched.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Restore the standard Supabase public-schema grants (genesis migrations then
-- create objects inside this schema). These mirror a fresh Supabase project.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL    ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
```

> Object-level grants to `anon`/`authenticated` are **not** restored here — genesis
> migration `0000` issues only the **explicit, minimal** grants each table needs
> (anti-leak posture: no blanket read on `questions`, RLS enabled). The default
> privileges above intentionally cover only `postgres`/`service_role`.

---

## GUARD-2 — Post-drop `auth.users` integrity (owner-mandated)

*Run immediately after Step 2, before any genesis migration applies.*

```sql
SELECT count(*) AS auth_users_after FROM auth.users;             -- must == auth_users_before (0b)
SELECT id, email FROM auth.users ORDER BY created_at LIMIT 5;     -- must match the 0b rows
SELECT count(*) FROM information_schema.schemata WHERE schema_name='auth';  -- = 1 (auth intact)
```

**STOP if** `auth_users_after ≠ auth_users_before`, or the spot-checked rows
changed, or the `auth` schema is missing. The reseed depends on these exact ids
(FK `profiles.id → auth.users(id)` RESTRICT). Capture the output; it is the
GUARD-2 proof in the closure commit.

---

## Step 3 — Handoff to genesis (separate, gated step)

Teardown ends here. Applying genesis `0000` + reseed is **Phase 7** of the
lifecycle and a **separate** owner action, run only after the foundation contract
clears Codex (Phase 4) and the genesis migration clears CI (Phase 6):

```
supabase db push        # applies genesis 0000 (+ any genesis migrations) through the one pipeline
# then the owner-run reseed (RECUT-CONTRACT §6) → exit proof (RECUT-CONTRACT §9)
```

A non-empty `public` schema with the genesis object set, RLS enabled, and the
reseed proofs green (questions=280, profiles FK-intact, anti-leak probe clean)
closes WS-1.

---

## Rollback

There is **no in-place rollback** — Step 2 is destructive by design. Recovery is
**restore-from-snapshot only** (the owner's preservation snapshot). This is why
Step 0 and GUARD-1 are STOP gates: the snapshot's integrity and a clean inventory
diff are the preconditions that make the irreversible step safe to take.
