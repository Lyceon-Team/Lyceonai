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
 * ONE OUTCOME, BECAUSE THERE IS ONE PURCHASE PATH (@revised 2026-09-29 — owner
 * ruling: one subscription per student). This was a two-member union. The second
 * member, `{kind:"item_added", subscriptionItemId}`, described a guardian's
 * second purchase adding a SubscriptionItem to their existing subscription:
 * settled server-side, no redirect, and — the reason it is gone — no charge at
 * the moment of purchase, since Stripe's `create_prorations` default put the
 * amount on the next invoice up to three months later. Every guardian purchase
 * now creates its own subscription through Checkout, so `checkout_session` is
 * the only outcome the route can produce.
 *
 * KEPT AS A `kind`-TAGGED OBJECT RATHER THAN FLATTENED. The discriminator costs
 * one field and means a future second outcome is an added member rather than a
 * reinterpretation of this one. Flattening to `{url, sessionId}` would also make
 * a response from an older deploy parse as valid when it is not.
 *
 * WHAT THE MISSING SCHEMA COST, KEPT AS THE REASON THIS IS PARSED AT ALL.
 * `client/src/lib/billing-client.ts` used to read `payload.url`
 * unconditionally and throw "Billing response did not include a redirect URL"
 * whenever it was absent — which on the deleted branch it always was, so a
 * guardian whose card had been charged was told the purchase had FAILED, and
 * their retry then hit `STUDENT_ALREADY_FUNDED`. Parsing the response against a
 * schema is what makes a shape the client does not expect unignorable at the
 * call site, and that remains true with one member.
 *
 * Unknown keys are stripped rather than rejected: the route also sends
 * `requestId`, which is diagnostic and deliberately not part of the outcome.
 */
export const billingCheckoutOutcomeSchema = z.object({
  kind: z.literal("checkout_session"),
  /**
   * Kept at the TOP LEVEL, not nested, because `client/src/lib/billing-client.ts`
   * reads `payload.url` and the billing PORTAL route shares that same helper.
   * Nesting it would break the portal for no gain.
   */
  url: z.string().url(),
  sessionId: z.string().min(1),
});

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

/**
 * What GET /api/billing/plans returns, per plan.
 *
 * @spec [Doc 09 §1.4, §5.1 Stripe is canonical for pricing magnitudes at
 *        runtime; Coding Standards §7.1, §7.2, §17]
 * @implemented 2026-09-27
 *
 * plain English: one row per billing period, carrying what Stripe said about
 * that price and nothing the application decided. Expected outcome: the client
 * parses this and renders from it; when a field is null the client renders no
 * number rather than a remembered one.
 *
 * EVERY MONETARY FIELD IS NULLABLE, DELIBERATELY. An unconfigured price id and
 * a Stripe outage both arrive here as nulls, and that is the honest shape: the
 * route cannot invent an amount it did not receive. The client's job is to
 * render a card without a price, not to substitute one.
 *
 * WHY `interval` AND `intervalCount` AND NOT ONLY `intervalLabel`. The label is
 * prose ("per 3 months") and prose cannot be divided. The monthly equivalent is
 * `unit_amount ÷ months in the interval`, so the CLIENT needs the interval as
 * data. Before this, the route sent only the label, the arithmetic was therefore
 * impossible on the client, and `upgrade.tsx` filled the gap from a hardcoded
 * table — which is how the page came to print "$59.99" above
 * "$99.99 / month equivalent" (STRIPE_GROUNDING_AUDIT; owner report 2026-09-27).
 *
 * There is no `equivalentMonthlyCents` and no `savingsPercent` on the wire.
 * Both are DERIVED — see `deriveBillingPlanPricing` — because both are functions
 * of the live amounts, and a transmitted derivation is a second copy of a fact
 * that can disagree with the first.
 */
export const billingPlanMetadataSchema = z.object({
  plan: billingPeriodSchema,
  label: z.string().min(1),
  amountCents: z.number().int().positive().nullable(),
  currency: z.string().min(1).nullable(),
  intervalLabel: z.string().min(1).nullable(),
  interval: z.enum(["day", "week", "month", "year"]).nullable(),
  intervalCount: z.number().int().positive().nullable(),
  stripePriceIdConfigured: z.boolean(),
});

export type BillingPlanMetadata = z.infer<typeof billingPlanMetadataSchema>;

/** The plans envelope. `requestId` rides along for support correlation. */
export const billingPlansResponseSchema = z.object({
  plans: z.array(billingPlanMetadataSchema),
  requestId: z.string().optional(),
});

/**
 * Who manages a student's plan, as `GET /api/billing/status` reports it.
 *
 * @spec [Brief 8 ruling 5 / register F-40 (owner, 2026-10-01): derived from whether the student is
 *        the Stripe customer; no new payer column] | @implemented [2026-10-01]
 *
 * plain English: `guardian` when the student's plan is backed by a Stripe subscription and the
 * student is not a Stripe customer at all — so the subscription can only be someone else's, and
 * the portal (which opens the CALLER's own customer) has nothing to show them. The UI then says
 * "Managed by your guardian" with no Manage button. `self` otherwise, including a student with no
 * plan (they would buy their own) and every guardian (who manages their own customer).
 *
 * Known edge, stated rather than hidden: a student who once paid for themselves (so has a Stripe
 * customer) and is now covered by a guardian reads `self`. The portal then opens their own,
 * real customer record — their past billing — which is a reachable page, not the 409. Telling the
 * two apart needs either a Stripe call on every status read or the payer column the ruling ruled
 * out.
 */
export const billingManagedBySchema = z.enum(["self", "guardian"]);
export type BillingManagedBy = z.infer<typeof billingManagedBySchema>;

/** Pure: the F-40 derivation, kept here so the route and its test share one definition. */
export function deriveBillingManagedBy(input: {
  hasSubscription: boolean;
  isStripeCustomer: boolean;
}): BillingManagedBy {
  return input.hasSubscription && !input.isStripeCustomer ? "guardian" : "self";
}
 * What GET /api/billing/status returns — ONE shape for every banner that reads it.
 *
 * @spec [Guardian_Closure_Plan G4-09 (G-AUD-26); Doc 01 V8 §31.1–§31.3 (a guardian's access
 *       derives from a linked student); SCL-029; Coding Standards §7.1, §7.2]
 * @implemented [2026-09-30]
 *
 * plain English: the route has two branches — the self-paying student and the guardian — and
 * both write the same ten keys; the guardian branch adds `hasActiveLink` (§31.3's fold) and
 * `source: "guardian_linked_student"` (the answer is derived, and says so). Expected outcome:
 * every client reader parses this once, in `useBillingStatus`, instead of four readers each
 * casting `res.json()` to a private type that declared whichever subset it happened to read.
 * That was G-AUD-26: three cache keys, four types, no parse — so a renamed key read as
 * `undefined` and every banner keyed on it vanished without an error.
 *
 * trade-offs: `plan` and `stripeStatus` stay strings, not enums. `stripeStatus` carries the
 * entitlement status or `"missing"`, and the client only ever DISPLAYS it; an enum here would
 * be a second copy of the genesis status list that the server does not import. The booleans
 * are what anything decides on, and those are exact.
 *
 * edge cases: the object strips unknown keys (the client's posture for every read); the
 * round-trip test in `tests/ci/identity-entitlement.contract.test.ts` holds the route to the
 * `.strict()` form of this schema on both branches, so a key the route adds without adding it
 * here fails CI rather than being silently dropped.
 */
export const billingStatusResponseSchema = z.object({
  plan: z.string().min(1),
  stripeStatus: z.string().min(1),
  currentPeriodEnd: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  effectiveAccess: z.boolean(),
  needsPaymentUpdate: z.boolean(),
  lapsed: z.boolean(),
  hasBillingAccount: z.boolean(),
  isPaid: z.boolean(),
  /** Guardian branch only: is this guardian linked to any student at all (§31.3). */
  hasActiveLink: z.boolean().optional(),
  /** Guardian branch only: the answer is derived from a linked student, never owned. */
  source: z.literal("guardian_linked_student").optional(),
  requestId: z.string().optional(),
});

export type BillingStatus = z.infer<typeof billingStatusResponseSchema>;
