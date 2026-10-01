/**
 * The ONE place `cancel_at_period_end` is turned on or off — and it is turned on in STRIPE.
 *
 * @spec [Doc-01_V8 §955 "canceled (at period end) → access continues to end of paid period",
 *        §928 (the Customer Portal is the self-service path), §36.4 (the payer decides);
 *        SCL-047's country-egress path, which is the precedent for writing to Stripe and letting
 *        the webhook mirror it; SCL-191; owner ruling 2026-09-30 #6]
 * | @implemented [2026-09-30]
 *
 * plain English: ask Stripe to stop the subscription at the end of the period the payer has
 * already paid for. Expected outcome: nothing is cut off early, nothing is refunded, and our
 * `entitlements.cancel_at_period_end` catches up when `customer.subscription.updated` arrives.
 * Trade-off: our row is stale for the seconds between the API call and the webhook, which is the
 * same window every other Stripe-authoritative fact has.
 *
 * NEVER WRITES OUR COLUMN (owner ruling 2026-09-30 #6). `entitlements.cancel_at_period_end` has
 * exactly one writer — `server/lib/stripe/webhook-handler.ts:726`,
 * `cancel_at_period_end: subscription.cancel_at_period_end === true` — and a second writer here
 * would be a second source of truth for a fact Stripe owns. Worse, it would be the OPTIMISTIC
 * one: a row saying the subscription ends while Stripe has never been told is a promise we cannot
 * keep, and it would read exactly like a kept one.
 *
 * IDEMPOTENT, BY READING FIRST (edge case 8: "`cancel_at_period_end` already set — do not
 * re-set it"). Stripe's `subscriptions.update` is not itself idempotent in the sense that
 * matters here: re-sending the flag succeeds and emits another `customer.subscription.updated`,
 * so a job that re-set it every pass would emit one webhook per pass per student for the rest of
 * the period. The retrieve is what makes a second call a no-op, and it is also what lets the
 * caller record `skipped_cancel_pending` honestly.
 *
 * CLEARING IT IS THE SAME FUNCTION, deliberately. A student who says "not retaking" and then
 * changes their mind must be able to undo it, and the undo has to go through the same read-then-
 * write so it cannot fight with the set. Edge case 5's last-write-wins applies to the decision as
 * much as to the score: the latest answer is the answer, and it has to reach Stripe.
 */
import type Stripe from "stripe";
import { getStripeClient } from "./client";
import { logger } from "../../logger";
import { digestId } from "./redact";

export type RenewalCancellationOutcome =
  /** Stripe was told; the flag changed. */
  | { readonly kind: "applied" }
  /** Stripe already held the requested value; nothing was sent. */
  | { readonly kind: "already" }
  /** The call failed. The caller reports it and records nothing as done. */
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Set or clear `cancel_at_period_end` on one subscription.
 *
 * `stripe` is injected so the tests can assert the exact call made rather than the row that
 * followed — owner ruling 2026-09-30 #6 requires the test to assert the Stripe call AND the
 * mirrored row, and a module that reached for its own client could only be tested on one of them.
 */
export async function setCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
  options?: { readonly stripe?: Stripe; readonly requestId?: string },
): Promise<RenewalCancellationOutcome> {
  const stripe = options?.stripe ?? getStripeClient();
  const requestId = options?.requestId;

  try {
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    if (current.cancel_at_period_end === cancelAtPeriodEnd) {
      logger.info(
        "STRIPE",
        "renewal_cancel_noop",
        "the subscription already holds the requested cancel_at_period_end; nothing sent",
        {
          requestId,
          subscriptionRef: digestId(subscriptionId),
          cancelAtPeriodEnd,
        },
      );
      return { kind: "already" };
    }

    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });

    logger.info(
      "STRIPE",
      "renewal_cancel_applied",
      "cancel_at_period_end was written to Stripe; our row follows via the webhook",
      {
        requestId,
        subscriptionRef: digestId(subscriptionId),
        cancelAtPeriodEnd,
      },
    );
    return { kind: "applied" };
  } catch (thrown: unknown) {
    const reason = thrown instanceof Error ? thrown.message : "unknown";
    logger.error(
      "STRIPE",
      "renewal_cancel_failed",
      "cancel_at_period_end could not be written to Stripe; nothing was recorded as done",
      { requestId, subscriptionRef: digestId(subscriptionId), reason },
    );
    return { kind: "failed", reason };
  }
}
