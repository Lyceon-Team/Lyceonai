# Stripe Vertical — DDL Queue

**Nothing here is authored as a migration.** WS-M's freeze is in force (`docs/plans/WS-M_Migration_Integrity.md` §4:
"No new migrations are authored anywhere in the program until M1.2 passes"), and Charter §7 reserves
all migrations to the owner. This file records DDL *needs* with their reasons so none is lost.

**Opened:** 2026-08-20, Phase B. Phase C appends anything it discovers.

| # | Need | Source | Reason | Blocking? |
|---|---|---|---|---|
| D-1 | Drop `entitlements_stripe_subscription_id_key` (UNIQUE on `stripe_subscription_id`); add `stripe_subscription_item_id TEXT UNIQUE` | SCL-045 | Two students on one subscription need two `entitlements` rows sharing one `stripe_subscription_id`, which the existing UNIQUE rejects. The Stripe-side entitlement key must become the subscription **item**. **`entitlements_profile_id_unique` must be KEPT** — one entitlement per student is the invariant and it is the `upsert` `onConflict` target at `server/lib/account.ts:353-370`. | Blocks guardian/multi-student billing. **Does not block the Phase C unaccompanied slice** (one item, one row). |
| D-2 | New consent-record table | SCL-044 | Auto-Renewal Notice §3.3 + §6.7 require a persisted consent record (timestamp, terms version, account) retained ≥3 years from consent or 1 year after termination, whichever is longer. SCL-044 adds session id, customer id, text hash, Stripe's recorded consent value, IP, user agent, entitled student profile, payer relationship. No such table exists — `%consent%` sweep returns only `guardian_consent_requests`, `consent_runtime_config`, `consent_runtime_config_history`. | **Blocks Phase C step 4.** Per Charter §7, if the table does not exist when Phase C reaches it, Phase C stops and reports rather than authoring the migration. |
| D-3 | `DROP SCHEMA stripe CASCADE` (29 tables, all 0 rows) | SCL-050 | No owning document, no retention rule, absent from the Doc 05D §10 and Doc 07E cascades; mirrors `charges` (42 cols) and `invoices` (68 cols) to serve a binary entitlement. | No. Removal, not a prerequisite. |
| D-4 | Drop `public._rl_has_active_entitlement(uuid)` | Charter §10 | Charter §10 requires dead database objects queued for removal, with zero-policy use verified. **Verification is owed and not yet run** — Phase C runs it and either confirms zero references or strikes this row. | No. |

**Not queued — deliberately:** the guardian-link column drift (`docs/plans/WS-GL_Guardian_Link_Data_Layer.md`)
needs no DDL. Production and genesis agree; the schema is correct and the code is wrong.
