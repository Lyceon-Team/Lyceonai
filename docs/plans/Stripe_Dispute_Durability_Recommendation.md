# Dispute durability — three options, Stripe-native first

**Date:** 2026-08-27 · **Status:** RECOMMENDATION, nothing built · **Owner ruling required**

## The defect

`charge.dispute.created` revokes entitlement. A dispute does **not** cancel the Stripe
subscription, so the subscription stays `active`, and the next `customer.subscription.updated`
re-derives from Stripe and writes the entitlement back to `active` — silently undoing the
revocation. Two writers, one state.

Evaluated in the order ruled. What each does to a **won** dispute is the deciding question, because
winning is the case where the customer paid, kept paying, and must not be left revoked.

---

## Option A — cancel the subscription on dispute

**Stripe-native.** `subscriptions.cancel(id)`.

What the SDK says, verbatim: *"Cancels a customer's subscription immediately. The customer won't be
charged again for the subscription. **After it's canceled, you can no longer update the subscription
or its metadata.**"*

| | |
|---|---|
| durable? | **Yes.** `status` becomes `canceled`, which maps to free. No later event can write `active` back — the subscription is terminal. |
| **won dispute?** | **Unrecoverable.** The subscription is gone and cannot be updated. Restoring access means creating a *new* subscription — charging the customer a second time, or granting unpaid access. |
| other cost | Permanently ends the paying relationship of a customer who may be entirely in the right. A bank inquiry the customer never initiated (issuer-driven fraud screening) would destroy their subscription. |

**Rejected.** It solves durability by removing the thing that needs restoring.

## Option B — `pause_collection` — RECOMMENDED

**Stripe-native.** `subscriptions.update(id, { pause_collection: { behavior: 'keep_as_draft' } })`,
reversed with `subscriptions.resume(id)`.

| | |
|---|---|
| **won dispute?** | **Clean.** The SDK: *"Initiates resumption of a paused subscription… If no resumption invoice is generated, the subscription becomes active immediately."* One call, fully reversible. |
| durable? | **Yes — but only if the writer reads it.** See the catch below. |
| where the fact lives | On the **Stripe object**. No local state, no new column, no second source of truth. |
| behaviour choice | `keep_as_draft` — the conservative one. `void` destroys invoices that a won dispute would want back; `mark_uncollectible` writes off revenue we may yet win. |

### The catch, and why it is small

Stripe says, in the `status` field's own documentation: *"The `paused` status is different from
pausing collection, which still generates invoices and **leaves the subscription's status
unchanged**."*

So `pause_collection` does **not** move `subscription.status`. Our writer reads only `status`, so
today a paused subscription would still write `premium`/`active` — the pause would be invisible to
us.

The fix is one line in `writeEntitlementFromSubscription`: treat `pause_collection != null` as
not-entitled, alongside `status`. That is **reading more of Stripe's truth**, not inventing our own
— the opposite of a bespoke control. It keeps a single source of truth and adds no column, no
predicate, and no migration.

### What it does not do

Pausing collection does not claw back the disputed money — nothing does; that is the issuer's call.
Its job here is to be the durable, Stripe-side marker of "not entitled" that survives the next
subscription event. It also has an independent business justification: stop trying to bill a
customer who is mid-dispute.

## Option C — a local `dispute_revoked_at` column

The bespoke answer, and it carries a real cost.

`entitlement_active()`'s predicate would have to change, which touches **SCL-029** — an
owner-promoted, still-`OPEN` entry whose whole subject is what the entitled status set is. Changing
that predicate while its governing SCL is unruled means the code moves ahead of the ruling.

And the status set already has **two copies**, which is why a third is the wrong direction. Read
from production 2026-08-27:

| copy | predicate |
|---|---|
| `entitlement_active()` | `status IN ('active','past_due','trialing')` |
| `idx_entitlements_active` | `WHERE status = 'active' OR status = 'past_due'` |

**They already disagree — the index omits `trialing`.** That divergence is pre-existing and is
reported here rather than fixed in passing, but it is the argument: two copies of one rule have
already drifted, so adding a third is adding a known failure mode on purpose.

**Recommended only if B is rejected**, and if so it should come with consolidating all three copies
into one definition rather than leaving four.

---

## Recommendation

**Option B, with the one-line writer change.** It is Stripe-native, fully reversible on a won
dispute, keeps the fact on the Stripe object, adds no schema, and does not touch SCL-029's unruled
predicate.

**Not built.** Per the ruling: recommend, do not build until ruled.

### If B is ruled in, the work is

1. On `charge.dispute.created`: pause collection (`keep_as_draft`) in addition to writing the
   entitlement down.
2. On `charge.dispute.closed` → `won` / `warning_closed`: `subscriptions.resume(id)`, then re-derive
   the entitlement from the live subscription as the restore path already does.
3. `writeEntitlementFromSubscription`: `pause_collection != null` ⇒ not entitled.
4. Tests: a paused subscription must not confer premium — planted by removing the `pause_collection`
   read and observing the failure.

### One open question either way

A dispute on a **guardian** invoice pauses collection for the whole subscription, which after
migration `20260827010000` may carry several students. Pausing is subscription-level, so all of them
lose access for one student's chargeback. Whether that is correct — the invoice really was disputed
in full — or whether it over-punishes, is a product decision. Flagged, not assumed.
