/**
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3 (card on file, charged when the teen joins;
 *        the guardian sees "You'll be charged {price}/{interval} when your teen joins. Renews
 *        until you cancel." before saving), 9 (Billing Terms v4 §2.1, Auto-Renewal Notice v3
 *        §3.5); SCL-286; supabase/migrations/20261207000000_guardian_invite_card.sql]
 *        | @implemented [2026-11-22]
 *
 * plain English: the shapes of "save a card with your invite", shared by the server and the
 * client, and the one sentence the guardian reads before saving. The disclosure is built from
 * the plan's real price (`GET /api/billing/plans`, read from Stripe), never from a table here.
 * Expected outcome: the words on the card, in the tests and in the Billing Terms are the same
 * words. Edge case: a plan whose price is not configured has no disclosure, and the card
 * cannot be saved for it.
 */
import { z } from "zod";
import {
  billingPeriodSchema,
  type BillingPlanMetadata,
} from "./billing-schema";

/**
 * POST /api/guardian/invites/:id/card — open Stripe's card page for this invite and plan.
 * `acceptBillingTerms` is the guardian ticking the box under the disclosure: their consent to
 * the Billing Terms and to automatic renewal, given before the card is saved because the first
 * charge happens later, when the teen joins (Auto-Renewal Notice v3 §3.5).
 */
export const guardianInviteCardRequestSchema = z
  .object({
    plan: billingPeriodSchema,
    acceptBillingTerms: z.literal(true),
  })
  .strict();
type GuardianInviteCardRequest = z.infer<
  typeof guardianInviteCardRequestSchema
>;

/** Where to send the guardian: Stripe's hosted card page. */
export const guardianInviteCardResponseSchema = z
  .object({ data: z.object({ url: z.string().url() }).strict() })
  .strict();
export type GuardianInviteCardResponse = z.infer<
  typeof guardianInviteCardResponseSchema
>;

/** "month", "3 months", "year": the interval as the disclosure says it. */
function chargeIntervalText(
  interval: BillingPlanMetadata["interval"],
  intervalCount: number | null,
): string | null {
  if (interval === null) return null;
  const count = intervalCount ?? 1;
  return count === 1 ? interval : `${count} ${interval}s`;
}

/** "$29.99", in the price's own currency. */
function formatChargeAmount(
  amountCents: number,
  currency: string,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

/**
 * The ruled sentence for one plan, or null when the plan's price is not fully known (then the
 * card cannot be saved for it: a charge the guardian was not shown is not offered).
 */
export function guardianInviteChargeDisclosure(
  plan: BillingPlanMetadata,
): string | null {
  if (
    !plan.stripePriceIdConfigured ||
    plan.amountCents === null ||
    plan.currency === null
  ) {
    return null;
  }
  const interval = chargeIntervalText(plan.interval, plan.intervalCount);
  if (interval === null) return null;
  const price = formatChargeAmount(plan.amountCents, plan.currency);
  return `You'll be charged ${price}/${interval} when your teen joins. Renews until you cancel.`;
}
