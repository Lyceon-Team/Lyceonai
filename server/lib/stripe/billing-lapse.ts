/**
 * The billing lapse flow: warn before the first charge, a fixed grace after a failed one, and a
 * cancel when the grace runs out. Account and progress are always kept.
 *
 * @spec [Doc 01 §21 (`past_due`: Premium for grace_period_days_past_due, default 7, then free),
 *       §22.1 (`invoice.payment_failed` → past_due grace), §23 (Smart Retries during the grace;
 *       the day 0/3/6/8 emails; grace expiry → free); owner brief "Founding lapse flow" (Karl,
 *       2026-11-24) and rulings 1-8; SCL-289] | @implemented [2026-11-24]
 *
 * plain English, in three parts:
 *   1. CARD NEEDED. Once a day the job looks at every subscription that renews in the next two
 *      weeks, asks Stripe whether it has a default payment method, and warns the payer of one that
 *      has none and whose upcoming invoice is over $0 (ruling 3) at 14, 7 and 2 days out
 *      (`lyceon.billing_card_needed`). The amount is Stripe's preview of that invoice (ruling 4).
 *      A subscription already set to cancel at period end is skipped (ruling 8).
 *   2. PAYMENT FAILED. `invoice.payment_failed` sets `entitlements.grace_period_ends_at` to now +
 *      7 days, ONLY when it is empty, and emails attempts 1-3 (`lyceon.billing_payment_failed`,
 *      ruling 6). The deadline is ours and is authoritative: `entitlement_active` stops counting
 *      `past_due` at it (migration 20261211000000), whatever Stripe's retries are doing.
 *      `invoice.payment_succeeded`, and `customer.subscription.updated` reporting the subscription
 *      active again, clear it (ruling 1).
 *   3. ACCESS ENDED. When the deadline has passed and the subscription is still past_due, the job
 *      cancels it in Stripe and sends `lyceon.billing_access_ended`; when Stripe itself cancels
 *      for non-payment (`cancellation_details.reason = payment_failed`), the webhook sends it.
 *      Never on a self-cancel (ruling 5): that already has its own confirmation email.
 *   A past_due row with no deadline yet (from before this flow, ruling 2) keeps Pro until the job
 *   sets the deadline to its earliest unpaid invoice + 7 days.
 *
 * EVERY EMAIL ONCE. `billing_lapse_notices` is claimed before a send and released if the send
 * fails, so a rerun or a redelivered webhook never sends twice and a failed send is retried.
 * An under-13 payer is skipped (ruling 7) and the claim is kept, so they are counted once.
 *
 * Privacy: logs carry digested subscription ids and counts, never an address, a name or an amount.
 */
import { z } from "zod";
import type Stripe from "stripe";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  BILLING_ACCESS_ENDED_EVENT,
  BILLING_CARD_NEEDED_EVENT,
  BILLING_PAYMENT_FAILED_EVENT,
  CARD_NEEDED_MILESTONES,
  billingAccessEndedPayloadSchema,
  billingCardNeededPayloadSchema,
  billingPaymentFailedPayloadSchema,
  formatAmount,
  type BillingLapseNotice,
  type CardNeededMilestone,
} from "../../../packages/shared/src/billing-lapse-schema";
import { PAST_DUE_GRACE_DAYS } from "./cancellation";
import { getStripeClient } from "./client";
import {
  defaultLifecycleDeps,
  sendBillingEvent,
  type BillingEventOutcome,
} from "../lifecycle-email";
import { siteUrlFromEnv } from "../notifications/templates/index";
import { digestId } from "./redact";
import { logger } from "../../logger";

const DAY_MS = 86_400_000;
const COMPONENT = "BILLING_LAPSE";
/** How far ahead the job looks for renewals: the largest milestone plus a day. */
const LOOKAHEAD_DAYS = CARD_NEEDED_MILESTONES[0] + 1;
/** The comment Lyceon puts on a cancel it makes at the grace deadline. */
export const GRACE_DEADLINE_CANCEL_COMMENT =
  "Lyceon: grace period ended unpaid";

// ── Stripe, as this flow reads it ──────────────────────────────────────────────────────────

/** A subscription reduced to the facts this flow decides on. */
export type LapseSubscription = {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  /** A card (or other method) Stripe would charge: on the subscription or the customer. */
  hasDefaultPaymentMethod: boolean;
  /** When the next invoice is made: the earliest item period end, epoch seconds. */
  nextInvoiceAt: number | null;
};

export type BillingLapseStripe = {
  retrieveSubscription: (id: string) => Promise<LapseSubscription>;
  /** Stripe's preview of the next invoice: what will actually be charged. */
  previewNextInvoice: (
    subscriptionId: string,
  ) => Promise<{ amountDue: number; currency: string }>;
  /** The finalization time of the oldest open invoice, epoch seconds, or null if none is open. */
  earliestUnpaidInvoiceFinalizedAt: (
    subscriptionId: string,
  ) => Promise<number | null>;
  cancelSubscription: (subscriptionId: string) => Promise<void>;
};

export type BillingLapseDeps = {
  stripe: BillingLapseStripe;
  send: (
    payerProfileId: string,
    event: string,
    payload: Record<string, string>,
  ) => Promise<BillingEventOutcome>;
  now: () => Date;
  /** The public site, no trailing slash. Empty means links cannot be built: nothing is sent. */
  siteUrl: string;
};

const paymentMethodRef = z
  .union([z.string(), z.object({ id: z.string() })])
  .nullish();

const stripeSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  cancel_at_period_end: z.boolean().nullish(),
  default_payment_method: paymentMethodRef,
  default_source: paymentMethodRef,
  customer: z.union([
    z.string(),
    z.object({
      invoice_settings: z
        .object({ default_payment_method: paymentMethodRef })
        .nullish(),
      default_source: paymentMethodRef,
    }),
  ]),
  items: z.object({
    data: z.array(z.object({ current_period_end: z.number().nullish() })),
  }),
});

const previewSchema = z.object({
  amount_due: z.number().int(),
  currency: z.string().min(3),
});

const openInvoicesSchema = z.object({
  data: z.array(
    z.object({
      status_transitions: z
        .object({ finalized_at: z.number().nullish() })
        .nullish(),
      created: z.number(),
    }),
  ),
});

/** Parse what Stripe returned into the facts this flow uses. Exported for tests. */
export function toLapseSubscription(raw: unknown): LapseSubscription {
  const s = stripeSubscriptionSchema.parse(raw);
  const customer = typeof s.customer === "string" ? null : s.customer;
  const hasDefaultPaymentMethod = Boolean(
    s.default_payment_method ||
    s.default_source ||
    customer?.invoice_settings?.default_payment_method ||
    customer?.default_source,
  );
  const ends = s.items.data
    .map((i) => i.current_period_end)
    .filter((v): v is number => typeof v === "number");
  return {
    id: s.id,
    status: s.status,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    hasDefaultPaymentMethod,
    nextInvoiceAt: ends.length > 0 ? Math.min(...ends) : null,
  };
}

export function stripeLapseAdapter(stripe: Stripe): BillingLapseStripe {
  return {
    async retrieveSubscription(id) {
      return toLapseSubscription(
        await stripe.subscriptions.retrieve(id, { expand: ["customer"] }),
      );
    },
    async previewNextInvoice(subscriptionId) {
      const p = previewSchema.parse(
        await stripe.invoices.createPreview({ subscription: subscriptionId }),
      );
      return { amountDue: p.amount_due, currency: p.currency };
    },
    async earliestUnpaidInvoiceFinalizedAt(subscriptionId) {
      const list = openInvoicesSchema.parse(
        await stripe.invoices.list({
          subscription: subscriptionId,
          status: "open",
          limit: 100,
        }),
      );
      const times = list.data.map(
        (i) => i.status_transitions?.finalized_at ?? i.created,
      );
      return times.length > 0 ? Math.min(...times) : null;
    },
    async cancelSubscription(subscriptionId) {
      await stripe.subscriptions.cancel(subscriptionId, {
        cancellation_details: { comment: GRACE_DEADLINE_CANCEL_COMMENT },
      });
    },
  };
}

export function defaultBillingLapseDeps(): BillingLapseDeps {
  const lifecycle = defaultLifecycleDeps();
  return {
    stripe: stripeLapseAdapter(getStripeClient()),
    send: (payer, event, payload) =>
      sendBillingEvent(payer, event, payload, lifecycle),
    now: () => new Date(),
    siteUrl: siteUrlFromEnv(),
  };
}

// ── Our own state ──────────────────────────────────────────────────────────────────────────

type SubscriptionRow = {
  profile_id: string;
  payer_profile_id: string | null;
  status: string;
  grace_period_ends_at: string | null;
};

async function rowsForSubscription(
  subscriptionId: string,
): Promise<SubscriptionRow[]> {
  const { data, error } = await supabaseServer
    .from("entitlements")
    .select("profile_id, payer_profile_id, status, grace_period_ends_at")
    .eq("stripe_subscription_id", subscriptionId)
    .order("profile_id", { ascending: true });
  if (error) {
    throw new Error(
      `billing lapse: entitlements read failed: ${error.message}`,
    );
  }
  return (data ?? []) as SubscriptionRow[];
}

/** Who is charged: the payer recorded on the row, or the student when they pay themselves. */
function payerOf(rows: SubscriptionRow[]): string | null {
  const first = rows[0];
  return first ? (first.payer_profile_id ?? first.profile_id) : null;
}

async function addCardUrl(
  siteUrl: string,
  payerProfileId: string,
): Promise<string> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("role")
    .eq("id", payerProfileId)
    .maybeSingle();
  if (error) {
    throw new Error(`billing lapse: payer role read failed: ${error.message}`);
  }
  const role = (data as { role?: string } | null)?.role;
  // Both are signed-in pages with "Manage billing", which opens the Stripe portal where a card is
  // added. A portal session URL itself cannot be emailed: it needs a session and expires.
  return role === "guardian"
    ? `${siteUrl}/guardian/students`
    : `${siteUrl}/profile?tab=billing`;
}

/** Sets the deadline only where none is set; returns the deadline now in force. */
async function setGraceIfEmpty(
  subscriptionId: string,
  deadline: Date,
): Promise<string | null> {
  const { error } = await supabaseServer
    .from("entitlements")
    .update({ grace_period_ends_at: deadline.toISOString() })
    .eq("stripe_subscription_id", subscriptionId)
    .is("grace_period_ends_at", null);
  if (error) {
    throw new Error(`billing lapse: grace write failed: ${error.message}`);
  }
  const rows = await rowsForSubscription(subscriptionId);
  const set = rows
    .map((r) => r.grace_period_ends_at)
    .filter((v): v is string => v !== null)
    .sort();
  return set[0] ?? null;
}

export async function clearGrace(subscriptionId: string): Promise<void> {
  const { error } = await supabaseServer
    .from("entitlements")
    .update({ grace_period_ends_at: null })
    .eq("stripe_subscription_id", subscriptionId)
    .not("grace_period_ends_at", "is", null);
  if (error) {
    throw new Error(`billing lapse: grace clear failed: ${error.message}`);
  }
}

/**
 * SCL-289 ruling 1: a subscription Stripe reports `active` or `trialing` is no longer in a grace
 * period, so the deadline is cleared on the same write. Any other status leaves it untouched.
 */
export function graceClearedWhenGoodStanding(stripeStatus: string): {
  grace_period_ends_at?: null;
} {
  return stripeStatus === "active" || stripeStatus === "trialing"
    ? { grace_period_ends_at: null }
    : {};
}

const UNIQUE_VIOLATION = "23505";

/** True when this call took the claim; false when the notice was already claimed. */
async function claim(
  subscriptionId: string,
  notice: BillingLapseNotice,
  ref: string,
): Promise<boolean> {
  const { error } = await supabaseServer
    .from("billing_lapse_notices")
    .insert({ stripe_subscription_id: subscriptionId, notice, ref });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`billing lapse: claim failed: ${error.message}`);
}

async function settle(
  subscriptionId: string,
  notice: BillingLapseNotice,
  ref: string,
  outcome: BillingEventOutcome,
  now: Date,
): Promise<void> {
  const keyed = supabaseServer.from("billing_lapse_notices");
  if (outcome.kind === "failed") {
    // Released, so the next run (or Stripe's redelivery) tries again.
    const { error } = await keyed
      .delete()
      .eq("stripe_subscription_id", subscriptionId)
      .eq("notice", notice)
      .eq("ref", ref);
    if (error) {
      throw new Error(`billing lapse: release failed: ${error.message}`);
    }
    return;
  }
  if (outcome.kind === "sent") {
    const { error } = await keyed
      .update({ sent_at: now.toISOString() })
      .eq("stripe_subscription_id", subscriptionId)
      .eq("notice", notice)
      .eq("ref", ref);
    if (error) {
      throw new Error(`billing lapse: mark sent failed: ${error.message}`);
    }
  }
  // Skipped (an under-13 payer, a deleted account): the claim stays, so it is not retried.
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Whole UTC days from `now` to `at`: the date difference, not a 24-hour count. */
export function daysUntil(atEpochSeconds: number, now: Date): number {
  const at = new Date(atEpochSeconds * 1000);
  const a = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / DAY_MS);
}

/** The milestone whose band holds `daysLeft`: 8..14 → 14, 3..7 → 7, 1..2 → 2, else none. */
export function milestoneFor(daysLeft: number): CardNeededMilestone | null {
  if (daysLeft > 7 && daysLeft <= 14) return 14;
  if (daysLeft > 2 && daysLeft <= 7) return 7;
  if (daysLeft >= 1 && daysLeft <= 2) return 2;
  return null;
}

// ── Webhook side ───────────────────────────────────────────────────────────────────────────

export type LapseInvoice = {
  id: string;
  subscriptionId: string | null;
  attemptCount: number;
  amountDue: number;
  currency: string;
  hostedInvoiceUrl: string | null;
};

const invoiceEventSchema = z.object({
  id: z.string().min(1),
  attempt_count: z.number().int().nonnegative().nullish(),
  amount_due: z.number().int(),
  currency: z.string().min(3),
  hosted_invoice_url: z.string().nullish(),
  parent: z
    .object({
      subscription_details: z
        .object({
          subscription: z
            .union([z.string(), z.object({ id: z.string() })])
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

/** An Invoice event object, parsed. The subscription id sits under `parent` since API 2025-03-31. */
export function toLapseInvoice(raw: unknown): LapseInvoice {
  const i = invoiceEventSchema.parse(raw);
  const sub = i.parent?.subscription_details?.subscription;
  return {
    id: i.id,
    subscriptionId: sub == null ? null : typeof sub === "string" ? sub : sub.id,
    attemptCount: i.attempt_count ?? 0,
    amountDue: i.amount_due,
    currency: i.currency,
    hostedInvoiceUrl: i.hosted_invoice_url ?? null,
  };
}

export type PaymentFailedResult =
  | "not_a_subscription_invoice"
  | "unknown_subscription"
  | "no_site_url"
  | "beyond_third_attempt"
  | "already_sent"
  | BillingEventOutcome["kind"];

/**
 * `invoice.payment_failed`: the deadline once, then the attempt's email. Throws only on a failure
 * a retry can fix (a database or send failure), so Stripe's redelivery tries again; the deadline
 * write and the claim are both safe to repeat.
 */
export async function handleInvoicePaymentFailed(
  invoice: LapseInvoice,
  deps: BillingLapseDeps,
): Promise<PaymentFailedResult> {
  if (!invoice.subscriptionId) return "not_a_subscription_invoice";
  const subscriptionId = invoice.subscriptionId;
  const rows = await rowsForSubscription(subscriptionId);
  const payer = payerOf(rows);
  if (!payer) return "unknown_subscription";

  const now = deps.now();
  const deadline = new Date(now.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
  const inForce =
    (await setGraceIfEmpty(subscriptionId, deadline)) ?? deadline.toISOString();

  const attempt = invoice.attemptCount;
  if (attempt < 1 || attempt > 3) return "beyond_third_attempt";
  if (!deps.siteUrl) return "no_site_url";

  const notice = `payment_failed_${attempt}` as BillingLapseNotice;
  if (!(await claim(subscriptionId, notice, invoice.id))) return "already_sent";
  const payload = billingPaymentFailedPayloadSchema.parse({
    attempt: String(attempt),
    grace_ends_on: inForce.slice(0, 10),
    amount: formatAmount(invoice.amountDue, invoice.currency),
    currency: invoice.currency.toLowerCase(),
    add_card_url: await addCardUrl(deps.siteUrl, payer),
    invoice_url: invoice.hostedInvoiceUrl ?? "",
  });
  const outcome = await deps.send(payer, BILLING_PAYMENT_FAILED_EVENT, payload);
  await settle(subscriptionId, notice, invoice.id, outcome, now);
  logger.info(COMPONENT, "payment_failed", "Payment failure handled", {
    subscriptionRef: digestId(subscriptionId),
    attempt,
    outcome: outcome.kind,
  });
  if (outcome.kind === "failed") {
    throw new Error("billing lapse: payment_failed event was not accepted");
  }
  return outcome.kind;
}

/** `invoice.payment_succeeded`: the grace is over (ruling 1). */
export async function handleInvoicePaymentSucceeded(
  invoice: LapseInvoice,
): Promise<void> {
  if (invoice.subscriptionId) await clearGrace(invoice.subscriptionId);
}

/** `customer.subscription.deleted`: the cancel's cause, as Stripe recorded it. */
const deletedSubscriptionSchema = z.object({
  id: z.string().min(1),
  cancellation_details: z
    .object({
      reason: z.string().nullish(),
      comment: z.string().nullish(),
    })
    .nullish(),
});

/**
 * Stripe cancelled the subscription. Only a cancel caused by non-payment ends in the access-ended
 * email (ruling 5): Stripe's own cancel after its retries (`reason: payment_failed`), or ours at
 * the grace deadline (already sent by the job, so the claim makes this a no-op).
 */
export async function handleSubscriptionDeletedForLapse(
  raw: unknown,
  getDeps: () => BillingLapseDeps,
): Promise<"not_payment" | AccessEndedResult> {
  const s = deletedSubscriptionSchema.parse(raw);
  const byPayment =
    s.cancellation_details?.reason === "payment_failed" ||
    s.cancellation_details?.comment === GRACE_DEADLINE_CANCEL_COMMENT;
  // A self-cancel (and every other cancel) stops here, before any client is built.
  if (!byPayment) return "not_payment";
  const deps = getDeps();
  return fireAccessEnded(s.id, deps.now(), deps);
}

export type AccessEndedResult =
  | "unknown_subscription"
  | "already_sent"
  | BillingEventOutcome;

async function fireAccessEnded(
  subscriptionId: string,
  endedAt: Date,
  deps: BillingLapseDeps,
): Promise<AccessEndedResult> {
  const rows = await rowsForSubscription(subscriptionId);
  const payer = payerOf(rows);
  if (!payer) return "unknown_subscription";
  if (!(await claim(subscriptionId, "access_ended", subscriptionId))) {
    return "already_sent";
  }
  const payload = billingAccessEndedPayloadSchema.parse({
    ended_on: isoDay(endedAt),
    reason: "payment_failed",
  });
  const outcome = await deps.send(payer, BILLING_ACCESS_ENDED_EVENT, payload);
  await settle(
    subscriptionId,
    "access_ended",
    subscriptionId,
    outcome,
    deps.now(),
  );
  return outcome;
}

// ── The daily job ──────────────────────────────────────────────────────────────────────────

export type BillingLapseJobSummary = {
  ok: boolean;
  cardNeeded: {
    considered: number;
    sent: number;
    alreadySent: number;
    hasCard: number;
    cancelAtPeriodEnd: number;
    zeroAmount: number;
    notInBand: number;
    skippedUnder13: number;
    skippedOther: number;
    failed: number;
  };
  graceBackfilled: number;
  deadlineCancelled: number;
  accessEnded: { sent: number; skippedUnder13: number; failed: number };
  errors: number;
};

const CANDIDATE_COLUMNS =
  "stripe_subscription_id, status, grace_period_ends_at";

type CandidateRow = {
  stripe_subscription_id: string;
  status: string;
  grace_period_ends_at: string | null;
};

/** Distinct subscription ids from a candidate query's result. */
function subscriptionIds(result: {
  data: unknown;
  error: { message: string } | null;
}): string[] {
  const { data, error } = result;
  if (error) {
    throw new Error(`billing lapse: candidate read failed: ${error.message}`);
  }
  const ids = new Set(
    ((data ?? []) as CandidateRow[]).map((r) => r.stripe_subscription_id),
  );
  return [...ids].sort();
}

/**
 * Once a day. Each subscription is handled on its own: one Stripe or send failure is counted and
 * logged, and the rest still run. `ok` is false when any did fail, so the cron run shows red.
 */
export async function runBillingLapseJob(
  deps: BillingLapseDeps,
): Promise<BillingLapseJobSummary> {
  const now = deps.now();
  const summary: BillingLapseJobSummary = {
    ok: true,
    cardNeeded: {
      considered: 0,
      sent: 0,
      alreadySent: 0,
      hasCard: 0,
      cancelAtPeriodEnd: 0,
      zeroAmount: 0,
      notInBand: 0,
      skippedUnder13: 0,
      skippedOther: 0,
      failed: 0,
    },
    graceBackfilled: 0,
    deadlineCancelled: 0,
    accessEnded: { sent: 0, skippedUnder13: 0, failed: 0 },
    errors: 0,
  };
  const fail = (step: string, subscriptionId: string, err: unknown): void => {
    summary.errors += 1;
    summary.ok = false;
    logger.error(COMPONENT, step, "Billing lapse step failed", undefined, {
      subscriptionRef: digestId(subscriptionId),
      reason: err instanceof Error ? err.message : "unknown",
    });
  };
  if (!deps.siteUrl) {
    logger.error(
      COMPONENT,
      "no_site_url",
      "PUBLIC_SITE_URL is not set; no lapse email can carry a link",
    );
    return { ...summary, ok: false, errors: 1 };
  }

  // 1. Card needed: renewing within the lookahead, in good standing, not already stopping.
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS);
  const renewing = subscriptionIds(
    await supabaseServer
      .from("entitlements")
      .select(CANDIDATE_COLUMNS)
      .in("status", ["active", "trialing"])
      .not("stripe_subscription_id", "is", null)
      .eq("cancel_at_period_end", false)
      .gte("current_period_end", now.toISOString())
      .lte("current_period_end", horizon.toISOString()),
  );
  for (const subscriptionId of renewing) {
    summary.cardNeeded.considered += 1;
    try {
      const sub = await deps.stripe.retrieveSubscription(subscriptionId);
      if (sub.cancelAtPeriodEnd) {
        summary.cardNeeded.cancelAtPeriodEnd += 1;
        continue;
      }
      if (sub.hasDefaultPaymentMethod) {
        summary.cardNeeded.hasCard += 1;
        continue;
      }
      if (
        (sub.status !== "active" && sub.status !== "trialing") ||
        sub.nextInvoiceAt === null
      ) {
        summary.cardNeeded.notInBand += 1;
        continue;
      }
      const daysLeft = daysUntil(sub.nextInvoiceAt, now);
      const milestone = milestoneFor(daysLeft);
      if (milestone === null) {
        summary.cardNeeded.notInBand += 1;
        continue;
      }
      const preview = await deps.stripe.previewNextInvoice(subscriptionId);
      if (preview.amountDue <= 0) {
        summary.cardNeeded.zeroAmount += 1;
        continue;
      }
      const rows = await rowsForSubscription(subscriptionId);
      const payer = payerOf(rows);
      if (!payer) {
        summary.cardNeeded.skippedOther += 1;
        continue;
      }
      const invoiceDate = isoDay(new Date(sub.nextInvoiceAt * 1000));
      const notice = `card_needed_${milestone}` as BillingLapseNotice;
      if (!(await claim(subscriptionId, notice, invoiceDate))) {
        summary.cardNeeded.alreadySent += 1;
        continue;
      }
      const payload = billingCardNeededPayloadSchema.parse({
        days_left: String(daysLeft),
        invoice_date: invoiceDate,
        amount: formatAmount(preview.amountDue, preview.currency),
        currency: preview.currency.toLowerCase(),
        add_card_url: await addCardUrl(deps.siteUrl, payer),
      });
      const outcome = await deps.send(
        payer,
        BILLING_CARD_NEEDED_EVENT,
        payload,
      );
      await settle(subscriptionId, notice, invoiceDate, outcome, now);
      if (outcome.kind === "sent") summary.cardNeeded.sent += 1;
      else if (outcome.kind === "failed") {
        summary.cardNeeded.failed += 1;
        summary.ok = false;
      } else if (outcome.reason === "under_13") {
        summary.cardNeeded.skippedUnder13 += 1;
      } else summary.cardNeeded.skippedOther += 1;
    } catch (err) {
      fail("card_needed", subscriptionId, err);
    }
  }

  // 2. A past_due row with no deadline (from before this flow): earliest unpaid invoice + 7 days.
  const undated = subscriptionIds(
    await supabaseServer
      .from("entitlements")
      .select(CANDIDATE_COLUMNS)
      .eq("status", "past_due")
      .not("stripe_subscription_id", "is", null)
      .is("grace_period_ends_at", null),
  );
  for (const subscriptionId of undated) {
    try {
      const finalized =
        await deps.stripe.earliestUnpaidInvoiceFinalizedAt(subscriptionId);
      const from = finalized === null ? now : new Date(finalized * 1000);
      await setGraceIfEmpty(
        subscriptionId,
        new Date(from.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS),
      );
      summary.graceBackfilled += 1;
    } catch (err) {
      fail("grace_backfill", subscriptionId, err);
    }
  }

  // 3. The deadline has passed and the invoice is still unpaid: cancel, then tell the payer.
  const expired = subscriptionIds(
    await supabaseServer
      .from("entitlements")
      .select(CANDIDATE_COLUMNS)
      .eq("status", "past_due")
      .not("stripe_subscription_id", "is", null)
      .lte("grace_period_ends_at", now.toISOString()),
  );
  for (const subscriptionId of expired) {
    try {
      const sub = await deps.stripe.retrieveSubscription(subscriptionId);
      if (sub.status !== "canceled") {
        await deps.stripe.cancelSubscription(subscriptionId);
        summary.deadlineCancelled += 1;
      }
      const result = await fireAccessEnded(subscriptionId, now, deps);
      if (typeof result !== "string") {
        if (result.kind === "sent") summary.accessEnded.sent += 1;
        else if (result.kind === "failed") {
          summary.accessEnded.failed += 1;
          summary.ok = false;
        } else if (result.reason === "under_13") {
          summary.accessEnded.skippedUnder13 += 1;
        }
      }
    } catch (err) {
      fail("deadline_cancel", subscriptionId, err);
    }
  }

  logger.info(COMPONENT, "job_done", "Billing lapse job finished", {
    ok: summary.ok,
    cardNeeded: summary.cardNeeded,
    graceBackfilled: summary.graceBackfilled,
    deadlineCancelled: summary.deadlineCancelled,
    accessEnded: summary.accessEnded,
    errors: summary.errors,
  });
  return summary;
}
