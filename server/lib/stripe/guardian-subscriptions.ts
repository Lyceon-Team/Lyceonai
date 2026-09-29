/**
 * Read every subscription a guardian Customer currently holds — completely.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; SCL-045 one SubscriptionItem per student;
 *        Charter §6 metadata identifies, it does not authorise;
 *        owner ruling 2026-09-29 one subscription per student]
 * @implemented [2026-09-29]
 *
 * plain English: list the guardian's non-cancelled subscriptions, following
 * Stripe's pagination to the end, so the caller can ask whether one of them
 * already funds the student being bought for. Expected outcome: the answer is
 * computed over ALL of them or not given at all. Trade-off: up to five Stripe
 * calls on an account with hundreds of subscriptions, against the alternative of
 * answering from a partial view.
 *
 * WHY PAGINATION IS NOT OPTIONAL HERE. The route this replaces read one page of
 * ten with `limit: GUARDIAN_SUBSCRIPTION_SCAN_LIMIT = 10` and a comment saying
 * "the product creates at most ONE per payer, so this only has to be large
 * enough to detect the anomaly it fails closed on". Under one subscription per
 * student that premise is gone: the count is now the number of students the
 * guardian funds, and the limit became a real ceiling on it. A truncated page is
 * worse than a slow one, because the subscription that falls off the end is
 * indistinguishable from one that does not exist — so a guardian with eleven
 * students would have had their twelfth purchase pass a check that never saw the
 * first. This walks to the end, and says so when it cannot.
 *
 * IT FAILS CLOSED, LOUDLY. Exhausting the page cap returns
 * `SUBSCRIPTION_SCAN_INCOMPLETE` rather than the subscriptions found so far.
 * Returning a prefix would let the caller conclude "no subscription funds this
 * student" from a list that was never complete, which is the duplicate-charge
 * defect wearing a different hat.
 */
import type Stripe from "stripe";

/**
 * Objects per page. One hundred is Stripe's documented maximum — "Limit can
 * range between 1 and 100, and the default is 10" (stripe@20.4.1,
 * `types/shared.d.ts:168`) — so this is the fewest round trips the API allows.
 */
export const GUARDIAN_SUBSCRIPTION_PAGE_SIZE = 100;

/**
 * How many pages to walk before refusing to answer.
 *
 * Five, so 500 subscriptions. The real ceiling is the number of students one
 * guardian funds, and 500 is two orders of magnitude above any plausible
 * guardian while still bounding the walk — a Customer with a pathological
 * history cannot make this route page indefinitely. Reached, it is an anomaly
 * worth a human look, which is what the refusal says.
 */
export const GUARDIAN_SUBSCRIPTION_MAX_PAGES = 5;

/**
 * Statuses in which a subscription is paying for, or is about to pay for, its
 * student.
 *
 * THE RULING SAID "ACTIVE"; THIS IS WIDER, DELIBERATELY. The check exists to
 * cover the window between a subscription existing in Stripe and its webhook
 * writing our entitlement row. An `incomplete` subscription is precisely that
 * window — a completed session whose payment has not settled yet — so scanning
 * only `active` would leave open the case the check is for. `trialing`,
 * `past_due`, `unpaid` and `paused` are all states in which the student is
 * already funded and a second subscription would bill twice; SCL-029 already
 * rules a `past_due` student entitled.
 *
 * `canceled`, `incomplete_expired` and `ended` are deliberately absent: a
 * guardian whose subscription for a student ended must be able to buy again.
 *
 * Stripe's default already excludes cancelled subscriptions — "If no value is
 * supplied, all subscriptions that have not been canceled are returned"
 * (stripe@20.4.1, `types/SubscriptionsResource.d.ts` `status`) — and the list
 * call below omits `status` for that reason. This set is applied on top so the
 * blocking rule is stated in our own code rather than inherited from an API
 * default that could change.
 */
export const FUNDING_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status> =
  new Set<Stripe.Subscription.Status>([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
    "paused",
  ]);

export type GuardianSubscriptionScan =
  | {
      readonly ok: true;
      readonly subscriptions: readonly Stripe.Subscription[];
    }
  | { readonly ok: false; readonly code: "SUBSCRIPTION_SCAN_INCOMPLETE" };

/**
 * Every funding subscription on this Customer, or a refusal.
 *
 * `status` is omitted rather than set: Stripe's default is "all subscriptions
 * that have not been canceled", which is the superset this filters, and naming
 * a single status would exclude the others (`SubscriptionListParams.status`
 * takes one value, not a set).
 */
export async function listGuardianFundingSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<GuardianSubscriptionScan> {
  const found: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < GUARDIAN_SUBSCRIPTION_MAX_PAGES; page += 1) {
    const params: Stripe.SubscriptionListParams = {
      customer: customerId,
      limit: GUARDIAN_SUBSCRIPTION_PAGE_SIZE,
      ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
    };
    const listed = await stripe.subscriptions.list(params);

    for (const subscription of listed.data) {
      if (FUNDING_SUBSCRIPTION_STATUSES.has(subscription.status)) {
        found.push(subscription);
      }
    }

    if (!listed.has_more) return { ok: true, subscriptions: found };

    const last = listed.data[listed.data.length - 1];
    if (!last) {
      // `has_more` with an empty page: Stripe has nothing to page from, so
      // continuing would loop on the same cursor forever.
      return { ok: false, code: "SUBSCRIPTION_SCAN_INCOMPLETE" };
    }
    startingAfter = last.id;
  }

  return { ok: false, code: "SUBSCRIPTION_SCAN_INCOMPLETE" };
}
