# WS-1 (Genesis Re-Cut) — Closure Record + Migration-Ledger Reconcile

> **Status: WS-1 CLOSED.** The owner executed the teardown + genesis + reseed arc
> ([`RECUT-CONTRACT.md`](./RECUT-CONTRACT.md) §4) by hand via the Supabase SQL editor.
> The **live genesis `public` schema with 117 profiles is canonical.** This record
> captures the exit/GUARD evidence and the migration-ledger reconcile (**DONE 2026-06-22,
> ledger 3 → 15 — §4**), so the tracked pipeline (`supabase db push`) is safe to resume.
>
> **Supersession:** the canonical reseed path is the owner's **manual full reseed
> (117 profiles, one per `auth.users` row, FK-intact, `questions = 0`)**. This
> **supersedes [`RESEED-MAPPING.md`](./RESEED-MAPPING.md) §4** (the 62-row
> staging-transform path), which is **RETIRED** — it is retained only for provenance.

---

## 1. Grounding (this reconcile pass)

```
git branch                 = claude/sweet-tesla-8vktqh
git rev-parse HEAD         = 15c075a662684e79f3e8a141fa9d6ceabdb3f6b6
supabase project (linked)  = hncolwkccbbjkfithhlo  ("MVP", us-east-2, pg 17.6)
apply-path migrations      = supabase/migrations/*.sql  → 15 files
genesis git hash-object    = 10f205d8d1569824ae3760e877cda97b0168c1f6  (00000000000000_genesis.sql)
```

All DB facts below are from **read-only introspection** of the live project (MCP
`execute_sql`). No prod writes were issued by the agent; the §4 ledger reconcile was
executed by the **CTO** via the Supabase connector (ledger-only write) and is verified
live in this record.

---

## 2. Exit proof — canonical end-state (live, this session)

```sql
select (select count(*) from auth.users)                                              as auth_users_count,
       (select count(*) from public.profiles)                                         as profiles_count,
       (select count(*) from public.profiles p left join auth.users u on u.id=p.id
                                                 where u.id is null)                   as orphan_profiles,
       (select count(*) from public.questions)                                        as questions_count;
```
| auth_users_count | profiles_count | orphan_profiles | questions_count |
|---|---|---|---|
| **117** | **117** | **0** | **0** |

- **FK-intact:** every `profiles.id ∈ auth.users` (`orphan_profiles = 0`); the genesis
  FK `profiles.id → auth.users(id) ON DELETE RESTRICT` (RECUT §2 decision #5) holds.
- **Questions empty by design** (RESEED-MAPPING §0 — the 280 synthetic fixtures were
  discarded; the generation+QA pipeline populates the bank later).
- **Reseed shape:** 117 profiles (one per preserved `auth.users` row), not the 62 of
  the retired staging-transform path. This is the canonical reseed.

### GUARD evidence (owner-run during teardown; corroborated here)
- **GUARD-1** (pre-DROP inventory diff, TEARDOWN-RUNBOOK §GUARD-1) was the owner's
  pre-condition gate before `DROP SCHEMA public CASCADE`; the live schema now contains
  only the genesis-expected object set (76 `public` base tables + the genesis function
  family — §3), with no wrong-generation residue.
- **GUARD-2** (post-drop `auth.users` integrity, TEARDOWN-RUNBOOK §GUARD-2): `auth.users`
  was preserved across the in-place teardown. The live corroboration is
  `auth_users_count = 117` with `profiles_count = 117` and `orphan_profiles = 0` — the
  reseed keyed cleanly to the preserved ids, which is only possible if GUARD-2 held.

### Table census (live, measured this pass — not asserted)

```sql
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';   -- 76
select count(*) from information_schema.tables
 where table_schema='public' and table_type='VIEW';         -- 0
```
| public BASE TABLE | public VIEW |
|---|---|
| **76** | **0** |

The **76** `public` base tables cited above (GUARD-1) and in §3 are confirmed by direct
`information_schema` census this session — the figure is measured, not carried forward.

---

## 3. Live ↔ repo migration map (what is applied)

Each repo migration's application is proven by a **signature object** confirmed live
(table / seeded row / function body / trigger / column / constraint) — not by the
ledger, and not assumed.

| # | Repo version (filename) | Signature proof (live) | In ledger? |
|---|---|---|---|
| 1 | `00000000000000_genesis` | `profiles`, `questions`, `entitlements`, `guardian_links`, `audit_logs`, `idempotency_records`, genesis `*_runtime_config` family, enums | **YES** (`00000000000000`) |
| 2 | `20260610000000_ws2_config_constants` | `practice_runtime_config` seeded (`daily_quota_free`); `exam/review/tutor_context_runtime_config` seeded (5/7/9 rows) | no |
| 3 | `20260610010000_ws3_mastery_formula` | `mastery_constants`, `student_skill/domain_mastery`, `student_kpi_rollups_current`, `mastery_event_audit_log`, `compute_mastery_for_entity()` | no |
| 4 | `20260610020000_ws2_practice_review_runtime` | `practice_sessions`, `practice_session_items`, `review_sessions`, `review_session_items`, `review_error_attempts`, `review_schedule` | no |
| 5 | `20260613000000_lane_c_mastery_seam` | `apply_mastery_event()`, `canonical_mastery_events()` | no |
| 6 | `20260613010000_05b_domain_mastery_kpi` | `student_section/domain/skill/overall_kpi`, `mastery_domain_refresh_audit_log`, `refresh_*_kpi()` | no |
| 7 | `20260613020000_05c_section_projection` | `student_section_projection_snapshots`, `student_projection_refresh_state`, `projection_refresh_outbox`, `compute_section_projection()` | no |
| 8 | `20260616120000_entitlement_active_include_trialing` | `entitlement_active()` body contains `trialing` | no |
| 9 | `20260617000000_notification_outbox` | `notification_outbox` table | no |
| 10 | `20260618000000_legal_acceptances` | `legal_acceptances` table | **mismatch** → ledger `20260618044956` |
| 11 | `20260618010000_legal_acceptance_outbox` | `legal_acceptance_outbox` table | **mismatch** → ledger `20260618051930` |
| 12 | `20260619000000_handle_new_user_trigger` | `handle_new_user()` + `on_auth_user_created` trigger on `auth.users` | no |
| 13 | `20260619000100_profiles_auth_columns` | `profiles.{student_link_code,profile_completed_at,marketing_opt_in}` (3 cols) | no |
| 14 | `20260619000300_legal_outbox_independent` | `legal_acceptance_outbox_user_id_fkey` **dropped** (0 remaining) | no |
| 15 | `20260621000000_account_deletion_lifecycle` | `request/restore/cancel_account_deletion()`, `deidentify_user()`, `account_deletion_requests.recovery_token_hash` | no |

**Result:** 15/15 repo migrations are live. The **In ledger?** column above is the
**pre-reconcile** snapshot — the ledger then held only 3 versions, 2 of them under wrong
versions (the legal pair). The ledger was reconciled to all 15 repo versions on
**2026-06-22** (§4); the row-10/11 mismatches no longer exist.

> `supabase/migrations-pending/20260617130000_guardian_linked_emit.sql` is **NOT** in
> the apply path (separate `migrations-pending/` folder) and is **not live**
> (`guardian_links` has 0 emit triggers; no `*guardian_link*emit*` function). It stays
> pending and is excluded from the ledger by design — do not repair it.

---

## 4. Ledger reconcile — DONE 2026-06-22 (ledger 3 → 15, verified live)

**Status: COMPLETE.** The CTO reconciled `supabase_migrations.schema_migrations`
directly via the Supabase connector — a **ledger-only write**: no migration SQL ran, the
`public` schema and all data are untouched, and the write is idempotent (`ON CONFLICT`-safe).
Verified live this session (read-only introspection):

- **BEFORE:** 3 rows — `genesis` + the two **phantom** legal versions
  (`20260618044956`, `20260618051930`).
- **AFTER:** **15 rows = the 15 repo filenames, in order, with no phantoms.**

### 4.1 Proof artifact — the live 15-row ledger (this pass, read-only)

`select version, name from supabase_migrations.schema_migrations order by version;`

| # | version | name |
|---|---|---|
| 1 | `00000000000000` | genesis |
| 2 | `20260610000000` | ws2_config_constants |
| 3 | `20260610010000` | ws3_mastery_formula |
| 4 | `20260610020000` | ws2_practice_review_runtime |
| 5 | `20260613000000` | lane_c_mastery_seam |
| 6 | `20260613010000` | 05b_domain_mastery_kpi |
| 7 | `20260613020000` | 05c_section_projection |
| 8 | `20260616120000` | entitlement_active_include_trialing |
| 9 | `20260617000000` | notification_outbox |
| 10 | `20260618000000` | legal_acceptances |
| 11 | `20260618010000` | legal_acceptance_outbox |
| 12 | `20260619000000` | handle_new_user_trigger |
| 13 | `20260619000100` | profiles_auth_columns |
| 14 | `20260619000300` | legal_outbox_independent |
| 15 | `20260621000000` | account_deletion_lifecycle |

The phantoms are gone; the legal pair now sit under their **repo** versions
(`20260618000000` / `20260618010000`). `ledger_rows = 15 = apply-path migration count`,
so `supabase db push` is now a safe no-op (everything already applied) — the desired
post-reseed steady state.

### 4.2 Owner cross-check (optional tooling confirmation)

```bash
supabase link --project-ref hncolwkccbbjkfithhlo
supabase migration list      # expect 15 rows, Local == Remote on every version
```

### 4.3 Provenance — original CLI repair plan (SUPERSEDED by the direct connector write)

The reconcile was first authored as `supabase migration repair` commands (below).
They are **superseded by the CTO's direct connector write**, which achieved the same
ledger end-state; the CLI path errored only on a missing `supabase link`. Retained for
provenance — do **not** re-run (the ledger is already at 15):

```bash
# 4a — revert the two phantom ledger rows, then record the two repo versions
supabase migration repair --status reverted 20260618044956
supabase migration repair --status reverted 20260618051930
supabase migration repair --status applied  20260618000000   # legal_acceptances
supabase migration repair --status applied  20260618010000   # legal_acceptance_outbox

# 4b — record the 12 applied-but-unrecorded migrations
supabase migration repair --status applied 20260610000000   # ws2_config_constants
supabase migration repair --status applied 20260610010000   # ws3_mastery_formula
supabase migration repair --status applied 20260610020000   # ws2_practice_review_runtime
supabase migration repair --status applied 20260613000000   # lane_c_mastery_seam
supabase migration repair --status applied 20260613010000   # 05b_domain_mastery_kpi
supabase migration repair --status applied 20260613020000   # 05c_section_projection
supabase migration repair --status applied 20260616120000   # entitlement_active_include_trialing
supabase migration repair --status applied 20260617000000   # notification_outbox
supabase migration repair --status applied 20260619000000   # handle_new_user_trigger
supabase migration repair --status applied 20260619000100   # profiles_auth_columns
supabase migration repair --status applied 20260619000300   # legal_outbox_independent
supabase migration repair --status applied 20260621000000   # account_deletion_lifecycle
```

---

## 5. WS-1 closure assertions

1. Genesis `public` schema is live, RLS-enabled, spec-conformant (RECUT §5/§9).
2. Reseed is the **manual 117-profile** path (FK-intact; `questions = 0`), **superseding
   RESEED-MAPPING §4**.
3. The migration ledger matches introspected reality (**15 = 15**) — reconciled
   2026-06-22 via the CTO's connector write (§4), verified live this pass.
4. No prod writes were made by the agent; all DDL/ledger changes are owner-run (the §4
   ledger reconcile was the CTO's connector write).

WS-1 is closed. WS-2 (Doc 02B runtime) and WS-3 (Doc 05 mastery) proceed in parallel.
