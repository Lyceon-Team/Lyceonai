/**
 * Refund handling — when returned money removes premium access.
 *
 * @spec [SCL-048 refunds, as amended by SCL-072 (charged-amount comparison)]
 * @implemented [2026-08-27]
 *
 * plain English: a fully refunded payment takes premium access away; a partial
 * refund does not. Expected outcome: access follows the money, and the
 * comparison is against what was actually CHARGED, never the price's list
 * amount. Trade-off: revocation happens on `refund.updated` reaching status
 * `succeeded`, not on `refund.created`, so there is a short window in which a
 * refund exists and access remains — that is deliberate, because a created
 * refund can still fail. Edge case: two partial refunds that together cover the
 * charge ARE a full refund, which is why the comparison uses the charge's
 * cumulative `amount_refunded` rather than this one refund's `amount`.
 *
 * WHY THE CHARGED AMOUNT AND NOT THE LIST PRICE (SCL-072): coupons and
 * promotion codes mean the amount charged can be less than the price's list
 * amount. Comparing a refund against the list price would make a complete
 * refund of a discounted subscription look partial, and access would survive a
 * full refund. `Charge.amount` is what was charged; `Charge.amount_refunded` is
 * what has been given back. Both are on the same object, so they cannot
 * describe different transactions.
 *
 * A REFUND IS NOT A DISPUTE. A refund is money we return deliberately; a
 * chargeback is money an issuer takes back over our objection. They have
 * different evidence, different fees, and different reversibility, and SCL-073
 * keeps them on separate paths.
 */
import { z } from "zod";

/**
 * The Refund fields this handler reads.
 *
 * `status` is typed `string | null` by the pinned SDK (stripe@20.4.1,
 * types/Refunds.d.ts:107) — there is no closed union to lean on — so it is
 * compared explicitly against the one value that revokes rather than being
 * narrowed to an enum this SDK does not define.
 */
export const refundEventSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  charge: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
});

export type RefundEvent = z.infer<typeof refundEventSchema>;

/** The only refund status that removes access. */
export const REVOKING_REFUND_STATUS = "succeeded";

export type RefundDecision =
  | { readonly revoke: true; readonly reason: string }
  | { readonly revoke: false; readonly reason: string };

/**
 * Decide whether a refund removes premium access.
 *
 * Pure and deterministic: same inputs, same answer, no IO. Every branch states
 * its reason so the decision is legible in a log rather than inferred from a
 * boolean.
 *
 * @param status            the refund's own status
 * @param chargeAmount      what was actually charged, in minor units
 * @param chargeAmountRefunded  cumulative refunded on that charge, minor units
 */
export function decideRefundRevocation(
  status: string | null | undefined,
  chargeAmount: number,
  chargeAmountRefunded: number,
): RefundDecision {
  if (status !== REVOKING_REFUND_STATUS) {
    return {
      revoke: false,
      reason:
        `refund status is ${status ?? "null"}, not ${REVOKING_REFUND_STATUS}; ` +
        "a refund that has not succeeded has moved no money and must not " +
        "remove access (SCL-048: revoke on succeeded, never on creation)",
    };
  }

  // Guard the degenerate case rather than dividing by it: a zero-amount charge
  // would make every refund look "full" against it.
  if (chargeAmount <= 0) {
    return {
      revoke: false,
      reason:
        `charge amount is ${chargeAmount}, so there is no charged amount to ` +
        "compare against; fails safe rather than treating zero as fully refunded",
    };
  }

  if (chargeAmountRefunded >= chargeAmount) {
    return {
      revoke: true,
      reason:
        `fully refunded: ${chargeAmountRefunded} of ${chargeAmount} charged ` +
        "(SCL-072: compared against the CHARGED amount, not the list price)",
    };
  }

  return {
    revoke: false,
    reason:
      `partially refunded: ${chargeAmountRefunded} of ${chargeAmount} charged; ` +
      "SCL-048 revokes on a full refund only",
  };
}
