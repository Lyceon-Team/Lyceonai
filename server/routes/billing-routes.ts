/**
 * @spec [Doc-01_V8 §20 (verified heading "## **§20 Subscription model**"), §22;
 *        SCL-043 payer identity; SCL-052 one entitlement tier] @implemented 2026-08-20
 *
 * plain English: the billing surface. Five routes: POST /checkout, GET /status,
 * POST /portal, GET /plans, GET /publishable-key.
 *
 * What this serves:
 *  - Self-pay. An unaccompanied student pays for themselves, so the Stripe
 *    Customer and the entitled profile coincide (SCL-043's simplest case).
 *  - Guardian-paid, per student. The guardian names ONE actively linked student.
 *    Their first purchase creates the subscription through Checkout; every
 *    purchase after adds a SubscriptionItem to that same subscription. The
 *    selected id is authorised against this server's own read of `guardian_links`
 *    (Charter §6) — it selects, it never grants.
 *
 * What this does NOT serve:
 *  - Third-party-paid checkout. The payer is always the authenticated caller.
 *  - Consent capture (`consent_collection` / `custom_text`) is deliberately NOT
 *    built. Owner ruling: consent is Phase C.2, gated on the billing terms page,
 *    carried as a launch gate on SCL-044. The Dashboard Terms-of-Service URL is
 *    NOT to be set as a workaround.
 *
 * ORDER ON THE GUARDIAN PATH: BRANCH FIRST, THEN GATE. Whether a purchase is a
 * first purchase or an add-item is decided BEFORE the country gate runs, because
 * the two need different verdicts: a first purchase has no billing address yet
 * and must reach Checkout to collect one. See the note at the `isGuardian`
 * branch, which records the defect that ordering fixed.
 *
 * expected outcome: a student or a guardian can start Checkout, and every
 * entitlement fact the status endpoint reports is read from the database, never
 * from the caller.
 *
 * trade-offs / edge cases:
 *  - No gate is DEFINED here. Country eligibility is evaluated by
 *    `server/lib/stripe/country-eligibility.ts`; this file only calls it.
 *  - `/status` reports entitlement from `entitlements` only. It does not compute
 *    access; the canonical gate is `EntitlementService.isEntitlementActiveForProfile`.
 *  - Entitlement rows are never created here. The Stripe webhook handler is the
 *    canonical writer (Doc 01 V8 Appendix E ownership matrix).
 */
import { Request, Response, Router } from "express";
import type Stripe from "stripe";
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
  getAllGuardianStudentLinks,
  resolveLinkedPairPremiumAccessForGuardian,
} from "../lib/account";
import {
  resolveGuardianPurchaseSubject,
  subscriptionAlreadyFundsStudent,
} from "../lib/stripe/guardian-checkout";
import { evaluateSubjectPurchaseEligibility } from "../lib/stripe/purchase-eligibility";
import {
  evaluateCountryEligibility,
  deniesEntitlement,
  blocksCheckout,
} from "../lib/stripe/country-eligibility";
import { getTier1Countries } from "../lib/entitlement-runtime-config";
import { billingCheckoutRequestSchema } from "../../packages/shared/src/billing-schema";

import { logger } from "../logger";
import { digestId } from "../lib/stripe/redact";
import { classifyError } from "../lib/redact";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import { normalizeRuntimeRole } from "../lib/auth-role";

/**
 * How many of a guardian's subscriptions to scan when deciding whether to add
 * an item or start one. The product creates at most ONE per payer, so this only
 * has to be large enough to detect the anomaly it fails closed on.
 */
const GUARDIAN_SUBSCRIPTION_SCAN_LIMIT = 10;

const router = Router();

/**
 * The ONLY field a caller supplies. `.strict()` rejects unknown keys, so a
 * client cannot smuggle a profile id, a price id, or an entitlement claim.
 */
const checkoutSchema = billingCheckoutRequestSchema;

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
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid input", details: parsed.error.flatten() },
        requestId,
      });
    }

    const plan: BillingPeriod = parsed.data.plan;
    // SCL-043: the PAYER is always the authenticated caller. On the
    // unaccompanied path the payer and the student are the same person; on the
    // guardian path they are not, and conflating them is what SCL-043 exists to
    // prevent. Both names below refer to `userId`, and only the SELF path may
    // read `studentProfileId` as a subject.
    const payerProfileId = userId;
    const studentProfileId = userId;
    const isGuardian = role === "guardian";

    try {
      /**
       * ONE RULE, BOTH ROUTES — the self-pay half.
       *
       * @spec [Doc 01 V8 §20; SCL-029] | @implemented [2026-09-02]
       *
       * Runs BEFORE `getStripeClient()` and before the Customer is created, so
       * a student who already has a subscription causes no Stripe object of any
       * kind to come into existence. The guardian half runs at its own earliest
       * point — immediately after `resolveGuardianPurchaseSubject`, since the
       * subject there is not known until the links are read.
       *
       * The subject on this path is the authenticated caller; nothing in the
       * body selects it.
       */
      if (!isGuardian) {
        const eligibility =
          await evaluateSubjectPurchaseEligibility(studentProfileId);
        if (!eligibility.ok) {
          logger.info("BILLING", "checkout", "Self-pay purchase refused", {
            requestId,
            studentProfileId,
            code: eligibility.code,
          });
          return res
            .status(eligibility.code === "ENTITLEMENT_UNREADABLE" ? 503 : 409)
            .json({
              error: { message: eligibility.reason, code: eligibility.code },
              requestId,
            });
        }
      }

      const priceId = getPriceId(plan);
      const stripe = getStripeClient();

      let customerId = await getProfileStripeCustomerId(payerProfileId);
      if (!customerId) {
        // SCL-044: the Customer email is the PAYER's, on both paths — the
        // guardian's own on the guardian path, the student's on the
        // unaccompanied path where they are the same person. The Customer is
        // never stamped with a student on the guardian path: one Customer funds
        // several students, so naming one of them here would be wrong for the
        // rest.
        const customer = await stripe.customers.create({
          email: req.user?.email,
          metadata: isGuardian
            ? {
                payer_profile_id: payerProfileId,
                payer_relationship: "guardian",
              }
            : {
                student_profile_id: studentProfileId,
                payer_profile_id: payerProfileId,
                payer_relationship: "self",
              },
        });
        customerId = customer.id;
        await setProfileStripeCustomerId(payerProfileId, customerId);
      }

      let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
      let sessionMetadata: Record<string, string>;

      /**
       * §4.8 GUARDIAN-PAID PURCHASE — PER STUDENT. The production call site.
       *
       * @spec [Doc 01 V8 §20 "Who pays"; §31.4; §36.4; SCL-043 payer identity;
       *        SCL-044 payer email; SCL-045 one SubscriptionItem per student;
       *        Charter §6] | @implemented [2026-08-28 — owner ruling]
       *
       * plain English: the guardian picks ONE linked student and pays for that
       * student. Expected outcome: their first purchase creates a subscription
       * with a single item; every purchase after adds an item to that same
       * subscription. Trade-off: two children means two transactions, which is
       * the point — the alternative charged for children the guardian never
       * chose. Edge cases: no links, a student they are not linked to, and a
       * student already funded — all refused before any money moves.
       *
       * ONE CUSTOMER, ONE SUBSCRIPTION, ONE INVOICE. The second student is a new
       * SubscriptionItem on the EXISTING subscription, never a second
       * subscription. Stripe prorates that natively — `proration_behavior`
       * defaults to `create_prorations` (stripe@20.4.1,
       * `SubscriptionItemsResource.d.ts`: "The default value is
       * `create_prorations`", citing
       * https://docs.stripe.com/billing/subscriptions/prorations) — so the
       * default is deliberately NOT overridden: the guardian is charged for the
       * remainder of the current period and everything lands on one invoice.
       */
      if (isGuardian) {
        const activeLinks = await getAllGuardianStudentLinks(payerProfileId);
        const subject = resolveGuardianPurchaseSubject(
          activeLinks,
          parsed.data.student_profile_id,
        );
        if (!subject.ok) {
          // Not a 500: every one of these is a legitimate client state with a
          // specific remedy, and the code names which.
          logger.info("BILLING", "checkout", "Guardian purchase refused", {
            requestId,
            payerProfileId,
            code: subject.code,
            reason: subject.reason,
          });
          return res
            .status(subject.code === "STUDENT_NOT_SELECTED" ? 400 : 409)
            .json({
              error: { message: subject.reason, code: subject.code },
              requestId,
            });
        }
        const selectedStudentId = subject.studentProfileId;

        /**
         * ONE RULE, BOTH ROUTES — the guardian half. Same function, same code,
         * asked about the SELECTED STUDENT rather than the guardian: a guardian
         * with premium access derived from child A must still be able to buy
         * for child B.
         *
         * This runs before `subscriptions.list` and before either write branch,
         * so a refusal creates no Stripe object. It does NOT replace
         * `subscriptionAlreadyFundsStudent` below — that answers a different
         * question of a different source (does this guardian's own subscription
         * already carry an item for this student), and it stays because it
         * closes the window before the webhook has written the row.
         */
        const guardianEligibility =
          await evaluateSubjectPurchaseEligibility(selectedStudentId);
        if (!guardianEligibility.ok) {
          logger.info("BILLING", "checkout", "Guardian purchase refused", {
            requestId,
            payerProfileId,
            code: guardianEligibility.code,
          });
          return res
            .status(
              guardianEligibility.code === "ENTITLEMENT_UNREADABLE" ? 503 : 409,
            )
            .json({
              error: {
                message: guardianEligibility.reason,
                code: guardianEligibility.code,
              },
              requestId,
            });
        }

        /**
         * BRANCH FIRST, THEN GATE. The order is the fix.
         *
         * @revised [2026-08-28 — Codex HIGH-3]
         *
         * The gate previously ran BEFORE this lookup, treating `unknown` as a
         * denial for every guardian. A guardian's FIRST purchase creates a
         * Customer with no address (there is nowhere to have got one yet), so
         * the country was always `unknown` and the first purchase was refused
         * before Stripe could collect an address. The passing test hid it by
         * handing the freshly created Customer a US address.
         *
         * The two branches need DIFFERENT verdicts, which is exactly the split
         * `country-eligibility.ts` already documents and which I applied
         * wrongly:
         *
         *   first purchase  -> `blocksCheckout`: only a KNOWN ineligible
         *                      country refuses. `unknown` proceeds, because the
         *                      address does not exist until the customer types
         *                      it during Checkout — and the completed-session
         *                      gate then enforces it before any entitlement.
         *   add-item        -> `deniesEntitlement`: `unknown` REFUSES. The
         *                      Customer already has an address by now, so not knowing
         *                      one is a fault, and this path grants entitlement
         *                      without a later Checkout gate to catch it.
         */
        const existing = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: GUARDIAN_SUBSCRIPTION_SCAN_LIMIT,
        });
        if (existing.data.length > 1) {
          logger.error(
            "BILLING",
            "checkout",
            "Guardian has several active subscriptions; refusing to guess which to extend",
            { requestId, payerProfileId, count: existing.data.length },
          );
          return res.status(409).json({
            error: {
              message:
                "This account has more than one active subscription. Contact support.",
              code: "AMBIGUOUS_SUBSCRIPTION",
            },
            requestId,
          });
        }

        const isAddItem = existing.data.length === 1;

        const customer = await stripe.customers.retrieve(customerId);
        const payerCountry =
          "deleted" in customer && customer.deleted
            ? null
            : (customer as Stripe.Customer).address?.country;
        const eligibility = evaluateCountryEligibility(
          payerCountry,
          await getTier1Countries(),
        );
        const refuses = isAddItem
          ? deniesEntitlement(eligibility)
          : blocksCheckout(eligibility);
        if (refuses) {
          logger.warn(
            "BILLING",
            "checkout",
            "Guardian purchase refused by INV-03-08 country gate",
            {
              requestId,
              payerProfileId,
              verdict: eligibility.verdict,
              path: isAddItem ? "add_item" : "first_purchase",
            },
          );
          return res.status(403).json({
            error: {
              message:
                "This account's billing country is not eligible for premium at launch.",
              code: "COUNTRY_NOT_ELIGIBLE",
            },
            requestId,
          });
        }

        const currentSubscription = existing.data[0];

        if (currentSubscription) {
          // ---- ADD AN ITEM TO THE EXISTING SUBSCRIPTION ----------------
          if (
            subscriptionAlreadyFundsStudent(
              currentSubscription.items?.data ?? [],
              selectedStudentId,
            )
          ) {
            return res.status(409).json({
              error: {
                message:
                  "This student is already covered by your subscription.",
                code: "STUDENT_ALREADY_FUNDED",
              },
              requestId,
            });
          }

          // Metadata is set DIRECTLY on the item here, so this path does not
          // depend on Checkout propagating `line_items[].metadata` — the one
          // mechanism §4.8's plan could never verify. Only a guardian's FIRST
          // purchase goes through Checkout at all.
          const item = await stripe.subscriptionItems.create({
            subscription: currentSubscription.id,
            price: priceId,
            quantity: 1,
            // proration_behavior deliberately omitted: Stripe's default
            // `create_prorations` is exactly the wanted behaviour.
            metadata: { student_profile_id: selectedStudentId },
          });

          logger.info(
            "BILLING",
            "checkout",
            "Student added to existing subscription",
            {
              requestId,
              payerProfileId,
              studentProfileId: selectedStudentId,
              subscriptionId: currentSubscription.id,
              subscriptionItemId: item.id,
              plan,
            },
          );

          return res.json({
            kind: "item_added",
            subscriptionItemId: item.id,
            requestId,
          });
        }

        // ---- FIRST PURCHASE: CREATE THE SUBSCRIPTION VIA CHECKOUT -------
        //
        // The subscription metadata names BOTH the payer and the single
        // student. The payer marks it guardian-paid; the student is the
        // subscription-level fallback the webhook uses when a one-item
        // subscription's item carries no metadata of its own. That fallback is
        // what makes this path safe WITHOUT the unverified propagation probe.
        lineItems = [
          {
            price: priceId,
            quantity: 1,
            metadata: { student_profile_id: selectedStudentId },
          },
        ];
        sessionMetadata = {
          payer_profile_id: payerProfileId,
          student_profile_id: selectedStudentId,
          payer_relationship: "guardian",
          plan,
        };
      } else {
        if (parsed.data.student_profile_id) {
          // Rejected, not ignored: a student who thinks they bought for someone
          // else must be told they did not.
          return res.status(400).json({
            error: {
              message:
                "A student purchase cannot name another student. Only guardians buy for a linked student.",
              code: "STUDENT_CANNOT_SELECT_SUBJECT",
            },
            requestId,
          });
        }
        lineItems = [{ price: priceId, quantity: 1 }];
        sessionMetadata = {
          student_profile_id: studentProfileId,
          payer_relationship: "self",
          plan,
        };
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: lineItems,
        /**
         * SAVE THE BILLING ADDRESS ONTO THE CUSTOMER — ONE FACT, ONE SOURCE.
         *
         * @spec [INV-03-08; Charter §7 "one fact, one source"]
         * @implemented [2026-09-02]
         *
         * plain English: tell Stripe to copy the address the payer types during
         * Checkout onto the Customer. Expected outcome: the grant gate, which
         * reads `Customer.address.country`, has something to read.
         *
         * WHAT WENT WRONG WITHOUT IT. Stripe collects the billing address per
         * PAYMENT METHOD and does not write it back to the Customer unless
         * asked. So `Customer.address` stayed `null` on every customer we have,
         * while the session carried a complete address. Two gates then read the
         * same fact from two sources and disagreed on the same purchase:
         * `fulfilCheckoutSession` passed guardian `c6d3fc60` on
         * `session.customer_details.address.country = "US"`, and
         * `assertCountryEligibleForGrant` denied the same purchase seconds
         * later on `Customer.address = null` -> verdict `unknown` ->
         * `hold_for_operator`. Charge taken, subscription live, nothing
         * refunded, no entitlement. Every grant behaved this way from
         * 2026-08-28, when the Customer-level gate landed, until this change.
         *
         * WHY NOT POINT THE GRANT GATE AT THE SESSION INSTEAD. Renewals have no
         * session. The Customer is the correct source precisely because it is
         * the one that still exists at `customer.subscription.updated`; it was
         * simply never populated. Fixing the read would have fixed checkout and
         * left every renewal denying.
         *
         * `customer_update` requires `customer` to be set, which it is on every
         * path through this route (see `customerId` above).
         * https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-customer_update-address
         *
         * IT DOES NOT BACKFILL. Customers that already exist with a null
         * address keep it until their next Checkout; that is an owner action,
         * not a code path.
         */
        customer_update: { address: "auto" },
        /**
         * RETURN THE PAYER TO A PAGE THEIR ROLE CAN LOAD.
         *
         * @revised [2026-09-02]
         *
         * `/dashboard` is `RequireRole allow={["student","admin"]}`
         * (`client/src/App.tsx`), so a guardian who completed checkout landed
         * on a role denial: the money moved, the entitlement landed, and the
         * payer was shown a wall. It also made `SubscriptionPaywall`'s
         * `?checkout=success` polling unreachable for guardians, since that
         * component only ever wraps `/guardian`.
         */
        success_url: `${siteBaseUrl()}${isGuardian ? "/guardian" : "/dashboard"}?checkout=success`,
        cancel_url: `${siteBaseUrl()}${isGuardian ? "/guardian" : "/dashboard"}?checkout=cancel`,
        // SCL-043: the authoritative payer-to-student mapping on the
        // unaccompanied path. Deliberately UNSET for a guardian: it takes one
        // profile id, and a guardian session has no single subject — setting it
        // to the guardian would make the payer look like the entitled student.
        ...(isGuardian ? {} : { client_reference_id: studentProfileId }),
        metadata: sessionMetadata,
        subscription_data: { metadata: sessionMetadata },
      });

      // Charter §6: on the unaccompanied path the student IS the payer, so the
      // profile id and the Checkout Session id are both payer identifiers.
      logger.info("BILLING", "checkout", "Checkout session created", {
        requestId,
        studentProfileRef: digestId(studentProfileId),
        plan,
        sessionRef: digestId(session.id),
      });

      // `url` stays top-level: `client/src/lib/billing-client.ts` reads it, and
      // the billing portal route shares that helper. `kind` discriminates the
      // two guardian outcomes without moving it.
      return res.json({
        kind: "checkout_session",
        url: session.url,
        sessionId: session.id,
        requestId,
      });
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
    /**
     * @spec [Doc 01 V8 §31.1 "Guardians do NOT have their own entitlement";
     *        §31.2 derivation] | @implemented [2026-08-28 — Codex MEDIUM]
     *
     * REPLACES a 503 GUARDIAN_BILLING_UNAVAILABLE. That response was correct
     * only while guardian billing did not exist; with guardian checkout live it
     * made the surface self-contradictory — a guardian could POST /checkout and
     * buy, then be told by /status that billing was unavailable.
     *
     * A guardian has no entitlement ROW of their own (§31.1), so reading
     * `getEntitlementForProfile(guardianId)` would report `free` forever and be
     * wrong in the other direction. Their access DERIVES from a linked
     * student, and `resolveLinkedPairPremiumAccessForGuardian` is the existing
     * single owner of that derivation — consumed here rather than reimplemented.
     */
    if (role === "guardian") {
      try {
        const access = await resolveLinkedPairPremiumAccessForGuardian(userId);
        return res.json({
          plan: access.hasPremiumAccess ? "premium" : "free",
          stripeStatus: access.studentEntitlementStatus,
          currentPeriodEnd: null,
          stripeSubscriptionId: null,
          effectiveAccess: access.hasPremiumAccess,
          /**
           * Whether this guardian is linked to any student at all, straight from §31.3's
           * fold — the same call that decided `effectiveAccess`, so the two cannot disagree.
           *
           * WHY THIS FIELD EXISTS AND ITS FOUR PREDECESSORS DO NOT. The client used to read
           * `linkRequiredForPremium`, `hasLinkedStudent`, `requiresStudentSubscription` and
           * `lockedReason`. NONE of them was ever written by any server route, so all four
           * were permanently `undefined` and every branch keyed on them was dead. The visible
           * consequence: `SubscriptionPaywall`'s escape hatch never fired, so a guardian with
           * no linked student fell through to a pricing page — with the surface for linking a
           * student trapped inside the dashboard that page was hiding. This field is the
           * condition those four were reaching for, with a writer.
           */
          hasActiveLink: access.hasActiveLink,
          needsPaymentUpdate:
            access.studentEntitlementStatus === "past_due" ||
            access.studentEntitlementStatus === "unpaid",
          isPaid: access.hasPremiumAccess,
          // The guardian's access is DERIVED, and saying so is the difference
          // between a correct answer and a coincidentally equal one.
          source: "guardian_linked_student",
          requestId,
        });
      } catch (err: unknown) {
        logger.error(
          "BILLING",
          "status",
          "Failed to derive guardian entitlement",
          { requestId, profileId: userId, ...classifyError(err) },
        );
        return res.status(503).json({
          error: "Unable to read subscription status",
          requestId,
        });
      }
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
      const effectiveAccess =
        tier === "premium" && entitledStatuses.has(status);

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
    /**
     * The guardian guard is DELETED, not replaced. A guardian who has purchased
     * has a Stripe Customer of their own (they are the payer, SCL-043), and the
     * per-student ruling's whole shape is ONE Customer, ONE subscription, ONE
     * portal. Refusing them the portal would leave a paying customer unable to
     * update a card or cancel. A guardian who has never purchased has no
     * Customer and falls into the existing 409 below — the same answer a
     * student in that state gets.
     */
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
