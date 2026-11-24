/**
 * What cancelling a subscription does — decided purely, from Stripe's own facts.
 *
 * @spec [SCL-271 (cancellation at every status, never gated on a balance;
 *        `past_due` ends billing now and holds access to the grace deadline;
 *        "access never ends earlier than doing nothing would"); SCL-272
 *        (payer-only, our endpoint is the single self-service path); Doc-01_V8
 *        §21 status table `:950-959`, §23 dunning `:1013-1019`; owner rulings
 *        Karl 2026-11-03] | @implemented [2026-11-03]
 *
 * plain English: given a subscription's status and dates, say what cancelling it
 * would do and the exact moment premium access would end. Expected outcome: the
 * confirmation screen, the final screen and the email all read one number that
 * this function computed, so they cannot disagree with each other or with what
 * the server actually asked Stripe to do. Trade-offs and edge cases below.
 *
 * NO IO, DELIBERATELY. Every input is a value the caller has already read from
 * Stripe. That is what makes the whole decision table testable without a Stripe
 * double, and it is why the branch cannot drift from the thing the route does:
 * the route has no second opinion to offer.
 *
 * WHY `past_due` IS NOT "CANCEL IMMEDIATELY". The owner's first cut of the
 * ruling ended premium at cancellation; it was amended on 2026-11-03, before
 * any code was written, because a `past_due` student is inside a window where
 * DOING NOTHING keeps their access — so ending it on cancellation would punish
 * them for using a button the platform is making frictionless. Billing still
 * ends at once (every open invoice voided, collection paused), which is the half
 * the customer asked for; access runs to the deadline that was already fixed.
 *
 * edge cases:
 *   - THE DEADLINE CAN ALREADY HAVE PASSED. A subscription that has sat
 *     `past_due` for longer than the grace window has no future moment to hold
 *     access to, and Stripe rejects a `cancel_at` in the past. That case
 *     degrades to `immediate` rather than throwing, and is reported as such.
 *   - A `past_due` SUBSCRIPTION WITH NO OPEN INVOICE has no anchor — its
 *     invoices were already voided or marked uncollectible by hand. There is
 *     nothing to measure the grace from, so it also degrades to `immediate`.
 *   - `unpaid`, `incomplete` and `incomplete_expired` all carry NO access
 *     today: `entitlement_active` grants `active`, `past_due` and `trialing`
 *     only (`20260616120000_entitlement_active_include_trialing.sql`, the last
 *     migration to define it). So `accessEndsAt` is null for them — not "now" —
 *     because there is no access left to end, and the copy says so.
 *   - AN UNRECOGNISED STATUS REFUSES. Stripe may add one, and both wrong
 *     guesses are harmful: cancelling immediately could destroy access a
 *     customer paid for, and cancelling at period end could leave billing
 *     running on something we told them was stopped. `unsupported` fails closed
 *     and the route surfaces it.
 */

/**
 * The `past_due` grace window, in days. ONE DEFINITION — owner ruling 2026-11-03,
 * "define the 7 as a named constant in one place, not inline."
 *
 * It matches the default Doc-01_V8 §21 `:954` and §23 `:1015` both name as
 * `entitlement_runtime_config.grace_period_days_past_due`. It is a constant here
 * and NOT a config read, deliberately and by the same ruling: that config key
 * exists in no migration and no TypeScript, `entitlements.grace_period_ends_at`
 * has no writer, and `entitlement_active` enforces no deadline at all — so Doc
 * 01's grace model is unimplemented, and reading a key that is not there would
 * fail closed on every cancellation. Implementing the general grace model is
 * explicitly out of scope for this change and is tracked separately; this
 * constant is the whole of the grace behaviour here.
 */
export const PAST_DUE_GRACE_DAYS = 7;

const SECONDS_PER_DAY = 86_400;

/** Statuses that are in good standing and cancel at the end of the paid period. */
const GOOD_STANDING: readonly string[] = ["active", "trialing"];

/**
 * Statuses that carry no premium access, so cancelling costs the customer
 * nothing to lose. `entitlement_active` grants none of them.
 */
const NO_ACCESS: readonly string[] = [
  "unpaid",
  "incomplete",
  "incomplete_expired",
];

export type CancellationPlan =
  /** Good standing: `cancel_at_period_end`, access to the end of the paid period. */
  | { readonly kind: "at_period_end"; readonly accessEndsAt: string | null }
  /**
   * `past_due`: void the open invoices, pause collection, and schedule the
   * cancellation for the grace deadline. Billing ends now; access ends then.
   */
  | {
      readonly kind: "past_due_scheduled";
      readonly accessEndsAt: string;
      readonly cancelAtEpoch: number;
    }
  /** Nothing to preserve: void the open invoices and cancel now. */
  | {
      readonly kind: "immediate";
      readonly accessEndsAt: string | null;
      /** Set when this is a `past_due` whose grace window has already elapsed. */
      readonly graceAlreadyElapsed?: true;
    }
  /** Already stopping. No second Stripe call, no second email. */
  | {
      readonly kind: "already_scheduled";
      readonly accessEndsAt: string | null;
    }
  | { readonly kind: "already_canceled"; readonly accessEndsAt: null }
  /** Fails closed on a status this function has never been taught. */
  | { readonly kind: "unsupported"; readonly status: string };

export type CancellationInput = {
  readonly status: string;
  readonly cancelAtPeriodEnd: boolean;
  /** Stripe's `cancel_at`, seconds since epoch, or null. */
  readonly cancelAtEpoch: number | null;
  /**
   * The subscription ITEM's `current_period_end`, seconds since epoch. Item
   * level, not subscription level: that is where the webhook reads the period
   * from, and a guardian subscription's items are what carry it.
   */
  readonly currentPeriodEndEpoch: number | null;
  /**
   * `status_transitions.finalized_at` of the EARLIEST still-open invoice on this
   * subscription — the moment payment first became due and was not made. The
   * anchor for the grace window, by owner ruling 2026-11-03.
   */
  readonly earliestUnpaidInvoiceFinalizedAtEpoch: number | null;
  /** Injected so the decision table is deterministic under test. */
  readonly nowEpoch: number;
};

/** The grace deadline for a `past_due` subscription, seconds since epoch. */
export function pastDueGraceDeadlineEpoch(
  earliestUnpaidInvoiceFinalizedAtEpoch: number,
): number {
  return (
    earliestUnpaidInvoiceFinalizedAtEpoch +
    PAST_DUE_GRACE_DAYS * SECONDS_PER_DAY
  );
}

function iso(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

export function decideCancellation(input: CancellationInput): CancellationPlan {
  // ORDER MATTERS. "Already stopping" is checked before status, because a
  // subscription can be `active` AND already set to cancel — answering
  // `at_period_end` there would re-send the flag, emit a second
  // `customer.subscription.updated`, and send a second email for one decision.
  if (input.status === "canceled") {
    return { kind: "already_canceled", accessEndsAt: null };
  }
  if (input.cancelAtPeriodEnd || input.cancelAtEpoch !== null) {
    return {
      kind: "already_scheduled",
      accessEndsAt: iso(input.cancelAtEpoch ?? input.currentPeriodEndEpoch),
    };
  }

  if (GOOD_STANDING.includes(input.status)) {
    return {
      kind: "at_period_end",
      accessEndsAt: iso(input.currentPeriodEndEpoch),
    };
  }

  if (input.status === "past_due") {
    const anchor = input.earliestUnpaidInvoiceFinalizedAtEpoch;
    if (anchor === null) {
      // No open invoice to measure from. Nothing is owed either, so there is
      // nothing to void and no deadline to honour.
      return { kind: "immediate", accessEndsAt: null };
    }
    const deadline = pastDueGraceDeadlineEpoch(anchor);
    if (deadline <= input.nowEpoch) {
      return {
        kind: "immediate",
        accessEndsAt: null,
        graceAlreadyElapsed: true,
      };
    }
    // `iso` cannot return null here — `deadline` is a number — but the type
    // does not know that, so it is narrowed rather than asserted.
    const accessEndsAt = iso(deadline);
    if (accessEndsAt === null) {
      return { kind: "immediate", accessEndsAt: null };
    }
    return {
      kind: "past_due_scheduled",
      accessEndsAt,
      cancelAtEpoch: deadline,
    };
  }

  if (NO_ACCESS.includes(input.status)) {
    // Null, not `now`: these statuses grant nothing, so there is no access left
    // to end and no date to promise.
    return { kind: "immediate", accessEndsAt: null };
  }

  return { kind: "unsupported", status: input.status };
}

/** Whether a plan means the caller changed nothing. */
export function isAlreadyStopping(plan: CancellationPlan): boolean {
  return plan.kind === "already_scheduled" || plan.kind === "already_canceled";
}
