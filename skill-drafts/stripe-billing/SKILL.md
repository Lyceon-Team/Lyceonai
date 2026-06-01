---
name: stripe-billing
description: Stripe payments, subscriptions, webhook idempotency, and the payment/entitlement boundary. Use whenever code handles a Stripe webhook, processes a subscription or renewal, reconciles billing state, or connects a payment event to a student entitlement. Covers the event-ledger dedup pattern and auto-renewal/refund spec ties.
---

# Stripe & Billing (Coding Standards §4.2, §6.3 · canonical: docs/Spec, Doc 09, Refund/Sub Notice)

## Webhook idempotency — required

Stripe delivers events at-least-once and can replay. Every webhook handler dedupes via the **event ledger pattern**:

1. On receipt, record the Stripe `event.id` in a dedup ledger table.
2. If the `event.id` already exists → acknowledge 200 and **do nothing** (already processed).
3. Otherwise process inside a transaction that also writes the ledger row, so processing and dedup commit together.

A webhook handler without ledger-based dedup is **not complete**.

## Payment ≠ permissions

A paid invoice does not itself grant access. Entitlements are student-scoped and set explicitly by the billing domain logic after the event is verified — never inferred client-side, never granted by the checkout redirect alone. (See `auth-entitlements`.)

## Verify and validate

- Verify the Stripe **webhook signature** before trusting any payload.
- `safeParse` the event payload at the boundary (§7.1) — treat Stripe input as untrusted external data.
- Secrets (Stripe keys, webhook secret) come from validated env (`packages/shared/env.ts`). Never inline a key — the secrets hook will hard-block it.

## Spec-bound behaviors (reference, do not improvise or restate values)

Doc 09 and the locked Refund Policy / Subscription & Auto-Renewal Notice are the canonical owners. Name the behavior, cite the document, read exact windows/values from it — do not transcribe numeric windows or governing-law choices into code or this skill (decision 5).

- **Auto-renewal / subscription** terms (consent capture at checkout, reminders, cancel flow, EU/UK withdrawal function, price-change workflow) are governed by the locked Subscription/Auto-Renewal Notice. Implement to that spec; do not invent renewal logic.
- **Refund** windows, grace periods, and governing law are governed by the locked Refund Policy. Reference it for the exact values; never hardcode a window without pointing at the clause it implements.
- Use **Stripe Tax** for tax handling rather than hand-rolled tax math.

## Self-check before done

- [ ] Webhook signature verified; payload Zod-parsed.
- [ ] Event-ledger dedup commits in the same txn as processing.
- [ ] No entitlement granted on payment alone — explicit student-scoped set.
- [ ] No secret inlined; all from validated env.
- [ ] Renewal/refund behavior matches the locked notices by reference (no hardcoded windows/law).

## Proving mechanism

Replay test: deliver the same `event.id` twice → exactly one state change. Signature-rejection test for a bad signature. (§14 idempotency + denial tests.)
