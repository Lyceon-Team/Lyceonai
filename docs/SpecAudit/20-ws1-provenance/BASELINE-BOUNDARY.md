# Baseline Boundary — WS-1 Provenance

> **Status:** locked (owner decision, 2026-06-08). This document defines the
> single authoritative scope line for `supabase/migrations/00000000000000_baseline.sql`
> and for every `supabase db diff` drift check from WS-1 forward. It is a
> first-class WS-1 deliverable, not an afterthought.

**Grounding**

- Code: `git rev-parse HEAD` = `34255356e0f728647b6ab224b199b3ccd96e1800` (branch `claude/sleepy-heisenberg-fKZvh`)
- Ground truth: `docs/SpecAudit/0000-supabase-live-20260607.csv` — git blob `5bb0ffe15d52ef45a6706caaa1fd108dc5a82a2a` — 8182 LF — 462104 bytes (post-WS-0, pre-WS-1-drops capture)
- Frozen audit evidence (NOT reconciled against): `00-supabase-live-state.csv` — blob `21ecaf668a6d0c04f460334f13a2f9ae25892d7f` — 8404 LF

The capture draws this line itself. Section **I5** (LF 8163), verbatim anchor:
`## I5 — Schema inventory (context only; audit scope remains public)`.

---

## 1. Owned surface — baseline 0000 reproduces it; the CI gate enforces it

Everything in the **`public`** schema is repo-owned and MUST appear in the
single-pipeline migrations with a tracked `CREATE`/`ALTER`:

| Object class | Capture section (LF) | Notes |
|---|---|---|
| Tables, columns, defaults | A1/A2 (LF 7–1267) | incl. `NOT NULL`, defaults like `gen_random_uuid()` |
| Constraints (PK / UNIQUE / FK incl. cascade / CHECK) | A3 (LF 1268) | cascade behavior is load-bearing (e.g. EX-07) |
| Indexes (uniqueness + partial predicates) | A4 (LF 1572) | |
| Views | A5 (LF 1879) | |
| Materialized views | A6 (LF 1883) | |
| Table-level grants per role | A7 (LF 1887) | grants to `anon` / `authenticated` / `service_role` only |
| Functions — SECURITY DEFINER **and** INVOKER, full bodies | B1/B2 (LF 4078 / 4149) | `search_path` pinned exactly as deployed (`SET search_path TO 'public'`) |
| RLS enable-state + policies (USING / WITH CHECK) | C1 (LF 7243) | enabled+zero-policy = deny-all, preserved as such |
| Triggers incl. enable state | D1 (LF 7990) | **`ENABLE ALWAYS`** state is load-bearing (GAP-MA-09 governance triggers) and must be reproduced, not defaulted to origin |
| Enum / custom types | E1/E2 (LF 8051 / 8059) | only `profile_role {student,guardian,admin}` exists today |

### Owned cross-schema dependencies (declared in baseline, we depend on but do not fully own)

- `create extension if not exists vector` — currently installed **in `public`** (F1, LF 8074: `vector | 0.8.0 | public`). Baseline reproduces deployed state, so it declares `vector` in `public` as-is. Relocating it out of `public` is **GAP-HY-07 / WS-7**, executed later through this same pipeline — not pre-empted here.
- `create extension if not exists pgcrypto` — provisioned in the `extensions` schema (F1, LF 8072). Required for `gen_random_uuid()` / crypto used by `public` defaults. Declared `if not exists`; we do **not** pin or own its schema.
- `auth.uid()` / `auth.jwt()` touchpoints — RLS policies and SECURITY DEFINER functions in `public` *reference* the platform `auth` schema (read-only). We depend on these symbols; we never define or migrate the `auth` schema.

---

## 2. Platform-managed boundary — NOT in baseline; Supabase owns the lifecycle

Reproducing any of the following in our migrations would (a) fail to apply on a
fresh Supabase project (objects pre-exist / permission denied) and (b) produce
permanent false-positive drift as Supabase upgrades them. They are therefore
**out of the owned surface by design** and excluded from the diff scope.

### Managed schemas (I5, LF 8163–8181) — 14 excluded, `public` is the only owned schema

```
auth  copilot  cron  extensions  graphql  graphql_public  net
pgbouncer  realtime  storage  stripe  supabase_functions
supabase_migrations  vault
```

(`supabase_migrations` is the CLI's own bookkeeping schema; `copilot` and
`stripe` are Supabase platform / wrapper-managed.)

### Platform extensions (F1, LF 8067–8078) — provisioned by Supabase, not by us

`pg_cron` (pg_catalog), `pg_net` (extensions), `pg_stat_statements` (extensions),
`plpgsql` (pg_catalog), `supabase_vault` (vault), `uuid-ossp` (extensions).
(`pgcrypto` and `vector` are listed in §1 as *owned dependencies* because
`public` objects depend on them; the rest are platform-only.)

### Roles (I2, LF 8112–8145) — provisioned by the platform; baseline GRANTs, never CREATEs

`anon`, `authenticated`, `service_role`, `postgres`, and every `supabase_*` /
`pg_*` role exist before any migration runs. Baseline 0000 contains `GRANT`
statements **to** these roles on `public` objects; it contains **no**
`CREATE ROLE` / `ALTER ROLE`. The five `bypasses_rls=true` roles
(`postgres`, `service_role`, `supabase_admin`, `supabase_etl_admin`,
`supabase_read_only_user`) are all standard Supabase platform roles — accounted
for, none rogue.

---

## 3. Diff scope (the authoritative drift contract)

`supabase db diff` is run **scoped to the owned surface (`--schema public`)**.
A non-empty diff on that scope is a defect (an object in prod with no repo
source, or repo source with no prod object). Managed schemas are excluded by
design and are never part of the empty-diff exit proof.

---

## 4. Why Option 1 (this boundary) and not full-cluster DDL

A full-cluster baseline (auth/storage/realtime/… + platform extensions + role
creation) is **not applyable** on a clean Supabase project and makes
`supabase db diff` **never empty** — Supabase upgrades managed schemas
independently of our repo. Under that option the WS-1 exit proof is
unattainable and CI shows perpetual platform-drift false positives. The
public-scoped boundary is the only choice under which "fresh-apply == prod
(modulo data)" is a reachable, durable state.
