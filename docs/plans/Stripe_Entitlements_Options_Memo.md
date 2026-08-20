# Stripe Entitlements — Options Memo

**Type:** Options memo. **No recommendation.** The owner rules.
**Date:** 2026-08-20
**Produced by:** Stripe vertical, Phase B (deliverable B1).
**Question:** should Stripe's own Entitlements product own the paid/not-paid axis, or should
`entitlement_features` continue to own it?

This memo argues both sides and stops. It proposes no design and schedules no work.

---

## 1. Why the question is live

Charter §1 places Stripe's documentation above `docs/Spec/` **on mechanism**. Stripe ships an
Entitlements product, and it is already visible in this project's database: the sync schema
contains `stripe.active_entitlements`, and the two registered webhook endpoints both subscribe to
`entitlements.active_entitlement_summary.updated` (89 event types each, verified in SCL-050).
Under the supremacy ruling that deserves an argued answer rather than an assumption in either
direction.

Note the naming collision, because it will confuse every future reader: **Stripe's "Entitlements" and
Lyceon's `public.entitlements` are unrelated.** Stripe's is a feature-provisioning product keyed on
Customer; Lyceon's is a subscription-state row keyed on `profile_id`.

## 2. What Stripe Entitlements does

Per Stripe's documentation (https://docs.stripe.com/billing/entitlements): features are mapped to
products; when a subscription becomes active Stripe creates an active entitlement for each feature
attached to the subscribed product; the integrator determines what to provision either by retrieving
active entitlements (https://docs.stripe.com/api/entitlements/active-entitlement/list) or by
listening to the summary event. The summary payload carries at most 10 entitlements and supplies a
URL for the full paginated list.

## 3. What Lyceon's gate actually evaluates

Doc 01 V8 §27.3 (heading verified: `### **27.3 Feature access evaluation order**`) specifies a
seven-step deterministic order, first-failure-wins. Referenced, not restated. The relevant structural
fact for this memo is the **split**:

| Axis | Source of truth | Can Stripe express it? |
|---|---|---|
| Feature exists / enabled | `entitlement_features` row | Yes — Stripe features are a registry |
| Account not soft-deleted | `profiles.deleted_at` | No |
| Age eligible | `profiles.age_years` vs `required_age_minimum` | No |
| Country eligible | `profiles.country_code` vs Tier-1 set | No |
| **Tier sufficient** | `entitlements` / `entitlement_active()` | **Yes — this is exactly what Stripe Entitlements is** |
| Live exam not in progress | `full_length_exams.status` | No |
| Abuse score acceptable | `AbuseScoreService` (does not exist) | No |

**One of seven axes is Stripe-expressible.** That is the whole shape of the decision.

## 4. The case FOR Stripe Entitlements owning the paid axis

1. **It is the mechanism, and the Charter says mechanism goes to Stripe.** Deriving "is this
   subscription currently conferring access" from subscription status is exactly the derivation
   Stripe now performs and maintains. Doing it in `mapStripeStatusToEntitlement`
   (`server/lib/account.ts:788-800`) is a reimplementation of vendor logic — the pattern
   managed-service-first exists to prevent.
2. **It removes a status-mapping surface that has already drifted.** The entitled-status set has
   moved twice (owner ruling 2026-06-14, then SCL-029 adding `trialing`), and the audit found the
   `entitlement-service.ts:44` docstring still describing the pre-SCL-029 two-value set. A derivation
   Lyceon does not own cannot drift from a decision Lyceon does not make.
3. **It survives Stripe's own future changes.** Pause-collection, subscription schedules, and any
   future status Stripe introduces are handled by Stripe's derivation on the day they ship. Lyceon's
   `STRIPE_STATUS_TO_GENESIS` map defaults an unrecognised status to `canceled`
   (`account.ts:798`) — fail-closed and safe, but it means a new Stripe status silently downgrades
   real subscribers until someone notices.
4. **Per-item entitlement comes for free.** SCL-045 moves the entitlement key to the subscription
   item. Stripe's entitlements are already computed per subscribed product, which is the same grain.
5. **The subscription event surface shrinks.** Instead of handling
   `customer.subscription.created/updated/deleted` plus `invoice.*` plus refunds and deriving state,
   one summary event says what the customer is entitled to now.

## 5. The case AGAINST

1. **It is keyed on the Stripe Customer, and Lyceon's entitlement is keyed on the student.** Under
   SCL-043 the Customer is the *payer*, who in the guardian and third-party cases is not the student
   and may have no Lyceon profile. Stripe's active entitlements would tell Lyceon that *the payer*
   is entitled — which is not a fact Lyceon needs and not the fact the gate evaluates. The
   payer→student mapping stays Lyceon's under Charter §1 carve-out 2 regardless, so adopting Stripe
   Entitlements does not remove the mapping layer; it adds a second identity to reconcile through it.
2. **It answers one of seven questions.** Six checks still need `profiles`, `full_length_exams`, and
   an abuse service. So `canAccessFeature` remains, `entitlement_features` remains as the registry
   for the other six axes, and the win is confined to replacing one boolean's derivation.
3. **Two feature registries instead of one.** `entitlement_features` would hold age, country,
   live-exam, and abuse-tier policy for the same eight feature keys that Stripe's feature registry
   holds the paid policy for. Keeping two registries in sync by hand is the divergence class the
   repo already suffers from — and unlike a code-level drift, this one spans a vendor boundary and
   cannot be caught by a repo grep or a CI parity gate.
4. **It couples a synchronous request-path gate to a vendor read.** `entitlement_active()` is a
   `STABLE SECURITY DEFINER` SQL function over one indexed table. Substituting a Stripe API read, or
   a locally cached mirror of one, adds a dependency and a staleness question to a call on the
   critical path of every gated request. Doc 01 V8 §30.1 requires the gate to fail closed on
   unavailability; a vendor read makes "unavailable" more frequent.
5. **The summary event caps at 10 entitlements with pagination beyond.** Lyceon has 8 feature keys
   today. That is under the cap and above half of it, so the cap is a live constraint on feature
   growth, not a theoretical one — and the paginated fallback is a second code path that would be
   exercised rarely and therefore tested rarely.
6. **Adoption implies re-opening SCL-050.** Stripe Entitlements is most naturally consumed alongside
   the sync integration this session has just proposed removing. Adopting one and removing the other
   is possible — the API can be called directly — but the two decisions interact and should be ruled
   on together rather than in sequence.

## 6. What is not in dispute

- Whichever way this goes, the **payer→student mapping stays Lyceon's** (Charter §1 carve-out 2).
- Whichever way this goes, **six of seven §27.3 checks stay Lyceon's**, because Stripe has no view of
  age, country, soft-delete, live exams, or abuse tier.
- Whichever way this goes, `canAccessFeature` remains the single route-facing gate per Doc 01 V8 §33
  (heading verified: `## **§33 Consumed by**`).

## 7. Cost of deferring

Low, and symmetric. Nothing in the Phase C thin slice depends on the answer: the slice writes one
entitlement row from `checkout.session.completed` and reads it through `entitlement_active()`. If
Stripe Entitlements is adopted later, the change is confined to how that one row's `tier`/`status` is
derived — the row, the key, the gate, and the six other checks are unaffected.

The one thing that would raise the cost of deferring is building a second, richer status-derivation
layer in the interim. Phase C does not do that; it persists Stripe's reported status verbatim.

---

**No recommendation is made. The owner rules.**
