/**
 * Who may cancel what — resolved from the caller, never from the request.
 *
 * @spec [SCL-272 (only the payer may cancel through the self-service flow; the
 *        server decides who that is); SCL-043 (the Stripe Customer IS the
 *        payer); Charter §6 (a selection is not a claim); owner ruling Karl
 *        2026-11-03 clause 4 (the UI shows the button only to the payer)]
 * | @implemented [2026-11-03]
 *
 * plain English: given an authenticated profile, find the subscriptions that
 * profile is the payer of, and refuse any subscription id that is not one of
 * them. Expected outcome: a student whose guardian pays can name the guardian's
 * subscription id in devtools and is refused; a guardian can cancel for the
 * student they fund and for nobody else.
 *
 * THE PAYER CHECK IS ONE COMPARISON, AND THAT IS NOT A SHORTCUT. SCL-043 makes
 * the Stripe Customer the payer: a guardian who buys has a Customer of their
 * own, and a self-paying student is their own Customer. So
 * `subscription.customer === the caller's stripe_customer_id` IS the payer
 * question, already answered by an invariant the whole billing vertical rests
 * on, rather than by re-deriving a relationship from metadata that identifies
 * but does not authorise. `payer_profile_id` and `payer_relationship` are read
 * here only to LABEL the row for the surface, never to decide it.
 *
 * edge cases:
 *   - A student funded by a guardian has no Stripe Customer at all, or a
 *     different one, so the comparison refuses them. That is the required
 *     denial and it falls out of the invariant rather than being bolted on.
 *   - `subscription.customer` arrives as an id string or an expanded object
 *     depending on the call; both are handled, because reading `.id` off a
 *     string yields `undefined` and would compare equal to nothing — a denial
 *     that looks like a decision.
 *   - A CANCELLED subscription is still authorised to its payer. The listing
 *     below omits cancelled ones (nothing can be done to them), but the
 *     per-subscription path retrieves by id so that cancelling an
 *     already-cancelled subscription answers "already cancelled" rather than
 *     "not yours", which would be a lie.
 */
import type Stripe from "stripe";
import type { CancellableSubscription } from "../../../packages/shared/src/billing-schema";
import { getProfileStripeCustomerId } from "../account";
import { listGuardianFundingSubscriptions } from "./guardian-subscriptions";
import { decideCancellation, type CancellationPlan } from "./cancellation";
import {
  earliestUnpaidFinalizedAtEpoch,
  listOpenInvoices,
} from "./cancellation-execute";

/** Stripe gives `customer` as an id or an expanded object. */
export function customerIdOf(
  subscription: Pick<Stripe.Subscription, "customer">,
): string | null {
  const c = subscription.customer;
  if (typeof c === "string") return c;
  if (c !== null && typeof c === "object" && typeof c.id === "string") {
    return c.id;
  }
  return null;
}

/**
 * The student a subscription funds.
 *
 * Item metadata first, subscription metadata second — the same precedence the
 * webhook uses, because a guardian subscription's SUBSCRIPTION-level metadata
 * names the payer while its ITEM names the student.
 */
export function studentProfileIdOf(
  subscription: Stripe.Subscription,
): string | null {
  for (const item of subscription.items?.data ?? []) {
    const fromItem = item.metadata?.student_profile_id;
    if (typeof fromItem === "string" && fromItem.length > 0) return fromItem;
  }
  const fromSub = subscription.metadata?.student_profile_id;
  return typeof fromSub === "string" && fromSub.length > 0 ? fromSub : null;
}

/**
 * The ITEM's `current_period_end`. Item level, not subscription level: that is
 * where the webhook reads the period from, and on a guardian subscription it is
 * the item that carries the student's period.
 */
export function currentPeriodEndEpochOf(
  subscription: Stripe.Subscription,
): number | null {
  const item = subscription.items?.data?.[0];
  const fromItem = item?.current_period_end;
  return typeof fromItem === "number" ? fromItem : null;
}

export type PayerSubscriptions =
  | {
      readonly ok: true;
      readonly customerId: string;
      readonly subscriptions: readonly Stripe.Subscription[];
    }
  /** The caller is the payer of nothing: no Customer of their own. */
  | { readonly ok: false; readonly code: "NO_STRIPE_CUSTOMER" }
  /** Fails closed rather than answering from a partial list. */
  | { readonly ok: false; readonly code: "SUBSCRIPTION_SCAN_INCOMPLETE" };

export async function resolvePayerSubscriptions(
  stripe: Stripe,
  callerProfileId: string,
): Promise<PayerSubscriptions> {
  const customerId = await getProfileStripeCustomerId(callerProfileId);
  if (customerId === null) return { ok: false, code: "NO_STRIPE_CUSTOMER" };

  const scan = await listGuardianFundingSubscriptions(stripe, customerId);
  if (!scan.ok) return { ok: false, code: scan.code };

  return { ok: true, customerId, subscriptions: scan.subscriptions };
}

export type AuthorizedSubscription =
  | { readonly ok: true; readonly subscription: Stripe.Subscription }
  | { readonly ok: false; readonly code: "NO_STRIPE_CUSTOMER" }
  /** Exists, but the caller is not its payer. */
  | { readonly ok: false; readonly code: "NOT_THE_PAYER" }
  | { readonly ok: false; readonly code: "SUBSCRIPTION_NOT_FOUND" };

/**
 * Re-resolve a caller-supplied subscription id against the caller's own Customer.
 *
 * This is the whole of Charter §6 for this flow: the id is a SELECTION the
 * client makes among things it can see, and this function is the server read
 * that decides whether it may be acted on.
 */
export async function authorizeSubscriptionForPayer(
  stripe: Stripe,
  callerProfileId: string,
  subscriptionId: string,
): Promise<AuthorizedSubscription> {
  const callerCustomerId = await getProfileStripeCustomerId(callerProfileId);
  if (callerCustomerId === null) {
    return { ok: false, code: "NO_STRIPE_CUSTOMER" };
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    // A bad id and someone else's id are answered the same way by design: a
    // distinct "exists but not yours" would confirm the existence of another
    // customer's subscription to anyone who guesses an id.
    return { ok: false, code: "SUBSCRIPTION_NOT_FOUND" };
  }

  if (customerIdOf(subscription) !== callerCustomerId) {
    return { ok: false, code: "NOT_THE_PAYER" };
  }

  return { ok: true, subscription };
}

/** The internal plan, mapped onto the wire decision. `unsupported` never ships. */
export function wireDecisionOf(
  plan: CancellationPlan,
): CancellableSubscription["decision"] | null {
  switch (plan.kind) {
    case "at_period_end":
      return "at_period_end";
    case "past_due_scheduled":
      return "past_due_scheduled";
    case "immediate":
      return "immediate";
    case "already_scheduled":
      return "already_scheduled";
    case "already_canceled":
      return "already_canceled";
    case "unsupported":
      return null;
  }
}

/**
 * Plan a cancellation for one subscription, reading the grace anchor only when
 * the branch needs it.
 *
 * The invoice list is ONE extra Stripe call and it is made only for `past_due`,
 * because that is the only branch whose answer depends on it. A guardian funding
 * six students in good standing costs no invoice reads at all.
 */
export async function planFor(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  nowEpoch: number,
): Promise<CancellationPlan> {
  const needsAnchor =
    subscription.status === "past_due" &&
    subscription.cancel_at === null &&
    subscription.cancel_at_period_end !== true;

  const anchor = needsAnchor
    ? earliestUnpaidFinalizedAtEpoch(
        await listOpenInvoices(stripe, subscription.id),
      )
    : null;

  return decideCancellation({
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    cancelAtEpoch: subscription.cancel_at,
    currentPeriodEndEpoch: currentPeriodEndEpochOf(subscription),
    earliestUnpaidInvoiceFinalizedAtEpoch: anchor,
    nowEpoch,
  });
}

/** One row of the cancel-state surface. */
export async function describeCancellable(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  nowEpoch: number,
): Promise<CancellableSubscription | null> {
  const plan = await planFor(stripe, subscription, nowEpoch);
  const decision = wireDecisionOf(plan);
  // An unsupported status is not offered a button. The surface shows nothing
  // rather than a control whose outcome the server cannot name.
  if (decision === null) return null;

  const cancelAtIso =
    subscription.cancel_at === null
      ? null
      : new Date(subscription.cancel_at * 1000).toISOString();

  return {
    subscriptionId: subscription.id,
    studentProfileId: studentProfileIdOf(subscription),
    stripeStatus: subscription.status,
    decision,
    accessEndsAt: plan.kind === "unsupported" ? null : plan.accessEndsAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    cancelAt: cancelAtIso,
    // Only a cancellation that has not taken effect can be undone. A cancelled
    // subscription is terminal in Stripe and can only be replaced.
    undoable:
      subscription.status !== "canceled" &&
      (subscription.cancel_at_period_end === true ||
        subscription.cancel_at !== null),
  };
}
