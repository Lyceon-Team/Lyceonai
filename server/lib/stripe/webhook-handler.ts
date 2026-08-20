/**
 * @spec [Doc-01_V8 §22 (verified heading "## **§22 Stripe webhook handling**");
 *        SCL-043 payer identity; SCL-049 livemode assertion] @implemented 2026-08-20
 *
 * plain English: the Stripe webhook receiver. Rebuilt in Phase C, not patched.
 * Fixed order, and the order is the contract:
 *   1. raw Buffer check       — signature verification needs the unparsed body
 *   2. signature verification — Stripe's constructEvent
 *   3. livemode assertion     — reject a mode this environment does not serve
 *   4. idempotency gate       — insert-once on stripe_webhook_events.id
 *   5. dispatch               — subscription lifecycle only
 * Steps 2 and 3 precede all processing (Charter §6). Nothing the caller sends
 * influences an entitlement decision: the subject is read from Stripe's own
 * signature-verified payload, and subscription state is re-fetched from Stripe
 * rather than trusted from the delivered object.
 *
 * expected outcome: one entitlement row per entitled student profile, carrying
 * Stripe's reported status verbatim.
 *
 * trade-offs / edge cases:
 *  - Out-of-order delivery converges because every handler re-fetches the
 *    subscription and persists Stripe's current truth, not the delivered
 *    snapshot. Stripe does not guarantee ordering
 *    (https://docs.stripe.com/webhooks).
 *  - The idempotency gate is the existing `stripe_webhook_events` 23505 pattern.
 *    Doc 01A §38 names this handler as `IdempotencyService`'s pilot consumer;
 *    that migration is a later phase and no local variant is designed here.
 *  - On handler failure the gate row is rolled back so Stripe's retry can
 *    reprocess. A failed rollback is logged, never swallowed.
 *  - Refund events are NOT handled here. SCL-048 rules that they must revoke;
 *    that is outside the thin slice and is recorded, not silently skipped.
 */
import Stripe from "stripe";
import { z } from "zod";
import { getStripeClient, getExpectedLivemode } from "./client";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { upsertEntitlement, mapStripeStatusToEntitlement } from "../account";
import { logger } from "../../logger";

/** Events this handler acts on. Anything else is acknowledged and ignored. */
const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type WebhookOutcome =
  | {
      ok: true;
      eventId: string;
      status: "processed" | "already_processed" | "ignored";
    }
  | {
      ok: false;
      reason: "not_raw_body" | "bad_signature" | "livemode_mismatch";
      message: string;
    };

const profileIdSchema = z.string().uuid();

/**
 * Resolve the entitled student profile from a Stripe object.
 *
 * SCL-043: `metadata.student_profile_id` is the authoritative payer-to-student
 * mapping, because the Stripe Customer is the payer — in the unaccompanied case
 * that is the student, in the guardian and third-party cases it is not.
 * `client_reference_id` is the secondary source on the Checkout Session.
 *
 * Both are written server-side at Checkout and arrive inside a
 * signature-verified payload, so neither is a caller-supplied value.
 *
 * The legacy `metadata.account_id` fallback is deliberately absent: the
 * account-keyed entitlement model no longer exists (`entitlements` has no
 * `account_id` column) and the fallback was dead code on the identity path.
 *
 * Throws when no valid subject is present — webhooks fail closed.
 */
function resolveStudentProfileId(source: {
  metadata?: Stripe.Metadata | null;
  client_reference_id?: string | null;
}): string {
  const fromMetadata = source.metadata?.student_profile_id;
  const fromClientRef = source.client_reference_id ?? undefined;
  const candidate = fromMetadata ?? fromClientRef;

  const parsed = profileIdSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      "Stripe object carries no valid student_profile_id (metadata or client_reference_id).",
    );
  }
  return parsed.data;
}

function epochToIso(seconds: unknown): string | null {
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/**
 * Persist Stripe's authoritative subscription state onto the student's
 * entitlement row. Re-fetches rather than trusting the delivered object.
 */
async function writeEntitlementFromSubscription(
  subscriptionId: string,
  studentProfileId: string,
  eventType: string,
  eventId: string,
): Promise<void> {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const { tier, status } = mapStripeStatusToEntitlement(subscription.status);
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;

  await upsertEntitlement(studentProfileId, {
    tier,
    status,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    current_period_start: epochToIso(
      (subscription as unknown as { current_period_start?: unknown })
        .current_period_start,
    ),
    current_period_end: epochToIso(
      (subscription as unknown as { current_period_end?: unknown })
        .current_period_end,
    ),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
  });

  logger.info("STRIPE_WEBHOOK", eventType, "Entitlement written", {
    eventId,
    studentProfileId,
    subscriptionId: subscription.id,
    tier,
    status,
  });
}

/** Insert-once gate. Returns false when the event id is already present. */
async function claimEvent(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .insert({ id: eventId, type: eventType });

  if (!error) return true;
  if (error.code === "23505") return false;

  logger.error(
    "STRIPE_WEBHOOK",
    "gate_insert_failed",
    "Idempotency gate write failed",
    { eventId, eventType, code: error.code, message: error.message },
  );
  throw new Error(`Idempotency gate write failed: ${error.code ?? "unknown"}`);
}

async function releaseEvent(eventId: string): Promise<void> {
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .delete()
    .eq("id", eventId);
  if (error) {
    logger.error(
      "STRIPE_WEBHOOK",
      "gate_rollback_failed",
      "Idempotency gate rollback failed",
      { eventId, code: error.code, message: error.message },
    );
  }
}

async function dispatch(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription" || !session.subscription) {
      logger.info(
        "STRIPE_WEBHOOK",
        event.type,
        "Non-subscription checkout ignored",
        { eventId: event.id },
      );
      return;
    }
    const studentProfileId = resolveStudentProfileId(session);
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    await writeEntitlementFromSubscription(
      subscriptionId,
      studentProfileId,
      event.type,
      event.id,
    );
    return;
  }

  const subscription = event.data.object as Stripe.Subscription;
  const studentProfileId = resolveStudentProfileId(subscription);
  await writeEntitlementFromSubscription(
    subscription.id,
    studentProfileId,
    event.type,
    event.id,
  );
}

/**
 * Process one inbound Stripe webhook request.
 *
 * `rawBody` must be the unparsed request body. `signature` is the
 * `stripe-signature` header.
 */
export async function processStripeWebhook(
  rawBody: unknown,
  signature: string | undefined,
  requestId?: string,
): Promise<WebhookOutcome> {
  if (!Buffer.isBuffer(rawBody)) {
    logger.error(
      "STRIPE_WEBHOOK",
      "not_raw_body",
      "Body was parsed before the handler",
      { requestId },
    );
    return {
      ok: false,
      reason: "not_raw_body",
      message:
        "Webhook body must be a raw Buffer; register the route before the JSON parser.",
    };
  }

  if (!signature) {
    return {
      ok: false,
      reason: "bad_signature",
      message: "Missing stripe-signature header.",
    };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error(
      "STRIPE_WEBHOOK",
      "config_error",
      "STRIPE_WEBHOOK_SECRET is not configured",
      { requestId },
    );
    return {
      ok: false,
      reason: "bad_signature",
      message: "Webhook secret is not configured.",
    };
  }

  // 2. Signature verification — before anything else touches the payload.
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err: unknown) {
    logger.error(
      "STRIPE_WEBHOOK",
      "bad_signature",
      "Signature verification failed",
      { requestId, message: err instanceof Error ? err.message : "unknown" },
    );
    return {
      ok: false,
      reason: "bad_signature",
      message: "Signature verification failed.",
    };
  }

  // 3. livemode assertion (SCL-049) — fail closed on a mode this env does not serve.
  const expectedLivemode = getExpectedLivemode();
  if (event.livemode !== expectedLivemode) {
    logger.error(
      "STRIPE_WEBHOOK",
      "livemode_mismatch",
      "Rejected event from the wrong Stripe mode",
      {
        requestId,
        eventId: event.id,
        eventType: event.type,
        eventLivemode: event.livemode,
        expectedLivemode,
      },
    );
    return {
      ok: false,
      reason: "livemode_mismatch",
      message: "Event livemode does not match this environment.",
    };
  }

  const isHandled = (HANDLED_EVENTS as readonly string[]).includes(event.type);
  if (!isHandled) {
    logger.info(
      "STRIPE_WEBHOOK",
      "ignored",
      "Unhandled event type acknowledged",
      { requestId, eventId: event.id, eventType: event.type },
    );
    return { ok: true, eventId: event.id, status: "ignored" };
  }

  // 4. Idempotency gate.
  const claimed = await claimEvent(event.id, event.type);
  if (!claimed) {
    logger.info("STRIPE_WEBHOOK", "replay", "Event already processed", {
      requestId,
      eventId: event.id,
      eventType: event.type,
    });
    return { ok: true, eventId: event.id, status: "already_processed" };
  }

  // 5. Dispatch.
  try {
    await dispatch(event);
  } catch (err: unknown) {
    await releaseEvent(event.id);
    logger.error("STRIPE_WEBHOOK", "handler_failed", "Event handler failed", {
      requestId,
      eventId: event.id,
      eventType: event.type,
      message: err instanceof Error ? err.message : "unknown",
    });
    throw err;
  }

  return { ok: true, eventId: event.id, status: "processed" };
}
