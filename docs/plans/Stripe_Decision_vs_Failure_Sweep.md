# Decisions that still return 5xx — a full sweep

**Verified 2026-09-02** against `server/lib/stripe/webhook-handler.ts` at the commit that introduces
`UnresolvableSubjectError`. Line numbers are from that file at that commit; re-derive with
`grep -n "throw new"` before citing them elsewhere.

## The rule

> A denial, an ambiguity refusal, or an unresolvable subject is a **decision**. It settles at 200
> with a structured log. A shape failure, an infrastructure error, or a programming error is a
> **failure**. It throws, returns 5xx, and Stripe retries.

The test is not "is this bad news" but **"could a redelivery of this exact event produce a different
answer?"** If no, retrying is pure cost: the event never settles, the log fills, and a real failure
is harder to see among the noise.

Applied to `checkout.session.completed` on 2026-09-01 (`CountryDenialError`), and to the subscription
lifecycle arm on 2026-09-02 (`UnresolvableSubjectError`). What follows is every remaining site.

## Settled — no longer 5xx

| Line       | Condition                                  | Status                                          |
| ---------- | ------------------------------------------ | ----------------------------------------------- |
| 540        | `resolveStudentProfileId` finds no subject | `unresolvable_subject`, **lifecycle arm only**  |
| 634 / 1624 | `CountryDenialError`                       | `held` or `remediated_*`, **checkout arm only** |

## Still 5xx, and correctly so

| Line | Condition                                        | Why a retry is right                                                                                                            |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 501  | `parseOrFail` — Zod field errors                 | A genuine shape failure. API-version drift or a transient truncation; a redelivery under a corrected pin can genuinely succeed. |
| 2476 | Event marked HANDLED with no `dispatch()` branch | A programming error. The retry is what makes it loud, and the comment at that site says so deliberately.                        |

## Still 5xx, and each one is a decision — REPORTED, NOT FIXED

None of these is reachable by the live objects that prompted this sweep. Each needs its own verdict
about what a settled outcome should say, and several move money, so widening them in one pass would
be the same "one change, many rulings" mistake this vertical keeps unwinding.

| Line | Condition                                                             | Could a redelivery change it?                                                                                  | Note                                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 690  | No subscription item resolves to the subject (`items=N`)              | **No** — the retrieve is fresh each time.                                                                      | The closest sibling of the one just fixed. Likeliest next candidate.                                                                                                                             |
| 880  | Charge maps to N invoice payments; refusing to guess                  | **No** — Stripe's invoice payments for a settled charge do not change.                                         | Ambiguity refusal.                                                                                                                                                                               |
| 988  | Cannot restore: item count ≠ entitlement row count                    | **No** by itself.                                                                                              | Sits on the dispute-restore path; a settled outcome here must not read as "restored".                                                                                                            |
| 1292 | No item carries `student_profile_id` and no fallback applies          | **No.**                                                                                                        | Now much rarer: `propagateSubjectToBareItem` fills the single-bare-item case at purchase time.                                                                                                   |
| 1312 | Multi-student subscription carries no `payer_profile_id`              | **No.**                                                                                                        |                                                                                                                                                                                                  |
| 1343 | Items name a student the payer is not actively linked to (Charter §6) | **Yes, in principle** — a link revoked between checkout and webhook could be restored inside the retry window. | **The one genuine exception in this table.** The 2026-09-02 country-address recovery is the precedent: a retry self-healed the moment an operator supplied the missing input. Leave it throwing. |
| 1551 | Checkout session originated from a Payment Link                       | **No.**                                                                                                        | Money has moved and nothing is granted; the retry is currently the only recurring alarm. Settling it needs an operator-facing alternative first.                                                 |

**`fulfilCheckoutSession` deliberately still throws on an unresolvable subject** (line 540 reached
from the checkout arm). There the money has just moved, so a silent 200 would hide a payer who was
charged and entitled nobody. That asymmetry is intentional and is the reason the catch was added to
one arm rather than to the resolver.

## The hazard behind the forbidden fix

`upsertEntitlement` (`server/lib/account.ts`) upserts on **`profile_id` alone**:

```ts
.upsert({ profile_id: profileId, ...updates }, { onConflict: "profile_id" })
```

`entitlements` holds at most one row per student — `entitlements_profile_id_unique` — however many
subscriptions fund them. So **every event from every subscription for a student writes the same
row**, and the last event wins.

Live proof that several subscriptions per student is not hypothetical: `cus_V4lNXGNkj7FQH3` carries
two `active` subscriptions for student `3f18cbe2` (`sub_1U8pin…` and `sub_1U4bqZ…`).

Concrete sequences that produce a wrong outcome, once both subscriptions are resolvable:

1. **Cancellation of the older overwrites the newer.** `sub_1U4bqZ…` is cancelled → its
   `customer.subscription.updated` resolves to `3f18cbe2` → the row becomes `canceled`/`free`, even
   though `sub_1U8pin…` is still `active` and paid. The student loses access they are paying for.
   _This is exactly what "make the legacy metadata resolvable" would have caused, and why it is
   forbidden._
2. **Renewal of the older rewrites the newer's period.** Both renew; whichever event lands last
   writes its own `current_period_end`, so the row can carry the earlier subscription's period while
   the later one funds access. Dunning and grace then run off the wrong date.
3. **Deletion of one deletes the entitlement for both.** `customer.subscription.deleted` on either
   maps to the same row.

Note that ordering is not the defect — **there is no ordering that is correct**, because one row
cannot represent two subscriptions. Today the pair is safe only because one of the two is
unresolvable, which is an accident of the data.

**Not fixed here, deliberately.** The fix is to key entitlement on the subscription (or the
SubscriptionItem, which SCL-045 already threads through the writer as
`stripe_subscription_item_id`), and to derive a student's access by folding their rows. That is a
schema change plus a rewrite of every reader — a separate, specified change, not a side effect of a
webhook fix.

## Related gap, out of scope and confirmed

**The self-pay route has no already-funded guard.** `STUDENT_ALREADY_FUNDED`
(`billing-routes.ts:315-324`, via `subscriptionAlreadyFundsStudent`) exists **only** on the guardian
add-item branch. The self-pay `else` branch checks only that a student is not naming another
student; nothing stops a student who already holds an active subscription from buying a second one.

`cus_V4lNXGNkj7FQH3`'s two active subscriptions for one student are that gap, already exercised in
production. It is the same root as the hazard above: nothing in the purchase path knows a student is
already funded, and nothing in the write path can represent it if they are.
