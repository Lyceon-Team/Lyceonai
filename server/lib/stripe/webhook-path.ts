/**
 * @spec [SCL-049; docs/plans/Stripe_Phase_C_Preflight.md §5] @implemented 2026-08-20
 *
 * plain English: the one place the Stripe webhook path is written down. The
 * Express mount reads it, and a contract test asserts the mount matches it, so
 * the configured Stripe endpoint URL and the served route cannot silently
 * diverge.
 *
 * Why this exists: both previously-registered Stripe endpoints targeted
 * `/api/stripe/webhook` while the application mounted `/api/billing/webhook`.
 * They never matched, which is why `stripe_webhook_events` held zero rows. A
 * shared constant plus an assertion replaces the assumption.
 *
 * The Stripe Dashboard endpoint URL must end with this path.
 */
export const STRIPE_WEBHOOK_PATH = "/api/billing/webhook";
