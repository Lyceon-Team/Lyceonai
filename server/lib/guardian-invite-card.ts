/**
 * Card on file for a guardian invite: save a card for a plan, charge it when the teen joins.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 3 (card on file, charged when the teen
 *        claims; no seat; no charge without an active link; the guardian never holds an
 *        entitlement; Checkout `mode: "setup"` on the guardian's own Customer; the subscription
 *        created server-side `off_session` on the saved payment method, with today's metadata,
 *        idempotency key the invite id; the entitlement still written by the existing webhook
 *        path), 9 (Billing Terms v4 §2.1); SCL-286; Doc 01 V8 §20 "Who pays";
 *        supabase/migrations/20261207000000_guardian_invite_card.sql] | @implemented [2026-11-22]
 *
 * plain English: three steps, each owned by one caller.
 *   1. `createGuardianInviteCardSession` (route): a guardian with no active link opens Stripe's
 *      card page for one of their open invites and a plan, having ticked the Billing Terms box.
 *   2. `recordGuardianInviteCardFromSetupSession` (webhook): the completed setup session's
 *      payment method and plan are stored on the invite. Domain outcomes settle; a Stripe or
 *      database failure is thrown so Stripe retries (a lost card would otherwise be silent).
 *   3. `chargeGuardianInviteOnClaim` (the /join claim, after the link transaction committed):
 *      the ONE claim that wins `begin_guardian_invite_charge_audited` (which requires the
 *      invite claimed by this student and its link ACTIVE) creates the subscription
 *      off-session. Never throws: the teen's claim has already succeeded and stands.
 *
 * Nothing here writes an entitlement. The subscription carries today's guardian metadata, so
 * `customer.subscription.created` reaches `writeEntitlementsForAllItems` exactly as a Checkout
 * purchase does, with its country gate and its active-link check (Charter §6).
 *
 * Edge cases, each with its own outcome: a declined card or a bank asking to confirm
 * (`payment_failed`, the link stands, the guardian is emailed a link to today's checkout for
 * this student); a teen already covered (`already_funded`, no charge, the guardian is told);
 * an ineligible billing country or an incomplete view of the guardian's subscriptions
 * (`not_charged`, no charge, the guardian is pointed to today's checkout, which decides again);
 * a Stripe or database failure mid-charge (`release`: back to card_saved, and the same
 * idempotency key is used on the next attempt, so no second subscription can result).
 * Nothing logs a payment method id, an address or a card detail.
 */
import type Stripe from "stripe";
import { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  getPriceId,
  getStripeClient,
  type BillingPeriod,
} from "./stripe/client";
import {
  getProfileStripeCustomerId,
  setProfileStripeCustomerId,
} from "./account";
import { aSubscriptionAlreadyFundsStudent } from "./stripe/guardian-checkout";
import { listGuardianFundingSubscriptions } from "./stripe/guardian-subscriptions";
import { evaluateSubjectPurchaseEligibility } from "./stripe/purchase-eligibility";
import {
  evaluateCountryEligibility,
  resolveBillingCountry,
} from "./stripe/country-eligibility";
import { getTier1Countries } from "./entitlement-runtime-config";
import { digestId } from "./stripe/redact";
import {
  sendGuardianInviteAlreadyFundedEmail,
  sendGuardianInviteChargedEmail,
  sendGuardianInviteChargeFailedEmail,
} from "./notifications/direct-sends";
import { logger } from "../logger";

/** The metadata purpose a setup session carries, so the webhook knows it is ours. */
const GUARDIAN_INVITE_CARD_PURPOSE = "guardian_invite_card";

/** The Stripe idempotency key for the one charge an invite may make: the invite id. */
function guardianInviteChargeIdempotencyKey(inviteId: string): string {
  return `guardian-invite-charge:${inviteId}`;
}

function rpcFailure(
  op: string,
  error: { code?: string; message?: string },
): Error {
  return new Error(
    `guardian invite card ${op} failed: ${error.code ?? "unknown"} ${error.message ?? ""}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// 1. The setup session
// ---------------------------------------------------------------------------

const setSessionResultSchema = z
  .object({
    outcome: z.enum([
      "recorded",
      "not_found",
      "has_active_link",
      "card_in_use",
    ]),
  })
  .strict();
type SetSessionOutcome = z.infer<
  typeof setSessionResultSchema
>["outcome"];

type CreateCardSessionResult =
  | { ok: true; url: string }
  | { ok: false; outcome: Exclude<SetSessionOutcome, "recorded"> };

/**
 * Open Stripe's hosted card page (Checkout `mode: "setup"`) on the guardian's own Customer, and
 * record it as the invite's current session. Ownership, the open invite and the no-active-link
 * rule are decided by the SQL function; a refusal there leaves the unused session to expire.
 */
export async function createGuardianInviteCardSession(input: {
  guardianProfileId: string;
  guardianEmail: string | undefined;
  inviteId: string;
  plan: BillingPeriod;
  siteUrl: string;
  requestId?: string;
}): Promise<CreateCardSessionResult> {
  const stripe = getStripeClient();
  const priceId = getPriceId(input.plan);
  // Setup mode needs a currency once payment methods are chosen dynamically; it is the plan's
  // own, so the card is saved for the currency it will be charged in.
  const price = await stripe.prices.retrieve(priceId);

  let customerId = await getProfileStripeCustomerId(input.guardianProfileId);
  if (!customerId) {
    // The same Customer today's guardian checkout creates (SCL-044: the payer's email, never a
    // student's), so a later checkout for the same guardian reuses it.
    const customer = await stripe.customers.create({
      ...(input.guardianEmail ? { email: input.guardianEmail } : {}),
      metadata: {
        payer_profile_id: input.guardianProfileId,
        payer_relationship: "guardian",
      },
    });
    customerId = customer.id;
    await setProfileStripeCustomerId(input.guardianProfileId, customerId);
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      customer: customerId,
      currency: price.currency,
      // The billing address goes onto the Customer: the country gate at the grant reads it
      // there (see the same parameter on today's checkout in billing-routes.ts).
      customer_update: { address: "auto" },
      billing_address_collection: "required",
      success_url: `${input.siteUrl}/guardian?card=saved`,
      cancel_url: `${input.siteUrl}/guardian?card=cancel`,
      metadata: {
        purpose: GUARDIAN_INVITE_CARD_PURPOSE,
        invite_id: input.inviteId,
        payer_profile_id: input.guardianProfileId,
        payer_relationship: "guardian",
        plan: input.plan,
      },
    },
    // A double click inside the same minute opens the same page, not two.
    {
      idempotencyKey: `guardian-invite-card-session:${input.inviteId}:${input.plan}:${Math.floor(Date.now() / 60_000)}`,
    },
  );
  if (!session.url) throw new Error("setup session has no url");

  const { data, error } = await supabaseServer.rpc(
    "set_guardian_invite_setup_session_audited",
    {
      p_guardian_id: input.guardianProfileId,
      p_invite_id: input.inviteId,
      p_session_id: session.id,
      p_plan: input.plan,
      p_request_id: input.requestId ?? null,
    },
  );
  if (error) throw rpcFailure("set_session", error);
  const result = setSessionResultSchema.parse(data);
  if (result.outcome !== "recorded") {
    return { ok: false, outcome: result.outcome };
  }
  return { ok: true, url: session.url };
}

// ---------------------------------------------------------------------------
// 2. The webhook: a completed setup session
// ---------------------------------------------------------------------------

const setupMetadataSchema = z
  .object({
    purpose: z.literal(GUARDIAN_INVITE_CARD_PURPOSE),
    invite_id: z.string().uuid(),
    payer_profile_id: z.string().uuid(),
    plan: z.enum(["monthly", "quarterly", "yearly"]),
  })
  .passthrough();

const setupIntentSchema = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    payment_method: z
      .union([z.string().min(1), z.object({ id: z.string().min(1) })])
      .nullable(),
  })
  .passthrough();

const recordCardResultSchema = z
  .object({
    outcome: z.enum([
      "recorded",
      "already_recorded",
      "not_found",
      "stale_session",
      "invite_closed",
      "card_in_use",
    ]),
  })
  .strict();

type SetupSessionOutcome =
  | z.infer<typeof recordCardResultSchema>["outcome"]
  | "not_ours"
  | "setup_not_succeeded";

/**
 * A completed `mode: "setup"` Checkout Session. Writes no entitlement and creates no
 * subscription. Returns the outcome; it throws only for a failure a retry can fix (Stripe or
 * the database unreachable), never for a decision.
 */
export async function recordGuardianInviteCardFromSetupSession(input: {
  sessionId: string;
  setupIntent: string | { id: string } | null | undefined;
  metadata: Record<string, unknown> | null | undefined;
  eventId: string;
}): Promise<SetupSessionOutcome> {
  const meta = setupMetadataSchema.safeParse(input.metadata ?? {});
  if (!meta.success) {
    // A setup session that is not an invite card (none exists today) is acknowledged.
    logger.info(
      "GUARDIAN_INVITE_CARD",
      "setup_session",
      "Setup session is not an invite card; nothing recorded",
      { eventId: input.eventId, sessionRef: digestId(input.sessionId) },
    );
    return "not_ours";
  }

  const setupIntentId =
    typeof input.setupIntent === "string"
      ? input.setupIntent
      : input.setupIntent?.id;
  if (!setupIntentId) {
    logger.error(
      "GUARDIAN_INVITE_CARD",
      "setup_session",
      "Completed setup session carries no SetupIntent; no card recorded",
      { eventId: input.eventId, sessionRef: digestId(input.sessionId) },
    );
    return "setup_not_succeeded";
  }

  const intent = setupIntentSchema.parse(
    await getStripeClient().setupIntents.retrieve(setupIntentId),
  );
  const paymentMethodId =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : intent.payment_method?.id;
  if (intent.status !== "succeeded" || !paymentMethodId) {
    logger.warn(
      "GUARDIAN_INVITE_CARD",
      "setup_session",
      "SetupIntent did not succeed; no card recorded",
      {
        eventId: input.eventId,
        sessionRef: digestId(input.sessionId),
        setupStatus: intent.status,
      },
    );
    return "setup_not_succeeded";
  }

  const { data, error } = await supabaseServer.rpc(
    "record_guardian_invite_card_audited",
    {
      p_invite_id: meta.data.invite_id,
      p_guardian_id: meta.data.payer_profile_id,
      p_session_id: input.sessionId,
      p_payment_method_id: paymentMethodId,
      p_plan: meta.data.plan,
      p_request_id: input.eventId,
    },
  );
  if (error) throw rpcFailure("record_card", error);
  const outcome = recordCardResultSchema.parse(data).outcome;
  logger.info(
    "GUARDIAN_INVITE_CARD",
    "setup_session",
    outcome === "recorded"
      ? "Card saved on the invite"
      : "Card not recorded on the invite; the payment method stays on the Customer, unused",
    {
      eventId: input.eventId,
      inviteId: meta.data.invite_id,
      outcome,
      plan: meta.data.plan,
    },
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// 3. The charge, when the teen joins
// ---------------------------------------------------------------------------

const beginResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("begin"),
      guardian_profile_id: z.string().uuid(),
      plan: z.enum(["monthly", "quarterly", "yearly"]),
      payment_method_id: z.string().min(1),
    })
    .strict(),
  z.object({ outcome: z.literal("no_card") }).strict(),
  z.object({ outcome: z.literal("not_claimed") }).strict(),
  z.object({ outcome: z.literal("no_active_link") }).strict(),
]);

type ChargeOutcome =
  | "no_card"
  | "not_claimed"
  | "no_active_link"
  | "charged"
  | "payment_failed"
  | "already_funded"
  | "not_charged"
  | "released";

type FinishOutcome =
  | "charged"
  | "payment_failed"
  | "already_funded"
  | "not_charged"
  | "release";

async function finishCharge(input: {
  inviteId: string;
  outcome: FinishOutcome;
  subscriptionId?: string;
  code?: string;
  requestId: string | undefined;
}): Promise<void> {
  const { error } = await supabaseServer.rpc(
    "finish_guardian_invite_charge_audited",
    {
      p_invite_id: input.inviteId,
      p_outcome: input.outcome,
      p_subscription_id: input.subscriptionId ?? null,
      p_failure_code: input.code ?? null,
      p_request_id: input.requestId ?? null,
    },
  );
  if (error) throw rpcFailure("finish", error);
}

/** A Stripe failure that is the card's, not ours: a decline, or the bank asking to confirm. */
function paymentFailureCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { type?: unknown; statusCode?: unknown; code?: unknown };
  const isCardFailure = e.type === "StripeCardError" || e.statusCode === 402;
  if (!isCardFailure) return null;
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : "payment_failed";
}

/**
 * The guardian's address for a direct send, or null. Never throws: the emails are best-effort
 * and must never turn a recorded charge outcome into a failure.
 */
async function guardianEmail(guardianId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer
      .from("profiles")
      .select("email")
      .eq("id", guardianId)
      .maybeSingle();
    if (error) throw rpcFailure("guardian_email", error);
    const parsed = z.object({ email: z.string().min(3) }).safeParse(data);
    return parsed.success ? parsed.data.email : null;
  } catch (err: unknown) {
    logger.warn(
      "GUARDIAN_INVITE_CARD",
      "email",
      "Could not read the guardian's address; email not sent",
      {
        guardianProfileId: guardianId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

type GuardianMail = "charged" | "payment_failed" | "already_funded";

/** One of the three emails, to the guardian, best-effort. */
async function emailGuardian(
  kind: GuardianMail,
  input: {
    inviteId: string;
    guardianId: string;
    studentProfileId: string;
    requestId: string | undefined;
  },
): Promise<void> {
  const email = await guardianEmail(input.guardianId);
  if (email === null) return;
  const common = {
    inviteId: input.inviteId,
    email,
    recipientProfileId: input.guardianId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
  if (kind === "charged") await sendGuardianInviteChargedEmail(common);
  else if (kind === "already_funded")
    await sendGuardianInviteAlreadyFundedEmail(common);
  else
    await sendGuardianInviteChargeFailedEmail({
      ...common,
      studentProfileId: input.studentProfileId,
    });
}

/**
 * Charge the card saved on this invite, once, now that `studentProfileId` has claimed it.
 * Called after the claim's transaction has committed. Never throws: every failure is logged,
 * and the teen's claim stands whatever happens here.
 */
export async function chargeGuardianInviteOnClaim(input: {
  inviteId: string;
  studentProfileId: string;
  requestId?: string;
}): Promise<ChargeOutcome> {
  const { inviteId, studentProfileId, requestId } = input;
  let begun: z.infer<typeof beginResultSchema>;
  try {
    const { data, error } = await supabaseServer.rpc(
      "begin_guardian_invite_charge_audited",
      {
        p_invite_id: inviteId,
        p_student_id: studentProfileId,
        p_request_id: requestId ?? null,
      },
    );
    if (error) throw rpcFailure("begin", error);
    begun = beginResultSchema.parse(data);
  } catch (err: unknown) {
    logger.error(
      "GUARDIAN_INVITE_CARD",
      "charge",
      "Could not start the invite charge; nothing was charged",
      {
        inviteId,
        requestId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return "no_card";
  }
  if (begun.outcome !== "begin") return begun.outcome;

  const guardianId = begun.guardian_profile_id;
  const plan = begun.plan;
  try {
    return await chargeBegun({
      inviteId,
      studentProfileId,
      guardianId,
      plan,
      paymentMethodId: begun.payment_method_id,
      requestId,
    });
  } catch (err: unknown) {
    // A failure that is not the card's: Stripe or the database. Release the invite so the next
    // claim attempt tries again under the SAME idempotency key: if Stripe did create the
    // subscription, it returns that one rather than a second.
    logger.error(
      "GUARDIAN_INVITE_CARD",
      "charge",
      "Invite charge interrupted; released for a retry under the same idempotency key",
      {
        inviteId,
        requestId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    try {
      await finishCharge({ inviteId, outcome: "release", requestId });
    } catch (releaseErr: unknown) {
      logger.error(
        "GUARDIAN_INVITE_CARD",
        "charge",
        "Could not release the invite charge; it stays 'charging' and needs operator review",
        {
          inviteId,
          requestId,
          error: releaseErr instanceof Error ? releaseErr.message : "unknown",
        },
      );
    }
    return "released";
  }
}

async function chargeBegun(input: {
  inviteId: string;
  studentProfileId: string;
  guardianId: string;
  plan: BillingPeriod;
  paymentMethodId: string;
  requestId: string | undefined;
}): Promise<ChargeOutcome> {
  const { inviteId, studentProfileId, guardianId, plan, requestId } = input;
  const stripe = getStripeClient();
  const customerId = await getProfileStripeCustomerId(guardianId);
  if (!customerId) {
    // The card was saved on this Customer; without it there is nothing to charge.
    await finishCharge({
      inviteId,
      outcome: "not_charged",
      code: "no_customer",
      requestId,
    });
    await notifyNotCharged({
      inviteId,
      guardianId,
      studentProfileId,
      requestId,
    });
    return "not_charged";
  }

  // Already covered? Our row first, then Stripe itself (the pre-webhook window), exactly the two
  // questions today's checkout asks before it charges.
  const eligibility =
    await evaluateSubjectPurchaseEligibility(studentProfileId);
  const scan = eligibility.ok
    ? await listGuardianFundingSubscriptions(stripe, customerId)
    : null;
  const covered =
    (!eligibility.ok && eligibility.code === "STUDENT_ALREADY_FUNDED") ||
    (scan?.ok === true &&
      aSubscriptionAlreadyFundsStudent(scan.subscriptions, studentProfileId));
  if (covered) {
    await finishCharge({
      inviteId,
      outcome: "already_funded",
      code: eligibility.ok
        ? "subscription_exists"
        : eligibility.code.toLowerCase(),
      requestId,
    });
    await emailGuardian("already_funded", {
      inviteId,
      guardianId,
      studentProfileId,
      requestId,
    });
    logger.info(
      "GUARDIAN_INVITE_CARD",
      "charge",
      "Teen already covered; not charged",
      {
        inviteId,
        requestId,
      },
    );
    return "already_funded";
  }
  if (!eligibility.ok || scan === null || !scan.ok) {
    // Cannot tell whether the teen is covered: never charge on a guess. Today's checkout asks
    // the same questions again when the guardian pays there.
    await finishCharge({
      inviteId,
      outcome: "not_charged",
      code: !eligibility.ok
        ? "entitlement_unreadable"
        : "subscription_scan_incomplete",
      requestId,
    });
    await notifyNotCharged({
      inviteId,
      guardianId,
      studentProfileId,
      requestId,
    });
    return "not_charged";
  }

  // INV-03-08 before the money moves. This path has no Checkout to remediate a denial after
  // the charge, so an unknown country denies here as it does at the grant; the owner's
  // missing-country default (resolveBillingCountry) applies as it does everywhere.
  const customer = await stripe.customers.retrieve(customerId);
  const country =
    "deleted" in customer && customer.deleted
      ? null
      : resolveBillingCountry((customer as Stripe.Customer).address?.country)
          .country;
  const verdict = evaluateCountryEligibility(
    country,
    await getTier1Countries(),
  );
  if (verdict.verdict !== "eligible") {
    await finishCharge({
      inviteId,
      outcome: "not_charged",
      code: `country_${verdict.verdict}`,
      requestId,
    });
    logger.warn(
      "GUARDIAN_INVITE_CARD",
      "charge",
      "Billing country not eligible; not charged",
      {
        inviteId,
        verdict: verdict.verdict,
        requestId,
      },
    );
    await notifyNotCharged({
      inviteId,
      guardianId,
      studentProfileId,
      requestId,
    });
    return "not_charged";
  }

  const metadata = {
    payer_profile_id: guardianId,
    student_profile_id: studentProfileId,
    payer_relationship: "guardian",
    plan,
  };
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [
          {
            price: getPriceId(plan),
            quantity: 1,
            metadata: { student_profile_id: studentProfileId },
          },
        ],
        default_payment_method: input.paymentMethodId,
        off_session: true,
        // A charge that fails, or that the bank wants confirmed, creates NO subscription: there
        // is no incomplete subscription left behind to chase.
        payment_behavior: "error_if_incomplete",
        metadata,
      },
      { idempotencyKey: guardianInviteChargeIdempotencyKey(inviteId) },
    );
  } catch (err: unknown) {
    const code = paymentFailureCode(err);
    if (code === null) throw err;
    await finishCharge({
      inviteId,
      outcome: "payment_failed",
      code,
      requestId,
    });
    logger.warn(
      "GUARDIAN_INVITE_CARD",
      "charge",
      "Invite charge did not go through",
      {
        inviteId,
        code,
        requestId,
      },
    );
    await emailGuardian("payment_failed", {
      inviteId,
      guardianId,
      studentProfileId,
      requestId,
    });
    return "payment_failed";
  }

  await finishCharge({
    inviteId,
    outcome: "charged",
    subscriptionId: subscription.id,
    requestId,
  });
  logger.info(
    "GUARDIAN_INVITE_CARD",
    "charge",
    "Invite charged; subscription created",
    {
      inviteId,
      subscriptionRef: digestId(subscription.id),
      plan,
      requestId,
    },
  );
  await emailGuardian("charged", {
    inviteId,
    guardianId,
    studentProfileId,
    requestId,
  });
  return "charged";
}

/** Not charged for a reason of ours: point the guardian to today's checkout for this teen. */
async function notifyNotCharged(input: {
  inviteId: string;
  guardianId: string;
  studentProfileId: string;
  requestId: string | undefined;
}): Promise<void> {
  await emailGuardian("payment_failed", input);
}
