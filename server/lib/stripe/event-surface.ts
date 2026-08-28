/**
 * The subscribed Stripe webhook event surface, and what the handler does with
 * each one.
 *
 * @spec [Doc-01_V8 §22.1 as amended by SCL-070 (19 subscribed events)]
 * @implemented [2026-08-27]
 *
 * plain English: one list of every event Stripe is configured to deliver, each
 * carrying either "the handler acts on this" or "the handler ignores this, and
 * here is why". Expected outcome: no subscribed event can reach the handler
 * without a stated disposition. Trade-off: this list mirrors Dashboard
 * configuration that lives outside the repository, so it can drift; the
 * disposition gate cross-checks every name against the SDK's event union so a
 * typo fails in CI rather than silently at the Dashboard. Edge case: an event
 * arriving that is NOT on this list is still acknowledged and ignored — Stripe
 * can deliver anything — but it is logged at WARN because it means the
 * Dashboard and this file disagree.
 *
 * Why the reasons are data and not comments: §4.2 requires that every
 * subscribed event either be processed or be "explicitly ignored with a stated
 * reason". A comment cannot be asserted on. A blanket fallthrough that ignores
 * fourteen events with one shrug is explicit as a mechanism and silent as an
 * explanation, which is the failure this replaces.
 */

/** Events Stripe is configured to deliver to this endpoint. SCL-070. */
export const SUBSCRIBED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.updated",
  "customer.deleted",
  "customer.discount.created",
  "customer.discount.updated",
  "customer.discount.deleted",
  "promotion_code.created",
  "promotion_code.updated",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;

export type SubscribedEvent = (typeof SUBSCRIBED_EVENTS)[number];

export type EventDisposition =
  | { readonly kind: "handled" }
  | { readonly kind: "ignored"; readonly reason: string };

const HANDLED: EventDisposition = { kind: "handled" };
const ignored = (reason: string): EventDisposition => ({
  kind: "ignored",
  reason,
});

/**
 * The disposition of every subscribed event. Exhaustive by construction: the
 * `Record<SubscribedEvent, …>` type makes a missing entry a compile error, and
 * the disposition gate proves it at runtime as well.
 */
export const EVENT_DISPOSITION: Record<SubscribedEvent, EventDisposition> = {
  // ---- Acted on -----------------------------------------------------------
  "checkout.session.completed": HANDLED,
  "customer.subscription.created": HANDLED,
  "customer.subscription.updated": HANDLED,
  "customer.subscription.deleted": HANDLED,
  "charge.dispute.created": HANDLED,
  "charge.dispute.closed": HANDLED,
  "refund.updated": HANDLED,

  // ---- Ignored, with the reason ------------------------------------------
  // SCL-071 settlement, BUILT 2026-08-28 (Codex HIGH-1). `completed` fires when
  // the SESSION completes, which for a delayed payment method is before the
  // money arrives; this event carries the settlement and fulfils through the
  // same `fulfilCheckoutSession` with the same gates and the same writer.
  "checkout.session.async_payment_succeeded": HANDLED,
  // SCL-071: produces NO entitlement by design, and is NOT a revocation of
  // something never granted. Handled rather than ignored so the failure is
  // visible to an operator.
  "checkout.session.async_payment_failed": HANDLED,

  "customer.updated": ignored(
    "SCL-046 country derivation is not built. The Portal permits " +
      "customer-initiated billing-address changes, so this event is the egress " +
      "trigger for a country the customer chose. Handling it without the " +
      "eligibility gate would record a country nothing acts on.",
  ),
  "customer.deleted": ignored(
    "SCL-070 amendment: a deleted Customer orphans an entitlement row that Doc " +
      "05D's cascade cannot see, because that cascade operates on Lyceon rows " +
      "and knows nothing about Stripe object lifetimes. Intended behaviour is " +
      "to revoke the entitlements keyed to that Customer; the seam is flagged " +
      "and the ruling is open.",
  ),
  "customer.discount.created": ignored(
    "SCL-072: a discount changes the CHARGED amount, which is the comparison " +
      "basis for the refund rule. Subscribed so the amount is observable; no " +
      "entitlement effect of its own.",
  ),
  "customer.discount.updated": ignored(
    "SCL-072: as customer.discount.created — observability of the charged " +
      "amount, no entitlement effect.",
  ),
  "customer.discount.deleted": ignored(
    "SCL-072: as customer.discount.created — observability of the charged " +
      "amount, no entitlement effect.",
  ),
  "promotion_code.created": ignored(
    "SCL-072: promotion codes reach the charged amount the same way discounts " +
      "do. Observability only; no entitlement effect.",
  ),
  "promotion_code.updated": ignored(
    "SCL-072: as promotion_code.created — observability only, no entitlement " +
      "effect.",
  ),
  "invoice.payment_succeeded": ignored(
    "§4.5 single-writer: subscription state is written from " +
      "`customer.subscription.updated` and from nothing else. This event " +
      "describes the same state transition from the invoice side; deriving it " +
      "here as well would give one state two writers, which is the " +
      "parallel-paths-built-differently pattern.",
  ),
  "invoice.payment_failed": ignored(
    "§4.5 single-writer: `past_due` is Stripe's subscription status and is " +
      "written from `customer.subscription.updated`. Deriving it independently " +
      "from the invoice would be a second writer for one state.",
  ),
  "refund.created": ignored(
    "SCL-048 as amended by SCL-072: a refund revokes when it reaches status " +
      "`succeeded`, and creation is not that transition. Subscribed so the " +
      "refund is observable from its start; the revoking transition is " +
      "`refund.updated`.",
  ),
};

/**
 * What the handler should do with an inbound event type.
 *
 * Anything not on the subscribed surface is ignored, but distinguishably so:
 * the caller logs an unsubscribed arrival at WARN because it means the
 * Dashboard configuration and this file disagree, and that disagreement is a
 * fact worth surfacing rather than absorbing.
 */
export function dispositionFor(
  eventType: string,
): EventDisposition | { readonly kind: "unsubscribed" } {
  if ((SUBSCRIBED_EVENTS as readonly string[]).includes(eventType)) {
    return EVENT_DISPOSITION[eventType as SubscribedEvent];
  }
  return { kind: "unsubscribed" };
}
