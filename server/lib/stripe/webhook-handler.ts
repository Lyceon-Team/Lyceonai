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
import { digestId } from "./redact";
import {
  resolveEntitlementItem,
  stripeSubscriptionItemSchema,
} from "./subscription-item";

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

/**
 * Boundary schemas for the signed Stripe payload.
 *
 * A valid signature proves Stripe sent the bytes. It does not prove the object
 * has the shape this handler needs — a Stripe API-version change, a partial
 * object, or an event routed here by mistake all arrive correctly signed.
 * Coding Standards §7.1 requires a Zod parse at every boundary; Stripe is a
 * boundary. Parse failure is an EXPECTED failure and fails closed.
 */
const profileIdSchema = z.string().uuid();

/** The payer-to-student mapping carried on Stripe objects (SCL-043). */
const subjectSchema = z.object({
  metadata: z
    .object({ student_profile_id: profileIdSchema.optional() })
    .passthrough()
    .nullish(),
  client_reference_id: profileIdSchema.nullish(),
});

/** The Checkout Session fields this handler reads. */
const checkoutSessionSchema = subjectSchema.extend({
  id: z.string().min(1),
  mode: z.string().nullish(),
  subscription: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
});

/** The Subscription fields this handler reads. */
const subscriptionEventSchema = subjectSchema.extend({
  id: z.string().min(1),
});

/**
 * The re-fetched Subscription, parsed before anything is persisted.
 *
 * NOTE the absent `current_period_start` / `current_period_end`. Stripe removed
 * them from the Subscription object in API version `2025-03-31.basil` and moved
 * them to SubscriptionItem; this repo's pinned SDK bundles `2026-02-25.clover`
 * and pins no `apiVersion`, so every retrieve here returns the item-level shape.
 * Declaring them at this level would parse to null forever and write NULL period
 * bounds onto live entitlement rows — which is exactly what it did. Periods and
 * price now come from the resolved ITEM (SCL-045), via `resolveEntitlementItem`.
 */
const retrievedSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  cancel_at_period_end: z.boolean().nullish(),
  items: z
    .object({
      data: z.array(stripeSubscriptionItemSchema).default([]),
    })
    .nullish(),
});

/** Thrown when a signed payload does not match the shape this handler requires. */
export class StripePayloadShapeError extends Error {
  constructor(eventType: string, detail: string) {
    super(`Stripe ${eventType} payload failed shape validation: ${detail}`);
    this.name = "StripePayloadShapeError";
  }
}

function parseOrFail<T>(
  schema: z.ZodType<T>,
  value: unknown,
  eventType: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new StripePayloadShapeError(
      eventType,
      JSON.stringify(parsed.error.flatten().fieldErrors),
    );
  }
  return parsed.data;
}

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
function resolveStudentProfileId(
  source: z.infer<typeof subjectSchema>,
  eventType: string,
): string {
  const candidate =
    source.metadata?.student_profile_id ??
    source.client_reference_id ??
    undefined;

  const parsed = profileIdSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StripePayloadShapeError(
      eventType,
      "no valid student_profile_id in metadata or client_reference_id",
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
  const subscription = parseOrFail(
    retrievedSubscriptionSchema,
    await stripe.subscriptions.retrieve(subscriptionId),
    eventType,
  );

  const { tier, status } = mapStripeStatusToEntitlement(subscription.status);

  // SCL-045: entitlement is keyed on the subscription ITEM. Price and period
  // both come from that one object, so they cannot describe different students.
  const items = subscription.items?.data ?? [];
  const item = resolveEntitlementItem(items, studentProfileId);

  // Absence and ambiguity are NOT the same failure, and must not share a branch.
  //
  //  - Zero items carries no period information. That is the shape a canceled or
  //    deleted subscription can arrive in, and revocation must never be blocked
  //    on a missing period: status is the load-bearing field there. Write nulls.
  //  - Several items with none naming this student IS ambiguous, and guessing
  //    `data[0]` would bill one student's period onto another's entitlement.
  //    Fail closed.
  if (!item && items.length > 0) {
    throw new StripePayloadShapeError(
      eventType,
      `no subscription item resolves to the subject student (items=${items.length})`,
    );
  }

  await upsertEntitlement(studentProfileId, {
    tier,
    status,
    stripe_subscription_id: subscription.id,
    stripe_price_id: item?.priceId ?? null,
    current_period_start: epochToIso(item?.currentPeriodStart ?? null),
    current_period_end: epochToIso(item?.currentPeriodEnd ?? null),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
  });

  // Charter §6: the student is the payer on the unaccompanied path, and Stripe
  // object ids resolve to a named person in the Dashboard. Digest both.
  logger.info("STRIPE_WEBHOOK", eventType, "Entitlement written", {
    eventId,
    studentProfileRef: digestId(studentProfileId),
    subscriptionRef: digestId(subscription.id),
    tier,
    status,
  });
}

/**
 * The unique key whose violation means "this event id is already recorded".
 * `stripe_webhook_events` has `id TEXT PRIMARY KEY` and nothing else unique
 * (genesis.sql:211-215), so today this is the only 23505 the insert can raise.
 * The name is checked anyway: treating *any* unique violation as a replay is the
 * collapse-an-error-into-a-legitimate-value pattern, and it would start silently
 * swallowing a different constraint the moment one is added.
 */
const REPLAY_CONSTRAINT = "stripe_webhook_events_pkey";

/** Insert-once gate. Returns false only for a genuine replay of the same event id. */
async function claimEvent(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .insert({ id: eventId, type: eventType });

  if (!error) return true;

  if (error.code === "23505") {
    const names = `${error.message ?? ""} ${error.details ?? ""}`;
    if (names.includes(REPLAY_CONSTRAINT)) return false;

    // A unique violation on some OTHER constraint is not a replay. Do not
    // acknowledge it as one — that would drop a real event silently.
    logger.error(
      "STRIPE_WEBHOOK",
      "gate_unexpected_unique_violation",
      "23505 on a constraint other than the event-id primary key",
      { eventId, eventType, code: error.code, message: error.message },
    );
    throw new Error(
      `Idempotency gate: unexpected unique violation (not ${REPLAY_CONSTRAINT}).`,
    );
  }

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
    // Parsed, not cast: a valid signature does not imply a valid shape.
    const session = parseOrFail(
      checkoutSessionSchema,
      event.data.object,
      event.type,
    );

    if (session.mode !== "subscription" || !session.subscription) {
      logger.info(
        "STRIPE_WEBHOOK",
        event.type,
        "Non-subscription checkout ignored",
        { eventId: event.id },
      );
      return;
    }

    const studentProfileId = resolveStudentProfileId(session, event.type);
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

  const subscription = parseOrFail(
    subscriptionEventSchema,
    event.data.object,
    event.type,
  );
  const studentProfileId = resolveStudentProfileId(subscription, event.type);
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
