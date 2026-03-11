# Stripe System Source of Truth

This document outlines the architecture, data flow, and canonical truth for payment processing and access entitlement within Lyceon.

## 1. Canonical Tables

The ultimate runtime source of truth for all billing and access decisions is the **`entitlements`** table.

*   `accountId` is the unique key. 
*   `entitlements.plan`, `entitlements.status`, and `entitlements.current_period_end` securely determine access. 
*   No other tables are consulted during access control flows (such as `checkUsageLimit` or `requireGuardianEntitlement`).

## 2. Webhook Authority

Our Stripe webhook integration (`webhookHandlers.ts`) is designed to be the absolute authority on entitlement state.

*   **Idempotency / Event Ledger**: Webhooks validate events through an idempotency gate using the `stripe_webhook_events` table before acting. This protects against Stripe duplicate delivery via a UNIQUE constraint.
*   **Out-of-Order Events**: Upon receiving a subscription webhook (event type `customer.subscription.*`), the handler pulls the *most recent* state directly from Stripe using the Stripe Subscription API (`stripe.subscriptions.retrieve`), rather than blind-trusting the old data payload. This ensures correct eventual consistency, even when events arrive out-of-order.
*   **Customer ID Management**: `stripe_customer_id` is only stored in and read from the `entitlements` table.

## 3. Deprecated Billing Fields Removed from Runtime Truth

Historically, billing metadata was loosely pinned to the individual user's profile table (`profiles`). This has been completely deprecated in favor of a strictly student-scoped, account-level truth.

**Removed from Active Use:**
*   `profiles.stripe_customer_id`

Runtime logic exclusively uses the `entitlements.stripe_customer_id`. The application maintains strict isolation so that any user role (guardian or student) manages payments that unlock the underlying student's workspace (their `account_id`).

## 4. Guardian-Paid Checkout Unlocking

When a guardian initiates checkout (via `/api/billing/checkout`), the system creates a Stripe Customer tied securely to the **student's account ID**.
The completed checkout session emits a `customer.subscription.created` webhook that naturally maps directly to the student account and updates **their** `entitlements` active state.

Guardian visibility checks verify if there is an active `entitlements` record for the linked `studentId` via `guardian_links`. Access checks never rely on the guardian's own personal entitlement record.
