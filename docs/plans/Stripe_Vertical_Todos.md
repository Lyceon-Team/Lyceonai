# Stripe Vertical — Todos

**Opened:** 2026-09-29, on the owner ruling that accompanied the guardian
one-subscription-per-student change. Items here are **recorded, not actioned** — each names
what was observed and who owns it.

This file exists because the vertical had nowhere to put an item of this shape.
`Stripe_Open_Questions.md` is for counsel and product questions; `STRIPE_DDL_QUEUE.md` is for
schema. These are live-data and follow-up items.

---

## T1 — `sub_1UB8p5DPtjyWEVqErGBHVFQF` carries two items (OWNER)

Two SubscriptionItems on one subscription:

| item subject | price |
|---|---|
| `00625591` | the **archived** $0.99 yearly |
| `59ce67c7` | the quarterly added 2026-09-29, **with no payment behind it** |

The second is the residue of the deleted add-item path: `subscriptionItems.create` with
`proration_behavior` unset put the amount on the next invoice (2026-12-02), so the item exists
and no money moved. Both are test accounts.

**Owner will inspect and remove. Do not touch it from code.** Nothing in the change that
recorded this reads or writes that subscription.

It is not unhandled in the meantime: `writeEntitlementsForAllItems` still iterates items and
writes a per-item `stripe_subscription_item_id`, and
`tests/ci/guardian-one-subscription-per-student.contract.test.ts` pins that on a two-item
fixture precisely because this shape exists in production. No new subscription can acquire a
second item.

## T2 — that subscription's SUBSCRIPTION-level metadata is stale (OWNER)

It reads `student_profile_id: 00625591`, `plan: yearly` — describing only the first student,
because it was written when the subscription was created and the second student arrived as an
item.

**Harmless today**, because the guardian fan-out reads ITEM metadata and falls back to
subscription metadata only when a subscription has exactly one item.

Worth recording for a second reason: the one-subscription-per-student model **removes this
class of staleness for all future data.** A subscription that funds exactly one student cannot
hold metadata that describes only some of its students. T2 is historical, not a standing risk.

## T3 — seven active subscriptions on the archived $0.99 price (OWNER)

Recorded as observed. No code reads the price's archived state to decide entitlement — tier
comes from subscription status — so these entitle normally. Flagged because the price is
archived and the amounts are not the published ones.

## T4 — Customer Portal with N subscriptions (UX, not blocking)

One guardian Customer now holds one subscription per funded student, so the portal lists all of
them and the guardian picks which to cancel. Workable as-is.

Stripe supports deep-linking a specific subscription via
`flow_data.subscription_cancel.subscription`, which would let `/guardian` send the guardian
straight to the right one from a per-student row. **A UX improvement for the vertical, not part
of the one-subscription-per-student change** (owner ruling 2026-09-29: record, do not build).

## T5 — `docs/route-registry.md:67` names a route that does not exist

The `/guardian` row lists `/api/billing/prices` among its endpoints. No such route exists in
`server/`, `client/src/` or `apps/`; the guardian purchase card calls `/api/billing/plans`.

Pre-existing and unrelated to any change that observed it — reported twice now (the billing
price-derivation PR and this one) and left alone both times under the one-atomic-change rule.
Recorded here so the third reader does not have to rediscover it.
