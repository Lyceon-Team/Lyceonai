# §4.8 Guardian-paid checkout — PLAN, and (2026-08-28) the implementation record

**Date:** 2026-08-27 · **Revised:** 2026-08-28 (twice: Codex fixes, then the per-student ruling) · **Status:** implemented and wired, per-student · **Author:** Claude Code

Per the work block: *"4.8 guardian-paid checkout: plan first, reported, before any code."*
Nothing in this document has been implemented. Every claim below was checked against the
repository or the pinned SDK on 2026-08-27; the two things I could **not** verify are marked as
such and are the first steps of the plan rather than assumptions inside it.

---

## 1. What 4.8 has to make true

A guardian pays once and one or more linked students get premium. Concretely:

- The Stripe **Customer is the payer** — the guardian, not the student (SCL-043).
- **Entitlement is keyed on the subscription ITEM**, not the subscription, so one subscription
  with N items entitles N students (SCL-045).
- A guardian's own premium derives from **any one** active premium student — a fold over all
  links, not a lookup of one (§31.3).

## 2. THE BLOCKER — 4.8 cannot be built before Phase 4 item 5.1

This is the finding that governs the sequencing, and it inverts the work block's phase order.

`entitlements.stripe_subscription_id` is declared **`TEXT UNIQUE`** (genesis.sql:173). One
subscription can therefore back exactly **one** entitlement row. Guardian-paid with two students is
one subscription and two entitlement rows, which that constraint forbids outright — the second
`upsertEntitlement` would fail on a unique violation.

Phase 4 item **5.1** is exactly the fix: drop `entitlements_stripe_subscription_id_key`, add
`stripe_subscription_item_id TEXT UNIQUE`. The work block sequences Phase 4 *after* Phase 3
"so the schema follows proven behaviour rather than anticipating it" — but 4.8 is the one Phase 3
item that cannot demonstrate its behaviour without the schema. **Ruling needed:** either 5.1 moves
ahead of 4.8, or 4.8 moves after Phase 4. I have not assumed either.

Two consequences already recorded rather than discovered later:

- `getEntitlementBySubscriptionId` (added this phase for the dispute path) uses `maybeSingle()`.
  Correct while the column is UNIQUE; **wrong the moment 5.1 lands**, because one subscription will
  then back several rows. Its docstring names 5.1, and 5.1 must change it to return a list.
- The dispute and refund paths resolve *one* entitlement per charge and **fail closed on several**.
  After 5.1 a guardian's single invoice legitimately covers several students, so "several" stops
  being ambiguity and becomes the normal case. That branch must change from *refuse* to *act on all
  items on the disputed invoice* — and that change is a 5.1 consequence, not a defect in the
  current code.

## 3. VERIFY FIRST — the one mechanism I could not confirm

SCL-045 needs `metadata.student_profile_id` on each **SubscriptionItem**. Today's checkout sets
metadata in two places (`billing-routes.ts:154` and `:159`) and **neither is per-item**: one is
Session metadata, the other is `subscription_data.metadata`, which lands on the Subscription.

The pinned SDK does expose per-item metadata — `line_items[].metadata?: Stripe.MetadataParam`
(stripe@20.4.1, `Checkout/SessionsResource.d.ts`). What I **cannot** confirm from type definitions
is whether Checkout **propagates** `line_items[].metadata` onto the resulting SubscriptionItem, or
whether it stays on the Checkout line item as a separate object. `docs.stripe.com` is egress-blocked
from this environment (HTTP 000), so this is unverified.

**Step 1 of implementation is therefore a probe, not a build:** create one test-mode Checkout
Session with per-item metadata, complete it, retrieve the Subscription with items expanded, and
**print** the item's `metadata`. If it propagates, the plan below stands. If it does not, the
item-level key needs a different mechanism — probably `subscriptions.update` on each item after
creation — and SCL-045's stated mechanism needs amending. That is an SCL question, not a code
decision, and it comes back to you before anything is written.

This probe needs a Stripe key. `STRIPE_BILLING_DIAGNOSTICS` is absent from this environment, so
**I cannot run it** — same blocker that leaves §4.1's live subscription object unprinted.

## 4. Consume, do not rebuild — the link layer

WS-GL Phase B's data layer already provides everything 4.8 reads. **No second link reader.**

| need | existing function | file |
|---|---|---|
| all active links for a guardian | `getAllGuardianStudentLinks(guardianProfileId)` | `server/lib/account.ts:725` |
| one link, guardian↔student | `getGuardianLinkForStudent` | `:69` |
| is a student's entitlement active | `EntitlementService.isEntitlementActiveForProfile` | single evaluator, SP25-001 |

`getAllGuardianStudentLinks` already filters `status = 'active'` and orders deterministically, so the
fold in §5 needs no new query.

## 5. The §31.3 derivation — the defect, precisely

`resolveLinkedPairPremiumAccessForGuardian` (`account.ts:860`) takes **one** link when no student is
requested — `getPrimaryGuardianLink(guardianUserId)` — and derives the guardian's access from that
single student. So a guardian with two linked students, where only the **second** is premium,
derives `free`. That is §31.3's unbuilt fold, and it is a live defect today, independent of
guardian-paid checkout.

The fix is a fold over `getAllGuardianStudentLinks`, short-circuiting on the first active student,
calling the canonical evaluator per link rather than reimplementing the predicate. The
`requestedStudentId` path keeps its current single-link behaviour — asking about a named student is
a different question from asking whether the guardian has access at all.

Note this changes `studentUserId` in the returned shape from "the primary link" to "the link that
conferred access", which is a visible contract change for callers. Worth a ruling.

## 6. Sequenced steps, each with its exit evidence

| # | step | exit evidence |
|---|---|---|
| 0 | **Owner ruling on §2** — does 5.1 move ahead of 4.8, or 4.8 after Phase 4? | a decision; nothing is written before it |
| 1 | **Probe** per-item metadata propagation (§3) | printed `metadata` from a retrieved SubscriptionItem — needs a Stripe key I do not have |
| 2 | §31.3 fold, standalone | a guardian with two links, only the second premium, derives premium; planted by reverting to the single-link read and observing the failure |
| 3 | Guardian checkout: N line items, one per student, each carrying its own `student_profile_id` | a created session whose items each carry the right student |
| 4 | Webhook: write N entitlement rows from N items | N rows in real PG, each with the right `profile_id` and its own period bounds |
| 5 | Dispute/refund fan-out after 5.1 (§2) | a disputed guardian invoice revokes every student on it, not one |

Steps 2 through 5 are each independently testable; step 2 does not depend on 1, 3, or the DDL, so
it can ship on its own and fix a live defect early.

## 7. What this plan deliberately does not do

- **No second link reader.** The table in §4 is the whole data access surface.
- **No local variant of the entitlement evaluator.** The fold calls the single evaluator per link.
- **No caller-supplied value gates entitlement.** The student ids come from server-read guardian
  links, never from the request; the guardian names *which* students only insofar as the link
  already exists and is active.
- **No DDL written here.** §2's schema change is Phase 4's to author.
- **No assumption about metadata propagation.** §3 is a probe first.

## 7a. Guardian-invoice dispute fan-out — ARGUED, NOT DECIDED

Owner ruling 2026-08-27: argue this here; do not decide it in a handler. Both readings below, with
what Stripe makes possible for each.

**The situation.** After migration `20260827010000` one guardian subscription carries N items, one
per student, and one invoice covers all of them. A chargeback contests **that invoice**. Dispute
durability is `pause_collection` (SCL-073 option B), which Stripe applies at the **SUBSCRIPTION**
level — there is no per-item pause. So one student's chargeback suspends every sibling on the
subscription.

**Reading 1 — the payment for all of them is genuinely contested.**
The disputed invoice is the one that paid for every item on it. The issuer has taken back the whole
amount, not one line of it: `Dispute.amount` is documented as *"Disputed amount. Usually the amount
of the charge"*, and the charge covers the full invoice. On this reading, continuing to serve the
siblings is serving students whose payment has been reversed — a straightforward unpaid-access
problem, and suspending all of them is simply correct.
*Stripe supports this natively and completely:* `pause_collection` on the subscription, `resume()`
if the dispute is won. Nothing bespoke.

**Reading 2 — a guardian disputing one line should not silently suspend siblings.**
The likely real-world case is a guardian who disputes because of ONE student — a duplicate charge, a
child who stopped using it, a billing surprise. Suspending three siblings for that is a
disproportionate, invisible consequence they cannot see or appeal, and the first they learn of it is
lost access. It also punishes students who are not party to the dispute at all.
*What Stripe makes possible here is weaker.* There is no per-item pause. The nearest native
mechanisms are: remove the disputed student's item from the subscription
(`subscriptionItems.del`) so billing continues for the others — but that **cancels that student's
entitlement outright**, which pre-judges a dispute we may win; or split guardians onto one
subscription per student, which makes fan-out impossible by construction but abandons SCL-045's
one-subscription shape and changes the invoice the guardian sees.

**The asymmetry worth naming:** reading 1 is fully supported by Stripe with no local state; reading 2
requires either an irreversible action (item removal) or a different subscription topology. That is
not an argument that reading 1 is *right* — it is a statement of what each costs.

**Not decided here.** The handler currently pauses the subscription, which implements reading 1 by
default because it is the only thing `pause_collection` can do. If the owner rules for reading 2, the
change is topological (one subscription per student) and belongs in this plan's §2 sequencing, not in
a webhook branch.

## 7b. Link revoked mid-period — RULED, and already true

Owner ruling 2026-08-27: **visibility follows the link.** A guardian revoking a link is a consent
action, and making it wait on a billing cycle would invert the trust model.

This required **no code change** — it already holds. `revokeGuardianLink` sets `status='revoked'`,
and `getAllGuardianStudentLinks` (the fold's reader) filters `status='active'`, so a revoked link is
excluded from the next request onward. A test now pins it
(`tests/ci/guardian-premium-fold.contract.test.ts`) so the coupling cannot be reintroduced by
someone "fixing" the reader to include paid-through links.

**SCL CANDIDATE — noted, not written.** The money is a separate question and the mechanics are not
specified anywhere:

> **Pro-rated refund on mid-period guardian link revocation.** Visibility ends immediately on
> revocation, but the guardian has paid through period end. Nothing states whether a refund is owed,
> who initiates it, whether it is pro-rated by days or by the item's share of the invoice, or how it
> interacts with SCL-048's full-versus-partial revocation rule — a pro-rated refund is by definition
> partial, so under SCL-048 it does NOT revoke, which is correct here but only by coincidence rather
> than by rule. Also unstated: whether revoking the LAST link should cancel the subscription item at
> period end, and whether the student (who may not be the payer) can trigger a refund to someone
> else's card.

Surfaced per the ruling rather than assumed. No refund behaviour is implemented.

## 7c. Dispute resume and the billing cycle — OPEN OWNER DECISION, nothing changed

Raised by Agent B, 2026-08-31. **Not an SCL**: the spec does not address the billing
cycle on dispute resume, and owner ruling 2026-08-31 is that silence is not a spec
error. `SCL-DRAFT-B-resume-billing-anchor` is withdrawn; the decision is recorded here.

`server/lib/stripe/webhook-handler.ts:988` resumes a paused subscription after a
dispute is won:

    await getStripeClient().subscriptions.resume(target.subscriptionId);

No params. Per the pinned SDK, `node_modules/stripe/types/SubscriptionsResource.d.ts:2145`,
`billing_cycle_anchor` defaults to **`now`**. So winning a dispute silently **resets the
renewal date**: the customer's period restarts from the resume instant rather than
continuing the cycle they paid for.

The two options, and what each costs:

- **`billing_cycle_anchor: 'now'`** (today's behaviour, by default rather than by
  choice). The renewal date moves. A customer who wins a dispute has their billing
  date shifted with no notice, which is a change to what they bought.
- **`billing_cycle_anchor: 'unchanged'`**. The cycle they paid for is preserved, but
  Stripe generates prorations for the paused interval, which shows up on the next
  invoice.

Neither is free, and the choice is billing policy rather than a defect an agent can
rule on. **`subscriptions.resume` is left unchanged until the owner rules.** It
becomes an SCL only if the ruling is that Doc 01 must state the behaviour.

## 8. Open questions for the owner

1. **Sequencing (§2).** 5.1 before 4.8, or 4.8 after Phase 4?
2. **Partial guardian payment.** A guardian pays for two of three linked students. The third has no
   item and no entitlement — is that a supported state, or must checkout cover every active link?
3. **Contract change (§5).** `studentUserId` becoming "the link that conferred access" rather than
   "the primary link" — acceptable?
4. **A link revoked mid-period.** The item is still paid for through period end. Does access follow
   the link (immediate) or the money (period end)? The guardian model says visibility needs an
   active link, which argues immediate — but the money says otherwise, and nothing states which wins.


---

## 9. IMPLEMENTATION RECORD — 2026-08-28 (closes Codex HIGH-2, HIGH-3, HIGH-7)

The 2026-08-27 pass wrote `buildGuardianLineItems` and the N-row writer but **wired neither**. Codex
found the route still returning 503 to every guardian and the builder referenced only by tests. This
section records what is now reachable in production, with the call site named — because "implemented"
without a call site is the defect this whole round is about.

| what | production call site |
|---|---|
| guardian purchase subject, ONE selected student (**superseded by §11** — was one per ACTIVE link) | `server/routes/billing-routes.ts` — `POST /api/billing/checkout`, guardian branch |
| N-row entitlement write | `server/lib/stripe/webhook-handler.ts` — `writeEntitlementsForAllItems`, reached from both `checkout.session.completed` and the subscription dispatcher |
| server-side subject authorisation | same function — `getAllGuardianStudentLinks(payerProfileId)` |

**Step 0 (§2 sequencing) is resolved.** 5.1 moved ahead of 4.8; migration `20260827010000` is authored
and remains unapplied.

**Step 1 (the probe) is NOT resolved and nothing was substituted for it.** See §10.

### What changed beyond the original plan

- **Charter §6 authorisation was missing from the plan itself.** §7 said "no caller-supplied value
  gates entitlement" and the plan satisfied it at *checkout* — student ids come from server-read
  links. It did **not** satisfy it at *webhook time*: the writer entitled whatever uuid a
  SubscriptionItem carried. A signature proves Stripe sent the bytes; it does not prove we derived
  them. The writer now resolves the payer's active links server-side and refuses the WHOLE event if
  any subject is unlinked — all-or-nothing, because a partial write would grant paid access off a
  payload just established as untrustworthy.

- **A guardian-paid subscription now takes the item path at ANY item count**, not only `> 1`. A
  guardian with exactly one linked student still has a subscription whose metadata names the payer,
  so the single-subject resolver must never run on one. The `>= 1` condition also left the writer's
  zero-candidate guard unreachable, which is *why* the bare-metadata test could not fail (HIGH-7).

- **`client_reference_id` is deliberately unset on a guardian session.** It takes one profile id, and
  setting it to the guardian would make the payer look like the entitled student.

## 10. STILL OPEN — carried, not substituted

1. **The metadata-propagation probe (§3).** Whether Checkout propagates `line_items[].metadata` onto
   the SubscriptionItem is still unverified. `STRIPE_BILLING_DIAGNOSTICS` is not reachable from the
   agent environment — see the phase report for the root cause — so the probe cannot be run, and
   nothing has been inferred from SDK types or mocked fixtures in its place.

   The failure mode remains **safe and is now tested against the real seam**: bare items mean no
   subject resolves, the writer refuses, and NOTHING is granted. It cannot grant the wrong student.

2. **§4.1's live subscription object** remains unprinted, same cause.

3. **Open question 2 (partial guardian payment) is RESOLVED by the §11 ruling.** A guardian pays for
   two of three linked students by buying for each one separately; the third simply has no item and no
   entitlement. That is now the designed behaviour rather than an unreachable case.

4. **Open question 3 (contract change to `studentUserId`)** is unchanged and unanswered.


---

## 11. OWNER RULING 2026-08-28 — GUARDIAN CHECKOUT IS PER STUDENT

**Ruled:** the guardian sees their linked students, picks ONE, and pays for that student's
entitlement. This REPLACES the cover-all-links behaviour that shipped on 2026-08-27.

The cover-all behaviour was never ruled — it emerged from the shape of `buildGuardianLineItems`,
which built one line item per active link. A guardian with three linked children was charged for
three the moment they pressed Subscribe. It is reversed.

### 11.1 Spec verification — asked before building, and nothing contradicts the ruling

| section | verified heading | what it says | bearing |
|---|---|---|---|
| §20 "Who pays" | `## **§20 Subscription model**` | "Guardian pays for linked student: guardian initiates Checkout on **student's** behalf… entitlement attaches to the student profile" | singular throughout — supports per-student |
| §31.4 | `### **31.4 Guardian paying for linked student**` | "Guardian pays for student… Subscription produces entitlement on **student's profile**" | singular — supports |
| §36.4 | `### **36.4 Unlinking and billing implications**` | "You are still paying for **this student's** subscription. Keep or cancel?" | per-student granularity at unlink, which is only answerable if the purchase was per-student |
| §31.3 | `### **31.3 Guardian with multiple linked students**` | any one active premium student grants the guardian derivation | about DERIVATION, not purchase — no bearing either way |

**ONE tension, and it is already registered.** §20 also says "**Stripe Subscription per entitled
profile**", which read literally would mean one subscription per student rather than one per payer.
That exact sentence is already the `WAS` of **SCL-045** (PROPOSED, 2026-08-20), whose `IS` is "One
Stripe Customer per payer. One Subscription per payer. One SubscriptionItem per entitled student."
So the ruling does not create a new contradiction — it lands inside one the register already owns.
SCL-045 also already cites §36.4's "this student's subscription" as the spec's own support for
per-student granularity, which is the same evidence this ruling rests on.

**Nothing else in Doc 01 V8 contradicts per-student selection.** No section specifies a bulk or
all-children purchase; SCL-045 recorded the proof of absence ("family plan" appears once corpus-wide,
as `(future)`).

### 11.2 The mechanic — verified against Stripe

**One Customer, one subscription, one invoice, one payment method, one portal.** The second student
is a new `SubscriptionItem` on the EXISTING subscription — never a second subscription.

| case | what the route does |
|---|---|
| guardian has no subscription | Checkout Session, ONE line item for the selected student |
| guardian has a subscription | `subscriptionItems.create({subscription, price, quantity: 1, metadata})` — no Checkout, payment method already on file |

**Verified from the pinned SDK (`stripe@20.4.1`), which ships Stripe's own generated docstrings.**
`docs.stripe.com` is egress-blocked from this environment (HTTP 000 via curl, `EGRESS_BLOCKED` via
the fetch tool), so the primary page could not be read directly; the SDK is generated from Stripe's
OpenAPI spec and carries the same prose, and it cites the page:

- `types/SubscriptionItemsResource.d.ts`, `SubscriptionItemCreateParams.subscription`:
  *"The identifier of the subscription to modify."* — **required**, which is what makes this "add to
  the existing subscription" rather than "create a new one".
- Same file, `proration_behavior`: *"Determines how to handle
  [prorations](https://docs.stripe.com/billing/subscriptions/prorations) when the billing cycle
  changes… **The default value is `create_prorations`.**"*
  → **Page cited: https://docs.stripe.com/billing/subscriptions/prorations**
- `ProrationBehavior = 'always_invoice' | 'create_prorations' | 'none'`.

**We do not set `proration_behavior`.** The default is exactly the wanted behaviour — Stripe credits
and charges for the partial period natively, and it lands on the guardian's next invoice. Setting it
explicitly to `create_prorations` would be re-stating a native default in our own code, which is the
"nothing bespoke" rule applied to a one-line parameter. A test asserts it is left unset.

**An unplanned benefit, worth naming.** `SubscriptionItemCreateParams.metadata` is set DIRECTLY on the
item by this call. So the add-item path does **not** depend on Checkout propagating
`line_items[].metadata` — the mechanism §3's probe exists to verify. Only a guardian's FIRST purchase
touches Checkout at all, and §11.3 removes the dependency there too.

### 11.3 The first purchase no longer depends on the unverified probe either

A guardian's first purchase creates a one-item subscription, and the route stamps the selected student
on BOTH the line item and `subscription_data.metadata`. The webhook writer now takes a
**single-student fallback**: exactly ONE item, that item carrying no student, and the subscription
naming one → use it. Unambiguous by construction, and deliberately restricted to the one-item case.

The probe (§10.1) therefore stays open but is no longer **blocking**: if propagation works the item
metadata is used; if it does not, the fallback resolves the same student. Neither path can entitle the
wrong person.

### 11.4 What the route needs from the client — the selection UI is NOT built here

The selection surface is a client concern. What the route requires of it:

- `POST /api/billing/checkout` with `{ plan, student_profile_id }`. Schema:
  `packages/shared/src/billing-schema.ts` → `billingCheckoutRequestSchema` (`.strict()`).
- `student_profile_id` must be a student the guardian is **actively linked** to. The client should
  populate the picker from the guardian's existing linked-students surface; the server re-reads
  `guardian_links` and refuses anything not in it, so a stale picker is safe.
- The response is discriminated on `kind`:
  `{kind: "checkout_session", url, sessionId}` → redirect to `url` (existing client behaviour,
  unchanged); `{kind: "item_added", subscriptionItemId}` → **do not redirect**; the purchase is
  already complete, so show a confirmation.
- Refusals to render, each with its own remedy: `STUDENT_NOT_SELECTED` (400),
  `STUDENT_NOT_LINKED` (409), `NO_ACTIVE_LINKED_STUDENTS` (409), `STUDENT_ALREADY_FUNDED` (409),
  `AMBIGUOUS_SUBSCRIPTION` (409), `COUNTRY_NOT_ELIGIBLE` (403).

### 11.5 Charter §6 — a selection is not a claim

`student_profile_id` is caller-supplied, which looks like a Charter §6 violation and is not. Charter §6
forbids a caller-supplied value from GATING entitlement; it does not forbid choosing among options the
server already knows. The id **selects**; the server's own read of `guardian_links` **authorises**.
Trusting the id because it is a well-formed uuid — without that read — is exactly Codex HIGH-3, and it
is called out in both the schema and the resolver so nobody reintroduces it.

### 11.6 A second country-gate call site, because the add-item path has no Checkout

Adding an item produces `customer.subscription.updated`, never `checkout.session.completed`, so the
gate wired at that event does not see it. Without a second check, buying for a second child would grant
premium with **no country decision** — the same fail-open money path Codex found for the first. The
route now evaluates the payer's Customer billing country before adding the item. Tested; planted.

### 11.7 Consequence recorded, not resolved: §36.4 unlink under the item model

§36.4 says "If canceled: subscription **canceled** via Stripe". Under SCL-045's item model, cancelling
ONE student is `subscriptionItems.del`, not cancelling the subscription — cancelling it would remove
premium from the guardian's OTHER children. The §36.4 prose predates the item model. Not built here
(unlink is not this workstream), and flagged so it is not implemented literally.
