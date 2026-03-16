# Stripe System Source of Truth

This document defines canonical billing and entitlement truth in Lyceon.

## 1. Canonical Runtime Truth

- Billing truth is account-scoped in `entitlements` (`account_id` unique).
- Relationship truth is `guardian_links` (`status='active'` for linked pairs).
- Guardian premium visibility is evaluated from the linked student's entitlement state.

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

Guardian checkout writes entitlement to the linked student account.
Student checkout writes entitlement to the student account.

## 4. Pair Premium Projection

Premium feature access is resolved from the student-owned entitlement:
- Student receives premium only through the student's active entitlement.
- Guardian requires an active link and the linked student's active entitlement.
- Unlinked guardian may retain billing metadata but does not receive student-derived premium product surfaces until linked and the linked student is entitled.
