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

export type BillingCheckoutRequest = z.infer<
  typeof billingCheckoutRequestSchema
>;

/**
 * What the route returns, discriminated on what actually happened.
 *
 * The two outcomes are genuinely different events and must not be flattened
 * into one optional-url shape: a FIRST purchase needs the payer to complete
 * Stripe Checkout, whereas ADDING a student to an existing subscription takes
 * the payment method already on file and completes server-side with no
 * redirect. A client that received `{url: null}` and redirected anyway would
 * send the guardian to a blank page after a successful purchase.
 */
export type BillingCheckoutOutcome =
  | {
      readonly kind: "checkout_session";
      /**
       * Kept at the TOP LEVEL, not nested, because `client/src/lib/billing-client.ts`
       * reads `payload.url` and the billing PORTAL route shares that same helper.
       * Nesting it would break the portal for no gain.
       */
      readonly url: string;
      readonly sessionId: string;
    }
  | { readonly kind: "item_added"; readonly subscriptionItemId: string };
