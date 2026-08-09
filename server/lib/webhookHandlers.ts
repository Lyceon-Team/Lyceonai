import { getUncachableStripeClient } from "./stripeClient";
import { upsertEntitlement, mapStripeStatusToEntitlement } from "./account";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import Stripe from "stripe";

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181] @implemented 2026-08-09
 * plain English: extract profile_id from Stripe object metadata or client_reference_id.
 * Stripe metadata was set at checkout with profile_id = the student's user id (= profiles.id).
 * Throws if missing — webhooks must fail closed when no profile mapping exists.
 */
function requireProfileIdFromStripeObject(
  obj: Record<string, unknown>,
): string {
  const meta = obj?.metadata as Record<string, string> | undefined;
  // Support both new (profile_id) and legacy (account_id) metadata keys for in-flight transitions
  const fromMeta = meta?.profile_id || meta?.account_id;
  const fromClientRef = (obj as Record<string, unknown>)?.client_reference_id;
  const profileId = fromMeta || fromClientRef;

  if (!profileId || typeof profileId !== "string") {
    throw new Error(
      "Missing profile_id on Stripe object metadata/client_reference_id",
    );
  }
  return profileId as string;
}

async function extractProfileIdStrict(
  session: Stripe.Checkout.Session | null,
  subscription: Stripe.Subscription | null,
): Promise<{ profileId: string; userId: string | null }> {
  if (session) {
    try {
      const profileId = requireProfileIdFromStripeObject(
        session as unknown as Record<string, unknown>,
      );
      const userId =
        session.metadata?.payer_user_id || session.metadata?.user_id || null;
      return { profileId, userId };
    } catch {
      // fall through to subscription
    }
  }

  if (subscription) {
    try {
      const profileId = requireProfileIdFromStripeObject(
        subscription as unknown as Record<string, unknown>,
      );
      const userId =
        subscription.metadata?.payer_user_id ||
        subscription.metadata?.user_id ||
        null;
      return { profileId, userId };
    } catch {
      // fall through to throw
    }
  }

  throw new Error(
    "Missing profile_id on Stripe object metadata/client_reference_id",
  );
}

/**
 * @spec [Doc-01_V8 §20–§24 | STRIPE-001] @implemented 2026-08-09
 * plain English: thin idempotent receiver for subscription lifecycle events. Always re-fetches
 * the latest subscription state from Stripe so out-of-order deliveries converge on Stripe's
 * authoritative truth, then persists that truth VERBATIM via upsertEntitlement(profileId, ...).
 * stripe_customer_id is NOT written to entitlements — it lives on profiles (genesis:149).
 */
async function handleSubscriptionEvent(
  subscriptionPayload: Stripe.Subscription,
  eventType: string,
  eventId: string,
  checkoutSession?: Stripe.Checkout.Session,
): Promise<void> {
  let profileId: string;

  try {
    const extracted = await extractProfileIdStrict(
      checkoutSession || null,
      subscriptionPayload,
    );
    profileId = extracted.profileId;
  } catch (err) {
    logger.error(
      "WEBHOOK",
      "subscription",
      "Missing profile_id on Stripe object metadata/client_reference_id",
      {
        subscriptionId: subscriptionPayload.id,
        eventType,
        eventId,
        error: (err as Error).message,
      },
    );
    throw err;
  }

  // STRIPE-001: thin idempotent receiver. Always re-fetch the latest subscription state from Stripe
  // so out-of-order webhook deliveries converge on Stripe's authoritative truth — then persist that
  // truth VERBATIM. No transition graph, no trial-ending computation, no canceled-at-request-time or
  // temporal/grace derivation: `status` is whatever Stripe reports, period fields are passed through.
  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionPayload.id,
  );

  const { tier, status } = mapStripeStatusToEntitlement(subscription.status);

  const toIso = (epochSeconds: unknown): string | null =>
    typeof epochSeconds === "number"
      ? new Date(epochSeconds * 1000).toISOString()
      : null;

  const currentPeriodStart = toIso(
    (subscription as { current_period_start?: unknown }).current_period_start,
  );
  const currentPeriodEnd = toIso(
    (subscription as { current_period_end?: unknown }).current_period_end,
  );
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;

  await upsertEntitlement(profileId, {
    tier,
    status,
    stripe_subscription_id: subscription.id,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
  });

  logger.info("WEBHOOK", eventType, "Updated entitlement", {
    profileId,
    tier,
    status,
    subscriptionId: subscription.id,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    eventId,
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<void> {
  if (session.mode !== "subscription" || !session.subscription) {
    logger.info(
      "WEBHOOK",
      "checkout",
      "Checkout is not a subscription, skipping",
      {
        sessionId: session.id,
        eventId,
      },
    );
    return;
  }

  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id,
  );

  await handleSubscriptionEvent(
    subscription,
    "checkout.session.completed",
    eventId,
    session,
  );
}

async function tryInsertWebhookEventGate(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .insert({ id: eventId, type: eventType });

  if (error) {
    if (error.code === "23505") {
      return false; // Duplicate event, already processed
    }
    logger.error(
      "WEBHOOK",
      "idempotency_gate_insert",
      "Failed to write idempotency gate; rejecting webhook event",
      {
        eventId,
        eventType,
        error: error.message,
        code: error.code,
      },
    );
    throw new Error(
      `Failed to write webhook idempotency gate: code=${error.code ?? "unknown"} message=${error.message}`,
    );
  }

  return true;
}

async function rollbackWebhookEventGate(eventId: string): Promise<void> {
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .delete()
    .eq("id", eventId);
  if (error) {
    logger.warn(
      "WEBHOOK",
      "idempotency_gate_rollback",
      "Failed to rollback idempotency gate",
      {
        eventId,
        error: error.message,
        code: error.code,
      },
    );
  }
}

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
    requestId?: string,
  ): Promise<{ received: boolean; eventId?: string; status?: string }> {
    if (!Buffer.isBuffer(payload)) {
      const errMsg =
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "Received type: " +
        typeof payload +
        ". " +
        "This usually means express.json() parsed the body before reaching this handler. " +
        "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).";
      logger.error("WEBHOOK", "payload_error", errMsg, { requestId });
      throw new Error(errMsg);
    }

    const stripe = await getUncachableStripeClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error(
        "WEBHOOK",
        "config_error",
        "STRIPE_WEBHOOK_SECRET not configured",
        { requestId },
      );
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      logger.error(
        "WEBHOOK",
        "signature_failed",
        "Signature verification failed",
        {
          error: err.message,
          requestId,
        },
      );
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    logger.info("WEBHOOK", "received", `Event received: ${event.type}`, {
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      requestId,
    });

    // Attempt to insert the event into the idempotency gate
    const isNewEvent = await tryInsertWebhookEventGate(event.id, event.type);
    if (!isNewEvent) {
      logger.info("WEBHOOK", "idempotent_skip", "Event already processed", {
        eventId: event.id,
        eventType: event.type,
        requestId,
      });
      return { received: true, eventId: event.id, status: "already_processed" };
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(
            event.data.object as Stripe.Checkout.Session,
            event.id,
          );
          break;

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionEvent(
            event.data.object as Stripe.Subscription,
            event.type,
            event.id,
          );
          break;

        case "invoice.payment_failed":
        case "invoice.paid":
          logger.info("WEBHOOK", event.type, "Invoice event received", {
            invoiceId: (event.data.object as any).id,
            eventId: event.id,
            requestId,
          });
          break;

        default:
          logger.info(
            "WEBHOOK",
            "unhandled",
            `Unhandled event type: ${event.type}`,
            {
              eventId: event.id,
              requestId,
            },
          );
      }
    } catch (handlerError: any) {
      await rollbackWebhookEventGate(event.id);
      logger.error("WEBHOOK", "handler_error", "Event handler failed", {
        eventId: event.id,
        eventType: event.type,
        error: handlerError.message,
        requestId,
      });
      throw handlerError;
    }

    logger.info("WEBHOOK", "completed", "Event processed successfully", {
      eventId: event.id,
      eventType: event.type,
      requestId,
    });

    return { received: true, eventId: event.id, status: "processed" };
  }
}
