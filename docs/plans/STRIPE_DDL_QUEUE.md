# Stripe Vertical — DDL Queue

**Nothing here is authored as a migration.** WS-M's freeze is in force (`docs/plans/WS-M_Migration_Integrity.md` §4:
"No new migrations are authored anywhere in the program until M1.2 passes"), and Charter §7 reserves
all migrations to the owner. This file records DDL *needs* with their reasons so none is lost.

**Opened:** 2026-08-20, Phase B. Phase C appends anything it discovers.

| # | Need | Source | Reason | Blocking? |
|---|---|---|---|---|
> **D-1 IS APPLIED IN PRODUCTION — verified 2026-09-01, read-only.** This queue carried it as
> pending for several rounds; that was wrong. Live state:
>
> ```
> entitlements columns  … stripe_subscription_item_id
> unique indexes        entitlements_pkey
>                       entitlements_stripe_subscription_item_id_key   (partial, WHERE NOT NULL)
>                       entitlements_profile_id_unique
> ```
>
> `entitlements_stripe_subscription_id_key` is GONE, the item-level key is live, and
> `entitlements_profile_id_unique` survives as the `upsert` `onConflict` target — exactly the
> shape D-1 specified. Nothing about D-1 blocks guardian/multi-student billing any longer.
>
> Caveat, and it is why "applied" is not the same as "in effect": the single live `entitlements`
> row predates the migration and carries `stripe_subscription_item_id = NULL` with both period
> bounds NULL. It is not backfilled. Access is unaffected — `entitlement_active()` reads
> `status` only — but no live write has ever populated the item key.

| D-1 | Drop `entitlements_stripe_subscription_id_key` (UNIQUE on `stripe_subscription_id`); add `stripe_subscription_item_id TEXT UNIQUE` | SCL-045 | Two students on one subscription need two `entitlements` rows sharing one `stripe_subscription_id`, which the existing UNIQUE rejects. The Stripe-side entitlement key must become the subscription **item**. **`entitlements_profile_id_unique` must be KEPT** — one entitlement per student is the invariant and it is the `upsert` `onConflict` target at `server/lib/account.ts:353-370`. | Blocks guardian/multi-student billing. **Does not block the Phase C unaccompanied slice** (one item, one row). |
| D-2 | New consent-record table | SCL-044 | Auto-Renewal Notice §3.3 + §6.7 require a persisted consent record (timestamp, terms version, account) retained ≥3 years from consent or 1 year after termination, whichever is longer. SCL-044 adds session id, customer id, text hash, Stripe's recorded consent value, IP, user agent, entitled student profile, payer relationship. No such table exists — `%consent%` sweep returns only `guardian_consent_requests`, `consent_runtime_config`, `consent_runtime_config_history`. | **Blocks Phase C step 4.** Per Charter §7, if the table does not exist when Phase C reaches it, Phase C stops and reports rather than authoring the migration. |
| D-3 | `DROP SCHEMA stripe CASCADE` (29 tables, all 0 rows) | SCL-050 | No owning document, no retention rule, absent from the Doc 05D §10 and Doc 07E cascades; mirrors `charges` (42 cols) and `invoices` (68 cols) to serve a binary entitlement. | No. Removal, not a prerequisite. |
| D-4 | Drop `public._rl_has_active_entitlement(uuid)` | Charter §10 | Charter §10 requires dead database objects queued for removal, with zero-policy use verified. **Verified 2026-08-20, zero references:** `SELECT schemaname, tablename, policyname FROM pg_policies WHERE qual::text ILIKE '%_rl_has_active_entitlement%' OR with_check::text ILIKE '%_rl_has_active_entitlement%';` returned `[]`. The function delegates correctly and fails closed, so this is dead-object hygiene, not a correctness fix. | No. |
| D-5 | The entitled-status set derives from one source, or the drift is CI-guarded | Owner finding 2026-08-20 (parallel-paths class) | The set `{active, past_due, trialing}` exists in **two independent copies** in production: the body of `entitlement_active(uuid)`, and the predicate of the partial index `idx_entitlements_active`. Verified below. A future SCL revisiting `past_due` that changes one leaves the other silently non-matching — the index stops covering the function's `WHERE`, the function keeps returning correct answers, no test fails, and the only symptom is a sequential scan. Silent because correctness is unaffected; costly because it is invisible. Either derive the predicate from one source, or add a CI parity check asserting the two sets are equal. | No. Performance/maintainability, not correctness. |

**D-5 evidence.** Both copies, printed:

```sql
SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='entitlement_active';
```
```
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.profile_id = p_profile_id AND e.status IN ('active','past_due','trialing')
  );
```
```sql
SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_entitlements_active';
```
```
CREATE INDEX idx_entitlements_active ON public.entitlements USING btree (profile_id)
  WHERE ((status = 'active'::text) OR (status = 'past_due'::text) OR (status = 'trialing'::text))
```
Same three values, two syntaxes (`IN (...)` vs `OR`-chain), no shared source.

Note that `tests/ci/entitlement.status-parity.contract.test.ts` already guards a *different* pair —
the migration file `20260616120000_entitlement_active_include_trialing.sql` against
`contracts/auth-entitlement-sp25.contract.md`, both by regex on `status IN (...)`. It reads neither
the index predicate (an `OR`-chain its regex cannot match) nor production. So a third copy is guarded
and these two are not.

**Not queued — deliberately:** the guardian-link column drift (`docs/plans/WS-GL_Guardian_Link_Data_Layer.md`)
needs no DDL. Production and genesis agree; the schema is correct and the code is wrong.
