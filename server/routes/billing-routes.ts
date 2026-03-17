import { Request, Response, Router } from 'express';
import {
  getSupabaseAdmin,
  requireSupabaseAuth,
  sendUnauthenticated,
} from '../middleware/supabase-auth';
import { getUncachableStripeClient, getStripePublishableKeySafe } from '../lib/stripeClient';
import { billingStorage } from '../lib/billingStorage';
import { getOrCreateEntitlement, ensureAccountForUser, getPrimaryGuardianLink, mapStripeStatusToEntitlement, upsertEntitlement, resolveLinkedPairPremiumAccessForGuardian, resolveLinkedPairPremiumAccessForStudent } from '../lib/account';
import { logger } from '../logger';
import { z } from 'zod';
import { csrfGuard } from '../middleware/csrf';
import { requireGuardianRole } from '../middleware/guardian-role';
import { normalizeRuntimeRole } from '../lib/auth-role';

const router = Router();
const csrfProtection = csrfGuard();
const requireGuardianBillingAccess = requireGuardianRole({
  message: 'You do not have permission to access guardian billing resources',
});

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  priceId: z.string().min(1).optional(),
}).refine((v) => !!v.plan || !!v.priceId, {
  message: 'plan or priceId is required',
});

function resolvePriceIdAndPlan(input: { plan?: string; priceId?: string }): { plan: 'monthly' | 'quarterly' | 'yearly'; priceId: string } {
  const monthly = process.env.STRIPE_PRICE_PARENT_MONTHLY;
  const quarterly = process.env.STRIPE_PRICE_PARENT_QUARTERLY;
  const yearly = process.env.STRIPE_PRICE_PARENT_YEARLY;

  if (!monthly || !quarterly || !yearly) {
    const missing = [
      !monthly ? 'STRIPE_PRICE_PARENT_MONTHLY' : null,
      !quarterly ? 'STRIPE_PRICE_PARENT_QUARTERLY' : null,
      !yearly ? 'STRIPE_PRICE_PARENT_YEARLY' : null,
    ].filter(Boolean);
    throw new Error(`Missing price env vars: ${missing.join(', ')}`);
  }

  const map = {
    monthly,
    quarterly,
    yearly,
  } as const;

  if (input.plan) {
    const plan = input.plan as keyof typeof map;
    const priceId = map[plan];
    return { plan, priceId };
  }

  const allowed = new Set([monthly, quarterly, yearly]);
  if (!input.priceId || !allowed.has(input.priceId)) {
    throw new Error('Invalid priceId');
  }

  const plan =
    input.priceId === monthly ? 'monthly' :
      input.priceId === quarterly ? 'quarterly' :
        'yearly';

  return { plan, priceId: input.priceId };
}

router.post('/checkout', requireSupabaseAuth, csrfProtection, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      return sendUnauthenticated(res, requestId);
    }

    const validation = checkoutSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.errors[0]?.message || 'Invalid request',
        requestId
      });
    }

    let resolved: { plan: 'monthly' | 'quarterly' | 'yearly'; priceId: string };
    try {
      resolved = resolvePriceIdAndPlan(validation.data);
    } catch (e: any) {
      return res.status(400).json({
        error: e?.message || 'Invalid checkout request',
        requestId,
      });
    }

    const { priceId, plan } = resolved;

    logger.info('BILLING', 'checkout', 'Resolved price for checkout', {
      plan,
      priceIdPrefix: priceId.slice(0, 12),
      priceIdLast4: priceId.slice(-4),
      priceIdLen: priceId.length,
      role,
      requestId,
    });

    if (!priceId.startsWith('price_')) {
      logger.error('BILLING', 'checkout', 'Invalid priceId format', { priceId, plan, requestId });
      return res.status(400).json({
        error: 'Invalid price configuration',
        stripeMessage: `Price ID must start with 'price_', got: ${priceId.slice(0, 10)}...`,
        plan,
        requestId,
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    let accountId: string | null = null;
    let linkedStudentId: string | null = null;

    if (role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot initiate checkout', requestId });
    } else if (role === 'student') {
      accountId = await ensureAccountForUser(supabaseAdmin, userId, 'student');
    } else if (role === 'guardian') {
      const link = await getPrimaryGuardianLink(userId);
      linkedStudentId = link?.student_user_id ?? null;
      if (!linkedStudentId) {
        return res.status(409).json({
          error: 'Link a student before starting guardian checkout',
          code: 'LINKED_STUDENT_REQUIRED',
          requestId,
        });
      }
      accountId = link?.account_id ?? await ensureAccountForUser(supabaseAdmin, linkedStudentId, 'student');
    } else {
      return res.status(403).json({ error: 'Unsupported role', requestId });
    }

    if (!accountId) {
      return res.status(500).json({ error: 'Failed to resolve account', requestId });
    }

    const stripe = await getUncachableStripeClient();

    try {
      await stripe.prices.retrieve(priceId);
    } catch (priceErr: any) {
      logger.error('BILLING', 'checkout', 'Price not found in Stripe', {
        priceId,
        plan,
        stripeError: priceErr?.message,
        stripeCode: priceErr?.code,
        requestId,
      });
      return res.status(400).json({
        error: 'Stripe price not found',
        stripeMessage: priceErr?.message || 'Price does not exist in Stripe',
        plan,
        priceId: priceId.slice(0, 20) + '...',
        requestId,
      });
    }

    // Resolve stripe customer id from entitlement (account-level source of truth).
    const entitlement = await getOrCreateEntitlement(accountId);
    let customerId: string | null = entitlement?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user!.email,
        metadata: {
          account_id: accountId,
          payer_user_id: userId,
          payer_role: role, // "student" | "guardian"
        },
      });

      customerId = customer.id;

      // Persist at ENTITLEMENT level (source of truth)
      await upsertEntitlement(accountId, { stripe_customer_id: customerId });

      logger.info('BILLING', 'checkout', 'Created Stripe customer', {
        userId,
        accountId,
        customerId,
        role: role,
        requestId,
      });
    } else {
      logger.info('BILLING', 'checkout', 'Reusing existing Stripe customer from entitlement', {
        userId,
        accountId,
        customerId,
        role: role,
        requestId,
      });
    }


    logger.info('BILLING', 'checkout', 'Upserted entitlement stripe_customer_id', {
      accountId,
      customerId,
      userId,
      role,
      requestId,
    });

    const baseUrl =
      process.env.SITE_URL ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://lyceon.ai');

    const successUrl = role === 'student'
      ? `${baseUrl}/dashboard?checkout=success`
      : `${baseUrl}/guardian?checkout=success`;
    const cancelUrl = role === 'student'
      ? `${baseUrl}/dashboard?checkout=cancel`
      : `${baseUrl}/guardian?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        account_id: accountId,
        payer_user_id: userId,
        payer_role: role,
        ...(linkedStudentId ? { linked_student_id: linkedStudentId } : {}),
        plan,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      },
      client_reference_id: accountId,
      subscription_data: {
        metadata: {
          account_id: accountId,
          payer_user_id: userId,
          payer_role: role,
          ...(linkedStudentId ? { linked_student_id: linkedStudentId } : {}),
          plan,
        },
      },
    });

    logger.info('BILLING', 'checkout', 'Created checkout session', { userId, accountId, plan, role, linkedStudentId, sessionId: session.id, requestId });

    res.json({ url: session.url, sessionId: session.id, requestId });
  } catch (err: any) {
    logger.error('STRIPE_CHECKOUT_FAILED', 'checkout', 'Failed to create checkout session', {
      requestId,
      message: err?.message,
      type: err?.type,
      code: err?.code,
      raw: err?.raw?.message,
    });

    return res.status(400).json({
      error: 'Failed to create checkout session',
      stripeMessage: err?.raw?.message || err?.message || 'Unknown error',
      requestId,
    });
  }
});

router.get('/status', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const userId = req.user!.id;
  const userRole = normalizeRuntimeRole(req.user!.role);

  let accountId: string | null = null;
  let entitlement: any = null;
  let hasLinkedStudent = false;
  let linkRequiredForPremium = false;
  let premiumSource: 'student' | 'guardian' | 'both' | 'none' = 'none';
  let effectiveAccess = false;
  let requiresStudentSubscription = false;
  let lockedReason: 'link_required' | 'student_subscription_required' | 'student_subscription_expired' | 'student_payment_past_due' | null = null;

  if (userRole === 'admin') {
    return res.status(403).json({ error: 'Admins cannot access billing status', requestId });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (userRole === 'guardian') {
      const link = await getPrimaryGuardianLink(userId);
      hasLinkedStudent = !!link?.student_user_id;
      linkRequiredForPremium = !hasLinkedStudent;
      accountId = link?.student_user_id
        ? link.account_id ?? await ensureAccountForUser(supabaseAdmin, link.student_user_id, 'student')
        : null;
    } else {
      accountId = await ensureAccountForUser(supabaseAdmin, userId, 'student');
    }
  } catch (err: any) {
    logger.warn('BILLING', 'status', 'Failed to ensure student-owned entitlement account', { userId, err: err.message, requestId });
  }

  try {
    if (accountId) {
      entitlement = await getOrCreateEntitlement(accountId);
    }
  } catch (err: any) {
    logger.warn('BILLING', 'status', 'Failed to get entitlement', { userId, accountId, err: err.message, requestId });
  }

  let plan = entitlement?.plan || 'free';
  let status = entitlement?.status || 'inactive';
  let currentPeriodEnd = entitlement?.current_period_end || null;

  let isActiveOrTrialing = status === 'active' || status === 'trialing';
  let periodExpired = false;
  if (currentPeriodEnd) {
    periodExpired = new Date(currentPeriodEnd) < new Date();
  }

  let billingIsPaid = plan === 'paid' && isActiveOrTrialing && !periodExpired;

  if (!billingIsPaid && accountId) {
    try {
      const stripeCustomerId = entitlement?.stripe_customer_id || null;
      if (stripeCustomerId) {
        logger.info('BILLING', 'status', 'Self-heal: if DB says not paid but Stripe says active, reconcile now', {
          userId,
          accountId,
          stripeCustomerId,
          currentStatus: status,
          requestId,
        });

        const stripe = await getUncachableStripeClient();
        const subs = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'all',
          limit: 10,
        });

        const accountSubs = subs.data.filter(s => {
          const subAccountId = s.metadata?.account_id;
          return subAccountId === accountId;
        });

        const best =
          accountSubs.find(s => s.status === 'active') ||
          accountSubs.find(s => s.status === 'trialing') ||
          accountSubs.sort((a, b) => (b.created || 0) - (a.created || 0))[0];

        if (best) {
          const mapped = mapStripeStatusToEntitlement(best.status);
          const periodEnd = (best as any).current_period_end;
          const reconciledPeriodEnd = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

          await upsertEntitlement(accountId, {
            plan: mapped.plan,
            status: mapped.status,
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: best.id,
            current_period_end: reconciledPeriodEnd,
          });

          entitlement = await getOrCreateEntitlement(accountId);
          plan = entitlement?.plan || 'free';
          status = entitlement?.status || 'inactive';
          currentPeriodEnd = entitlement?.current_period_end || null;
          isActiveOrTrialing = status === 'active' || status === 'trialing';
          periodExpired = currentPeriodEnd ? new Date(currentPeriodEnd) < new Date() : false;
          billingIsPaid = plan === 'paid' && isActiveOrTrialing && !periodExpired;

          logger.info('BILLING', 'status', 'Self-heal: reconciliation complete', {
            userId,
            accountId,
            newPlan: plan,
            newStatus: status,
            subscriptionId: best.id,
            requestId,
          });
        }
      }
    } catch (e: any) {
      logger.warn('BILLING', 'status', 'Self-heal reconcile failed', { error: e.message, requestId });
    }
  }

  try {
    if (userRole === 'guardian') {
      const access = await resolveLinkedPairPremiumAccessForGuardian(userId);
      hasLinkedStudent = access.hasActiveLink;
      linkRequiredForPremium = !hasLinkedStudent;
      premiumSource = access.premiumSource;
      effectiveAccess = access.hasPremiumAccess;
      if (!effectiveAccess && hasLinkedStudent) {
        lockedReason = access.studentEntitlementExpired
          ? 'student_subscription_expired'
          : access.studentEntitlementStatus === 'past_due'
            ? 'student_payment_past_due'
            : 'student_subscription_required';
      }
    } else {
      const access = await resolveLinkedPairPremiumAccessForStudent(userId);
      premiumSource = access.premiumSource;
      effectiveAccess = access.hasPremiumAccess;
      if (!effectiveAccess) {
        lockedReason = access.studentEntitlementExpired
          ? 'student_subscription_expired'
          : access.studentEntitlementStatus === 'past_due'
            ? 'student_payment_past_due'
            : 'student_subscription_required';
      }
    }
  } catch (err: any) {
    logger.warn('BILLING', 'status', 'Failed to resolve student-owned premium access', {
      userId,
      role: userRole,
      error: err.message,
      requestId,
    });
    effectiveAccess = false;
  }

  if (linkRequiredForPremium) {
    lockedReason = 'link_required';
  }

  const needsPaymentUpdate =
    !effectiveAccess &&
    !linkRequiredForPremium &&
    (lockedReason === 'student_subscription_expired' || lockedReason === 'student_payment_past_due');
  requiresStudentSubscription =
    !effectiveAccess &&
    !linkRequiredForPremium &&
    lockedReason === 'student_subscription_required';

  logger.info('BILLING', 'status', 'Billing status retrieved', {
    userId,
    accountId,
    billingPlan: plan,
    billingStatus: status,
    effectiveAccess,
    premiumSource,
    hasLinkedStudent,
    linkRequiredForPremium,
    needsPaymentUpdate,
    requiresStudentSubscription,
    lockedReason,
    requestId
  });

  res.json({
    accountId: accountId || null,
    plan,
    stripeStatus: status,
    currentPeriodEnd,
    stripeSubscriptionId: entitlement?.stripe_subscription_id || null,
    effectiveAccess,
    needsPaymentUpdate,
    requiresStudentSubscription,
    isPaid: billingIsPaid,
    premiumSource,
    hasLinkedStudent,
    linkRequiredForPremium,
    lockedReason,
    billingOwnerRole: 'student',
    requestId,
  });
});

router.get('/products', requireSupabaseAuth, requireGuardianBillingAccess, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const products = await billingStorage.listProducts();
    res.json({ products, requestId });
  } catch (err: any) {
    logger.error('BILLING', 'products', 'Failed to list products', { err: err.message, requestId });
    res.status(500).json({ error: 'Failed to list products', requestId });
  }
});

async function getPricesHandler(req: Request, res: Response) {
  const requestId = req.requestId;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const monthlyId = process.env.STRIPE_PRICE_PARENT_MONTHLY;
    const quarterlyId = process.env.STRIPE_PRICE_PARENT_QUARTERLY;
    const yearlyId = process.env.STRIPE_PRICE_PARENT_YEARLY;

    const missing: string[] = [];
    if (!monthlyId) missing.push('STRIPE_PRICE_PARENT_MONTHLY');
    if (!quarterlyId) missing.push('STRIPE_PRICE_PARENT_QUARTERLY');
    if (!yearlyId) missing.push('STRIPE_PRICE_PARENT_YEARLY');

    if (missing.length > 0) {
      logger.error('BILLING', 'prices', 'Missing price env vars', { missing, requestId });
      return res.status(500).json({
        error: 'Subscription prices not configured',
        missing,
        requestId
      });
    }

    const prices = [
      {
        id: monthlyId,
        plan: 'monthly' as const,
        priceId: monthlyId,
        amount: 9900,
        currency: 'usd',
        interval: 'month',
        intervalCount: 1,
        label: 'Monthly',
      },
      {
        id: quarterlyId,
        plan: 'quarterly' as const,
        priceId: quarterlyId,
        amount: 19900,
        currency: 'usd',
        interval: 'month',
        intervalCount: 3,
        label: 'Quarterly',
        badge: 'Best value',
      },
      {
        id: yearlyId,
        plan: 'yearly' as const,
        priceId: yearlyId,
        amount: 69900,
        currency: 'usd',
        interval: 'year',
        intervalCount: 1,
        label: 'Yearly',
      },
    ];

    res.json({ prices, requestId });
  } catch (err: any) {
    logger.error('BILLING', 'prices', 'Failed to list prices', { err: err.message, requestId });
    res.status(500).json({ error: 'Failed to list prices', requestId });
  }
}

router.get('/prices', getPricesHandler);

router.get('/prices/authenticated', requireSupabaseAuth, getPricesHandler);
router.get('/products/:productId/prices', requireSupabaseAuth, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const { productId } = req.params;
    const product = await billingStorage.getProduct(productId);

    if (!product) {
      return res.status(404).json({ error: 'Product not found', requestId });
    }

    const prices = await billingStorage.getPricesForProduct(productId);
    res.json({ prices, requestId });
  } catch (err: any) {
    logger.error('BILLING', 'prices', 'Failed to get prices', { err: err.message, requestId });
    res.status(500).json({ error: 'Failed to get prices', requestId });
  }
});

router.get('/portal', (req, res) => {
  return res.status(405).json({
    error: 'Method Not Allowed. Use POST /api/billing/portal.',
  });
});


router.post('/portal', requireSupabaseAuth, csrfProtection, async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const userId = req.user!.id;
    const userRole = normalizeRuntimeRole(req.user!.role);

    if (userRole === 'admin') {
      return res.status(403).json({ error: 'Admins cannot access billing portal', requestId });
    }

    const supabaseAdmin = getSupabaseAdmin();
    let accountId: string | null = null;

    if (userRole === 'guardian') {
      const link = await getPrimaryGuardianLink(userId);
      if (!link?.student_user_id) {
        return res.status(409).json({
          error: 'Link a student before opening guardian billing portal',
          code: 'LINKED_STUDENT_REQUIRED',
          requestId,
        });
      }
      accountId = link.account_id ?? await ensureAccountForUser(supabaseAdmin, link.student_user_id, 'student');
    } else {
      accountId = await ensureAccountForUser(supabaseAdmin, userId, 'student');
    }

    if (!accountId) {
      return res.status(500).json({ error: 'Failed to resolve account', requestId });
    }

    const entitlement = await getOrCreateEntitlement(accountId);

    if (!entitlement?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found for this account', requestId });
    }

    const stripe = await getUncachableStripeClient();
    const baseUrl =
      process.env.SITE_URL ||
      (process.env.NODE_ENV === 'development' ? 'http://localhost:5000' : 'https://lyceon.ai');

    // Return user to the correct UI
    const returnUrl = userRole === 'guardian' ? `${baseUrl}/guardian` : `${baseUrl}/dashboard`;

    const session = await stripe.billingPortal.sessions.create({
      customer: entitlement.stripe_customer_id,
      return_url: returnUrl,
    });

    return res.json({ url: session.url, requestId });
  } catch (err: any) {
    logger.error('BILLING', 'portal', 'Failed to create portal session', { err: err.message, requestId });
    return res.status(500).json({ error: 'Failed to create portal session', requestId });
  }
});


router.get('/publishable-key', async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const publishableKey = await getStripePublishableKeySafe();
    res.json({ publishableKey, requestId });
  } catch (err: any) {
    logger.error('BILLING', 'publishable-key', 'Failed to get publishable key', { err: err.message, requestId });
    res.status(500).json({ error: 'Failed to get publishable key', requestId });
  }
});

function safeIdInfo(id: string | undefined): { prefix: string | null; last4: string | null; length: number } {
  if (!id) return { prefix: null, last4: null, length: 0 };
  return {
    prefix: id.slice(0, 12),
    last4: id.length > 4 ? id.slice(-4) : id,
    length: id.length,
  };
}

router.get('/debug/env', requireSupabaseAuth, requireGuardianBillingAccess, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const requestId = req.requestId;
  const stripeEnvRaw = process.env.STRIPE_ENV || null;
  const stripeEnvNormalized = stripeEnvRaw?.toLowerCase() === 'live' ? 'live' : 'test';
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  const pubKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  const monthlyId = process.env.STRIPE_PRICE_PARENT_MONTHLY || '';
  const quarterlyId = process.env.STRIPE_PRICE_PARENT_QUARTERLY || '';
  const yearlyId = process.env.STRIPE_PRICE_PARENT_YEARLY || '';

  const keyMode = secretKey.startsWith('sk_live_') ? 'live' : secretKey.startsWith('sk_test_') ? 'test' : 'unknown';
  const usingEnvSecretKey = !!process.env.STRIPE_SECRET_KEY;

  res.json({
    stripeEnvRaw,
    stripeEnvNormalized,
    keyMode,
    usingEnvSecretKey,
    secretKeyPrefix: secretKey.slice(0, 8) || null,
    secretKeyLast4: secretKey.length > 4 ? secretKey.slice(-4) : null,
    publishableKeyPrefix: pubKey.slice(0, 8) || null,
    resolvedPrices: {
      monthly: safeIdInfo(monthlyId),
      quarterly: safeIdInfo(quarterlyId),
      yearly: safeIdInfo(yearlyId),
    },
    envVarsSet: {
      STRIPE_ENV: !!process.env.STRIPE_ENV,
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_PUBLISHABLE_KEY: !!process.env.STRIPE_PUBLISHABLE_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_PRICE_PARENT_MONTHLY: !!process.env.STRIPE_PRICE_PARENT_MONTHLY,
      STRIPE_PRICE_PARENT_QUARTERLY: !!process.env.STRIPE_PRICE_PARENT_QUARTERLY,
      STRIPE_PRICE_PARENT_YEARLY: !!process.env.STRIPE_PRICE_PARENT_YEARLY,
      SITE_URL: !!process.env.SITE_URL,
    },
    siteUrl: process.env.SITE_URL || null,
    requestId,
  });
});

router.get('/debug/validate', requireSupabaseAuth, requireGuardianBillingAccess, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const requestId = req.requestId;
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  const mode = secretKey.startsWith('sk_live_') ? 'live' : secretKey.startsWith('sk_test_') ? 'test' : 'unknown';

  const priceEnvs = {
    monthly: process.env.STRIPE_PRICE_PARENT_MONTHLY,
    quarterly: process.env.STRIPE_PRICE_PARENT_QUARTERLY,
    yearly: process.env.STRIPE_PRICE_PARENT_YEARLY,
  };

  const results: Record<string, any> = {};

  try {
    const stripe = await getUncachableStripeClient();

    for (const [plan, priceId] of Object.entries(priceEnvs)) {
      const idInfo = safeIdInfo(priceId);

      if (!priceId) {
        results[plan] = {
          ok: false,
          error: 'Price ID not configured',
          priceIdPrefix: null,
          priceIdLast4: null,
          priceIdLen: 0,
        };
        continue;
      }

      if (!priceId.startsWith('price_')) {
        results[plan] = {
          ok: false,
          error: 'Invalid price ID format (must start with price_)',
          priceIdPrefix: idInfo.prefix,
          priceIdLast4: idInfo.last4,
          priceIdLen: idInfo.length,
        };
        continue;
      }

      try {
        const price = await stripe.prices.retrieve(priceId);
        results[plan] = {
          ok: true,
          priceIdPrefix: idInfo.prefix,
          priceIdLast4: idInfo.last4,
          priceIdLen: idInfo.length,
          active: price.active,
          currency: price.currency,
          unitAmount: price.unit_amount,
          type: price.type,
          recurring: price.recurring ? {
            interval: price.recurring.interval,
            intervalCount: price.recurring.interval_count,
          } : null,
          productId: typeof price.product === 'string' ? price.product : (price.product as any)?.id,
        };
      } catch (err: any) {
        results[plan] = {
          ok: false,
          priceIdPrefix: idInfo.prefix,
          priceIdLast4: idInfo.last4,
          priceIdLen: idInfo.length,
          stripeErrorType: err?.type || null,
          stripeErrorCode: err?.code || null,
          stripeErrorMessage: err?.message || 'Unknown error',
          stripeRequestId: err?.requestId || null,
        };
      }
    }

    const allOk = Object.values(results).every((r: any) => r.ok === true);
    const failedPlans = Object.entries(results)
      .filter(([_, r]) => !r.ok)
      .map(([plan]) => plan);

    res.json({
      ok: allOk,
      mode,
      secretKeyPrefix: secretKey.slice(0, 8) || null,
      secretKeyLast4: secretKey.length > 4 ? secretKey.slice(-4) : null,
      failedPlans: failedPlans.length > 0 ? failedPlans : null,
      prices: results,
      requestId,
    });
  } catch (err: any) {
    logger.error('BILLING', 'debug/validate', 'Failed to validate prices', { err: err.message, requestId });
    res.status(500).json({
      ok: false,
      error: 'Failed to initialize Stripe client',
      stripeMessage: err?.message,
      requestId,
    });
  }
});

export default router;

