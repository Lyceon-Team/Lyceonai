# Owner action — recover `sub_1UB8p5DPtjyWEVqErGBHVFQF`

Guardian `c6d3fc60` paid $0.99 for student `00625591` on 2026-09-02 07:43Z. The money moved, the
subscription is `active`, and no entitlement was written. **Do not cancel it and do not refund it —
it is the evidence, and it is recoverable.**

## Why it is stuck

`assertCountryEligibleForGrant` reads `Customer.address.country`. `cus_TmPAI2XDmhuWJu.address` is
`null`, because Stripe collects the billing address per payment method and does not write it back to
the Customer unless the session asks it to. Verdict `unknown` -> `hold_for_operator`: entitlement
refused, no money moved, event settled. The code fix (`customer_update: { address: "auto" }`) makes
this true for every FUTURE session; it does not backfill a Customer that already exists.

**The item metadata does not need to be written first.** `writeEntitlementsForAllItems`'s
single-student fallback already resolves a lone bare item from subscription metadata, and writes
`stripe_subscription_item_id` from the item's own id. The address is the only missing input.

## Step 1 — put the address on the Customer

Values taken verbatim from `cs_live_a1izRz…`'s `customer_details.address`. Nothing is invented.

```bash
stripe customers update cus_TmPAI2XDmhuWJu \
  --address[line1]="14264 Langham Dr. " \
  --address[city]=Carmel \
  --address[state]=IN \
  --address[postal_code]=46074 \
  --address[country]=US
```

Dashboard equivalent: Customers -> `karlnkemzi@gmail.com` -> Update details -> Billing address.

## Step 2 — let a lifecycle event re-derive the entitlement

**Resending `evt_1UB8p8DPtjyWEVqEAauTTks5` will not work.** That id is in
`stripe_webhook_events`, so the idempotency gate answers `already_processed` and never reaches the
writer. That is the gate behaving correctly; do not delete the ledger row to force it.

Use either of these instead:

- **Wait for the retry** of `customer.subscription.created`. That event is absent from the ledger
  because it _threw_: `CountryDenialError` propagates on the lifecycle path, `releaseEvent` deletes
  the claim, and Stripe retries. Delivery was never the problem — two other events from the same
  second are in the ledger. Once the address is set, the next retry succeeds on its own.
- **Or touch the subscription** so Stripe emits a fresh `customer.subscription.updated` — saving it
  unchanged in the Dashboard is enough. Use this if the retry window has closed.

## Step 3 — verify, read-only

```sql
SELECT profile_id, tier, status, stripe_subscription_id, stripe_subscription_item_id
  FROM public.entitlements
 WHERE profile_id::text LIKE '00625591%';
```

Expected exactly one row: `tier = premium`, `status = active`,
`stripe_subscription_id = sub_1UB8p5DPtjyWEVqErGBHVFQF`,
`stripe_subscription_item_id = si_VBVqCKx5JSjVkF`.

The paying Customer is `cus_TmPAI2XDmhuWJu` (the guardian) — held on the subscription in Stripe, not
on the entitlement row, which has no customer column.

## What this does not do

Student `3f18cbe2`'s customer `cus_V4lNXGNkj7FQH3` also has `address: null`. Its entitlement row
predates the Customer-level gate (written 2026-08-26, gate landed 2026-08-28), so it is intact —
but **its next renewal will deny the same way**. Either apply step 1 to that customer too, using the
address on its own most recent session, or accept that its first renewal after this date holds for
an operator.
