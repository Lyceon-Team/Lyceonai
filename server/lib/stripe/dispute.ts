/**
 * Chargeback handling — revocation on dispute, restoration on a won dispute.
 *
 * @spec [SCL-073 (disputes); Doc 01A §52 incident taxonomy; SCL-043 payer
 *        identity] | @implemented [2026-08-27]
 *
 * plain English: when a customer charges back, the money is taken out of our
 * account, so premium access comes off. When we win the dispute the money comes
 * back, so access goes back on. Expected outcome: access follows the funds.
 * Trade-off: a dispute does NOT cancel the Stripe subscription, so revocation
 * here is a deliberate override of Stripe's subscription state rather than a
 * reflection of it — see the durability limit below, which is real and is
 * reported rather than hidden. Edge cases: an inquiry that never becomes a
 * dispute, a dispute closed in a state the SDK says cannot reach `closed`, and
 * a Customer that maps to no subscription at all — all three are handled
 * explicitly and none guesses.
 *
 * A DISPUTE IS NOT A REFUND. It must not route through the refund path: a
 * refund is us returning money deliberately, a dispute is the issuer taking it
 * back over our objection, and SCL-048's full-versus-partial amount comparison
 * has no meaning for a chargeback.
 *
 * DURABILITY LIMIT — REPORTED, NOT DESIGNED AROUND.
 * `entitlements.status` admits only Stripe's own subscription statuses
 * (genesis.sql:172). There is no column recording that a revocation was caused
 * by a dispute. Because a dispute leaves the subscription active, the next
 * `customer.subscription.updated` re-derives from Stripe and writes the
 * entitlement back to active — undoing this revocation. Closing that requires
 * DDL (a `dispute_revoked_at` column, or equivalent), which is Phase 4 work.
 * Until then this revocation is correct at the moment it is written and can be
 * overwritten by a later subscription event.
 */
import { z } from "zod";

/**
 * `Dispute.Status`, reproduced from the pinned SDK's own union
 * (stripe@20.4.1, types/Disputes.d.ts). All eight members, verified 2026-08-27.
 * Parsed rather than trusted: an unknown member must fail loudly, because
 * silently treating one as "not won" would decide entitlement by omission.
 */
export const disputeStatusSchema = z.enum([
  "lost",
  "needs_response",
  "prevented",
  "under_review",
  "warning_closed",
  "warning_needs_response",
  "warning_under_review",
  "won",
]);

export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

/** What a `charge.dispute.closed` in this status means for entitlement. */
export type ClosedDisposition =
  | { readonly action: "restore"; readonly reason: string }
  | { readonly action: "leave_revoked"; readonly reason: string };

/**
 * Every member of `Dispute.Status` given an explicit meaning on CLOSE.
 *
 * The SDK's shipped description of `charge.dispute.closed` is: "Occurs when a
 * dispute is closed and the dispute status changes to `lost`, `warning_closed`,
 * or `won`." So only three members are reachable here. The other five are
 * mapped anyway — a status the documentation says cannot arrive is exactly the
 * kind of thing that arrives, and leaving them to a default would decide
 * entitlement by omission rather than by rule.
 */
export const CLOSED_DISPOSITION: Record<DisputeStatus, ClosedDisposition> = {
  won: {
    action: "restore",
    reason:
      "The issuer decided in our favour and the funds are reinstated. The " +
      "customer paid and the subscription was never cancelled, so withholding " +
      "access would be charging them for nothing.",
  },
  warning_closed: {
    action: "restore",
    reason:
      "An inquiry/early-warning closed WITHOUT becoming a dispute. No funds " +
      "were ever withdrawn — `balance_transactions` on such a dispute is empty " +
      "— so there is nothing to withhold access over.",
  },
  lost: {
    action: "leave_revoked",
    reason:
      "The issuer decided against us; the funds are gone and the dispute fee " +
      "stands. Access stays off.",
  },

  // --- Not reachable on `closed` per the SDK's description. Mapped anyway. ---
  needs_response: {
    action: "leave_revoked",
    reason:
      "An open dispute awaiting our evidence. Reaching `closed` in this status " +
      "contradicts the SDK's own event description, so it is treated as an " +
      "unresolved dispute and fails closed rather than restoring on a state we " +
      "do not understand.",
  },
  under_review: {
    action: "leave_revoked",
    reason:
      "An open dispute under issuer review. As `needs_response`: unresolved, " +
      "so access stays off.",
  },
  warning_needs_response: {
    action: "leave_revoked",
    reason:
      "An open inquiry. Unresolved, so access stays off; a genuine close will " +
      "arrive as `warning_closed` and restore.",
  },
  warning_under_review: {
    action: "leave_revoked",
    reason:
      "An open inquiry under review. As `warning_needs_response`: unresolved, " +
      "so access stays off.",
  },
  prevented: {
    action: "leave_revoked",
    reason:
      "The payment was prevented, so no settled charge underwrites access. " +
      "Fails closed.",
  },
};

/**
 * Decide what a closed dispute does to entitlement.
 *
 * Pure and total: every member of the status union has an answer, so this
 * cannot fall through to a default. Deterministic — the same status always
 * yields the same action.
 */
export function dispositionForClosedDispute(
  status: DisputeStatus,
): ClosedDisposition {
  return CLOSED_DISPOSITION[status];
}

/**
 * The Dispute fields this handler reads.
 *
 * `charge` is the only link to the payer that this API version provides:
 * `Charge.invoice` does not exist in stripe@20.4.1 (zero occurrences in
 * types/Charges.d.ts), and neither does `PaymentIntent.invoice`, so there is no
 * forward path from a dispute to the invoice or the subscription. The Customer
 * on the Charge is the available key, and it is the payer per SCL-043.
 */
export const disputeEventSchema = z.object({
  id: z.string().min(1),
  status: disputeStatusSchema,
  charge: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
});

export type DisputeEvent = z.infer<typeof disputeEventSchema>;

/** Normalise Stripe's `string | { id }` expandable reference to an id. */
export function refToId(ref: string | { id: string }): string {
  return typeof ref === "string" ? ref : ref.id;
}
