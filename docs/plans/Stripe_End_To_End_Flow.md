# Stripe Integration — Complete End-to-End Flow

**Purpose:** the single document describing every path from initialization to termination. Every audit so far has found the *next* gap because no document listed all the paths. This one does.

**How to use it:** reconcile the existing implementation against this flow in **one pass**. Rebuild what diverges. Keep what conforms. Do not delete what Codex confirmed closed.

**Reference implementations — clone them.** `docs.stripe.com` is egress-blocked, but `github.com` is not:

```
git clone https://github.com/stripe-samples/checkout-single-subscription
git clone https://github.com/stripe-samples/subscription-use-cases
```

These are Stripe's own working code for Checkout + Billing subscriptions with webhook fulfilment. **Where our shape differs from theirs, the difference must be justified by a Lyceon requirement or it is a defect.** Cite the sample file and line the same way you cite spec sections.

**Local end-to-end testing.** The Stripe CLI is how the samples are run: `stripe listen --forward-to localhost:PORT/api/billing/webhook` delivers real webhooks locally, and `stripe trigger <event>` fires any event on demand. This removes the dependency on a deployed preview and on the owner making a purchase. Set it up first — it is the reason this has been slow.

**Authority:** the SCL register (042–076) defines the rules. This document defines the *paths*. Where they conflict, the register wins and this document is in defect.

---

## 0. The invariant this document exists to enforce

**Every path that grants, extends, or restores entitlement passes the same gates.**

Codex found six paths with no country gate because the gate was wired at one event. That class recurs until the paths are enumerated. §9's matrix is the enforcement — a new path with an empty cell is a defect, not an omission.

---

## PHASE 0 — Initialization

State that must exist before any purchase is possible. For each: what it is, where it lives, who sets it, and what happens if it's absent.

**0.1 Stripe account configuration.** Live and test mode. One webhook endpoint per mode, pointed at the app's actual mount path — assert the configured URL matches the mount rather than assuming. 19 subscribed events per SCL-070. Customer Portal configured. Terms of Service URL — currently unset, gating consent capture.

**0.2 Credentials.** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, three price IDs. Environment-scoped per SCL-049 — production and preview hold different values under the same names. Mode derives from the key prefix; no second source.

**0.3 Catalog.** Three Prices, one Product, one entitlement tier. Price IDs are mode-specific.

**0.4 Runtime config.** `tier_1_countries` in `entitlement_runtime_config`, ISO 3166-1 alpha-2. **Unseeded means deny** — that is the ruled behaviour, not a bug. Currently unseeded.

**0.5 Schema.** `entitlements` keyed on subscription *item* per SCL-045. Migration 5.1 authored; determine whether it is applied and say so.

**0.6 Startup validation.** Zod parses every variable above at boot. A missing credential fails loudly at start, never at the first webhook.

---

## PHASE 1 — Pre-checkout

**1.1 Who is purchasing.** Three cases, and every downstream branch depends on which: unaccompanied student paying for themselves; guardian paying for a linked student; third-party payer with no Lyceon profile (Refund Policy §10 contemplates gifts and scholarships).

**1.2 Guardian selection.** Guardian sees their linked students, picks one. Per-student, owner-ruled. The route reads active `guardian_links` server-side — the selection identifies a student, it does not authorise one.

**1.3 First purchase or add-item.** **Determine this before any gate runs.** Codex HIGH-3: the country gate ran before this branch, so a new guardian Customer with no address was denied before Stripe could collect one. First purchase → Checkout Session. Existing subscription → `subscriptionItems.create`.

**1.4 Pre-checkout eligibility.** Age. Existing entitlement — already-entitled must not double-purchase. Country **only when already known**; unknown is permitted for first purchase because the address does not exist yet, and is *not* permitted for add-item because the Customer already has one.

---

## PHASE 2 — Session creation

**2.1 Customer resolution.** Existing `stripe_customer_id` on the payer's profile, or create. Payer, never the student-by-default (SCL-043). Third-party payers may have no profile — the subscription's metadata is the authoritative mapping, the profile column is a convenience index.

**2.2 Checkout Session.** `client_reference_id` and `metadata.student_profile_id` set **server-side**. `line_items` — one per selected student. `billing_address_collection: required`. Mode `subscription`. Success and cancel URLs. Idempotency key on creation.

**Consent (deferred, Phase C.2):** `consent_collection.terms_of_service` and `custom_text` are absent by ruling, blocked on the billing terms page. Launch gate on SCL-044.

**2.3 Add-item branch.** `subscriptionItems.create` with `subscription` and item `metadata.student_profile_id`. `proration_behavior` **deliberately unset** so Stripe's `create_prorations` default applies — do not restate a Stripe default.

**2.4 What the client receives.** Session URL for the Checkout branch; a confirmation for the add-item branch. One contract, discriminated.

---

## PHASE 3 — Payment

Stripe-hosted. We touch nothing. The customer may abandon, fail, or succeed; a delayed payment method may complete the session before money settles.

---

## PHASE 4 — Settlement and grant

**The gate-bearing phase.** Every path here appears in §9's matrix.

**4.1 `checkout.session.completed`.** **Parse `payment_status` first.** Grant only on `paid` or `no_payment_required` (SCL-071, Codex HIGH-1). `unpaid` grants nothing and waits for the async event. Reject any session carrying `payment_link` and alert — a query-parameter `client_reference_id` is caller-supplied and Charter §6 forbids it.

**4.2 `checkout.session.async_payment_succeeded`.** Same derivation, same gates, same writer as 4.1. Currently ignored; that is Codex HIGH-1's other half. `async_payment_failed` grants nothing.

**4.3 `customer.subscription.created` / `.updated`.** Re-fetch, map status, write. **These currently have no country gate** (Codex HIGH-2). They grant and extend, so they gate.

**4.4 Item resolution.** Every subject resolved server-side against active `guardian_links`. Metadata identifies; it does not authorise. Any subject failing to resolve grants **nothing** — not partial credit.

**4.5 Period fields** come from the SubscriptionItem, not the Subscription (removed there in API 2025-03-31).

**4.6 Country derivation.** Billing address from the completed session or the Customer. One evaluator, called at every derivation point. ISO alpha-2, no normalisation layer.

**4.7 Write.** `upsertEntitlement`, `onConflict: profile_id`. One row per student. Idempotent — a replayed event produces no second write.

---

## PHASE 5 — Steady state

**5.1 Renewal.** `invoice.payment_succeeded` → period extends. Extension is a grant; it gates.

**5.2 Payment failure.** `invoice.payment_failed` → Stripe retries. Status becomes `past_due`, which `entitlement_active()` treats as entitled (SCL-029). **One writer**: the transition comes from `customer.subscription.updated`, never derived independently from invoice events.

**5.3 Dunning exhaustion.** Stripe's terminal state → revoke.

**5.4 Discounts.** `customer.discount.*` and `promotion_code.*` — acknowledged, no entitlement effect. But the charged amount now differs from list price, which SCL-057 makes load-bearing for refunds.

---

## PHASE 6 — Changes

**6.1 Add a student.** Phase 1.3's add-item branch. Emits `customer.subscription.updated`, **never** `checkout.session.completed` — so the gate wired at 4.1 does not see it. This is the class §0 names.

**6.2 Remove a student.** `subscriptionItems.del`. **Not** subscription cancellation — that strips siblings. §36.4's prose predates the item model; SCL candidate.

**6.3 Link revoked mid-period.** Visibility follows the link immediately, ruled. Money is separate, settled by pro-rated refund.

**6.4 Country change.** `customer.updated` carries the payer's new billing address. Currently ignored — Codex HIGH-2. Egress per SCL-047: `cancel_at_period_end`, access to period end, gate at renewal.

**6.5 Portal actions.** Payment method update, invoice history, cancellation with reason. The portal is a live input — a customer editing their billing address fires `customer.updated`.

---

## PHASE 7 — Termination

**7.1 Cancellation.** `cancel_at_period_end`; access to period end; `customer.subscription.deleted` at the terminal point.

**7.2 Refund.** `refund.created` / `refund.updated`, revoke on `succeeded`. Full versus partial measured against `charge.amount` and cumulative `charge.amount_refunded`, never list price. Durable — pause before local write, so a later lifecycle event cannot restore.

**7.3 Dispute.** `charge.dispute.created` → `pause_collection` then revoke. `charge.dispute.closed` → `won` and `warning_closed` restore, `lost` stays revoked. All eight `Dispute.Status` members explicit. **Restoration is a grant; it gates.** The `payment_dispute` abuse incident is a launch gate on `AbuseScoreService`.

**7.4 Charge provenance — Codex HIGH-5.** Refunds and disputes currently resolve a charge to a subscription by walking the Customer's subscriptions. An unrelated one-off charge could revoke an active subscription. Resolve the exact charge → invoice → subscription relationship. If provenance cannot be established, **change nothing and surface for an operator**.

**7.5 Account deletion.** Doc 05D's cascade knows nothing about Stripe objects. `customer.deleted` leaves an orphan entitlement.

---

## 8. Cross-cutting

**8.1 Idempotency.** Every mutation carries a key. Webhook dedup via the `stripe_webhook_events` 23505 gate, constraint-name checked. Migration to `IdempotencyService` is a launch gate (Doc 01A §38 names this handler its pilot consumer).

**8.2 Logging — Codex HIGH-4.** The identifier sanitiser is structural, but the boundary still copies raw `Error.message` and `stack`, and a Supabase vendor message with a `node_modules` stack was printed from the audit run. Replace unknown vendor prose with an allow-listed classification **at the boundary**, so a new call site inherits it. The test asserting the raw message must be present is inverted and is a hollow guard (Codex HIGH-6) — rewrite it to assert absence.

**8.3 Failure modes.** Fail closed, but distinguish absence from ambiguity: zero items is a fact, several items naming no student is a guess. Never collapse an error into a legitimate empty value.

**8.4 Writers.** All converge on `upsertEntitlement`. They can race; last commit wins. Fan-out writes are sequential and not atomic — a mid-loop failure leaves a prefix changed until Stripe retries.

---

## 9. The validation matrix — the deliverable

One row per path in Phases 4–7 that grants, extends, restores, or revokes. Columns: **path · trigger event · gates applied · writer · idempotency · test that fails if the gate is removed · production call site (`file:line`)**.

**Every cell filled. An empty cell is a defect.** This matrix, enforced by a test, is what stops the next audit finding a seventh ungated path.

Then, in one pass: for every row, does the implementation match? Where it diverges, rebuild that path from this flow and from the Stripe sample. Where it conforms, leave it — Codex confirmed seventeen findings closed and they are not to be re-risked.

---

## 10. Dead code — a closure condition, not a follow-up

Deferred through three rounds. `sendGuardianBlocked` and the 503 status route still live alongside working guardian checkout (Codex MEDIUM). Produce the deletion manifest: every file, function, route, table reference, and test deleted, each with what replaces it, plus grep-proven zero remaining references. **The vertical does not close while dead code from the old path remains.**

---

## 11. Standing conditions

Printed runtime artifacts, never descriptions. Every test answers whether it would fail if its behaviour were deleted, plant observed and reverted; a plant that fails to fail is a finding requiring a second formulation. Both halves asserted. No caller-supplied value gates entitlement — a signature proves Stripe sent the bytes, not that we derived the value. Every Stripe claim cites the sample repo or the pinned SDK. No DDL applied, nothing merged.

**Two verifications stay open** until credentials exist: the live subscription object, and Checkout-to-SubscriptionItem metadata propagation. Substitute nothing.
