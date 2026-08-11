import { Request, Response, Router } from "express";
import {
  requireSupabaseAuth,
  sendUnauthenticated,
} from "../middleware/supabase-auth";
import {
  getUncachableStripeClient,
  getStripePublishableKeySafe,
} from "../lib/stripeClient";
import { billingStorage } from "../lib/billingStorage";
import {
  getEntitlementForProfile,
  getProfileStripeCustomerId,
  setProfileStripeCustomerId,
  getPrimaryGuardianLink,
  mapStripeStatusToEntitlement,
  resolveLinkedPairPremiumAccessForGuardian,
  resolveLinkedPairPremiumAccessForStudent,
} from "../lib/account";
import { logger } from "../logger";
import { z } from "zod";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import { requireGuardianRole } from "../middleware/guardian-role";
import { normalizeRuntimeRole } from "../lib/auth-role";

const router = Router();
const csrfProtection = doubleCsrfProtection;
const requireGuardianBillingAccess = requireGuardianRole({
  message: "You do not have permission to access guardian billing resources",
});

const checkoutSchema = z
  .object({
    plan: z.enum(["monthly", "quarterly", "yearly"]),
  })
  .strict();

function resolvePriceIdAndPlan(input: {
  plan: "monthly" | "quarterly" | "yearly";
}): { plan: "monthly" | "quarterly" | "yearly"; priceId: string } {
  const monthly = process.env.STRIPE_PRICE_PARENT_MONTHLY;
  const quarterly = process.env.STRIPE_PRICE_PARENT_QUARTERLY;
  const yearly = process.env.STRIPE_PRICE_PARENT_YEARLY;

  if (!monthly || !quarterly || !yearly) {
    const missing = [
      !monthly ? "STRIPE_PRICE_PARENT_MONTHLY" : null,
      !quarterly ? "STRIPE_PRICE_PARENT_QUARTERLY" : null,
      !yearly ? "STRIPE_PRICE_PARENT_YEARLY" : null,
    ].filter(Boolean);
    throw new Error(`Missing price env vars: ${missing.join(", ")}`);
  }

  const map = {
    monthly,
    quarterly,
    yearly,
  } as const;

  const plan = input.plan as keyof typeof map;
  const priceId = map[plan];
  return { plan, priceId };
}

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:149,168–181] @implemented 2026-08-09
 * plain English: create a Stripe Checkout session for a student or guardian-paid subscription.
 * profile_id = userId (auth.users.id). stripe_customer_id lives on profiles (genesis:149).
 * Entitlement rows are NOT auto-created here — the webhook upsert is the only writer.
 */
router.post(
  "/checkout",
  requireSupabaseAuth,
  csrfProtection,
  async (req: Request, res: Response) => {
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
          error: validation.error.errors[0]?.message || "Invalid request",
          requestId,
        });
      }

      let resolved: {
        plan: "monthly" | "quarterly" | "yearly";
        priceId: string;
      };
      try {
        resolved = resolvePriceIdAndPlan(validation.data);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Invalid checkout request";
        return res.status(400).json({
          error: msg,
          requestId,
        });
      }

      const { priceId, plan } = resolved;

      logger.info("BILLING", "checkout", "Resolved price for checkout", {
        plan,
        priceIdPrefix: priceId.slice(0, 12),
        priceIdLast4: priceId.slice(-4),
        priceIdLen: priceId.length,
        role,
        requestId,
      });

      if (!priceId.startsWith("price_")) {
        logger.error("BILLING", "checkout", "Invalid priceId format", {
          priceId,
          plan,
          requestId,
        });
        return res.status(400).json({
          error: "Invalid price configuration",
          stripeMessage: `Price ID must start with 'price_', got: ${priceId.slice(0, 10)}...`,
          plan,
          requestId,
        });
      }

      // profile_id = userId for students, = linked student's userId for guardians
      let profileId: string | null = null;
      let linkedStudentId: string | null = null;

      if (role === "admin") {
        return res
          .status(403)
          .json({ error: "Admins cannot initiate checkout", requestId });
      } else if (role === "student") {
        profileId = userId;
      } else if (role === "guardian") {
        const link = await getPrimaryGuardianLink(userId);
        linkedStudentId = link?.student_user_id ?? null;
        if (!linkedStudentId) {
          return res.status(409).json({
            error: "Link a student before starting guardian checkout",
            code: "LINKED_STUDENT_REQUIRED",
            requestId,
          });
        }
        // Entitlement is student-scoped — profile_id = student's user id
        profileId = linkedStudentId;
      } else {
        return res.status(403).json({ error: "Unsupported role", requestId });
      }

      if (!profileId) {
        return res
          .status(500)
          .json({ error: "Failed to resolve profile", requestId });
      }

      const stripe = await getUncachableStripeClient();

      try {
        await stripe.prices.retrieve(priceId);
      } catch (priceErr: unknown) {
        const msg =
          priceErr instanceof Error
            ? priceErr.message
            : "Price does not exist in Stripe";
        const code = (priceErr as { code?: string })?.code;
        logger.error("BILLING", "checkout", "Price not found in Stripe", {
          priceId,
          plan,
          stripeError: msg,
          stripeCode: code,
          requestId,
        });
        return res.status(400).json({
          error: "Stripe price not found",
          stripeMessage: msg,
          plan,
          priceId: priceId.slice(0, 20) + "...",
          requestId,
        });
      }

      // stripe_customer_id lives on profiles (genesis:149), NOT entitlements
      let customerId = await getProfileStripeCustomerId(profileId);

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user!.email,
          metadata: {
            profile_id: profileId,
            payer_user_id: userId,
            payer_role: role,
          },
        });

        customerId = customer.id;

        // Persist stripe_customer_id on profiles table (genesis:149)
        await setProfileStripeCustomerId(profileId, customerId);

        logger.info("BILLING", "checkout", "Created Stripe customer", {
          userId,
          profileId,
          customerId,
          role,
          requestId,
        });
      } else {
        logger.info(
          "BILLING",
          "checkout",
          "Reusing existing Stripe customer from profile",
          {
            userId,
            profileId,
            customerId,
            role,
            requestId,
          },
        );
      }

      const baseUrl =
        process.env.SITE_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:5000"
          : "https://lyceon.ai");

      const successUrl =
        role === "student"
          ? `${baseUrl}/dashboard?checkout=success`
          : `${baseUrl}/guardian?checkout=success`;
      const cancelUrl =
        role === "student"
          ? `${baseUrl}/dashboard?checkout=cancel`
          : `${baseUrl}/guardian?checkout=cancel`;

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          profile_id: profileId,
          payer_user_id: userId,
          payer_role: role,
          ...(linkedStudentId ? { linked_student_id: linkedStudentId } : {}),
          plan,
          environment:
            process.env.NODE_ENV === "production"
              ? "production"
              : "development",
        },
        client_reference_id: profileId,
        subscription_data: {
          metadata: {
            profile_id: profileId,
            payer_user_id: userId,
            payer_role: role,
            ...(linkedStudentId ? { linked_student_id: linkedStudentId } : {}),
            plan,
          },
        },
      });

      logger.info("BILLING", "checkout", "Created checkout session", {
        userId,
        profileId,
        plan,
        role,
        linkedStudentId,
        sessionId: session.id,
        requestId,
      });

      res.json({ url: session.url, sessionId: session.id, requestId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const raw = (err as { raw?: { message?: string } })?.raw?.message;
      logger.error(
        "STRIPE_CHECKOUT_FAILED",
        "checkout",
        "Failed to create checkout session",
        {
          requestId,
          message: msg,
          type: (err as { type?: string })?.type,
          code: (err as { code?: string })?.code,
          raw,
        },
      );

      return res.status(400).json({
        error: "Failed to create checkout session",
        stripeMessage: raw || msg,
        requestId,
      });
    }
  },
);

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:168–181] @implemented 2026-08-09
 * plain English: billing status endpoint. profile_id = userId. Entitlement is read
 * directly by profile_id — no ensureAccountForUser indirection. tier (not plan) is
 * the genesis column; 'free' when no entitlement row exists.
 */
router.get(
  "/status",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;
    const userRole = normalizeRuntimeRole(req.user!.role);

    // profile_id for the student whose entitlement we're reading
    let profileId: string | null = null;
    let entitlement: Awaited<ReturnType<typeof getEntitlementForProfile>> =
      null;
    let hasLinkedStudent = false;
    let linkRequiredForPremium = false;
    let premiumSource: "student" | "guardian" | "both" | "none";
    let effectiveAccess = false;
    let requiresStudentSubscription = false;
    let lockedReason:
      | "link_required"
      | "student_subscription_required"
      | "student_subscription_expired"
      | "student_payment_past_due"
      | null = null;

    if (userRole === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot access billing status", requestId });
    }

    try {
      if (userRole === "guardian") {
        const link = await getPrimaryGuardianLink(userId);
        hasLinkedStudent = !!link?.student_user_id;
        linkRequiredForPremium = !hasLinkedStudent;
        // Entitlement is student-scoped — profile_id = student's userId
        profileId = link?.student_user_id ?? null;
      } else {
        // Student: profile_id = own userId
        profileId = userId;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("BILLING", "status", "Failed to resolve billing profile", {
        userId,
        err: msg,
        requestId,
      });
      return res.status(503).json({
        error: "Billing status unavailable",
        code: "BILLING_STATUS_UNAVAILABLE",
        requestId,
      });
    }

    try {
      if (profileId) {
        entitlement = await getEntitlementForProfile(profileId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("BILLING", "status", "Failed to get entitlement", {
        userId,
        profileId,
        err: msg,
        requestId,
      });
      return res.status(503).json({
        error: "Billing status unavailable",
        code: "BILLING_STATUS_UNAVAILABLE",
        requestId,
      });
    }

    // Genesis uses `tier` (free/premium), not `plan` (free/paid)
    const tier = entitlement?.tier ?? "free";
    const status = entitlement?.status ?? "inactive";
    const currentPeriodEnd = entitlement?.current_period_end ?? null;

    const isActiveOrTrialing = status === "active" || status === "trialing";
    let periodExpired = false;
    if (currentPeriodEnd) {
      periodExpired = new Date(currentPeriodEnd) < new Date();
    }

    const billingIsPremium =
      tier === "premium" && isActiveOrTrialing && !periodExpired;

    try {
      if (userRole === "guardian") {
        const access = await resolveLinkedPairPremiumAccessForGuardian(userId);
        hasLinkedStudent = access.hasActiveLink;
        linkRequiredForPremium = !hasLinkedStudent;
        premiumSource = access.premiumSource;
        effectiveAccess = access.hasPremiumAccess;
        if (!effectiveAccess && hasLinkedStudent) {
          lockedReason = access.studentEntitlementExpired
            ? "student_subscription_expired"
            : access.studentEntitlementStatus === "past_due"
              ? "student_payment_past_due"
              : "student_subscription_required";
        }
      } else {
        const access = await resolveLinkedPairPremiumAccessForStudent(userId);
        premiumSource = access.premiumSource;
        effectiveAccess = access.hasPremiumAccess;
        if (!effectiveAccess) {
          lockedReason = access.studentEntitlementExpired
            ? "student_subscription_expired"
            : access.studentEntitlementStatus === "past_due"
              ? "student_payment_past_due"
              : "student_subscription_required";
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        "BILLING",
        "status",
        "Failed to resolve student-owned premium access",
        {
          userId,
          role: userRole,
          error: msg,
          requestId,
        },
      );
      return res.status(503).json({
        error: "Billing status unavailable",
        code: "BILLING_STATUS_UNAVAILABLE",
        requestId,
      });
    }

    if (linkRequiredForPremium) {
      lockedReason = "link_required";
    }

    const needsPaymentUpdate =
      !effectiveAccess &&
      !linkRequiredForPremium &&
      (lockedReason === "student_subscription_expired" ||
        lockedReason === "student_payment_past_due");
    requiresStudentSubscription =
      !effectiveAccess &&
      !linkRequiredForPremium &&
      lockedReason === "student_subscription_required";

    logger.info("BILLING", "status", "Billing status retrieved", {
      userId,
      profileId,
      tier,
      billingStatus: status,
      effectiveAccess,
      premiumSource,
      hasLinkedStudent,
      linkRequiredForPremium,
      needsPaymentUpdate,
      requiresStudentSubscription,
      lockedReason,
      requestId,
    });

    res.json({
      accountId: profileId,
      tier,
      plan: tier === "premium" ? "paid" : "free",
      stripeStatus: status,
      currentPeriodEnd,
      stripeSubscriptionId: entitlement?.stripe_subscription_id ?? null,
      effectiveAccess,
      needsPaymentUpdate,
      requiresStudentSubscription,
      isPaid: billingIsPremium,
      premiumSource,
      hasLinkedStudent,
      linkRequiredForPremium,
      lockedReason,
      billingOwnerRole: "student",
      requestId,
    });
  },
);

router.get(
  "/products",
  requireSupabaseAuth,
  requireGuardianBillingAccess,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const products = await billingStorage.listProducts();
      res.json({ products, requestId });
    } catch (err: any) {
      logger.error("BILLING", "products", "Failed to list products", {
        err: err.message,
        requestId,
      });
      res.status(500).json({ error: "Failed to list products", requestId });
    }
  },
);

type BillingPlanKey = "monthly" | "quarterly" | "yearly";

type BillingPlanMetadata = {
  plan: BillingPlanKey;
  label: string;
  amountCents: number;
  currency: string;
  intervalLabel: string;
  equivalentMonthlyCents?: number;
  savingsPercent?: number;
  stripePriceIdConfigured: boolean;
};

const planFallbacks: Record<
  BillingPlanKey,
  Omit<BillingPlanMetadata, "plan" | "stripePriceIdConfigured">
> = {
  monthly: {
    label: "Monthly",
    amountCents: 9999,
    currency: "usd",
    intervalLabel: "per month",
    equivalentMonthlyCents: 9999,
    savingsPercent: 0,
  },
  quarterly: {
    label: "Quarterly",
    amountCents: 19999,
    currency: "usd",
    intervalLabel: "per 3 months",
    equivalentMonthlyCents: 6666,
    savingsPercent: 33.3,
  },
  yearly: {
    label: "Yearly",
    amountCents: 69999,
    currency: "usd",
    intervalLabel: "per year",
    equivalentMonthlyCents: 5833,
    savingsPercent: 41.7,
  },
};

function toIntervalLabel(
  interval: string | null | undefined,
  intervalCount: number | null | undefined,
): string | null {
  if (!interval || !intervalCount || intervalCount < 1) return null;
  if (interval === "month" && intervalCount === 1) return "per month";
  if (interval === "month" && intervalCount === 3) return "per 3 months";
  if (interval === "year" && intervalCount === 1) return "per year";
  if (intervalCount === 1) return `per ${interval}`;
  return `per ${intervalCount} ${interval}s`;
}

async function getPlansHandler(req: Request, res: Response) {
  const requestId = req.requestId;
  res.setHeader("Cache-Control", "no-store");
  try {
    const monthlyId = process.env.STRIPE_PRICE_PARENT_MONTHLY;
    const quarterlyId = process.env.STRIPE_PRICE_PARENT_QUARTERLY;
    const yearlyId = process.env.STRIPE_PRICE_PARENT_YEARLY;

    const ids: Record<BillingPlanKey, string | undefined> = {
      monthly: monthlyId,
      quarterly: quarterlyId,
      yearly: yearlyId,
    };

    const stripe = await getUncachableStripeClient();
    const plans: BillingPlanMetadata[] = await Promise.all(
      (Object.keys(ids) as BillingPlanKey[]).map(async (planKey) => {
        const fallback = planFallbacks[planKey];
        const configuredPriceId = ids[planKey];

        if (!configuredPriceId || !configuredPriceId.startsWith("price_")) {
          return {
            plan: planKey,
            ...fallback,
            stripePriceIdConfigured: false,
          };
        }

        try {
          const stripePrice = await stripe.prices.retrieve(configuredPriceId);
          const stripeAmount =
            typeof stripePrice.unit_amount === "number"
              ? stripePrice.unit_amount
              : fallback.amountCents;
          const stripeCurrency =
            typeof stripePrice.currency === "string"
              ? stripePrice.currency.toLowerCase()
              : fallback.currency;
          const stripeInterval =
            toIntervalLabel(
              stripePrice.recurring?.interval ?? null,
              stripePrice.recurring?.interval_count ?? null,
            ) ?? fallback.intervalLabel;

          return {
            plan: planKey,
            label: fallback.label,
            amountCents: stripeAmount,
            currency: stripeCurrency,
            intervalLabel: stripeInterval,
            equivalentMonthlyCents: fallback.equivalentMonthlyCents,
            savingsPercent: fallback.savingsPercent,
            stripePriceIdConfigured: true,
          };
        } catch (err: any) {
          logger.warn(
            "BILLING",
            "plans",
            "Failed to load Stripe price metadata, returning fallback",
            {
              plan: planKey,
              requestId,
              error: err?.message,
            },
          );

          return {
            plan: planKey,
            ...fallback,
            stripePriceIdConfigured: true,
          };
        }
      }),
    );

    res.json({ plans, requestId });
  } catch (err: any) {
    logger.error("BILLING", "plans", "Failed to list plans", {
      err: err.message,
      requestId,
    });
    res.status(500).json({ error: "Failed to list plans", requestId });
  }
}

router.get("/plans", requireSupabaseAuth, getPlansHandler);
router.get(
  "/products/:productId/prices",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const { productId } = req.params;
      const product = await billingStorage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found", requestId });
      }

      const prices = await billingStorage.getPricesForProduct(productId);
      res.json({ prices, requestId });
    } catch (err: any) {
      logger.error("BILLING", "prices", "Failed to get prices", {
        err: err.message,
        requestId,
      });
      res.status(500).json({ error: "Failed to get prices", requestId });
    }
  },
);

router.get("/portal", (req, res) => {
  return res.status(405).json({
    error: "Method Not Allowed. Use POST /api/billing/portal.",
  });
});

/**
 * @spec [Doc-01_V8 §20–§24; genesis.sql:149] @implemented 2026-08-09
 * plain English: open Stripe billing portal. stripe_customer_id lives on profiles (genesis:149).
 * profile_id = userId for students, = linked student's userId for guardians.
 */
router.post(
  "/portal",
  requireSupabaseAuth,
  csrfProtection,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    try {
      const userId = req.user!.id;
      const userRole = normalizeRuntimeRole(req.user!.role);

      if (userRole === "admin") {
        return res
          .status(403)
          .json({ error: "Admins cannot access billing portal", requestId });
      }

      let profileId: string | null = null;

      if (userRole === "guardian") {
        const link = await getPrimaryGuardianLink(userId);
        if (!link?.student_user_id) {
          return res.status(409).json({
            error: "Link a student before opening guardian billing portal",
            code: "LINKED_STUDENT_REQUIRED",
            requestId,
          });
        }
        profileId = link.student_user_id;
      } else {
        profileId = userId;
      }

      // stripe_customer_id lives on profiles (genesis:149)
      const customerId = await getProfileStripeCustomerId(profileId);

      if (!customerId) {
        return res
          .status(400)
          .json({
            error: "No billing account found for this profile",
            requestId,
          });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl =
        process.env.SITE_URL ||
        (process.env.NODE_ENV === "development"
          ? "http://localhost:5000"
          : "https://lyceon.ai");

      const returnUrl =
        userRole === "guardian"
          ? `${baseUrl}/guardian`
          : `${baseUrl}/dashboard`;

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return res.json({ url: session.url, requestId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("BILLING", "portal", "Failed to create portal session", {
        err: msg,
        requestId,
      });
      return res
        .status(500)
        .json({ error: "Failed to create portal session", requestId });
    }
  },
);

router.get("/publishable-key", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const publishableKey = await getStripePublishableKeySafe();
    res.json({ publishableKey, requestId });
  } catch (err: any) {
    logger.error(
      "BILLING",
      "publishable-key",
      "Failed to get publishable key",
      { err: err.message, requestId },
    );
    res.status(500).json({ error: "Failed to get publishable key", requestId });
  }
});

function safeIdInfo(id: string | undefined): {
  prefix: string | null;
  last4: string | null;
  length: number;
} {
  if (!id) return { prefix: null, last4: null, length: 0 };
  return {
    prefix: id.slice(0, 12),
    last4: id.length > 4 ? id.slice(-4) : id,
    length: id.length,
  };
}

router.get(
  "/debug/env",
  requireSupabaseAuth,
  requireGuardianBillingAccess,
  async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const requestId = req.requestId;
    const stripeEnvRaw = process.env.STRIPE_ENV || null;
    const stripeEnvNormalized =
      stripeEnvRaw?.toLowerCase() === "live" ? "live" : "test";
    const secretKey = process.env.STRIPE_SECRET_KEY || "";
    const pubKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
    const monthlyId = process.env.STRIPE_PRICE_PARENT_MONTHLY || "";
    const quarterlyId = process.env.STRIPE_PRICE_PARENT_QUARTERLY || "";
    const yearlyId = process.env.STRIPE_PRICE_PARENT_YEARLY || "";

    const keyMode = secretKey.startsWith("sk_live_")
      ? "live"
      : secretKey.startsWith("sk_test_")
        ? "test"
        : "unknown";
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
        STRIPE_PRICE_PARENT_QUARTERLY:
          !!process.env.STRIPE_PRICE_PARENT_QUARTERLY,
        STRIPE_PRICE_PARENT_YEARLY: !!process.env.STRIPE_PRICE_PARENT_YEARLY,
        SITE_URL: !!process.env.SITE_URL,
      },
      siteUrl: process.env.SITE_URL || null,
      requestId,
    });
  },
);

router.get(
  "/debug/validate",
  requireSupabaseAuth,
  requireGuardianBillingAccess,
  async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const requestId = req.requestId;
    const secretKey = process.env.STRIPE_SECRET_KEY || "";
    const mode = secretKey.startsWith("sk_live_")
      ? "live"
      : secretKey.startsWith("sk_test_")
        ? "test"
        : "unknown";

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
            error: "Price ID not configured",
            priceIdPrefix: null,
            priceIdLast4: null,
            priceIdLen: 0,
          };
          continue;
        }

        if (!priceId.startsWith("price_")) {
          results[plan] = {
            ok: false,
            error: "Invalid price ID format (must start with price_)",
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
            recurring: price.recurring
              ? {
                  interval: price.recurring.interval,
                  intervalCount: price.recurring.interval_count,
                }
              : null,
            productId:
              typeof price.product === "string"
                ? price.product
                : (price.product as any)?.id,
          };
        } catch (err: any) {
          results[plan] = {
            ok: false,
            priceIdPrefix: idInfo.prefix,
            priceIdLast4: idInfo.last4,
            priceIdLen: idInfo.length,
            stripeErrorType: err?.type || null,
            stripeErrorCode: err?.code || null,
            stripeErrorMessage: err?.message || "Unknown error",
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
      logger.error("BILLING", "debug/validate", "Failed to validate prices", {
        err: err.message,
        requestId,
      });
      res.status(500).json({
        ok: false,
        error: "Failed to initialize Stripe client",
        stripeMessage: err?.message,
        requestId,
      });
    }
  },
);

export default router;
