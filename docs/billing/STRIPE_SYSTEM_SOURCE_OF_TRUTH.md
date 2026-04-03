# Stripe System Source of Truth

**Canonical Writer:** Webhooks (`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`).
**Canonical Data Store:** `entitlements` table.

## Lifecycle Rules

1. Entitlement is ALWAYS applied to the student layer.
2. Guardian checkouts properly link the entitlement to the student specified during the metadata step. Webhooks allocate entitlement correctly.
3. Webhook replay MUST be safe and idempotent.

## Explicit Anti-Patterns

- Profile-level compatibility or billing strings must NOT be used as live billing truth.
- Do NOT perform `self-healing` synchronous patches between Stripe and the local database during `/status` endpoint resolution. Webhook streams MUST execute out-of-band updates as the canonical resolution path to prevent conflicting state updates.
