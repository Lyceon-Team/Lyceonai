/**
 * @spec [Doc-01_V8 §20 (verified heading "## **§20 Subscription model**"), §22;
 *        SCL-043 payer identity; SCL-052 one entitlement tier] @implemented 2026-08-20
 *
 * plain English: the billing surface, rebuilt in Phase C for the
 * unaccompanied-student path. The previous module was not adapted.
 *
 * What this serves and what it does not:
 *  - Unaccompanied student pays for self. The payer IS the student, so the
 *    Stripe Customer and the entitled profile coincide (SCL-043's simplest case).
 *  - Guardian-paid and third-party-paid checkout are NOT served here. They are
 *    blocked on the guardian-link data-layer defect
 *    (docs/plans/WS-GL_Guardian_Link_Data_Layer.md) and on SCL-045's item-level
 *    entitlement key, which needs DDL that the WS-M freeze forbids
 *    (docs/plans/STRIPE_DDL_QUEUE.md D-1). Guardians receive an explicit
 *    unavailable response naming the blocker rather than a crash or a
 *    misleading free-tier answer.
 *  - Consent capture (`consent_collection` / `custom_text`) is deliberately NOT
 *    built. Owner ruling: consent is Phase C.2, gated on the billing terms page,
 *    carried as a launch gate on SCL-044. The Dashboard Terms-of-Service URL is
 *    NOT to be set as a workaround.
 *
 * expected outcome: a student can start Checkout, and every entitlement fact the
 * status endpoint reports is read from the database, never from the caller.
 *
 * trade-offs / edge cases:
 *  - `/status` reports entitlement from `entitlements` only. It does not compute
 *    access; the canonical gate is `EntitlementService.isEntitlementActiveForProfile`.
 *  - Entitlement rows are never created here. The Stripe webhook handler is the
 *    canonical writer (Doc 01 V8 Appendix E ownership matrix).
 */
import { Request, Response, Router } from "express";
import { z } from "zod";
import {
  requireSupabaseAuth,
  sendUnauthenticated,
} from "../middleware/supabase-auth";
import {
  getStripeClient,
  getStripePublishableKey,
  getPriceId,
  getConfiguredPriceId,
  BILLING_PERIODS,
  type BillingPeriod,
} from "../lib/stripe/client";
import {
  getEntitlementForProfile,
  getProfileStripeCustomerId,
  setProfileStripeCustomerId,
} from "../lib/account";
import { logger } from "../logger";
import { digestId } from "../lib/stripe/redact";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import { normalizeRuntimeRole } from "../lib/auth-role";

const router = Router();

/**
 * Guardian-paid billing is unbuilt, not broken-by-omission. One response, one
 * code, one place — so the reason is greppable when WS-GL lands.
 */
const GUARDIAN_BLOCKED = {
  error:
    "Guardian-paid billing is not available yet. Student self-purchase is supported.",
  code: "GUARDIAN_BILLING_UNAVAILABLE" as const,
};

function sendGuardianBlocked(res: Response, requestId?: string): Response {
  return res.status(503).json({ ...GUARDIAN_BLOCKED, requestId });
}

/**
 * The ONLY field a caller supplies. `.strict()` rejects unknown keys, so a
 * client cannot smuggle a profile id, a price id, or an entitlement claim.
 */
const checkoutSchema = z.object({ plan: z.enum(BILLING_PERIODS) }).strict();

function siteBaseUrl(): string {
  return (
    process.env.SITE_URL ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:5000"
      : "https://lyceon.ai")
  );
}

/**
 * POST /api/billing/checkout — start a subscription Checkout Session.
 *
 * The entitled student is `req.user.id`, taken from the authenticated session.
 * Nothing in the request body selects the subject.
 */
router.post(
  "/checkout",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user?.id;
    const role = normalizeRuntimeRole(req.user?.role);

    if (!userId || !role) return sendUnauthenticated(res, requestId);

    if (role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot initiate checkout", requestId });
    }
    if (role === "guardian") {
      return sendGuardianBlocked(res, requestId);
    }

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid input", details: parsed.error.flatten() },
        requestId,
      });
    }

    const plan: BillingPeriod = parsed.data.plan;
    const studentProfileId = userId;

    try {
      const priceId = getPriceId(plan);
      const stripe = getStripeClient();

      let customerId = await getProfileStripeCustomerId(studentProfileId);
      if (!customerId) {
        // Unaccompanied case: the payer IS the student, so the Customer email is
        // the student's own. In the guardian and third-party cases the Customer
        // email must be the payer's (SCL-044) — one reason those paths are not
        // served here.
        const customer = await stripe.customers.create({
          email: req.user?.email,
          metadata: {
            student_profile_id: studentProfileId,
            payer_profile_id: studentProfileId,
            payer_relationship: "self",
          },
        });
        customerId = customer.id;
        await setProfileStripeCustomerId(studentProfileId, customerId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${siteBaseUrl()}/dashboard?checkout=success`,
        cancel_url: `${siteBaseUrl()}/dashboard?checkout=cancel`,
        // SCL-043: the authoritative payer-to-student mapping.
        client_reference_id: studentProfileId,
        metadata: {
          student_profile_id: studentProfileId,
          payer_relationship: "self",
          plan,
        },
        subscription_data: {
          metadata: {
            student_profile_id: studentProfileId,
            payer_relationship: "self",
            plan,
          },
        },
      });

      // Charter §6: on the unaccompanied path the student IS the payer, so the
      // profile id and the Checkout Session id are both payer identifiers.
      logger.info("BILLING", "checkout", "Checkout session created", {
        requestId,
        studentProfileRef: digestId(studentProfileId),
        plan,
        sessionRef: digestId(session.id),
      });

      return res.json({ url: session.url, sessionId: session.id, requestId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("BILLING", "checkout", "Failed to create checkout session", {
        requestId,
        studentProfileRef: digestId(studentProfileId),
        plan,
        message,
      });
      return res
        .status(502)
        .json({ error: "Failed to start checkout", requestId });
    }
  },
);

/**
 * GET /api/billing/status — the student's own entitlement state, read from the
 * database. Reports; does not decide. The gate is EntitlementService.
 */
router.get(
  "/status",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user?.id;
    const role = normalizeRuntimeRole(req.user?.role);

    if (!userId || !role) return sendUnauthenticated(res, requestId);
    if (role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot access billing status", requestId });
    }
    if (role === "guardian") {
      return sendGuardianBlocked(res, requestId);
    }

    try {
      const entitlement = await getEntitlementForProfile(userId);

      const tier = entitlement?.tier ?? "free";
      const status = entitlement?.status ?? "inactive";
      const currentPeriodEnd = entitlement?.current_period_end ?? null;

      // The entitled set is {active, past_due, trialing} — the canonical SQL
      // predicate's set (SCL-029). Mirrored here for display only; the gate
      // itself calls entitlement_active().
      const entitledStatuses = new Set(["active", "past_due", "trialing"]);
      const effectiveAccess = tier === "premium" && entitledStatuses.has(status);

      return res.json({
        plan: tier,
        stripeStatus: status,
        currentPeriodEnd,
        stripeSubscriptionId: entitlement?.stripe_subscription_id ?? null,
        effectiveAccess,
        needsPaymentUpdate: status === "past_due" || status === "unpaid",
        isPaid: effectiveAccess,
        requestId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("BILLING", "status", "Failed to read entitlement", {
        requestId,
        profileRef: digestId(userId),
        message,
      });
      // Fail closed: an entitlement read failure never renders as free-tier
      // success, and never as paid.
      return res.status(503).json({
        error: "Billing status unavailable",
        code: "BILLING_STATUS_UNAVAILABLE",
        requestId,
      });
    }
  },
);

/**
 * POST /api/billing/portal — Stripe Billing Portal session.
 *
 * Stripe supplies the cancellation surface the Subscription and Auto-Renewal
 * Notice §6.4 requires ("click to cancel" through the customer portal). No
 * bespoke cancellation surface is built.
 * https://docs.stripe.com/customer-management/configure-portal
 */
router.post(
  "/portal",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user?.id;
    const role = normalizeRuntimeRole(req.user?.role);

    if (!userId || !role) return sendUnauthenticated(res, requestId);
    if (role === "admin") {
      return res
        .status(403)
        .json({ error: "Admins cannot access the billing portal", requestId });
    }
    if (role === "guardian") {
      return sendGuardianBlocked(res, requestId);
    }

    try {
      const customerId = await getProfileStripeCustomerId(userId);
      if (!customerId) {
        return res.status(409).json({
          error: "No billing account exists for this profile yet",
          code: "NO_STRIPE_CUSTOMER",
          requestId,
        });
      }

      const session = await getStripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: `${siteBaseUrl()}/dashboard`,
      });

      return res.json({ url: session.url, requestId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("BILLING", "portal", "Failed to create portal session", {
        requestId,
        profileRef: digestId(userId),
        message,
      });
      return res
        .status(502)
        .json({ error: "Failed to open billing portal", requestId });
    }
  },
);

type BillingPlanMetadata = {
  plan: BillingPeriod;
  label: string;
  amountCents: number | null;
  currency: string | null;
  intervalLabel: string | null;
  stripePriceIdConfigured: boolean;
};

const PLAN_LABEL: Record<BillingPeriod, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function intervalLabel(
  interval: string | null | undefined,
  count: number | null | undefined,
): string | null {
  if (!interval || !count || count < 1) return null;
  if (interval === "month" && count === 1) return "per month";
  if (interval === "month") return `per ${count} months`;
  if (interval === "year" && count === 1) return "per year";
  return `per ${count} ${interval}s`;
}

/**
 * GET /api/billing/plans — price metadata read live from Stripe.
 *
 * No hardcoded amounts. Doc 09 §1.4 and §5.1 make Stripe canonical for pricing
 * magnitudes at runtime; the previous module carried two hardcoded and mutually
 * inconsistent USD price sets (STRIPE_GROUNDING_AUDIT G-27). A price Stripe
 * cannot return is reported as unavailable, never as a guessed number.
 */
router.get(
  "/plans",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    res.setHeader("Cache-Control", "no-store");

    try {
      const stripe = getStripeClient();
      const plans: BillingPlanMetadata[] = await Promise.all(
        BILLING_PERIODS.map(async (plan) => {
          const priceId = getConfiguredPriceId(plan);
          if (!priceId) {
            return {
              plan,
              label: PLAN_LABEL[plan],
              amountCents: null,
              currency: null,
              intervalLabel: null,
              stripePriceIdConfigured: false,
            };
          }
          const price = await stripe.prices.retrieve(priceId);
          return {
            plan,
            label: PLAN_LABEL[plan],
            amountCents: price.unit_amount ?? null,
            currency: price.currency?.toLowerCase() ?? null,
            intervalLabel: intervalLabel(
              price.recurring?.interval ?? null,
              price.recurring?.interval_count ?? null,
            ),
            stripePriceIdConfigured: true,
          };
        }),
      );

      return res.json({ plans, requestId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error("BILLING", "plans", "Failed to load plans from Stripe", {
        requestId,
        message,
      });
      return res
        .status(502)
        .json({ error: "Failed to load billing plans", requestId });
    }
  },
);

/** GET /api/billing/publishable-key — public by design. */
router.get("/publishable-key", (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    return res.json({ publishableKey: getStripePublishableKey(), requestId });
  } catch {
    logger.error(
      "BILLING",
      "publishable_key",
      "STRIPE_PUBLISHABLE_KEY is not configured",
      { requestId },
    );
    return res
      .status(503)
      .json({ error: "Billing is not configured", requestId });
  }
});

export default router;
