# Stripe System Source of Truth

This document defines canonical billing and entitlement truth in Lyceon.

## 1. Canonical Runtime Truth

- Billing truth is account-scoped in `entitlements` (`account_id` unique).
- Relationship truth is `guardian_links` (`status='active'` for linked pairs).
- Guardian premium visibility and student premium projection are evaluated across the active linked pair.

In runtime access checks:
- Entitlement state comes from `entitlements`.
- Link state comes from `guardian_links`.

## 2. Webhook Authority

`server/lib/webhookHandlers.ts` is authoritative for Stripe subscription state transitions.

- Idempotency gate table: `stripe_webhook_events`.
- Duplicate events (`23505`) are skipped.
- Non-duplicate gate write failures are fail-closed (event processing is rejected).
- Subscription events reconcile against latest Stripe subscription state (`stripe.subscriptions.retrieve`) before writing entitlement.

## 3. Checkout Ownership Model

Checkout metadata always carries billing owner context:
- `account_id`
- `payer_user_id`
- `payer_role`
- `client_reference_id = account_id`

Guardian checkout writes entitlement to the guardian billing owner account.
Student checkout writes entitlement to the student billing owner account.

## 4. Pair Premium Projection

Premium feature access is resolved over the active linked pair:
- Student can receive premium via own active entitlement or linked guardian active entitlement.
- Guardian requires active link, then can receive premium via linked student active entitlement or own active entitlement.
- Unlinked guardian may retain paid billing state but does not receive student-derived premium product surfaces until linked.
