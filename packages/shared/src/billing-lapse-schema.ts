/**
 * The billing lapse emails: event names, milestones and payloads, one definition.
 *
 * @spec [Doc 01 §21, §22.1, §23 (the past_due grace and the day 0/3/6/8 emails); owner brief
 *       "Founding lapse flow" (Karl, 2026-11-24) and rulings 1-8; SCL-289] | @implemented [2026-11-24]
 *
 * plain English: Lyceon tells Resend three facts as Automation events, and Resend holds the
 * templates (the welcome flow's pattern, server/lib/lifecycle-email.ts). Every value is a true
 * fact read from Stripe or our database at the moment of sending: the amount is the upcoming
 * invoice's amount due, never a hard-coded price; the dates are the invoice's own and the grace
 * deadline we stored. Resend event payloads are strings, so numbers travel as decimal strings.
 * These are billing emails: always sent, never held by the email send gate.
 */
import { z } from "zod";

export const BILLING_CARD_NEEDED_EVENT = "lyceon.billing_card_needed";
export const BILLING_PAYMENT_FAILED_EVENT = "lyceon.billing_payment_failed";
export const BILLING_ACCESS_ENDED_EVENT = "lyceon.billing_access_ended";

/**
 * Days before the first charge at which a member with no card is warned. Each is a band, so a
 * day the job did not run is caught on the next run: 14 covers 8..14 days left, 7 covers 3..7,
 * 2 covers 1..2. `days_left` in the payload is the true count on the day it is sent.
 */
export const CARD_NEEDED_MILESTONES = [14, 7, 2] as const;
export type CardNeededMilestone = (typeof CARD_NEEDED_MILESTONES)[number];

/** The failed attempts that get an email (owner ruling: 3 tries, then cancel). */
export const PAYMENT_FAILED_ATTEMPTS = [1, 2, 3] as const;

export const billingLapseNoticeSchema = z.enum([
  "card_needed_14",
  "card_needed_7",
  "card_needed_2",
  "payment_failed_1",
  "payment_failed_2",
  "payment_failed_3",
  "access_ended",
]);
export type BillingLapseNotice = z.infer<typeof billingLapseNoticeSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveIntString = z.string().regex(/^[1-9]\d*$/);
/** A formatted amount as the email shows it, e.g. "$59.99". */
const displayAmount = z.string().min(2);
const currency = z.string().regex(/^[a-z]{3}$/);
const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"));

export const billingCardNeededPayloadSchema = z
  .object({
    days_left: positiveIntString,
    invoice_date: isoDate,
    amount: displayAmount,
    currency,
    add_card_url: httpsUrl,
  })
  .strict();
export type BillingCardNeededPayload = z.infer<
  typeof billingCardNeededPayloadSchema
>;

export const billingPaymentFailedPayloadSchema = z
  .object({
    attempt: z.enum(["1", "2", "3"]),
    grace_ends_on: isoDate,
    amount: displayAmount,
    currency,
    add_card_url: httpsUrl,
    /** Stripe's hosted page for this invoice; empty when Stripe gave none. */
    invoice_url: z.union([httpsUrl, z.literal("")]),
  })
  .strict();
export type BillingPaymentFailedPayload = z.infer<
  typeof billingPaymentFailedPayloadSchema
>;

export const billingAccessEndedPayloadSchema = z
  .object({
    ended_on: isoDate,
    reason: z.literal("payment_failed"),
  })
  .strict();
export type BillingAccessEndedPayload = z.infer<
  typeof billingAccessEndedPayloadSchema
>;

/** "$59.99" from Stripe's minor units. Two-decimal currencies only (Lyceon bills in USD). */
export function formatAmount(
  amountMinor: number,
  currencyCode: string,
): string {
  const major = (amountMinor / 100).toFixed(2);
  return currencyCode.toLowerCase() === "usd"
    ? `$${major}`
    : `${major} ${currencyCode.toUpperCase()}`;
}
