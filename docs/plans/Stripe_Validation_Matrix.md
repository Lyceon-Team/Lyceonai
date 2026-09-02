# Stripe Validation Matrix

**Owner: Agent A (Core).** Other agents propose rows via PR comment; A merges them.

**Status: corrected and republished — ready for row assignment.** Filled against
current code on `claude/stripe-grounding-audit-u2tus0` (PR #674, unmerged).

Governing: `Stripe_End_To_End_Flow.md` §0/§9 (paths), SCL register 042–076 (rules),
Parallel Execution Plan §1 (this file is the coordination artifact).

> **A row is claimed by exactly one agent, and claimed before work starts.**
> An empty cell is a defect. A *wrongly filled* cell is worse, because it reads
> as verified.

**What changed since the first publication (2026-08-28).** That version carried
three defects of its own, all in how the matrix was *enforced* rather than in
what it said about Stripe. All three are now fixed in code and each fix was
proved by a plant — §5. The owner also ruled on the open gap: `customer.deleted`
revokes, and it is implemented.

---

## 1. Method

Every cell below is read out of the code. Call sites are **invocation** lines,
and each row now carries the text that line must contain, so the contract test
reads the file and checks it rather than checking that an integer looks like an
integer.

Counts, printed from the source (`tests/ci/stripe-entitlement-paths.contract.test.ts`):

| quantity | value | source |
|---|---|---|
| subscribed events | 19 | `event-surface.ts` `SUBSCRIBED_EVENTS` |
| HANDLED | 11 | `EVENT_DISPOSITION` |
| ignored (stated reason each) | 8 | `EVENT_DISPOSITION` |
| matrix rows | 20 | 19 events + 1 route — every event has exactly one |
| production `upsertEntitlement` call sites | 3 | grep, repo-wide |
| other writes to `entitlements` | 0 | all remaining touches are `.select` |

HANDLED went 10 → 11 because `customer.deleted` moved out of `ignored` on the
owner ruling. Ignored went 9 → 8 for the same reason.

---

## 2. The chokepoint, verified

The country gate is **not** wired per call site. It sits inside the two writers,
conditioned on the effect:

| writer | defined | gate | write |
|---|---|---|---|
| `writeEntitlementFromSubscription` | `webhook-handler.ts:491` | `:517` `if (tier === "premium")` | `:545` |
| `writeEntitlementsForAllItems` | `webhook-handler.ts:1090` | `:1150` `if (tier === "premium")` | `:1207` |
| `revokeAllProfiles` | `webhook-handler.ts:791` | *(none, by design)* | `:796` |

Consequences, and why this is the structure §4A asks for:

- Every granting path that routes through a writer **inherits** the gate. A new
  granting path cannot omit it without also bypassing the sole writer.
- `if (tier === "premium")` is what keeps revocation ungated. `customer.subscription.deleted`
  reaches the same writer with `tier = "free"` and is therefore not country-gated.
  The asymmetry is a property of the guard, not of a caller remembering.
- `handleCustomerDeleted` revokes through `revokeAllProfiles`, so it inherits the
  same ungated revocation path — asserted directly in
  `tests/ci/stripe-customer-deleted.contract.test.ts` with the Tier-1 list empty
  and `customers.retrieve` rejecting.
- `upsertEntitlement` (`account.ts:562`) is the **sole writer**, verified: its only
  production callers are `:545`, `:796`, `:1207`. Every other reference to the
  `entitlements` table in production (`account.ts:488`, `:530`,
  `account-deletion-execute.ts:53`) is a `.select` read.

Route side gates separately, at `billing-routes.ts:271–277`, with the
branch-then-gate ordering: `isAddItem ? deniesEntitlement(...) : blocksCheckout(...)`.

**Chokepoint verdict: expressible and expressed on the webhook side.** The route
side is a second derivation point by necessity (no Stripe event exists yet at
checkout time). That is two derivation points, not one — recorded here rather
than hidden, per §4A's instruction to say so when a single chokepoint is not
available.

---

## 3. The matrix — all 19 events, plus the one granting route

Gate keys: **SIG** signature · **LM** livemode (SCL-049) · **IDEM** `stripe_webhook_events`
insert-once (23505) · **SHAPE** Zod boundary parse · **SETL** settlement (SCL-071) ·
**CTRY** INV-03-08 Tier-1 (SCL-046) · **PLINK** Payment Link refusal · **SUBJ** subject
resolved against active `guardian_links` · **PROV** charge→invoice→subscription
provenance · **AUTH** session + role · **SEL** selected student is an active link.

**Effect is derived, not typed.** A row declares a *direction*; the effect is
computed from `EVENT_DISPOSITION`. An ignored event runs no handler, so its
effect is `none` whatever anyone writes, and declaring a direction on one throws
at module load.

### 3.1 Handled (11)

| # | Path | Trigger | Effect | Gates | Writer | Idempotency | Test | Call site (verified) |
|---|---|---|---|---|---|---|---|---|
| 1 | Checkout completed, settled | `checkout.session.completed` | grant | SIG LM IDEM SHAPE PLINK SETL CTRY SUBJ | `fulfilCheckoutSession` → writer | event id insert-once; upsert on `profile_id` | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1663` |
| 2 | Delayed payment settled | `checkout.session.async_payment_succeeded` | grant | SIG LM IDEM SHAPE PLINK SETL CTRY SUBJ | `fulfilCheckoutSession` → writer | event id insert-once; upsert on `profile_id` | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1663` |
| 3 | Delayed payment failed | `checkout.session.async_payment_failed` | none | SIG LM IDEM | none — SCL-071: grants nothing, and is not a revocation of something never granted | event id insert-once | `stripe-settlement.contract.test.ts` | `webhook-handler.ts:1667` |
| 4 | Subscription created | `customer.subscription.created` | grant | SIG LM IDEM SHAPE CTRY SUBJ | `writeEntitlementsForAllItems` \| `writeEntitlementFromSubscription` | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1724` |
| 5 | Subscription updated | `customer.subscription.updated` | extend | SIG LM IDEM SHAPE CTRY SUBJ | as row 4 | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1724` |
| 6 | Subscription canceled | `customer.subscription.deleted` | revoke | SIG LM IDEM SHAPE — **no CTRY, by design** | `writeEntitlementFromSubscription` (tier=free) | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1724` |
| 7 | Country egress (payer left Tier-1) | `customer.updated` | **none** | SIG LM IDEM SHAPE | none — writes **no** entitlement; sets `cancel_at_period_end` on Stripe (SCL-047). The revoke arrives later through `customer.subscription.updated/deleted` | event id insert-once; `cancel_at_period_end` is idempotent | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1604` |
| 8 | **Customer deleted — billing relationship ended** | `customer.deleted` | **revoke** | SIG LM IDEM SHAPE — **no CTRY, by design** | `handleCustomerDeleted` → `revokeAllProfiles` (tier=free) | event id insert-once; upsert on `profile_id` | `stripe-customer-deleted.contract.test.ts` | `webhook-handler.ts:1599` |
| 9 | Chargeback opened | `charge.dispute.created` | revoke | SIG LM IDEM SHAPE PROV — **no CTRY** | `revokeAllProfiles` (`pause_collection` first, SCL-073) | event id insert-once; upsert on `profile_id` | `stripe-dispute.contract.test.ts` | `webhook-handler.ts:1614` |
| 10 | Dispute closed in our favour | `charge.dispute.closed` | restore | SIG LM IDEM SHAPE PROV CTRY SUBJ | `rederiveEntitlementsForSubscription` (resume first, SCL-073) | event id insert-once; upsert on `profile_id` | `stripe-lifecycle-gate.contract.test.ts` | `webhook-handler.ts:1619` |
| 11 | Full refund | `refund.updated` | revoke | SIG LM IDEM SHAPE PROV — **no CTRY** | `revokeAllProfiles` (SCL-048/072) | event id insert-once; upsert on `profile_id` | `stripe-refund.contract.test.ts` | `webhook-handler.ts:1609` |

Row 7 changed from `revoke` to `none`. It is not a downgrade of severity — it is
what the code does. `handleCustomerUpdated` writes no entitlement row at all; it
sets `cancel_at_period_end` on Stripe, and the entitlement change arrives later
as a subscription event, which is row 5 or row 6. Calling it `revoke` credited
this path with a write it does not perform.

### 3.2 Subscribed and ignored (8)

Enumerated, not omitted — this is Fix 2. Each reaches no handler, so each can
claim only the three pre-dispatch gates, and each cites the `EVENT_DISPOSITION`
entry recording why it is ignored. This is the group `customer.deleted` hid in.

| # | Path | Trigger | Effect | Gates | Why nothing happens | Call site (verified) |
|---|---|---|---|---|---|---|
| 12 | Renewal paid | `invoice.payment_succeeded` | none | SIG LM IDEM | §4.5 single-writer: the period is written from `customer.subscription.updated` and from nothing else | `event-surface.ts:118` |
| 13 | Renewal failed | `invoice.payment_failed` | none | SIG LM IDEM | `past_due` is a subscription status; it arrives through `customer.subscription.updated` (§4.5) | `event-surface.ts:125` |
| 14 | Refund created | `refund.created` | none | SIG LM IDEM | SCL-048/072: a refund revokes when it reaches `succeeded`; creation is not that transition | `event-surface.ts:130` |
| 15 | Discount created | `customer.discount.created` | none | SIG LM IDEM | SCL-072 observability of the charged amount | `event-surface.ts:97` |
| 16 | Discount updated | `customer.discount.updated` | none | SIG LM IDEM | SCL-072 observability of the charged amount | `event-surface.ts:102` |
| 17 | Discount deleted | `customer.discount.deleted` | none | SIG LM IDEM | SCL-072 observability of the charged amount | `event-surface.ts:106` |
| 18 | Promotion code created | `promotion_code.created` | none | SIG LM IDEM | SCL-072 observability of the charged amount | `event-surface.ts:110` |
| 19 | Promotion code updated | `promotion_code.updated` | none | SIG LM IDEM | SCL-072 observability of the charged amount | `event-surface.ts:114` |

### 3.3 The one non-webhook granting path

| # | Path | Trigger | Effect | Gates | Writer | Idempotency | Test | Call site (verified) |
|---|---|---|---|---|---|---|---|---|
| 20 | Guardian adds a student (add-item) | `POST /api/billing/checkout` | grant | AUTH SHAPE SEL CTRY SUBJ | `subscriptionItems.create`; the row is written by `customer.subscription.updated` | already-funded guard refuses a second item for the same student | `identity-entitlement.contract.test.ts` | `billing-routes.ts:276` |

---

## 4. `customer.deleted` — the owner ruling, implemented

**Ruling (2026-08-31):** the Customer *is* the billing relationship. Without it
there is no subscription, no payment method, and no way to bill or cancel, so
leaving entitlement active grants free access with no recourse. It revokes. Low
volume — Customers are normally deleted by an operator.

**How the subjects are found without Stripe.** By the time the event arrives the
Customer is gone, so `subscriptions.list` is unavailable. The handler is
therefore all DB, no SDK:

1. `profiles.stripe_customer_id` is UNIQUE (`genesis:149`) and indexed
   (`genesis:160`), so it is the surviving link → `getProfileIdByStripeCustomerId`
   resolves the payer.
2. The payer's own entitlement row contributes its `stripe_subscription_id`.
3. Active `guardian_links` are walked, because a guardian holds the Customer but
   often owns no entitlement row of their own — a payer-row-only handler would
   revoke nobody in the guardian-paid case.
4. Each subscription id fans out through `getEntitlementsBySubscriptionId`
   (SCL-045: one Customer per payer, one Subscription per payer, one
   SubscriptionItem per student).
5. Every resolved profile is revoked to `{ tier: "free", status: "canceled" }`.

**The over-revocation rule, stated so it is checkable:** a linked student who
holds their own `stripe_customer_id` is skipped. That column is UNIQUE, so such a
student is a payer in their own right and is not funded by the deleted Customer.
Tested directly.

**Absence is a fact, not an error.** No profile holds the Customer, or no
entitlement rows sit behind it → log and change nothing. Only ambiguity fails
closed.

**Stated, not asserted:** whether Stripe also emits `customer.subscription.deleted`
when a Customer is deleted could not be verified here — no credentials, and the
sample repos do not cover it. The handler is therefore written as a durable
sweep rather than depending on that. Upserting to free is idempotent, so the
belt-and-braces overlap is safe either way.

Behaviour proved by `tests/ci/stripe-customer-deleted.contract.test.ts` (4 tests):
guardian-paid fan-out revokes every funded student; a self-paying linked student
is not revoked *and* their subscription is never fanned out; an unknown Customer
writes nothing; and revocation happens with the country gate unreachable.

---

## 5. The three enforcement defects — fixed, each proved by a plant

Every plant below was applied, observed failing, and reverted byte-identical.

### Fix 1 — the call-site column is read, not asserted

*The defect.* The test checked cell **shape** (`toMatch(/^[\w./-]+:\d+$/)`) and
that the **file** existed (`existsSync`). It never opened the line. So all seven
citations pointed at closing parens and docblock fragments, and `:999999` would
have passed in a 1736-line file. A decorative evidence column is worse than
none: it tells the next reader a claim was checked when nothing checked it.

*The fix.* Each row carries `callSiteExpect` — the text the cited line must
contain. The test calls `readCitedLine`, reads the file, and asserts containment.
It prints expected-vs-found for all 20 rows, so the reviewer sees the evidence.

*The plant.* Moved `customer.deleted`'s citation from `:1599` to `:1600`:

```
customer.deleted: server/lib/stripe/webhook-handler.ts:1600 does not contain
"await handleCustomerDeleted(event)" — line reads: "return;"
```

*Second, unplanned confirmation.* The Fix 2 plant added an event to
`event-surface.ts`, shifting the lines below it. Fix 1 immediately flagged all
eight `event-surface.ts` citations as drifted. That is the exact failure mode —
citations rotting when a file grows above them — catching itself unprompted.

### Fix 2 — completeness walks all 19 events, not only the handled ones

*The defect.* Completeness asserted that every HANDLED event had a row. An event
that *should* change entitlement but is ignored therefore could not be missing.
That is precisely how `customer.deleted` stayed invisible for three audits: not
"handled but absent", but "ignored, should revoke, and absent".

*The fix.* Every subscribed event gets exactly one row — handled or ignored. The
hiding place is closed structurally, not by a hand-maintained "has intent" flag
that someone must remember to set. `ENTITLEMENT_PATHS.length` is asserted equal
to `SUBSCRIBED_EVENTS.length + 1` so the test cannot pass vacuously.

*The plant.* Added `customer.subscription.paused` to `SUBSCRIBED_EVENTS` as
`ignored`, with plain entitlement intent ("pausing suspends billing"), and no
matrix row — the shape the old rule permitted:

```
subscribed events with no matrix row:
expected [ 'customer.subscription.paused' ] to deeply equal []
```

### Fix 3 — the effect is derived from `EVENT_DISPOSITION`, not typed beside it

*The defect.* `effect` was a hand-typed field, so it could contradict the
dispatcher. `invoice.payment_succeeded` claimed `extend` and listed CTRY and
SUBJ while `EVENT_DISPOSITION` marked it ignored — gates claimed on a path that
never executes. Mislabelling the effect manufactured a gate claim out of nothing.

*The fix.* A row declares only a `direction`. `deriveEffect` computes the effect:
for an ignored trigger the answer is `none`, and a declared direction is a
contradiction that **throws at module load** rather than being coerced quietly.
Nothing in production imports this module, so failing loudly is free. The test
also asserts every ignored row carries *exactly* the three pre-dispatch gates.

*The plant.* Declared `direction: "revoke"` on `refund.created`:

```
Error: entitlement matrix contradicts EVENT_DISPOSITION: "refund.created" is
ignored (no handler runs) but the row declares direction "revoke". An ignored
event cannot change entitlement. Either handle the event or declare no direction.
```

*Provisional SCL ids, for the owner to number at merge:*
**WITHDRAWN as SCL drafts, 2026-08-31 audit.** They were provisionally labelled
`SCL-DRAFT-A-citation-verification`, `-matrix-completeness`, `-effect-derivation` and
`-customer-deleted-revoke`. None survives the owner's hard test (`SPEC_CHANGES_LOG.md`
header): an SCL amends the spec, and the outcome of each of these is "we do X in this
repo", not "the owner amends a document".

- The first three are **test-quality defects**, fixed in this workstream: the citation
  column is now read rather than asserted, completeness walks all 19 events, and the
  effect is derived from `EVENT_DISPOSITION`. They are recorded by the fixes and their
  plants, above — not by a register entry.
- `customer.deleted` revoking is a **build decision** the owner ruled on 2026-08-31 and
  which is implemented. Row 8 records it. Should it need to become spec text — Doc 01
  stating what a deleted Customer does to entitlement — that is a NEW entry written
  against the hard test, not a relabelling of this one.

No SCL number is owed for any of the four.

### What verified clean

- `upsertEntitlement` is the sole writer — 3 production callers, all inside the
  three intended functions; every other `entitlements` touch is a read.
- The country gate is a real chokepoint on the webhook side, inherited rather
  than wired, and `if (tier === "premium")` keeps revocation ungated.
- Route-side branch-then-gate ordering is correct at `billing-routes.ts:271–277`.
- 19 events, 11 HANDLED / 8 ignored, every ignored one carrying a stated reason.

---

## 6. Proposed row assignment

Ownership follows the layer split; these are proposals, not claims. Rows 1–20
describe shipped behaviour — there is no open gap left in the matrix itself.

| Row / item | Suggested agent | Note |
|---|---|---|
| Rows 1–3 settlement | A (derivation) / B (dispatch) | one derivation, two entry points |
| Rows 4–6 lifecycle | A (gate) / B (schemas, dispatcher) | |
| Row 7 egress | B | `customer.updated` SDK surface |
| Row 8 `customer.deleted` | **A — done in this PR** | handler + 4 tests; B may extend the SDK surface if a read is ever needed |
| Rows 9–11 dispute & refund | B | provenance + `pause_collection` |
| Rows 12–19 ignored events | A | they exist to be enumerated; changing one to handled makes it a new row |
| Row 20 add-item | C | route, contract, selection input |
| Fixtures, plants, PG wiring for all rows | D | |

Branches: A `claude/Astripe-core` · B `claude/Bstripe-surface` ·
C `claude/Cstripe-routes` · D `claude/Dstripe-deletion`. B, C and D branch off
`stripe` once A merges; merge order A → B → C → D, rebasing between each.

---

## 7. Standing

No DDL applied. Nothing merged by an agent. Two verifications remain open until
credentials exist — the live subscription object, and Checkout→SubscriptionItem
metadata propagation. Nothing is substituted for either. Whether Stripe cancels
subscriptions on Customer deletion is a third such item; §4 records how the
handler is written so as not to depend on the answer.
