import { getUncachableStripeClient } from './stripeClient';
import { upsertEntitlement, mapStripeStatusToEntitlement } from './account';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';
import { logger } from '../logger';
import Stripe from 'stripe';

/**
 * Strictly extract account_id from Stripe object metadata or client_reference_id.
 * Throws an error if account_id is missing - webhooks must fail if no account mapping.
 */
function requireAccountIdFromStripeObject(obj: any): string {
  const fromMeta = obj?.metadata?.account_id;
  const fromClientRef = obj?.client_reference_id;
  const accountId = fromMeta || fromClientRef;

  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Missing account_id on Stripe object metadata/client_reference_id');
  }
  return accountId;
}

interface EventLogEntry {
  event_id: string;
  type: string;
  livemode: boolean;
  payload: object;
  status: 'pending' | 'processed' | 'ignored' | 'failed';
  processed_at?: string;
  error?: string;
  account_id?: string;
  user_id?: string;
}

async function checkEventIdempotency(eventId: string): Promise<{ alreadyProcessed: boolean; status?: string }> {
  const { data, error } = await supabaseServer
    .from('stripe_event_log')
    .select('id, processed_at, status')
    .eq('event_id', eventId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    logger.warn('WEBHOOK', 'idempotency_check', 'Failed to check idempotency', { eventId, error: error.message });
  }

  if (data?.processed_at) {
    return { alreadyProcessed: true, status: data.status };
  }
  
  return { alreadyProcessed: false };
}

async function recordEventStart(entry: EventLogEntry): Promise<void> {
  const { error } = await supabaseServer
    .from('stripe_event_log')
    .insert({
      event_id: entry.event_id,
      type: entry.type,
      livemode: entry.livemode,
      payload: entry.payload,
      status: 'pending',
    });
  
  if (error && !error.message.includes('duplicate')) {
    logger.warn('WEBHOOK', 'record_start', 'Failed to record event start', { 
      eventId: entry.event_id, 
      error: error.message 
    });
  }
}

async function updateEventStatus(
  eventId: string, 
  status: 'processed' | 'ignored' | 'failed',
  details?: { error?: string; account_id?: string; user_id?: string }
): Promise<void> {
  const { error } = await supabaseServer
    .from('stripe_event_log')
    .update({
      status,
      processed_at: new Date().toISOString(),
      error: details?.error || null,
      account_id: details?.account_id || null,
      user_id: details?.user_id || null,
    })
    .eq('event_id', eventId);
  
  if (error) {
    logger.warn('WEBHOOK', 'record_update', 'Failed to update event status', { 
      eventId, 
      status,
      error: error.message 
    });
  }
}

async function extractAccountIdStrict(
  session: Stripe.Checkout.Session | null,
  subscription: Stripe.Subscription | null
): Promise<{ accountId: string; userId: string | null }> {
  if (session) {
    try {
      const accountId = requireAccountIdFromStripeObject(session);
      const userId = session.metadata?.payer_user_id || session.metadata?.user_id || null;
      return { accountId, userId };
    } catch {
    }
  }
  
  if (subscription) {
    try {
      const accountId = requireAccountIdFromStripeObject(subscription);
      const userId = subscription.metadata?.payer_user_id || subscription.metadata?.user_id || null;
      return { accountId, userId };
    } catch {
    }
  }
  
  if (session?.subscription) {
    try {
      const stripe = await getUncachableStripeClient();
      const subId = typeof session.subscription === 'string' 
        ? session.subscription 
        : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      const accountId = requireAccountIdFromStripeObject(sub);
      const userId = sub.metadata?.payer_user_id || sub.metadata?.user_id || null;
      return { accountId, userId };
    } catch (err) {
      logger.warn('WEBHOOK', 'extractAccountIdStrict', 'Failed to retrieve subscription', { error: (err as Error).message });
    }
  }
  
  throw new Error('Missing account_id on Stripe object metadata/client_reference_id');
}

async function handleSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventType: string,
  eventId: string,
  checkoutSession?: Stripe.Checkout.Session
): Promise<void> {
  let accountId: string;
  let userId: string | null;
  
  try {
    const extracted = await extractAccountIdStrict(checkoutSession || null, subscription);
    accountId = extracted.accountId;
    userId = extracted.userId;
  } catch (err) {
    logger.error('WEBHOOK', 'subscription', 'Missing account_id on Stripe object metadata/client_reference_id', {
      subscriptionId: subscription.id,
      eventType,
      eventId,
      error: (err as Error).message,
    });
    await updateEventStatus(eventId, 'failed', { error: 'Missing account_id on Stripe object metadata/client_reference_id' });
    return;
  }

  const { plan, status } = mapStripeStatusToEntitlement(subscription.status);
  const periodEnd = (subscription as any).current_period_end;
  const currentPeriodEnd = periodEnd 
    ? new Date(periodEnd * 1000).toISOString()
    : null;

  await upsertEntitlement(accountId, {
    plan,
    status,
    stripe_customer_id: typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    current_period_end: currentPeriodEnd,
  });

  await updateEventStatus(eventId, 'processed', { account_id: accountId, user_id: userId || undefined });

  logger.info('WEBHOOK', eventType, 'Updated entitlement', {
    accountId,
    plan,
    status,
    subscriptionId: subscription.id,
    currentPeriodEnd,
    eventId,
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string
): Promise<void> {
  if (session.mode !== 'subscription' || !session.subscription) {
    logger.info('WEBHOOK', 'checkout', 'Checkout is not a subscription, skipping', { 
      sessionId: session.id,
      eventId,
    });
    await updateEventStatus(eventId, 'ignored', { error: 'Not a subscription checkout' });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    typeof session.subscription === 'string' ? session.subscription : session.subscription.id
  );

  await handleSubscriptionEvent(subscription, 'checkout.session.completed', eventId, session);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, requestId?: string): Promise<{ received: boolean; eventId?: string; status?: string }> {
    if (!Buffer.isBuffer(payload)) {
      const errMsg = 
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).';
      logger.error('WEBHOOK', 'payload_error', errMsg, { requestId });
      throw new Error(errMsg);
    }

    const stripe = await getUncachableStripeClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('WEBHOOK', 'config_error', 'STRIPE_WEBHOOK_SECRET not configured', { requestId });
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      logger.error('WEBHOOK', 'signature_failed', 'Signature verification failed', { 
        error: err.message,
        requestId,
      });
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    logger.info('WEBHOOK', 'received', `Event received: ${event.type}`, { 
      eventId: event.id, 
      eventType: event.type,
      livemode: event.livemode,
      requestId,
    });

    const { alreadyProcessed, status: existingStatus } = await checkEventIdempotency(event.id);
    if (alreadyProcessed) {
      logger.info('WEBHOOK', 'idempotent_skip', 'Event already processed', { 
        eventId: event.id, 
        eventType: event.type,
        existingStatus,
        requestId,
      });
      return { received: true, eventId: event.id, status: 'already_processed' };
    }

    await recordEventStart({
      event_id: event.id,
      type: event.type,
      livemode: event.livemode,
      payload: event.data.object as object,
      status: 'pending',
    });

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await handleSubscriptionEvent(event.data.object as Stripe.Subscription, event.type, event.id);
          break;

        case 'invoice.payment_failed':
        case 'invoice.paid':
          logger.info('WEBHOOK', event.type, 'Invoice event received', { 
            invoiceId: (event.data.object as any).id,
            eventId: event.id,
            requestId,
          });
          await updateEventStatus(event.id, 'processed');
          break;

        default:
          logger.info('WEBHOOK', 'unhandled', `Unhandled event type: ${event.type}`, { 
            eventId: event.id,
            requestId,
          });
          await updateEventStatus(event.id, 'ignored', { error: 'Unhandled event type' });
      }
    } catch (handlerError: any) {
      logger.error('WEBHOOK', 'handler_error', 'Event handler failed', { 
        eventId: event.id,
        eventType: event.type,
        error: handlerError.message,
        requestId,
      });
      await updateEventStatus(event.id, 'failed', { error: handlerError.message });
      throw handlerError;
    }

    // No additional sync or custom processWebhook needed here.

    logger.info('WEBHOOK', 'completed', 'Event processed successfully', { 
      eventId: event.id, 
      eventType: event.type,
      requestId,
    });

    return { received: true, eventId: event.id, status: 'processed' };
  }
}
