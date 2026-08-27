# §4.8 Guardian-paid checkout — PLAN ONLY, no code written

**Date:** 2026-08-27 · **Status:** awaiting owner ruling · **Author:** Claude Code

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

## 8. Open questions for the owner

1. **Sequencing (§2).** 5.1 before 4.8, or 4.8 after Phase 4?
2. **Partial guardian payment.** A guardian pays for two of three linked students. The third has no
   item and no entitlement — is that a supported state, or must checkout cover every active link?
3. **Contract change (§5).** `studentUserId` becoming "the link that conferred access" rather than
   "the primary link" — acceptable?
4. **A link revoked mid-period.** The item is still paid for through period end. Does access follow
   the link (immediate) or the money (period end)? The guardian model says visibility needs an
   active link, which argues immediate — but the money says otherwise, and nothing states which wins.
