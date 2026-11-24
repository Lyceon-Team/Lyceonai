/**
 * The Stripe side of cancelling — and the ONLY place cancellation talks to Stripe.
 *
 * @spec [SCL-271 (`past_due` voids every open invoice and holds access to the
 *        grace deadline; nothing is retried and nothing is owed); SCL-272
 *        (one self-service path); Doc-01_V8 §21; owner rulings Karl 2026-11-03]
 * | @implemented [2026-11-03]
 *
 * plain English: carry out the plan `decideCancellation` chose. Expected outcome:
 * for a subscription in good standing, Stripe is told to stop at the end of the
 * paid period; for one that is `past_due`, collection is paused so no further
 * invoice is ever collected, the cancellation is scheduled for the grace
 * deadline, and every open invoice is voided so the balance is cleared.
 *
 * WRITES NO ENTITLEMENT, BY DESIGN. Every function here talks to Stripe and
 * nothing else. `entitlements` has exactly one writer —
 * `server/lib/stripe/webhook-handler.ts` — and owner ruling 2026-11-03 keeps it
 * that way: the webhook mirrors whatever Stripe ends up holding. A second writer
 * here would be the OPTIMISTIC one, and a row saying access ends on a date
 * Stripe was never told is a promise we cannot keep.
 *
 * `stripe` IS INJECTED on every function, following `guardian-subscriptions.ts`
 * and `renewal-cancellation.ts`. The tests assert the exact calls made, which is
 * the only way to prove "no second action" on a replay — a module reaching for
 * its own client could be tested on the row that followed but never on the call.
 *
 * WHY THE SCHEDULE IS WRITTEN BEFORE THE INVOICES ARE VOIDED, which is the one
 * ordering decision in this file. Both steps can fail independently, so the
 * question is which loss hurts less:
 *   - Lose the UPDATE: the subscription stays `past_due` with its invoices
 *     voided. A retry then finds no open invoice, so there is no anchor, and the
 *     plan degrades to `immediate` — ending a student's access TODAY when doing
 *     nothing would have kept it. That is the one outcome owner ruling
 *     2026-11-03 exists to forbid.
 *   - Lose the VOIDS: the subscription is correctly scheduled and collection is
 *     paused with `behavior: 'void'`, so Stripe never auto-collects and nothing
 *     is retried. A finalized open invoice remains manually payable, which is a
 *     stale balance nobody is chased for — visible, recoverable, and strictly
 *     less harmful than cutting access early.
 * So the update goes first. A failed void is logged at error and reported in
 * `openInvoicesRemaining` rather than swallowed, because the one thing worse
 * than a stale balance is a stale balance nobody knows about.
 *
 * IDEMPOTENCY IS TWO LAYERS. Every Stripe call carries a key derived from
 * durable state (the subscription or invoice id), which Stripe honours for 24
 * hours, so a double-submit inside that window collapses to one object. And the
 * decision itself reads Stripe first: a replay after the window sees `cancel_at`
 * already set and answers `already_scheduled`, which performs nothing at all.
 */
import type Stripe from "stripe";
import { logger } from "../../logger";
import { digestId } from "./redact";
import { setCancelAtPeriodEnd } from "./renewal-cancellation";
import type { CancellationPlan } from "./cancellation";

/** One page is ample: a subscription with more than 100 open invoices is an incident. */
const OPEN_INVOICE_PAGE_SIZE = 100;

/** Deterministic, so a double-submit collapses at Stripe rather than in our code. */
export function cancellationIdempotencyKey(subscriptionId: string): string {
  return `subscription-cancel:${subscriptionId}`;
}

export function invoiceVoidIdempotencyKey(invoiceId: string): string {
  return `invoice-void:${invoiceId}`;
}

export function cancellationUndoIdempotencyKey(subscriptionId: string): string {
  // Distinct from the cancel key on purpose. Sharing one would make an undo
  // inside the 24-hour window return Stripe's CACHED cancel response and change
  // nothing, which would read to the customer as a silently ignored undo.
  return `subscription-cancel-undo:${subscriptionId}`;
}

/**
 * Every still-open invoice on one subscription, oldest first.
 *
 * `status: "open"` is the finalized-but-unpaid set. `draft` is deliberately not
 * included: a draft carries no balance, and cancelling leaves it in draft.
 */
export async function listOpenInvoices(
  stripe: Stripe,
  subscriptionId: string,
): Promise<readonly Stripe.Invoice[]> {
  const page = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "open",
    limit: OPEN_INVOICE_PAGE_SIZE,
  });
  return [...page.data].sort(
    (a, b) =>
      (a.status_transitions?.finalized_at ?? a.created) -
      (b.status_transitions?.finalized_at ?? b.created),
  );
}

/**
 * The grace anchor: when payment first became due and was not made.
 *
 * `finalized_at` is the moment Stripe made the invoice payable. `created` is the
 * fallback for an invoice with no recorded transition, which should not happen
 * on a finalized invoice and is not worth throwing over.
 */
export function earliestUnpaidFinalizedAtEpoch(
  openInvoices: readonly Stripe.Invoice[],
): number | null {
  const first = openInvoices[0];
  if (first === undefined) return null;
  return first.status_transitions?.finalized_at ?? first.created;
}

export type VoidOutcome = {
  readonly voided: number;
  readonly remaining: number;
};

/**
 * Void every open invoice on the subscription.
 *
 * ALL of them, not `latest_invoice`. Cancelling a subscription only sets
 * `auto_advance = false` on its open and draft invoices, which pauses automatic
 * collection and leaves each one payable with its balance standing — so the
 * customer is still shown money owed on a subscription they cancelled. Stripe's
 * own guidance is to void them, and to void all rather than only the latest.
 */
export async function voidAllOpenInvoices(
  stripe: Stripe,
  subscriptionId: string,
  options: { readonly requestId?: string } = {},
): Promise<VoidOutcome> {
  const open = await listOpenInvoices(stripe, subscriptionId);
  let voided = 0;

  for (const invoice of open) {
    if (invoice.id === undefined) continue;
    try {
      await stripe.invoices.voidInvoice(
        invoice.id,
        {},
        { idempotencyKey: invoiceVoidIdempotencyKey(invoice.id) },
      );
      voided += 1;
    } catch (err: unknown) {
      // Never thrown onward: the schedule is already in place and collection is
      // paused, so a failed void is a stale balance rather than a live charge.
      // Logged with ids only — no amounts, no customer, no email.
      logger.error(
        "BILLING",
        "cancel_invoice_void_failed",
        "Failed to void an open invoice while cancelling",
        {
          requestId: options.requestId,
          subscriptionRef: digestId(subscriptionId),
          invoiceRef: digestId(invoice.id),
          message: err instanceof Error ? err.message : "Unknown error",
        },
      );
    }
  }

  return { voided, remaining: open.length - voided };
}

export type CancellationExecution =
  | {
      readonly kind: "applied";
      readonly voided: number;
      readonly openInvoicesRemaining: number;
    }
  /** Nothing was sent: the subscription was already stopping. */
  | { readonly kind: "noop" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Carry out a plan. Returns rather than throws, so the route can answer the
 * customer something true either way.
 */
export async function applyCancellation(
  stripe: Stripe,
  subscriptionId: string,
  plan: CancellationPlan,
  options: { readonly requestId?: string } = {},
): Promise<CancellationExecution> {
  try {
    switch (plan.kind) {
      case "already_scheduled":
      case "already_canceled":
        // Owner ruling 2026-11-03: return the current state, with no second
        // action. No Stripe call, and the caller sends no second email.
        return { kind: "noop" };

      case "at_period_end": {
        // The canonical writer, reused rather than reimplemented: it reads
        // Stripe first, so a repeat is a real no-op instead of a second
        // `customer.subscription.updated`, and it never writes our column.
        const outcome = await setCancelAtPeriodEnd(subscriptionId, true, {
          stripe,
          ...(options.requestId === undefined
            ? {}
            : { requestId: options.requestId }),
        });
        if (outcome.kind === "failed") {
          return { kind: "failed", reason: outcome.reason };
        }
        // No invoice is voided here. The customer keeps the period they have
        // paid for, so its invoice is theirs to pay.
        return { kind: "applied", voided: 0, openInvoicesRemaining: 0 };
      }

      case "past_due_scheduled": {
        // ONE update carries both halves, so there is no window in which
        // collection is paused but the cancellation is unscheduled.
        await stripe.subscriptions.update(
          subscriptionId,
          {
            pause_collection: { behavior: "void" },
            cancel_at: plan.cancelAtEpoch,
          },
          { idempotencyKey: cancellationIdempotencyKey(subscriptionId) },
        );
        const voids = await voidAllOpenInvoices(
          stripe,
          subscriptionId,
          options,
        );
        return {
          kind: "applied",
          voided: voids.voided,
          openInvoicesRemaining: voids.remaining,
        };
      }

      case "immediate": {
        const voids = await voidAllOpenInvoices(
          stripe,
          subscriptionId,
          options,
        );
        await stripe.subscriptions.cancel(
          subscriptionId,
          { prorate: false, invoice_now: false },
          { idempotencyKey: cancellationIdempotencyKey(subscriptionId) },
        );
        return {
          kind: "applied",
          voided: voids.voided,
          openInvoicesRemaining: voids.remaining,
        };
      }

      case "unsupported":
        return {
          kind: "failed",
          reason: `unsupported subscription status: ${plan.status}`,
        };
    }
  } catch (err: unknown) {
    return {
      kind: "failed",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export type UndoExecution =
  | { readonly kind: "restored" }
  /** Nothing was scheduled, so nothing was undone. Not an error. */
  | { readonly kind: "nothing_scheduled" }
  /** Terminal: a cancelled subscription cannot be revived, only replaced. */
  | { readonly kind: "too_late" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Undo a cancellation that has not yet taken effect.
 *
 * WHAT AN UNDO DOES NOT DO: it cannot un-void an invoice. A `past_due`
 * cancellation cleared the balance, and restoring the subscription restores
 * FUTURE billing only — the voided invoices stay void. That is the right way
 * round: the customer is put back on the plan without being re-billed for the
 * period they had already stopped paying for, and Stripe invoices them again at
 * the next cycle.
 */
export async function undoScheduledCancellation(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  options: { readonly requestId?: string } = {},
): Promise<UndoExecution> {
  if (subscription.status === "canceled") return { kind: "too_late" };

  const scheduledAtPeriodEnd = subscription.cancel_at_period_end === true;
  const scheduledAt = subscription.cancel_at;

  if (!scheduledAtPeriodEnd && scheduledAt === null) {
    return { kind: "nothing_scheduled" };
  }

  try {
    if (scheduledAtPeriodEnd && scheduledAt === null) {
      // Clearing is the same function as setting, deliberately — see
      // `renewal-cancellation.ts`: the undo has to go through the same
      // read-then-write so it cannot fight with the set.
      const outcome = await setCancelAtPeriodEnd(subscription.id, false, {
        stripe,
        ...(options.requestId === undefined
          ? {}
          : { requestId: options.requestId }),
      });
      if (outcome.kind === "failed") {
        return { kind: "failed", reason: outcome.reason };
      }
      return { kind: "restored" };
    }

    // The `past_due` shape: clear the schedule AND resume collection. Leaving
    // collection paused would restore a subscription that could never bill.
    await stripe.subscriptions.update(
      subscription.id,
      {
        cancel_at: null,
        cancel_at_period_end: false,
        pause_collection: null,
      },
      { idempotencyKey: cancellationUndoIdempotencyKey(subscription.id) },
    );
    return { kind: "restored" };
  } catch (err: unknown) {
    return {
      kind: "failed",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
