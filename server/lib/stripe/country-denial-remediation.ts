/**
 * What we DO about a country denial — as opposed to what the country rule
 * DECIDES, which is `country-eligibility.ts` and is not touched here.
 *
 * @spec [INV-03-08 (Doc 03 §2156); SCL-046; SCL-048 as amended by SCL-072
 *        (full-vs-partial refund on the CHARGED amount); Doc-01_V8 §22 Stripe
 *        webhook handling] | @implemented [2026-09-01 — SCL-DRAFT-B-denial-is-a-decision]
 *
 * plain English: when the Tier-1 gate refuses a payer who has already been
 * charged, cancel the subscription, refund the charge in full, write no
 * entitlement, and let the webhook SETTLE. Expected outcome: the money goes
 * back, no further invoice is generated, and Stripe stops redelivering.
 *
 * THE DEFECT THIS EXISTS TO FIX. A denial used to be thrown as a
 * `StripePayloadShapeError`, which the route turns into a 500, which Stripe
 * retries — forever. Money captured, no entitlement, no terminal state, and a
 * permanently failing webhook endpoint. The root shape is not the country
 * check: it is that A LEGITIMATE DECISION WAS BEING RENDERED AS AN ERROR. A
 * denial is a decision. Decisions settle; errors retry.
 *
 * ------------------------------------------------------------------------
 * INELIGIBLE AND UNKNOWN DO NOT GET THE SAME TREATMENT.
 * ------------------------------------------------------------------------
 * `evaluateCountryEligibility` already refuses to collapse these two, and this
 * module must not re-collapse them one layer down:
 *
 *   ineligible  a fact about the USER. We know their country and it is not on
 *               the Tier-1 list. There is no configuration change that makes
 *               this purchase valid, so the terminal state is: cancel, refund,
 *               grant nothing.
 *   unknown     a fact about OUR RECORDS or OUR CONFIGURATION — the completed
 *               session carried no country, or `tier_1_countries` is unseeded.
 *               Auto-refunding on this verdict would, the moment the config row
 *               is missing, cancel and refund EVERY paying customer at once
 *               while believing it was enforcing a policy. So `unknown` HOLDS:
 *               no entitlement (unchanged, fail closed), no cancel, no refund,
 *               settle the event, and alert an operator to decide.
 *
 * Both stop the retry loop, which is the defect. Only one moves money. This is
 * the Charter's "fail closed, but distinguish absence from ambiguity" applied
 * to the remediation rather than only to the verdict.
 *
 * ------------------------------------------------------------------------
 * WHY CANCEL BEFORE REFUND, AND WHY WITH NO CANCELLATION DATE.
 * ------------------------------------------------------------------------
 * Cancel first so no further invoice can be generated while the refund is in
 * flight. If the refund then fails, the customer is at least not billed again;
 * if the order were reversed and the cancel failed, we would have refunded a
 * live subscription that goes on charging. The ordering is asserted by
 * INVOCATION ORDER in the contract suite, not by mere occurrence.
 *
 * `subscriptions.cancel(id, {})` — empty params, deliberately. Note what the
 * pinned SDK actually offers: `SubscriptionCancelParams`
 * (`node_modules/stripe/types/SubscriptionsResource.d.ts:2054-2074`) has
 * `cancellation_details`, `expand`, `invoice_now` and `prorate` and NO
 * cancellation-date field at all — a future cancellation date is
 * `subscriptions.update({ cancel_at })`, a different call on a different verb.
 *
 * A brief in circulation attributes to Stripe the sentence "If you set a custom
 * cancellation date, you can't provide a refund." THAT SENTENCE IS NOT IN THE
 * PINNED SDK — `grep -rn -i "custom cancellation date" node_modules/stripe/types/`
 * returns nothing, and neither does a search for "provide a refund". It may
 * well be true on docs.stripe.com, which is not reachable from this
 * environment. It is therefore NOT cited as SDK evidence. Immediate
 * cancellation is chosen on the safe side regardless: it is what stops the next
 * invoice, which is the reason we cancel at all.
 *
 * ------------------------------------------------------------------------
 * DOES CANCELLING REFUND ANYTHING BY ITSELF? EVIDENCE, AND ITS STRENGTH.
 * ------------------------------------------------------------------------
 * Three facts from the pinned SDK (stripe@20.4.1), strongest first:
 *
 *  1. `grep -n -i "refund" node_modules/stripe/types/SubscriptionsResource.d.ts`
 *     returns ZERO matches. Not "the cancel docblock is silent" — the ENTIRE
 *     subscriptions resource, every method and every param type, never mentions
 *     a refund.
 *  2. `RefundsResource.d.ts:120` — "When you create a new refund, you must
 *     specify a Charge or a PaymentIntent object on which to create it." A
 *     refund is only ever produced by naming its subject; there is no verb by
 *     which cancelling a subscription could name one.
 *  3. `SubscriptionsResource.d.ts:2263-2267` describes what cancel DOES do:
 *     stop future charges, leave pending invoice items, and stop automatic
 *     collection of finalized invoices. Returning money is absent from that
 *     list.
 *
 * (1) and (2) together are a STRUCTURAL argument — the API offers no path — and
 * that is materially stronger than (3), which is only an argument from silence.
 * It is still not a positive statement by Stripe that cancellation issues no
 * refund, and it is not presented as one. It is why the refund is issued
 * explicitly here instead of being assumed to follow from the cancel.
 */
import { z } from "zod";
import { decideRefundRevocation } from "./refund";

/**
 * A country denial, raised as its own class so the checkout path can catch
 * EXACTLY this and nothing else.
 *
 * NOT a subclass of `StripePayloadShapeError`. The payload shape is fine — a
 * French billing address is a perfectly well-formed one. Calling this a shape
 * failure would report an integration defect that is not there, and a
 * `catch (e instanceof StripePayloadShapeError)` around the fulfilment call
 * would then swallow genuine parse failures into a refund. That is the
 * collapse-an-error-into-a-legitimate-value pattern this handler refuses
 * everywhere else; a distinct class is what keeps the catch honest.
 */
export class CountryDenialError extends Error {
  readonly verdict: "ineligible" | "unknown";
  readonly country: string | null;

  constructor(
    eventType: string,
    verdict: "ineligible" | "unknown",
    country: string | null,
    detail: string,
  ) {
    super(
      `Stripe ${eventType}: billing country is not Tier-1 eligible ` +
        `(verdict=${verdict}); ${detail}`,
    );
    this.name = "CountryDenialError";
    this.verdict = verdict;
    this.country = country;
  }
}

/**
 * What a denial verdict warrants once the money has already moved.
 *
 * Pure, total over the two denying verdicts, and separated from the IO so the
 * ineligible-vs-unknown asymmetry can be tested without a Stripe client.
 */
export type RemediationPlan =
  | { readonly action: "cancel_and_refund"; readonly reason: string }
  | { readonly action: "hold_for_operator"; readonly reason: string };

export function planForDenial(
  verdict: "ineligible" | "unknown",
): RemediationPlan {
  if (verdict === "ineligible") {
    return {
      action: "cancel_and_refund",
      reason:
        "the billing country is known and is not on the Tier-1 list; no " +
        "configuration change makes this purchase valid, so the terminal " +
        "state is cancelled and refunded (INV-03-08)",
    };
  }
  return {
    action: "hold_for_operator",
    reason:
      "the country could not be established — the completed session carried " +
      "none, or `tier_1_countries` is unseeded. That is a fact about our " +
      "records or our configuration, not about the payer. Entitlement is " +
      "still refused (fail closed), but money is NOT moved automatically: an " +
      "unseeded config would otherwise cancel and refund every paying " +
      "customer at once. An operator decides.",
  };
}

/** Statuses in which a subscription is already terminal and must not be cancelled again. */
export const TERMINAL_SUBSCRIPTION_STATUSES = [
  "canceled",
  "incomplete_expired",
] as const;

export type CancellationStep =
  | { readonly cancel: true; readonly reason: string }
  | { readonly cancel: false; readonly reason: string };

/**
 * Should the subscription be cancelled, given the status Stripe reports NOW?
 *
 * THIS IS THE DURABLE IDEMPOTENCY GUARD FOR THE CANCEL, and it carries the
 * whole weight — unlike the refund, the cancel gets no help from a Stripe
 * idempotency key. `subscriptions.cancel` is routed as an HTTP DELETE
 * (`node_modules/stripe/esm/resources/Subscriptions.js:19-22`), and Stripe
 * honours idempotency keys on POST; a key passed here would be decoration that
 * READS like protection, which is worse than none. Re-reading the status is the
 * protection.
 *
 * Cancelling twice is not merely wasteful: `SubscriptionsResource.d.ts:2263`
 * — "After it's canceled, you can no longer update the subscription or its
 * metadata" — so a second attempt is an API error, and an API error on a replay
 * is how the retry loop this module removes would grow back.
 */
export function decideCancellation(
  status: string | null | undefined,
): CancellationStep {
  if (!status) {
    return {
      cancel: false,
      reason:
        "the retrieved subscription carries no status; refusing to act on a " +
        "subscription whose state we could not read",
    };
  }
  if ((TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    return {
      cancel: false,
      reason: `subscription is already \`${status}\`; nothing further to cancel (replay-safe)`,
    };
  }
  return {
    cancel: true,
    reason: `subscription is \`${status}\`; cancelling immediately so no further invoice is generated`,
  };
}

export type RefundStep =
  | { readonly refund: true; readonly reason: string }
  | { readonly refund: false; readonly reason: string };

/**
 * Should the charge be refunded, given what has ALREADY been refunded on it?
 *
 * Same comparison basis as SCL-048/SCL-072: the CHARGED amount and the charge's
 * cumulative `amount_refunded`, never a list price. Deliberately the same two
 * numbers `decideRefundRevocation` reads, so the money question has one basis
 * across this vertical rather than two that can drift.
 *
 * `RefundsResource.d.ts:128-130`: "Once entirely refunded, a charge can't be
 * refunded again. This method will raise an error when called on an
 * already-refunded charge" — so the replay case is an API error, not a
 * harmless no-op, and it has to be decided BEFORE the call.
 */
export function decideRemedialRefund(
  chargeAmount: number,
  chargeAmountRefunded: number,
): RefundStep {
  if (chargeAmount <= 0) {
    return {
      refund: false,
      reason:
        `charge amount is ${chargeAmount}; there is nothing to return. Not ` +
        "treated as 'already refunded' — no money moved in either direction",
    };
  }
  if (chargeAmountRefunded >= chargeAmount) {
    return {
      refund: false,
      reason:
        `already fully refunded: ${chargeAmountRefunded} of ${chargeAmount} ` +
        "charged. This is the replay path; refunding again would raise a " +
        "Stripe error (RefundsResource.d.ts:128-130)",
    };
  }
  return {
    refund: true,
    reason:
      `refunding the full charged amount: ${chargeAmountRefunded} of ` +
      `${chargeAmount} returned so far`,
  };
}

/**
 * Did the refund we just issued actually read as FULL?
 *
 * The refund is full by construction — `refunds.create` is called with no
 * `amount`, and `RefundsResource.d.ts:125` offers partial refunds as the
 * OPTIONAL case ("You can optionally refund only part of a charge"). But
 * "by construction" is an argument, and this vertical does not accept arguments
 * where it can have a check: a partial refund would leave the customer out of
 * pocket AND, under SCL-048, would not have revoked anything either.
 *
 * The check reuses `decideRefundRevocation` rather than restating the rule.
 * That function is the canonical answer to "is this charge fully refunded"; a
 * second predicate here would be a second rule to keep in step with SCL-072.
 */
export function refundReadsAsFull(
  chargeAmount: number,
  projectedAmountRefunded: number,
): boolean {
  return decideRefundRevocation(
    "succeeded",
    chargeAmount,
    projectedAmountRefunded,
  ).revoke;
}

/**
 * The Stripe idempotency key for the remedial refund.
 *
 * KEYED ON THE SUBSCRIPTION, NOT THE EVENT. Keying on the event id would
 * protect nothing the webhook gate does not already protect — a redelivery of
 * the SAME event id never reaches dispatch. The case that needs a key is two
 * DIFFERENT events describing one purchase: `checkout.session.completed` and
 * `checkout.session.async_payment_succeeded` both carry the same session and
 * both run the same gate. Keyed on the subscription, the second call returns
 * Stripe's first refund instead of creating a second.
 *
 * The key is the first line only. Stripe expires idempotency keys after a
 * bounded window, so `decideRemedialRefund`'s `amount_refunded` pre-check is
 * the durable guard behind it. Two mechanisms, because they fail differently:
 * the key covers a race, the pre-check covers a late redelivery.
 */
export function refundIdempotencyKey(subscriptionId: string): string {
  return `inv-03-08-country-denial-refund:${subscriptionId}`;
}

/**
 * The subscription fields the remediation reads. Narrow on purpose: this path
 * writes no entitlement, so it needs the state to decide on and the invoice to
 * walk to the payment — nothing else.
 */
export const remediationSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  latest_invoice: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
});

/**
 * The InvoicePayment fields that carry the forward hop invoice -> PaymentIntent.
 *
 * This is the SAME provenance chain the refund and dispute paths already walk,
 * traversed forwards. Backwards (a charge in hand, looking for its
 * subscription) it is `invoicePayments.list({ payment: { payment_intent } })`;
 * forwards (a subscription in hand, looking for its charge) it is
 * `invoicePayments.list({ invoice })` —
 * `node_modules/stripe/types/InvoicePaymentsResource.d.ts:24-27`. One chain,
 * one set of hops, so a change to the API version breaks both visibly rather
 * than one silently.
 */
export const remediationInvoicePaymentListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        payment: z.object({
          type: z.string(),
          payment_intent: z
            .union([z.string().min(1), z.object({ id: z.string().min(1) })])
            .nullish(),
        }),
      }),
    )
    .default([]),
});

/**
 * The Refund fields the remediation reads back after creating one.
 *
 * PARSED, NOT CAST, for the same reason every other Stripe response in this
 * vertical is: `amount` is the number the partial-refund guard divides its
 * verdict on, and a TYPE is a claim about the response where a SCHEMA is a
 * check on it. Reading `amount` off an unparsed object and defaulting a missing
 * value to 0 would make an unreadable response look like a partial refund
 * without ever saying so.
 */
export const remediationRefundSchema = z.object({
  id: z.string().min(1),
  amount: z.number(),
});

/**
 * The PaymentIntent fields the remediation reads.
 *
 * `latest_charge` (`node_modules/stripe/types/PaymentIntents.d.ts:140`) rather
 * than `charges.list({ payment_intent })`: a PaymentIntent can accumulate
 * failed attempts, and the list would make us choose among them. `latest_charge`
 * names the one charge that succeeded, so there is nothing to choose.
 */
export const remediationPaymentIntentSchema = z.object({
  id: z.string().min(1),
  latest_charge: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
});
