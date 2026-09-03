/**
 * Billing request contracts — the single source of truth for what a client may
 * send to the checkout route.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for linked student;
 *        §36.4 per-student billing granularity; SCL-043 payer identity;
 *        SCL-045 one SubscriptionItem per student; Charter §6]
 * @implemented [2026-08-28]
 *
 * plain English: defines the checkout request body. Expected outcome: a
 * guardian names WHICH linked student they are paying for, and a student names
 * nobody at all. Trade-off: `student_profile_id` is a caller-supplied value,
 * which looks like a Charter §6 problem and is not — see the note below, which
 * is the distinction the whole guardian purchase flow rests on. Edge case:
 * `.strict()` rejects unknown keys, so a client cannot smuggle a price id, an
 * entitlement claim, or a second student.
 *
 * CHARTER §6 — A SELECTION IS NOT A CLAIM, AND THE DIFFERENCE IS THE SERVER
 * READ. Charter §6 forbids a caller-supplied value from GATING entitlement. It
 * does not forbid a caller from CHOOSING among options the server already
 * knows. `student_profile_id` here is a choice: the server reads the guardian's
 * ACTIVE rows from `guardian_links` and requires the requested id to be one of
 * them. A guardian who posts a student they are not linked to is refused, and
 * a guardian who posts a well-formed uuid belonging to a stranger is refused by
 * the same check. The id selects; the server's own read authorises. Removing
 * that read — trusting the id because it is a valid uuid — is the defect Codex
 * found at webhook time (HIGH-3), and it is the thing this comment exists to
 * stop anyone reintroducing here.
 */
import { z } from "zod";

/** The billing periods a caller may choose. Mirrors `BILLING_PERIODS`. */
export const billingPeriodSchema = z.enum(["monthly", "quarterly", "yearly"]);
export type BillingPeriodChoice = z.infer<typeof billingPeriodSchema>;

/**
 * POST /api/billing/checkout.
 *
 * `student_profile_id` is OPTIONAL in the schema and REQUIRED by the route for
 * a guardian. It is expressed that way deliberately: the shape cannot know the
 * caller's role, and the role check is the server's job. A student sending one
 * is rejected by the route, not silently ignored — ignoring it would let a
 * student believe they had bought for someone else.
 */
export const billingCheckoutRequestSchema = z
  .object({
    plan: billingPeriodSchema,
    student_profile_id: z.string().uuid().optional(),
  })
  .strict();


/**
 * What the route returns, discriminated on what actually happened.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for linked student;
 *        §36.4 per-student billing granularity; SCL-045 one SubscriptionItem
 *        per student; Coding Standards §7.2, §17]
 * @implemented [2026-08-31]
 *
 * ZOD FIRST, TYPE INFERRED (Coding Standards §7.2, §17). This was previously a
 * hand-written TypeScript union with no schema behind it — the exact shape §17
 * names as a hard stop. Because it was only a type, nothing could parse against
 * it, and nothing did: `BillingCheckoutOutcome` was exported and imported by no
 * module on any branch. A contract nobody can enforce is a comment, and this one
 * was already contradicted by its own consumer — see the note on
 * `billingCheckoutOutcomeSchema` below.
 *
 * The two outcomes are genuinely different events and must not be flattened
 * into one optional-url shape: a FIRST purchase needs the payer to complete
 * Stripe Checkout, whereas ADDING a student to an existing subscription takes
 * the payment method already on file and completes server-side with no
 * redirect. A client that received `{url: null}` and redirected anyway would
 * send the guardian to a blank page after a successful purchase.
 *
 * WHAT THE MISSING SCHEMA COST. `client/src/lib/billing-client.ts` read
 * `payload.url` unconditionally and threw "Billing response did not include a
 * redirect URL" whenever it was absent. On the `item_added` branch it is always
 * absent — so a guardian who successfully added their second child was told the
 * purchase had FAILED, after the card was charged, and a retry then hit
 * `STUDENT_ALREADY_FUNDED`. Parsing the response against this schema is what
 * makes that branch unignorable at the call site.
 *
 * Unknown keys are stripped rather than rejected: the route also sends
 * `requestId`, which is diagnostic and deliberately not part of the outcome.
 */
export const billingCheckoutOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checkout_session"),
    /**
     * Kept at the TOP LEVEL, not nested, because `client/src/lib/billing-client.ts`
     * reads `payload.url` and the billing PORTAL route shares that same helper.
     * Nesting it would break the portal for no gain.
     */
    url: z.string().url(),
    sessionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("item_added"),
    subscriptionItemId: z.string().min(1),
  }),
]);

export type BillingCheckoutOutcome = z.infer<
  typeof billingCheckoutOutcomeSchema
>;

/**
 * What POST /api/billing/portal returns.
 *
 * @spec [Doc 01 V8 §20; Subscription and Auto-Renewal Notice §6.4 "click to
 *        cancel" via the customer portal; Coding Standards §7.1, §7.2]
 * @implemented [2026-08-31]
 *
 * plain English: the Stripe Billing Portal redirect. Expected outcome: the
 * caller gets a usable URL or a refusal, never a cast that hopes for one.
 * Trade-off: this is a single shape rather than a discriminated union, because
 * unlike checkout the portal has exactly ONE outcome — there is no server-side
 * completion path. Edge case: `requestId` rides along on the wire and is
 * stripped, exactly as on the checkout outcome.
 *
 * WHY IT EXISTS. `openBillingPortal` previously narrowed with
 * `(payload as { url?: unknown } | null)?.url` — the same validate-by-cast that
 * caused the checkout add-item defect, left behind in the same module after the
 * checkout half was fixed. A cast asserts a shape; it does not check one.
 *
 * `url` is `.url()`-validated rather than merely non-empty, so a body carrying
 * something that is not a URL is refused here instead of at
 * `window.location.assign`.
 */
export const billingPortalOutcomeSchema = z.object({
  url: z.string().url(),
});

/**
 * What GET /api/public/pricing returns — the ONE monthly price, for strangers.
 *
 * @spec [Doc 09 §1.4, §5.1 Stripe is canonical for pricing magnitudes at
 *        runtime; Coding Standards §7.1, §7.2] | @implemented [2026-09-03]
 *
 * plain English: the homepage quotes money to logged-out visitors, so it needs
 * a price it did not make up. Expected outcome: a number that came from Stripe
 * this quarter-hour, or no number at all. Trade-off: monthly only — the public
 * card advertises one plan and the plan comparison lives behind auth on
 * `/upgrade`. Edge case: an unconfigured price id and a Stripe outage both
 * resolve to "no data", and the card renders without a price line.
 *
 * `amountCents` IS `.int().positive()`, AND THAT IS THE ANTI-`$NaN` GUARD.
 * `upgrade.tsx:92` spreads the API row over a fallback row
 * (`{...fallback, ...fromApi}`), so a `null` amount from the API OVERWRITES the
 * fallback and reaches the formatter — the author rescued
 * `equivalentMonthlyCents` and `savingsPercent` from exactly that hazard on the
 * next two lines and missed the price itself. Here the shape refuses a null,
 * a zero and a missing key at the boundary, so there is no path on which the
 * client holds a price it cannot render. There is no fallback to overwrite
 * either: a hardcoded amount would be the two-sources-for-one-fact defect on
 * the one page that quotes money to people who have not signed up.
 *
 * NO PRICE ID, NO PRODUCT, NO PLAN LIST. This is served unauthenticated; it
 * carries the three fields a price tag needs and nothing that describes the
 * billing configuration behind it.
 */
export const publicPricingSchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().min(1),
  interval: z.literal("month"),
});

export type PublicPricing = z.infer<typeof publicPricingSchema>;

/** The success envelope, per Coding Standards §8.2 (`{ data: T }`). */
export const publicPricingResponseSchema = z.object({
  data: publicPricingSchema,
});
