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
 *   5. dispatch               — subscription lifecycle, refunds, disputes
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
 *  - Refunds revoke on `refund.updated` reaching `succeeded` with the charge
 *    fully refunded (SCL-048 as amended by SCL-072). Disputes revoke on
 *    `charge.dispute.created` and restore on a won `charge.dispute.closed`
 *    (SCL-073). A dispute is NOT a refund and does not share that path.
 */
import Stripe from "stripe";
import { z } from "zod";
import { getStripeClient, getExpectedLivemode } from "./client";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import {
  upsertEntitlement,
  mapStripeStatusToEntitlement,
  getEntitlementsBySubscriptionId,
  getAllGuardianStudentLinks,
  getEntitlementForProfile,
  getProfileIdByStripeCustomerId,
  getProfileStripeCustomerId,
} from "../account";
import type { EntitlementUpdate } from "../account";
import { logger } from "../../logger";
import { digestId } from "./redact";
import { getTier1Countries } from "../entitlement-runtime-config";
import {
  evaluateCountryEligibility,
  deniesEntitlement,
} from "./country-eligibility";
import {
  resolveEntitlementItem,
  stripeSubscriptionItemSchema,
  type StripeSubscriptionItem,
} from "./subscription-item";
import { classifyError } from "../redact";
import { dispositionFor } from "./event-surface";
import {
  disputeEventSchema,
  dispositionForClosedDispute,
  refToId,
} from "./dispute";
import { refundEventSchema, decideRefundRevocation } from "./refund";
import type { RemediationStatus } from "./country-denial-remediation";
import {
  CountryDenialError,
  planForDenial,
  decideCancellation,
  decideRemedialRefund,
  refundReadsAsFull,
  refundIdempotencyKey,
  remediationRefundSchema,
  remediationSubscriptionSchema,
  remediationInvoicePaymentListSchema,
  remediationNeedsOperator,
  remediationPaymentIntentSchema,
} from "./country-denial-remediation";

/**
 * How many of a Customer's subscriptions to scan when mapping a dispute back to
 * an entitlement. A Customer with more than this many subscriptions is not a
 * shape this product produces — SCL-045 puts several students on ONE
 * subscription as separate items — so the limit bounds the scan without
 * truncating a real case. If it ever truncates, the ambiguity branch below
 * fails closed rather than guessing.
 */
const SUBSCRIPTION_SCAN_LIMIT = 100;

/**
 * @spec [Coding Standards §7.1 "Parse at Every Boundary ... Third-party
 *        payloads (Stripe, etc.)"] | @implemented [2026-08-28 — Codex M-2]
 *
 * plain English: the shape of a retrieved Charge, limited to the fields that
 * drive a money or entitlement decision. Expected outcome: `amount`,
 * `amount_refunded` and `customer` are known-good numbers/strings before
 * `decideRefundRevocation` compares them. Trade-off: this duplicates part of
 * `Stripe.Charge`, which is a maintenance cost paid to keep the standard's
 * "parse at every boundary" literal — a TYPE is a claim about a response, a
 * SCHEMA is a check on it, and only the second survives an API version drift.
 * Edge case: `amount_refunded` is defaulted to 0 rather than made optional,
 * because a missing value must not read as "nothing refunded yet" by accident —
 * `decideRefundRevocation` guards the amounts independently.
 */
const retrievedChargeSchema = z.object({
  id: z.string().min(1),
  amount: z.number(),
  amount_refunded: z.number().default(0),
  /**
   * The first hop of the provenance chain (Codex HIGH-5). `Charge.invoice` does
   * not exist in this API version, so the PaymentIntent is the only forward
   * path from a charge to the invoice it paid.
   */
  payment_intent: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
  customer: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
});
type RetrievedCharge = z.infer<typeof retrievedChargeSchema>;

/**
 * The Customer fields this handler reads, wherever it reads a Customer.
 *
 * @spec [Coding Standards §7.1 "Third-party payloads (Stripe, etc.)";
 *        SCL-046 / INV-03-08 country signal; SCL-047 egress]
 * @implemented [2026-08-31 — SCL-DRAFT-B-customer-parse]
 *
 * plain English: one schema for the Stripe Customer, used by both places that
 * read one — the SCL-047 egress rule on `customer.updated`, and the INV-03-08
 * country gate that runs before every grant. Expected outcome: the billing
 * country that decides entitlement is a CHECKED value on both paths, not a
 * checked value on one and an asserted one on the other. Trade-off: the grant
 * gate now fails closed on a Customer whose shape it does not recognise, where
 * before it would have read `undefined` through a cast and denied for the wrong
 * reason. Edge case: `customers.retrieve` returns a DeletedCustomer — `{id,
 * object, deleted:true}`, no `address` — which parses here and is branched on
 * explicitly rather than being silently read as "no country".
 *
 * WHY THIS IS ONE SCHEMA AND NOT TWO. It was two: `customer.updated` parsed,
 * and the grant gate cast with `as Stripe.Customer`. A TYPE ASSERTION IS NOT A
 * PARSE — it is the compiler being told to stop asking, and it survives an API
 * version drift that a parse would catch. That the same object was checked on
 * the path that only SCHEDULES a cancellation and unchecked on the path that
 * GRANTS is the wrong way round.
 */
const stripeCustomerSchema = z.object({
  id: z.string().min(1),
  /**
   * Present and `true` only on a DeletedCustomer. Read rather than probed with
   * `"deleted" in customer`, so the case is part of the parsed shape instead of
   * a narrowing trick applied after the fact.
   */
  deleted: z.boolean().nullish(),
  address: z.object({ country: z.string().nullish() }).nullish(),
});

/**
 * @spec [Coding Standards §7.1] | @implemented [2026-08-31 — owner ruling]
 * A deleted Customer arrives as a bare id. Everything else about it is already
 * gone from Stripe, which is exactly why our own row has to carry the link.
 */
const customerDeletedSchema = z.object({
  id: z.string().min(1),
});

/**
 * @spec [Coding Standards §7.1] | @implemented [2026-08-28 — Codex HIGH-5]
 * The two hops of the provenance chain, parsed at the boundary like every other
 * Stripe response.
 */
const invoicePaymentListSchema = z.object({
  data: z
    .array(
      z.object({
        invoice: z.union([
          z.string().min(1),
          z.object({ id: z.string().min(1) }),
        ]),
      }),
    )
    .default([]),
});

const retrievedInvoiceSchema = z.object({
  id: z.string().min(1),
  parent: z
    .object({
      subscription_details: z
        .object({
          subscription: z.union([
            z.string().min(1),
            z.object({ id: z.string().min(1) }),
          ]),
        })
        .nullish(),
    })
    .nullish(),
});

/** The subscription-list response, parsed for the one field this scan reads. */
const subscriptionListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })).default([]),
});

/**
 * Which events this handler acts on, and the stated reason for each it does
 * not, live in `event-surface.ts` — one list consumed by both this handler and
 * the disposition gate, so the two cannot drift.
 */

export type WebhookOutcome =
  | {
      ok: true;
      eventId: string;
      /**
       * Every value here is `ok: true` and 200. `held` and the seven
       * `remediated_*` values are TERMINAL — a country denial used to leave
       * the event permanently un-settled, and now reports which terminal state
       * it reached (SCL-DRAFT-B-denial-is-a-decision):
       *
       *   held           the country could not be established. No entitlement
       *                  (fail closed) and deliberately NO money moved — an
       *                  unseeded `tier_1_countries` must not auto-refund
       *                  every paying customer. An operator decides.
       *   remediated_*   ineligible country: cancelled, no entitlement
       *                  written, and the suffix says what became of the
       *                  money. Enumerated in `RemediationStatus`.
       *
       * @revised [2026-09-01 — audit HIGH-2] this was a single `"remediated"`
       * covering seven outcomes, which made a FAILED refund and a SUCCESSFUL
       * one identical in the 200 body — the only layer an operator sees
       * without opening the application log (`server/index.ts:140-145` copies
       * this field straight into the response).
       */
      status:
        | "processed"
        | "already_processed"
        | "ignored"
        | "held"
        | RemediationStatus;
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
  /**
   * SCL-043: on a guardian-paid session the metadata names the PAYER, and there
   * is no single `student_profile_id` because the session funds several. Typed
   * here so the dispatcher can tell the two shapes apart without inspecting a
   * passthrough bag.
   */
  metadata: z
    .object({
      student_profile_id: profileIdSchema.optional(),
      payer_profile_id: profileIdSchema.optional(),
      payer_relationship: z.string().optional(),
    })
    .passthrough()
    .nullish(),
  mode: z.string().nullish(),
  subscription: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
  /**
   * §4.7: present only when the session came from a Payment Link. Its presence
   * is the whole signal — a Payment Link session carries no server-set
   * `client_reference_id`, so nothing on it can name a student except a
   * caller-supplied URL parameter.
   */
  payment_link: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
  /**
   * INV-03-08 / SCL-046. The billing country, available ONLY here: the SDK
   * documents `customer_details.address` as "The customer's address after a
   * completed Checkout Session", because the customer types it DURING Checkout.
   * That timing is why the gate cannot live wholly at session creation.
   */
  customer_details: z
    .object({
      address: z.object({ country: z.string().nullish() }).nullish(),
    })
    .nullish(),
  /**
   * SCL-071 settlement. Stripe's own words (stripe@20.4.1,
   * `types/Checkout/Sessions.d.ts`): "The payment status of the Checkout
   * Session, one of `paid`, `unpaid`, or `no_payment_required`. You can use
   * this value to decide when to fulfill your customer's order."
   *
   * NOT `.optional()`. A completed session always carries it, and defaulting a
   * missing value would silently pick a fulfilment decision — the collapse of
   * an error into a legitimate value this handler refuses everywhere else.
   */
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  /**
   * The invoice THIS session produced — the exact correlation the country
   * denial remediation refunds against (@implemented 2026-09-01, audit
   * MEDIUM-1). `node_modules/stripe/types/Checkout/Sessions.d.ts:171-173`:
   * "ID of the invoice created by the Checkout Session, if it exists."
   *
   * `.nullish()` because Stripe types it `| null` and a non-subscription
   * session has none. Absence is handled as untraceable and fails closed —
   * NOT as licence to fall back to the subscription's latest invoice, which is
   * a later period's charge on a subscription that has since renewed.
   */
  invoice: z
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
  /**
   * SCL-073 dispute durability, owner ruling 2026-08-27 (option B).
   *
   * Read because `status` alone does not carry the fact. Stripe says so in the
   * `status` field's own documentation: "The `paused` status is different from
   * pausing collection, which still generates invoices and LEAVES THE
   * SUBSCRIPTION'S STATUS UNCHANGED." So a subscription whose collection we
   * paused on a chargeback still reports `active`, and a writer reading only
   * `status` would hand premium straight back — which is exactly the durability
   * defect this closes.
   *
   * This is reading MORE of Stripe's truth, not storing our own. The
   * alternative considered and rejected was a local `dispute_revoked_at`
   * column: that would have made a THIRD copy of the entitled-status set. The
   * two that exist — `entitlement_active()`'s body and
   * `idx_entitlements_active`'s predicate — AGREE today, both
   * {active, past_due, trialing}, because migration 20260616120000 widened them
   * together in one change. A third copy would be the one to diverge: added by
   * a different change, for a different reason, with nothing keeping it in step
   * with the other two.
   */
  pause_collection: z
    .object({
      behavior: z.string().nullish(),
      resumes_at: z.number().nullish(),
    })
    .nullish(),
  /**
   * @implemented [2026-08-28 — Codex HIGH-3] SUBSCRIPTION-level metadata names
   * the PAYER (SCL-043), not any one student. Read so the N-row writer can
   * resolve that payer's ACTIVE `guardian_links` server-side and verify every
   * item subject against them, rather than entitling whatever uuid an item
   * carries.
   */
  /** The payer. INV-03-08's authoritative country signal lives on this object. */
  customer: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
  metadata: z
    .object({
      payer_profile_id: z.string().min(1).nullish(),
      /**
       * The SINGLE-STUDENT FALLBACK (2026-08-28). On a guardian's FIRST
       * purchase the subscription funds exactly one student, and the route
       * stamps that student here as well as on the Checkout line item. The
       * writer uses this only when the subscription has exactly ONE item and
       * that item carries no student of its own — which is precisely the shape
       * that appears if Checkout does not propagate `line_items[].metadata`.
       *
       * This is why the guardian path no longer DEPENDS on the unverified
       * propagation probe: with one item and one named student there is nothing
       * to guess. It is deliberately NOT a fallback for several items, where
       * picking a subject would be a guess.
       */
      student_profile_id: z.string().min(1).nullish(),
    })
    .passthrough()
    .nullish(),
  items: z
    .object({
      data: z.array(stripeSubscriptionItemSchema).default([]),
    })
    .nullish(),
});

/**
 * Named once so every site that passes a parsed subscription around refers to
 * the SAME type. Two separate `z.infer<typeof …>` expressions produce
 * structurally identical but nominally distinct types, which TypeScript then
 * refuses to assign between — a confusing error for an identical shape.
 */
type RetrievedSubscription = z.infer<typeof retrievedSubscriptionSchema>;

/** Thrown when a signed payload does not match the shape this handler requires. */
export class StripePayloadShapeError extends Error {
  constructor(eventType: string, detail: string) {
    super(`Stripe ${eventType} payload failed shape validation: ${detail}`);
    this.name = "StripePayloadShapeError";
  }
}

/**
 * Generic over the SCHEMA rather than over its output type. Inferring `T` from
 * `z.ZodType<T>` produces a fresh anonymous type at each call site, so two
 * calls against the same schema yield types TypeScript reports as "two
 * different types with this name … but they are unrelated". Constraining to
 * `z.ZodTypeAny` and returning `z.infer<S>` makes every call site resolve to
 * the one named type instead.
 */
function parseOrFail<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  eventType: string,
): z.infer<S> {
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
/**
 * INV-03-08 AT EVERY GRANT — the fix for the class, not the instance.
 *
 * @spec [INV-03-08; SCL-046] | @implemented [2026-08-28 — Codex HIGH-2]
 *
 * plain English: refuse to write premium when the payer's billing country is
 * not Tier-1. Expected outcome: the country rule holds on EVERY path that
 * grants, extends or restores — not only on the one event it was first wired
 * to. Trade-off: one extra Customer read per granting subscription event; this
 * is a webhook, so the cost is Stripe's retry budget rather than a page load.
 *
 * WHY IT LIVES IN THE WRITER. Codex found six granting paths with no country
 * gate — `customer.subscription.created`, `.updated`, won-dispute restore,
 * `warning_closed` restore, and both add-item consequences — because the gate
 * was wired at ONE event. Putting it at the call sites is what produced that;
 * putting it in the writer means a new granting path inherits it.
 *
 * ONLY GRANTS ARE GATED. A write that moves a student to `free` must never be
 * blocked by a country check: refusing to revoke because we cannot establish a
 * country would leave premium in place, which is the failure this exists to
 * prevent. So the gate is asked only when `tier === "premium"`.
 */
async function assertCountryEligibleForGrant(
  customerRef: string | { id: string } | null | undefined,
  eventType: string,
  eventId: string,
): Promise<void> {
  const customerId =
    typeof customerRef === "string" ? customerRef : customerRef?.id;

  let country: string | null | undefined = null;
  if (customerId) {
    // PARSED, NOT CAST (SCL-DRAFT-B-customer-parse). This value decides whether
    // a grant happens, so it is checked at the boundary like every other Stripe
    // response in this file. The previous `as Stripe.Customer` was a claim about
    // the response, not a check on it: an API-version drift that moved or
    // renamed `address` would have read `undefined` and denied every grant
    // silently, which looks identical to a genuine ineligible verdict.
    const customer = parseOrFail(
      stripeCustomerSchema,
      await getStripeClient().customers.retrieve(customerId),
      eventType,
    );
    // A DeletedCustomer carries no address. That is an ABSENT country, not an
    // ineligible one, and `evaluateCountryEligibility` turns absence into
    // `unknown`, which denies the grant. Branched explicitly so the reason is
    // legible rather than arriving as an undefined field read.
    country = customer.deleted ? null : customer.address?.country;
  }

  const eligibility = evaluateCountryEligibility(
    country,
    await getTier1Countries(),
  );
  if (!deniesEntitlement(eligibility)) return;

  logger.error(
    "STRIPE_WEBHOOK",
    eventType,
    "GRANT REFUSED by INV-03-08 country gate. No entitlement written.",
    {
      eventId,
      customerId,
      verdict: eligibility.verdict,
    },
  );
  // A DENIAL IS A DECISION, NOT A SHAPE FAILURE (SCL-DRAFT-B-denial-is-a-decision).
  // The payload is well formed; a French billing address is a perfectly valid
  // one. `CountryDenialError` is a distinct class so the checkout path can catch
  // exactly this and remediate, while a genuine parse failure keeps failing.
  //
  // ON THE SUBSCRIPTION-LIFECYCLE PATHS this still propagates and Stripe still
  // retries. That is left UNCHANGED and is reported, not quietly widened: a
  // renewal on a customer who has moved out of Tier-1 is the SCL-047 egress
  // case, whose money semantics (refund which invoice? the whole history?) are
  // an owner decision and not this fix's.
  throw new CountryDenialError(
    eventType,
    eligibility.verdict === "ineligible" ? "ineligible" : "unknown",
    eligibility.verdict === "unknown" ? null : eligibility.country,
    "grant denied per INV-03-08",
  );
}

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

  const mapped = mapStripeStatusToEntitlement(subscription.status);

  // SCL-073 (owner ruling 2026-08-27, option B): collection paused means not
  // entitled, whatever `status` says. Stripe leaves `status` unchanged when
  // collection is paused, so without this the next subscription event would
  // write premium back over a chargeback revocation. The pause IS the durable
  // marker, and it lives on Stripe's object rather than in a column of ours.
  const collectionPaused = subscription.pause_collection != null;
  const { tier, status } = collectionPaused
    ? { tier: "free" as const, status: mapped.status }
    : mapped;

  // INV-03-08: gate BEFORE the write, and only when this write would GRANT.
  if (tier === "premium") {
    await assertCountryEligibleForGrant(
      subscription.customer,
      eventType,
      eventId,
    );
  }

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
    // SCL-045 / migration 20260827010000: the item is the key. Written now so a
    // guardian subscription's rows are distinguishable from one another; NULL
    // only where the subscription genuinely has no resolvable item.
    stripe_subscription_item_id: item?.itemId ?? null,
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

/**
 * Resolve the entitlement a disputed charge underwrites.
 *
 * The route is forced by the API version: `Charge.invoice` does not exist in
 * stripe@20.4.1 and neither does `PaymentIntent.invoice`, so a dispute has no
 * forward path to the invoice or the subscription. The Customer on the Charge
 * is the only available key. Re-fetched from Stripe rather than read off the
 * delivered object, matching `writeEntitlementFromSubscription`.
 *
 * Returns null when the disputed charge underwrites no entitlement we hold —
 * absence, which is a fact and not an error. Throws on ambiguity.
 */
async function resolveEntitlementsForCharge(
  chargeId: string,
  eventType: string,
  eventId: string,
): Promise<{
  profileIds: string[];
  subscriptionId: string;
  charge: RetrievedCharge;
} | null> {
  const stripe = getStripeClient();
  // Codex M-2: parsed, not trusted. `amount` and `amount_refunded` decide
  // whether access is revoked, so they are checked before they are compared.
  const charge = parseOrFail(
    retrievedChargeSchema,
    await stripe.charges.retrieve(chargeId),
    eventType,
  );

  /**
   * EXACT PROVENANCE: charge -> payment intent -> invoice payment -> invoice ->
   * subscription.
   *
   * @revised [2026-08-28 — Codex HIGH-5]
   *
   * WHAT WAS WRONG. This previously took the charge's CUSTOMER, listed every
   * subscription that customer had, and treated the single one carrying local
   * entitlement rows as "the subscription this charge funded". That is an
   * inference, not a fact. An unrelated ONE-OFF charge on the same Customer —
   * a gift, a manual invoice, a charge for a subscription since deleted —
   * resolved to the customer's only current subscription and could revoke it.
   * The `matches.length > 1` branch caught ambiguity between SUBSCRIPTIONS; it
   * could never establish that the selected one produced this charge.
   *
   * The chain below is exact, and every hop exists in the pinned SDK
   * (stripe@20.4.1):
   *   `Charge.payment_intent`                    Charges.d.ts:148
   *   `invoicePayments.list({payment:{payment_intent, type}})`
   *                                              InvoicePaymentsResource.d.ts
   *   `InvoicePayment.invoice`                   InvoicePayments.d.ts:49
   *   `Invoice.parent.subscription_details.subscription`
   *                                              Invoices.d.ts (Parent)
   *
   * `Charge.invoice` does NOT exist in this API version — verified, zero
   * occurrences — which is why the walk goes through the PaymentIntent.
   *
   * IF PROVENANCE CANNOT BE ESTABLISHED, NOTHING CHANGES. Each null below is a
   * fact ("this charge did not pay a subscription invoice"), not an error, and
   * the correct response to a fact we do not have is to change no entitlement
   * and leave the event visible to an operator.
   */
  if (!charge.payment_intent) {
    logger.info(
      "STRIPE_WEBHOOK",
      eventType,
      "Charge has no PaymentIntent; it cannot be traced to a subscription invoice. No entitlement changed.",
      { eventId, chargeRef: digestId(chargeId) },
    );
    return null;
  }
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent.id;

  const invoicePayments = parseOrFail(
    invoicePaymentListSchema,
    await stripe.invoicePayments.list({
      payment: { payment_intent: paymentIntentId, type: "payment_intent" },
      limit: SUBSCRIPTION_SCAN_LIMIT,
    }),
    eventType,
  );

  if (invoicePayments.data.length === 0) {
    // THE case Codex named: a one-off charge that paid no invoice. Previously
    // this reached the customer walk and could revoke an unrelated subscription.
    logger.info(
      "STRIPE_WEBHOOK",
      eventType,
      "Charge paid no invoice (one-off charge). No entitlement changed.",
      { eventId, chargeRef: digestId(chargeId) },
    );
    return null;
  }
  if (invoicePayments.data.length > 1) {
    throw new StripePayloadShapeError(
      eventType,
      `charge maps to ${invoicePayments.data.length} invoice payments; refusing to guess which invoice it funded`,
    );
  }

  const only = invoicePayments.data[0];
  if (!only) return null;
  const invoiceId =
    typeof only.invoice === "string" ? only.invoice : only.invoice.id;

  const invoice = parseOrFail(
    retrievedInvoiceSchema,
    await stripe.invoices.retrieve(invoiceId),
    eventType,
  );

  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionRef) {
    logger.info(
      "STRIPE_WEBHOOK",
      eventType,
      "Charge paid an invoice with no subscription parent. No entitlement changed.",
      { eventId, chargeRef: digestId(chargeId), invoiceId },
    );
    return null;
  }
  const subscriptionId =
    typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef.id;

  // The subscription is now EXACT. Several entitlement rows on it is the normal
  // guardian shape (migration 20260827010000); zero means this subscription
  // funds nothing we hold, which is a fact and not an error.
  const entitlements = await getEntitlementsBySubscriptionId(subscriptionId);
  if (entitlements.length === 0) {
    logger.info(
      "STRIPE_WEBHOOK",
      eventType,
      "Charge traced to a subscription that underwrites no entitlement of ours.",
      { eventId, chargeRef: digestId(chargeId), subscriptionId },
    );
    return null;
  }

  return {
    profileIds: entitlements.map((e) => e.profile_id),
    subscriptionId,
    charge,
  };
}

/**
 * Revoke every student a charge funded.
 *
 * @spec [SCL-073 disputes; SCL-048/SCL-072 refunds] | @implemented [2026-08-28]
 * plain English: applies one revocation state to all the profiles on a
 * subscription. Expected outcome: a guardian invoice's chargeback removes access
 * for every student it paid for, not just the first one found. Trade-off: runs
 * sequentially, so a mid-way failure leaves a prefix revoked — acceptable
 * because Stripe retries the whole event and `upsertEntitlement` is idempotent
 * on `profile_id`, so a retry converges on the same state.
 */
async function revokeAllProfiles(
  profileIds: readonly string[],
  state: Pick<EntitlementUpdate, "tier" | "status">,
): Promise<void> {
  for (const profileId of profileIds) {
    await upsertEntitlement(profileId, state);
  }
}

/**
 * Re-derive entitlements from Stripe's live subscription, whatever its shape.
 *
 * @implemented [2026-08-28 — Codex HIGH-4]
 * plain English: restores access after a dispute we won. Reads the subscription
 * fresh and picks the same branch the dispatcher does — N student-bearing items
 * means N rows, otherwise the single-subject path. Expected outcome: a guardian
 * subscription restores every student, not one. Trade-off: re-fetches the
 * subscription rather than reconstructing what we revoked, because Stripe's
 * state is the truth and rebuilding from memory would make a second writer.
 */
async function rederiveEntitlementsForSubscription(
  subscriptionId: string,
  knownProfileIds: readonly string[],
  eventType: string,
  eventId: string,
): Promise<void> {
  const retrieved: RetrievedSubscription = parseOrFail(
    retrievedSubscriptionSchema,
    await getStripeClient().subscriptions.retrieve(subscriptionId),
    eventType,
  );
  const studentBearingItems = (retrieved.items?.data ?? []).filter(
    (i) => i.metadata?.student_profile_id,
  );

  if (studentBearingItems.length > 1) {
    await writeEntitlementsForAllItems(retrieved, eventType, eventId);
    return;
  }

  // Single-subject path. The profile comes from OUR rows rather than from the
  // subscription's metadata: on restore we already know exactly whose access we
  // took away, and re-resolving from metadata would be a second answer to a
  // question already settled.
  const only = knownProfileIds[0];
  if (!only || knownProfileIds.length !== 1) {
    throw new StripePayloadShapeError(
      eventType,
      `cannot restore: subscription has ${studentBearingItems.length} student-bearing items but ${knownProfileIds.length} entitlement rows`,
    );
  }
  await writeEntitlementFromSubscription(
    subscriptionId,
    only,
    eventType,
    eventId,
  );
}

/**
 * A dispute takes the money back, so premium access comes off — for EVERY
 * student the disputed charge funded.
 *
 * NOT the refund path: SCL-048's full-versus-partial amount comparison governs
 * money we return deliberately and has no meaning for money an issuer claws
 * back over our objection.
 *
 * FAN-OUT (4.8 plan §7a, reading 1). `pause_collection` is SUBSCRIPTION-level —
 * Stripe offers no per-item pause — so one chargeback on a guardian invoice
 * suspends every sibling on it. That is argued in the plan and ruled by the
 * owner as the default; it is not decided here.
 */
async function handleDisputeCreated(event: Stripe.Event): Promise<void> {
  const dispute = parseOrFail(
    disputeEventSchema,
    event.data.object,
    event.type,
  );
  const target = await resolveEntitlementsForCharge(
    refToId(dispute.charge),
    event.type,
    event.id,
  );
  if (!target) return;

  // SCL-073 option B: pause collection FIRST, so the durable marker exists on
  // Stripe's object before the local write. If the local write then failed and
  // Stripe retried, the pause would already be in place and the retry would
  // re-derive to `free` on its own — the safe ordering.
  //
  // `keep_as_draft` deliberately: `void` destroys invoices a WON dispute would
  // want back, and `mark_uncollectible` writes off revenue we may yet win.
  await getStripeClient().subscriptions.update(target.subscriptionId, {
    pause_collection: { behavior: "keep_as_draft" },
  });

  await revokeAllProfiles(target.profileIds, {
    tier: "free",
    status: "unpaid",
  });

  // Doc 01A §52 rates `payment_dispute` severity 5 and §54 binds a severity-5
  // incident to immediate re-scoring through AbuseScoreService.recordIncident.
  // That service does not exist in TypeScript, and `abuse_scores` is
  // governance-class single-writer (Doc 01A §55), so recording the incident
  // here would implement half of §54's contract and skip the half owned by
  // another document. The incident is a named launch gate, referred as a Doc
  // 01A platform workstream. This log is the interim operator signal, and it is
  // NOT a substitute for the incident record.
  logger.warn(
    "STRIPE_WEBHOOK",
    event.type,
    "Chargeback: entitlement revoked. Doc 01A §52 payment_dispute incident NOT recorded — AbuseScoreService absent (launch gate).",
    {
      eventId: event.id,
      subscriptionRef: digestId(target.subscriptionId),
      studentsRevoked: target.profileIds.length,
      disputeStatus: dispute.status,
    },
  );
}

/**
 * A closed dispute either gives the money back or does not, and access follows
 * — for every student on the subscription.
 */
async function handleDisputeClosed(event: Stripe.Event): Promise<void> {
  const dispute = parseOrFail(
    disputeEventSchema,
    event.data.object,
    event.type,
  );
  const decision = dispositionForClosedDispute(dispute.status);
  const target = await resolveEntitlementsForCharge(
    refToId(dispute.charge),
    event.type,
    event.id,
  );
  if (!target) return;

  if (decision.action === "leave_revoked") {
    logger.info(
      "STRIPE_WEBHOOK",
      event.type,
      "Dispute closed; entitlement stays revoked",
      {
        eventId: event.id,
        subscriptionRef: digestId(target.subscriptionId),
        studentsAffected: target.profileIds.length,
        disputeStatus: dispute.status,
        reason: decision.reason,
      },
    );
    return;
  }

  // SCL-073 option B: lift the pause BEFORE re-deriving. The re-derivation
  // reads `pause_collection`, so resuming second would read the still-paused
  // subscription and write `free` — restoring nothing.
  await getStripeClient().subscriptions.resume(target.subscriptionId);

  await rederiveEntitlementsForSubscription(
    target.subscriptionId,
    target.profileIds,
    event.type,
    event.id,
  );
  logger.info(
    "STRIPE_WEBHOOK",
    event.type,
    "Dispute closed in our favour; collection resumed and entitlement restored from live subscription",
    {
      eventId: event.id,
      subscriptionRef: digestId(target.subscriptionId),
      studentsRestored: target.profileIds.length,
      disputeStatus: dispute.status,
      reason: decision.reason,
    },
  );
}

/**
 * A fully refunded payment removes premium access; a partial one does not.
 *
 * SCL-048 as amended by SCL-072. NOT the dispute path — see refund.ts.
 *
 * DURABILITY (@revised 2026-08-28 — Codex HIGH-5). This previously wrote only
 * local `free`/`canceled` while leaving the Stripe subscription ACTIVE. Because
 * `entitlements` is last-writer-wins on `profile_id`, the next
 * `customer.subscription.updated` re-derived from live Stripe state and handed
 * premium straight back — the identical defect SCL-073 fixed for disputes, in a
 * path the dispute fix did not generalise to.
 *
 * The fix is the mechanism already ruled for disputes rather than a new one:
 * pause collection, so the revocation lives on Stripe's object where the
 * re-derivation will read it. `writeEntitlementFromSubscription` already treats
 * `pause_collection != null` as not-entitled, so no second predicate is
 * introduced and no local column is added.
 *
 * Trade-off, stated plainly: pausing also stops FUTURE invoices. For a full
 * refund that is the intended reading — we returned all the money — but it is a
 * stronger action than the local write it replaces, and it is reversible
 * (`subscriptions.resume`) where a cancellation would not be.
 *
 * STILL UNVERIFIED, AND NOT WORKED AROUND: whether Stripe ALREADY cancels or
 * pauses a subscription when its invoice is fully refunded, which would make
 * this write redundant rather than load-bearing. Answering that needs a live
 * test-mode object printed from a real account; `STRIPE_BILLING_DIAGNOSTICS` is
 * not reachable from this environment (see the phase report), so the question
 * is carried open rather than settled from the type definitions.
 */
async function handleRefundUpdated(event: Stripe.Event): Promise<void> {
  const refund = parseOrFail(refundEventSchema, event.data.object, event.type);
  const target = await resolveEntitlementsForCharge(
    refToId(refund.charge),
    event.type,
    event.id,
  );
  if (!target) return;

  const decision = decideRefundRevocation(
    refund.status,
    target.charge.amount,
    target.charge.amount_refunded,
  );

  if (!decision.revoke) {
    logger.info("STRIPE_WEBHOOK", event.type, "Refund does not revoke", {
      eventId: event.id,
      subscriptionRef: digestId(target.subscriptionId),
      studentsAffected: target.profileIds.length,
      reason: decision.reason,
    });
    return;
  }

  // Codex HIGH-5: the durable marker goes on Stripe's object BEFORE the local
  // write, for the same reason as the dispute path — if the local write then
  // fails and Stripe retries, the pause is already there and the retry
  // re-derives to `free` on its own.
  await getStripeClient().subscriptions.update(target.subscriptionId, {
    pause_collection: { behavior: "keep_as_draft" },
  });

  await revokeAllProfiles(target.profileIds, {
    tier: "free",
    status: "canceled",
  });
  logger.info(
    "STRIPE_WEBHOOK",
    event.type,
    "Full refund: collection paused and entitlement revoked",
    {
      eventId: event.id,
      subscriptionRef: digestId(target.subscriptionId),
      studentsRevoked: target.profileIds.length,
      reason: decision.reason,
    },
  );
}

/**
 * @spec [SCL-045; §4.8 guardian-paid checkout; Charter §6 "no caller-supplied
 *        value gates entitlement"] | @implemented [2026-08-27]
 * @revised [2026-08-28 — Codex HIGH-3]
 *
 * plain English: write one entitlement row per entitled student on a
 * subscription that funds several — after checking, server-side, that the payer
 * is actually linked to each of them.
 *
 * WHAT WAS WRONG. This loop previously read `item.metadata.student_profile_id`
 * and entitled that UUID directly. `getAllGuardianStudentLinks` existed and was
 * never called. Metadata on a SubscriptionItem is not a server-derived fact at
 * the moment it is read: it is a string on a Stripe object, and anyone who can
 * cause an item to exist with that string decides who gets paid access. A valid
 * but UNLINKED profile id was accepted as the subject. That is precisely the
 * Charter §6 failure, and "it arrived inside a signature-verified payload" does
 * not answer it — the signature proves Stripe sent it, not that we derived it.
 *
 * WHAT IT DOES NOW. Resolve the PAYER from subscription metadata, read that
 * guardian's ACTIVE links from `guardian_links` on the server, and require every
 * item subject to be in that set.
 *
 * ALL OR NOTHING, deliberately. If any subject fails to resolve, NOTHING is
 * written — not partial credit, not skip-and-continue. Writing the students who
 * did resolve would grant paid access off a payload we have just established we
 * cannot trust, and would do it silently. Refusing the whole event is loud:
 * Stripe retries, the failure is visible, and no wrong student is entitled in
 * the meantime.
 *
 * Trade-off: a legitimate guardian whose link is revoked between checkout and
 * webhook delivery gets nothing rather than something. That is the correct side
 * to fail on, and it is the same rule the owner ruled for mid-period revocation
 * — visibility follows the link.
 *
 * Only reached when MORE THAN ONE item names a student. The single-student path
 * is unchanged, because individual billing is the one-item case and not a
 * separate shape (SCL-045).
 */
async function writeEntitlementsForAllItems(
  subscription: RetrievedSubscription,
  eventType: string,
  eventId: string,
): Promise<void> {
  const items = subscription.items?.data ?? [];
  const mapped = mapStripeStatusToEntitlement(subscription.status);
  const collectionPaused = subscription.pause_collection != null;
  const tier = collectionPaused ? ("free" as const) : mapped.tier;

  // The subject candidates, in item order. An item with no student is skipped
  // here and counted — that is the metadata-propagation failure mode, and it is
  // an absence rather than an unauthorised claim.
  const candidates: { itemId: string; studentProfileId: string }[] = [];
  let skipped = 0;
  for (const item of items) {
    const studentProfileId = item.metadata?.student_profile_id;
    if (!studentProfileId) {
      skipped += 1;
      continue;
    }
    candidates.push({ itemId: item.id, studentProfileId });
  }

  // THE SINGLE-STUDENT FALLBACK. Exactly one item, that item carrying no
  // student, and the SUBSCRIPTION naming one: unambiguous, so use it. This is
  // the shape a guardian's first purchase takes if Checkout does not propagate
  // `line_items[].metadata`, and resolving it here is what removes this path's
  // dependence on a probe that cannot be run in this environment.
  //
  // Deliberately restricted to the one-item case. With several items a
  // subscription-level student names one of them at most, and choosing which
  // would be the guess this whole writer exists to refuse.
  const subscriptionLevelStudent = subscription.metadata?.student_profile_id;
  const firstItem = items[0];
  if (
    candidates.length === 0 &&
    items.length === 1 &&
    firstItem &&
    subscriptionLevelStudent
  ) {
    candidates.push({
      itemId: firstItem.id,
      studentProfileId: subscriptionLevelStudent,
    });
    skipped = 0;
  }

  if (candidates.length === 0) {
    // No item names a student and no unambiguous fallback exists. Fail loudly
    // rather than acknowledging an event that entitled nobody.
    throw new StripePayloadShapeError(
      eventType,
      `subscription has ${items.length} items and none carries student_profile_id; ` +
        "no entitlement written (check line_items metadata propagation)",
    );
  }

  // INV-03-08: gate BEFORE any of the N writes, and only when granting. All or
  // nothing — a country refusal must not entitle a prefix of the students.
  if (tier === "premium") {
    await assertCountryEligibleForGrant(
      subscription.customer,
      eventType,
      eventId,
    );
  }

  // ---- Charter §6 authorisation, server-side ----------------------------
  const payerProfileId = subscription.metadata?.payer_profile_id;
  if (!payerProfileId) {
    throw new StripePayloadShapeError(
      eventType,
      "multi-student subscription carries no payer_profile_id; cannot establish " +
        "who is paying, so cannot verify that they are linked to these students",
    );
  }

  const activeLinks = await getAllGuardianStudentLinks(payerProfileId);
  const linkedStudentIds = new Set(
    activeLinks
      .map((l) => l.student_profile_id)
      .filter((id): id is string => Boolean(id)),
  );

  const unauthorised = candidates.filter(
    (c) => !linkedStudentIds.has(c.studentProfileId),
  );
  if (unauthorised.length > 0) {
    logger.error(
      "STRIPE_WEBHOOK",
      eventType,
      "REFUSED: subscription item names a student the payer is not actively linked to. NOTHING was written.",
      {
        eventId,
        subscriptionRef: digestId(subscription.id),
        payerProfileId,
        unauthorisedCount: unauthorised.length,
        itemCount: candidates.length,
        activeLinkCount: linkedStudentIds.size,
      },
    );
    throw new StripePayloadShapeError(
      eventType,
      `${unauthorised.length} of ${candidates.length} subscription items name a student the payer ` +
        "is not actively linked to; refusing to entitle any of them (Charter §6)",
    );
  }

  // ---- Every subject is server-authorised; write ------------------------
  let written = 0;
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const candidate of candidates) {
    const item = itemById.get(candidate.itemId);
    if (!item) continue;
    const studentProfileId = candidate.studentProfileId;

    await upsertEntitlement(studentProfileId, {
      tier,
      status: mapped.status,
      stripe_subscription_id: subscription.id,
      stripe_subscription_item_id: item.id,
      stripe_price_id: item.price?.id ?? null,
      current_period_start: epochToIso(item.current_period_start ?? null),
      current_period_end: epochToIso(item.current_period_end ?? null),
      cancel_at_period_end: subscription.cancel_at_period_end === true,
    });
    written += 1;
  }

  logger.info("STRIPE_WEBHOOK", eventType, "Multi-student entitlement write", {
    eventId,
    subscriptionRef: digestId(subscription.id),
    payerProfileId,
    itemsWritten: written,
    itemsSkipped: skipped,
    tier,
  });
}

/**
 * Write the session's subject onto the SubscriptionItem Checkout left bare.
 *
 * @spec [SCL-045 one SubscriptionItem per student; Charter §6 metadata
 *        identifies, it does not authorise] | @implemented [2026-09-02]
 *
 * plain English: Stripe Checkout does not copy `line_items[].metadata` onto the
 * SubscriptionItem it creates, so a guardian's first purchase produces an item
 * with `metadata: {}`. This writes the student the session named onto that item,
 * so both purchase paths — Checkout and `subscriptionItems.create` — leave the
 * same item-level shape behind. Expected outcome: every item on a guardian
 * subscription names its own student, from the first purchase onwards.
 *
 * VERIFIED, NOT ASSUMED. `sub_1UB8p5DPtjyWEVqErGBHVFQF` in live Stripe carries
 * the full subject on the subscription and `metadata: {}` on item
 * `si_VBVqCKx5JSjVkF`. That question had been carried as an open verification
 * since Phase 3; the answer is that Checkout does not propagate it.
 *
 * WHY IT MATTERS, AND WHAT IT IS NOT FOR. It is NOT what makes the first
 * purchase work — `writeEntitlementsForAllItems`'s single-student fallback
 * already resolves a lone bare item from subscription metadata, and already
 * writes `stripe_subscription_item_id` from the item's own id. The defect it
 * closes appears at the SECOND student: once a guardian adds one, the
 * subscription has two items, the fallback is correctly restricted to the
 * one-item case, and the first student's bare item stops resolving — so their
 * entitlement is never refreshed again on renewal. Filling the item in at
 * purchase time is what keeps that from arising.
 *
 * IT GRANTS NOTHING. The value written comes from OUR session metadata, set
 * server-side at session creation, and the writer still re-resolves every item
 * subject against the payer's active `guardian_links` afterwards. Authorisation
 * stays in exactly one place; this only makes the identifier durable. Writing it
 * before that check is deliberate — checking here too would be a second copy of
 * the §6 rule, which is the pattern this vertical keeps removing.
 *
 * IT REFUSES TO GUESS. Only when EXACTLY ONE item lacks a subject is anything
 * written: with several bare items the session's single student names one of
 * them at most, and choosing would be the guess `writeEntitlementsForAllItems`
 * exists to refuse. Items that already carry metadata are never overwritten,
 * which also makes a replayed event a no-op on its second pass.
 */
async function propagateSubjectToBareItem(
  subscription: RetrievedSubscription,
  session: z.infer<typeof checkoutSessionSchema>,
  eventType: string,
  eventId: string,
): Promise<RetrievedSubscription> {
  const studentProfileId = session.metadata?.student_profile_id;
  if (!studentProfileId) return subscription;

  const items = subscription.items?.data ?? [];
  const bare = items.filter((i) => !i.metadata?.student_profile_id);
  if (bare.length !== 1) return subscription;

  const target = bare[0];
  if (!target) return subscription;

  /**
   * A FAILED BOOKKEEPING WRITE MUST NOT TAKE DOWN THE MONEY PATH.
   *
   * This is the one place in this function that can fail for reasons of its
   * own, and letting it throw would make the grant depend on it: Stripe would
   * retry, and a persistent API failure would leave a payer who has been
   * charged with no entitlement for the whole retry window. That is precisely
   * the shape this change exists to close — a secondary derivation taking down
   * a purchase that had already succeeded — and rebuilding it here, one layer
   * over, would be the same mistake with a different name.
   *
   * So the grant proceeds on the unmodified subscription: the single-student
   * fallback still resolves the subject, and the entitlement is written. What
   * is lost is durability, not this purchase — and it is logged at ERROR
   * naming the item, because nothing retries it and an operator setting the
   * metadata by hand is the remedy.
   *
   * NOT a silent catch: it is caught, named, and reported. Nothing else in this
   * function is caught, so a shape failure from `parseOrFail` on a SUCCESSFUL
   * response still propagates — that would mean Stripe answered something this
   * handler does not understand, which a retry can legitimately fix.
   */
  let updated: StripeSubscriptionItem;
  try {
    updated = parseOrFail(
      stripeSubscriptionItemSchema,
      await getStripeClient().subscriptionItems.update(target.id, {
        // Merged, not replaced: Stripe's metadata update is per key, and an
        // item may carry keys this handler does not read.
        metadata: {
          ...(target.metadata ?? {}),
          student_profile_id: studentProfileId,
        },
      }),
      eventType,
    );
  } catch (err: unknown) {
    logger.error(
      "STRIPE_WEBHOOK",
      eventType,
      "Could not write the student onto the SubscriptionItem. The entitlement is still granted from subscription metadata, but this item will stop resolving once a second student is added to this subscription — set its `student_profile_id` by hand.",
      {
        eventId,
        subscriptionRef: digestId(subscription.id),
        itemRef: digestId(target.id),
        ...classifyError(err),
      },
    );
    return subscription;
  }

  logger.info(
    "STRIPE_WEBHOOK",
    eventType,
    "Wrote the session's student onto the SubscriptionItem Checkout left bare (Checkout does not propagate line_items metadata)",
    {
      eventId,
      subscriptionRef: digestId(subscription.id),
      itemRef: digestId(target.id),
      studentProfileRef: digestId(studentProfileId),
    },
  );

  return {
    ...subscription,
    items: {
      ...(subscription.items ?? { data: [] }),
      data: items.map((i) => (i.id === target.id ? updated : i)),
    },
  };
}

/**
 * FULFILMENT — the one path both settlement events share.
 *
 * @spec [SCL-071 entitlement is written on payment SETTLEMENT, not on Checkout
 *        Session completion; INV-03-08; Charter §6]
 * @implemented [2026-08-28 — Codex HIGH-1]
 *
 * plain English: turn a settled Checkout Session into entitlement. Expected
 * outcome: identical derivation, identical gates and identical writer whichever
 * event carried the settlement. Trade-off: one function reached from two
 * dispatch arms rather than two branches that look alike — the two-branch shape
 * is what let the async path be "not yet built" while the sync path shipped.
 * Edge cases: a Payment Link session, an unpaid session, a non-subscription
 * session, and a guardian session with no single subject.
 *
 * IT IS CALLED ONLY WITH SETTLED MONEY. The caller decides that; see
 * `isSettled` and the two dispatch arms.
 */
async function fulfilCheckoutSession(
  session: z.infer<typeof checkoutSessionSchema>,
  eventType: string,
  eventId: string,
): Promise<void> {
  // §4.7 Payment Link defence. A Payment Link purchase carries `payment_link`
  // and no server-set `client_reference_id`, so the only thing that could
  // name a student is a URL query parameter — a caller-supplied value, which
  // Charter §6 forbids from gating entitlement by name. Refusing is not the
  // worst outcome here; granting the wrong student access is, and so is a
  // real charge that grants nothing with no operator signal. Hence: reject,
  // and alert.
  if (session.payment_link) {
    logger.error(
      "STRIPE_WEBHOOK",
      eventType,
      "PAYMENT LINK PURCHASE REJECTED — a real charge has been taken and NO entitlement was granted. Refund it or complete it manually.",
      {
        eventId: eventId,
        sessionRef: digestId(session.id),
        paymentLinkRef: digestId(refToId(session.payment_link)),
      },
    );
    throw new StripePayloadShapeError(
      eventType,
      "checkout session originated from a Payment Link; entitlement cannot be attributed to a student without a caller-supplied value (Charter §6)",
    );
  }

  if (session.mode !== "subscription" || !session.subscription) {
    logger.info(
      "STRIPE_WEBHOOK",
      eventType,
      "Non-subscription checkout ignored",
      { eventId: eventId },
    );
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;

  /**
   * INV-03-08 TIER-1 COUNTRY GATE — the production call site.
   *
   * @spec [INV-03-08 (Doc 03 §2156, heading verified); SCL-046 as amended
   *        2026-08-27] | @implemented [2026-08-28 — Codex HIGH-1]
   *
   * plain English: refuse premium when the billing country is not on the
   * Tier-1 list. Expected outcome: INV-03-08 is ENFORCED rather than merely
   * expressed.
   *
   * WHAT HAPPENS TO THE MONEY (@revised 2026-09-01,
   * SCL-DRAFT-B-denial-is-a-decision). The money has already moved by this
   * point. This used to throw, which meant a 500, which meant Stripe retried
   * the event forever: money captured, no entitlement, no terminal state. A
   * denial is a DECISION and decisions settle. The throw below is now caught
   * by the dispatcher, which cancels the subscription, refunds the charge in
   * full and returns 200 — see `remediateCountryDenial`. The gate itself is
   * unchanged; only what we DO about its verdict is.
   *
   * WHY HERE. `evaluateCountryEligibility` shipped with NO caller at all
   * (Codex HIGH-1: "a fail-open money path"). It could not be called at
   * session creation because the billing address does not exist until the
   * customer types it during Checkout. This event is the derivation point
   * the module's own header names.
   *
   * BOTH `ineligible` AND `unknown` DENY. After payment, refusing to decide
   * is itself a decision, and the safe one is not to grant access we cannot
   * justify. An unseeded `tier_1_countries` therefore denies — the
   * fail-closed default the owner ruled, and the reason the gate is INERT
   * (meaning: denying) until the owner DML is applied.
   */
  const eligibility = evaluateCountryEligibility(
    session.customer_details?.address?.country,
    await getTier1Countries(),
  );
  if (deniesEntitlement(eligibility)) {
    logger.error(
      "STRIPE_WEBHOOK",
      eventType,
      "COUNTRY GATE DENIED — a real charge has been taken and NO entitlement was granted (INV-03-08). Remediation follows; see the COUNTRY_DENIAL_ lines for this event id.",
      {
        eventId: eventId,
        sessionRef: digestId(session.id),
        // The subject is not resolved yet — the gate runs BEFORE it, because
        // a guardian-paid session has no single subject to resolve. Log
        // whichever party the session names; the logger digests both.
        studentProfileId: session.metadata?.student_profile_id ?? null,
        payerProfileId: session.metadata?.payer_profile_id ?? null,
        verdict: eligibility.verdict,
        country: eligibility.verdict === "unknown" ? null : eligibility.country,
      },
    );
    throw new CountryDenialError(
      eventType,
      eligibility.verdict === "ineligible" ? "ineligible" : "unknown",
      eligibility.verdict === "unknown" ? null : eligibility.country,
      "entitlement denied per INV-03-08",
    );
  }

  /**
   * §4.8: a guardian-paid session names the PAYER and funds several students,
   * one ITEM each. `resolveStudentProfileId` would throw on it — there is no
   * single subject — so the shape is read BEFORE the subject, exactly as the
   * subscription dispatcher does. The item path also runs for a guardian with
   * ONE linked student, which is why the test is "is this guardian-paid" and
   * not "are there several items".
   */
  if (session.metadata?.payer_profile_id) {
    const retrieved: RetrievedSubscription = parseOrFail(
      retrievedSubscriptionSchema,
      await getStripeClient().subscriptions.retrieve(subscriptionId),
      eventType,
    );
    // Checkout leaves the item bare; fill it in so both purchase paths converge
    // on the same item-level shape before the one writer reads it.
    const propagated = await propagateSubjectToBareItem(
      retrieved,
      session,
      eventType,
      eventId,
    );
    await writeEntitlementsForAllItems(propagated, eventType, eventId);
    return;
  }

  const studentProfileId = resolveStudentProfileId(session, eventType);
  await writeEntitlementFromSubscription(
    subscriptionId,
    studentProfileId,
    eventType,
    eventId,
  );
  return;
}

/**
 * Has the money actually arrived?
 *
 * Stripe's own words, shipped in stripe@20.4.1
 * (`types/Checkout/Sessions.d.ts`): "The payment status of the Checkout
 * Session, one of `paid`, `unpaid`, or `no_payment_required`. You can use this
 * value to decide when to fulfill your customer's order."
 *
 * `unpaid` means a delayed payment method completed the SESSION before the
 * money settled. Granting there hands premium to an unsettled payment;
 * `checkout.session.async_payment_succeeded` is the event that later carries
 * the settlement, and it fulfils through the same function.
 *
 * Exhaustive over the union rather than `!== "unpaid"`, so a new member added
 * by a future API version is a compile error rather than an accidental grant.
 */
function isSettled(
  status: z.infer<typeof checkoutSessionSchema>["payment_status"],
): boolean {
  switch (status) {
    case "paid":
    case "no_payment_required":
      return true;
    case "unpaid":
      return false;
  }
}

/**
 * COUNTRY EGRESS — the payer moved out of Tier-1.
 *
 * @spec [SCL-047 (owner ruling: option (b)); INV-03-08; SCL-046]
 * @implemented [2026-08-28 — Codex HIGH-2]
 *
 * plain English: when a customer changes their billing address in the Portal to
 * a country that is not Tier-1, set `cancel_at_period_end` on their
 * subscriptions. Expected outcome, exactly as ruled: the student keeps access
 * through `current_period_end`, no renewal occurs, and entitlement transitions
 * to free at period end.
 *
 * NO IMMEDIATE CUT, NO REFUND, NO PRORATION — the owner rejected option (a)
 * because Stripe does not automatically refund negative prorations, so
 * cancelling mid-period would generate a credit rather than money back.
 *
 * Trade-off: the entitlement row is NOT written here. `cancel_at_period_end` is
 * the durable marker on Stripe's object, and the transition to free arrives on
 * the subscription lifecycle event at period end — one writer, as everywhere
 * else. Writing free now would cut access immediately, which is precisely the
 * option that was rejected.
 *
 * Edge case: a customer moving INTO Tier-1 is not un-cancelled here. Reversing
 * a scheduled cancellation is a separate decision with its own money
 * consequences, and inventing it would be an unruled behaviour.
 */
async function handleCustomerUpdated(event: Stripe.Event): Promise<void> {
  const customer = parseOrFail(
    stripeCustomerSchema,
    event.data.object,
    event.type,
  );

  const eligibility = evaluateCountryEligibility(
    customer.address?.country,
    await getTier1Countries(),
  );

  // Only a POSITIVE ineligible triggers egress. `unknown` must not: a customer
  // who has never supplied an address has not moved anywhere, and cancelling
  // their subscription on an absence would revoke for a fact we do not have.
  if (eligibility.verdict !== "ineligible") return;

  const stripe = getStripeClient();
  const subscriptions = parseOrFail(
    subscriptionListSchema,
    await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: SUBSCRIPTION_SCAN_LIMIT,
    }),
    event.type,
  );

  for (const subscription of subscriptions.data) {
    await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
    });
  }

  logger.warn(
    "STRIPE_WEBHOOK",
    event.type,
    "Billing country left Tier-1: subscriptions set to cancel at period end (SCL-047). Access continues to period end; no refund, no proration.",
    {
      eventId: event.id,
      customerId: customer.id,
      country: eligibility.country,
      subscriptionsScheduled: subscriptions.data.length,
    },
  );
}

/**
 * The billing relationship is gone, so the entitlement it funded goes with it.
 *
 * @spec [SCL-070 amendment; Doc-01_V8 §20–§24 | OWNER RULING 2026-08-31]
 * @implemented [2026-08-31]
 *
 * plain English: deleting a Stripe Customer ends the billing relationship
 * outright — no subscription, no payment method, no way to bill and no way to
 * cancel. Leaving entitlement active after that grants free premium with no
 * recourse, so `customer.deleted` REVOKES. This event was previously subscribed
 * and ignored, with a comment that already recorded revoking as the intent; the
 * owner ruled on 2026-08-31 and this is that ruling implemented.
 *
 * expected outcome: every entitlement this Customer funded drops to
 * `tier=free, status=canceled`.
 *
 * WHY THE SUBJECTS ARE RESOLVED FROM OUR ROWS AND NOT FROM STRIPE. By the time
 * this event arrives the Customer no longer exists, so `subscriptions.list`
 * cannot be asked who it funded. `profiles.stripe_customer_id` (UNIQUE,
 * genesis:149) is the only surviving link, and the entitlement rows carry the
 * subscription ids. That is why this handler is all database and no SDK.
 *
 * trade-offs / edge cases:
 *  - NOT country-gated. It is a REVOKE, and gating a revocation on a country we
 *    may not know would leave premium in place — the exact failure the gate
 *    exists to prevent.
 *  - Guardian-paid: the guardian holds the Customer but owns no entitlement row
 *    of their own, so the funded students are reached through their ACTIVE
 *    guardian links. A linked student who holds their OWN
 *    `stripe_customer_id` is skipped: `stripe_customer_id` is UNIQUE, so such a
 *    student is a payer in their own right and this Customer does not fund them.
 *    Revoking them would cancel access somebody else is still paying for.
 *  - Absence is a fact, not an error. No profile holding this Customer, or no
 *    entitlement rows behind it, means nothing of ours was funded by it: log and
 *    change nothing.
 *  - Idempotent. The write is `upsertEntitlement` to free, so a replay — or the
 *    `customer.subscription.deleted` events Stripe may also emit when a Customer
 *    is removed — converges on the same row rather than fighting it. Belt and
 *    braces is deliberate: this handler does not depend on those events firing,
 *    because that behaviour cannot be verified here without credentials.
 *  - LOW VOLUME. Customers are normally deleted by an operator, so the
 *    per-student sequential reads below are not a hot path.
 */
async function handleCustomerDeleted(event: Stripe.Event): Promise<void> {
  const customer = parseOrFail(
    customerDeletedSchema,
    event.data.object,
    event.type,
  );

  const payerProfileId = await getProfileIdByStripeCustomerId(customer.id);
  if (!payerProfileId) {
    logger.info(
      "STRIPE_WEBHOOK",
      event.type,
      "Deleted Customer matches no profile; it funded no entitlement of ours. Nothing changed.",
      { eventId: event.id, customerRef: digestId(customer.id) },
    );
    return;
  }

  // Which subscriptions did this Customer fund? Answered from our rows only.
  const subscriptionIds = new Set<string>();

  const payerEntitlement = await getEntitlementForProfile(payerProfileId);
  if (payerEntitlement?.stripe_subscription_id) {
    subscriptionIds.add(payerEntitlement.stripe_subscription_id);
  }

  const activeLinks = await getAllGuardianStudentLinks(payerProfileId);
  for (const link of activeLinks) {
    const studentProfileId = link.student_profile_id;
    if (!studentProfileId) continue;

    // A student holding their own Customer pays for themselves; this Customer
    // is not theirs, and revoking them would cut off access someone else funds.
    const ownCustomerId = await getProfileStripeCustomerId(studentProfileId);
    if (ownCustomerId) continue;

    const studentEntitlement = await getEntitlementForProfile(studentProfileId);
    if (studentEntitlement?.stripe_subscription_id) {
      subscriptionIds.add(studentEntitlement.stripe_subscription_id);
    }
  }

  // SCL-045: one item per student, so one subscription can fund many rows. Fan
  // out through the subscription id so siblings are not left entitled.
  const profileIds = new Set<string>();
  if (payerEntitlement) profileIds.add(payerProfileId);
  for (const subscriptionId of subscriptionIds) {
    for (const row of await getEntitlementsBySubscriptionId(subscriptionId)) {
      profileIds.add(row.profile_id);
    }
  }

  if (profileIds.size === 0) {
    logger.info(
      "STRIPE_WEBHOOK",
      event.type,
      "Deleted Customer resolved to a profile but no entitlement rows reference it. Nothing changed.",
      { eventId: event.id, payerProfileId },
    );
    return;
  }

  await revokeAllProfiles([...profileIds], {
    tier: "free",
    status: "canceled",
  });

  logger.warn(
    "STRIPE_WEBHOOK",
    event.type,
    "Stripe Customer deleted: the billing relationship is gone, so every entitlement it funded is revoked (owner ruling 2026-08-31).",
    {
      eventId: event.id,
      customerRef: digestId(customer.id),
      payerProfileId,
      subscriptionsResolved: subscriptionIds.size,
      profilesRevoked: profileIds.size,
    },
  );
}

/**
 * What `dispatch` did, in the value the route actually returns.
 *
 * @revised [2026-09-01 — audit HIGH-2]
 *
 * `server/index.ts:140-145` copies this straight into the 200 body, so it is
 * the only account of the money path an operator sees without opening the
 * application log. It therefore has to distinguish the outcomes that leave a
 * customer owed money from the ones that do not — see `RemediationStatus`,
 * which enumerates all six rather than flattening them to one string.
 *
 * Every value here is `ok: true` and 200. `held` and every `remediated_*` are
 * TERMINAL: the event settled and Stripe must not redeliver it. That is the
 * whole point of the change this file exists for — a denial is a decision, and
 * decisions settle.
 */
type DispatchStatus = "processed" | "held" | RemediationStatus;

/**
 * Cancel, refund, and let the event SETTLE — the terminal state for a payer we
 * will not entitle.
 *
 * @spec [OWNER RULING 2026-09-01 — cancel first, refund in full, write no
 *        entitlement, return 200, alert loudly. That ruling is the source of
 *        this policy; INV-03-08 / SCL-046 say only WHO is refused, and
 *        SCL-048/SCL-072 govern the REVERSE causality (refund observed ->
 *        revoke), so neither establishes that we should ISSUE one. Cited by
 *        date so the behaviour traces to the decision rather than to
 *        inference.]
 * @implemented [2026-09-01 — SCL-DRAFT-B-denial-is-a-decision]
 *
 * plain English: the money comes back and Stripe stops retrying. Expected
 * outcome: subscription cancelled, charge refunded in full, no entitlement row,
 * HTTP 200. Trade-off: the customer is charged and then refunded, which is a
 * poor experience even when handled correctly — the prevention options are
 * evaluated in the phase report and are an owner decision, not this function's.
 * Edge cases: every step below can find that its precondition is already
 * satisfied (a replay) or cannot be established at all (no provenance), and in
 * both cases it does nothing and says which of the two it was.
 *
 * WHICH FAILURES SETTLE AND WHICH STILL RETRY — the line, drawn explicitly,
 * because "make it always return 200" would be as wrong as the throw it
 * replaces. The defect is a PERMANENT condition rendered as a retryable error,
 * not retrying as such:
 *
 *   the VERDICT itself           settles. No number of redeliveries makes a
 *                                French billing address Tier-1. This is the
 *                                defect, and it is what the catch above fixes.
 *   `refunds.create` failing     settles. The money question is now an operator
 *                                problem, and the subscription is ALREADY
 *                                cancelled by then so nothing bills again while
 *                                a human fixes it. Caught explicitly below.
 *   a decision we cannot make    settles as `held`. An unestablished country or
 *                                an untraceable charge will read the same on the
 *                                next delivery.
 *   `subscriptions.retrieve`,    STILL THROWS, and Stripe SHOULD retry. These
 *   `subscriptions.cancel`,      are transient-by-nature calls that have moved
 *   the provenance reads         no money yet, and a redelivery genuinely fixes
 *                                a Stripe blip. Swallowing them would leave a
 *                                live, ineligible subscription with a 200 next
 *                                to it — the failure hidden instead of fixed.
 *                                The one PERMANENT failure among them, cancelling
 *                                an already-cancelled subscription, is removed by
 *                                `decideCancellation`'s status pre-check rather
 *                                than by a catch.
 *
 * So this function has exactly ONE `catch`, it names one call, and every branch
 * that returns without acting alerts. That is why the swallow is not silent.
 */
async function remediateCountryDenial(
  session: z.infer<typeof checkoutSessionSchema>,
  denial: CountryDenialError,
  eventType: string,
  eventId: string,
): Promise<DispatchStatus> {
  const status = await runCountryDenialRemediation(
    session,
    denial,
    eventType,
    eventId,
  );

  // ONE SUMMARY LINE PER REMEDIATION, whichever branch produced it
  // (@revised 2026-09-01 — audit HIGH-2). The branch logs above each say what
  // happened; this says what it AMOUNTS TO, and carries the single field an
  // operator actually triages on. Without it, "does anyone still owe this
  // customer money?" is answered by knowing which of six log codes to grep —
  // which is the same "you can tell them apart" claim that did not hold.
  if (status !== "processed" && status !== "held") {
    logger.warn(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_OUTCOME",
      remediationNeedsOperator(status)
        ? "COUNTRY DENIAL settled, but a human still owes this customer something."
        : "COUNTRY DENIAL settled and nothing further is owed.",
      {
        eventId,
        eventType,
        sessionRef: digestId(session.id),
        status,
        operatorActionRequired: remediationNeedsOperator(status),
      },
    );
  }
  return status;
}

async function runCountryDenialRemediation(
  session: z.infer<typeof checkoutSessionSchema>,
  denial: CountryDenialError,
  eventType: string,
  eventId: string,
): Promise<DispatchStatus> {
  const plan = planForDenial(denial.verdict);

  if (plan.action === "hold_for_operator") {
    logger.error(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_HELD",
      "COUNTRY DENIAL HELD FOR AN OPERATOR — a real charge was taken, NO entitlement was written, and NO money has been moved automatically. The subscription is still live. Decide: seed `tier_1_countries`, or cancel and refund by hand.",
      {
        eventId,
        eventType,
        sessionRef: digestId(session.id),
        verdict: denial.verdict,
        reason: plan.reason,
      },
    );
    // Settled, not retried. The charge is unresolved, but a redelivery would
    // not resolve it either — only a human can.
    return "held";
  }

  const subscriptionRef = session.subscription;
  if (!subscriptionRef) {
    // Unreachable by construction: the gate runs after the mode/subscription
    // guard in `fulfilCheckoutSession`, so a denial implies a subscription.
    // Handled anyway, because "unreachable" is a claim about today's control
    // flow and this branch is what keeps it from becoming a silent throw.
    logger.error(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_NO_SUBSCRIPTION",
      "COUNTRY DENIAL could not be remediated: the session names no subscription, so there is nothing to cancel and no invoice to trace to a charge. MANUAL REFUND REQUIRED.",
      { eventId, eventType, sessionRef: digestId(session.id) },
    );
    return "held";
  }
  const subscriptionId = refToId(subscriptionRef);

  const stripe = getStripeClient();

  // ---- 1. CANCEL FIRST -----------------------------------------------------
  // Before the refund, always. Cancelling stops the next invoice; if the refund
  // then fails, the customer is at least not billed again. The reverse ordering
  // would refund a live subscription that goes on charging.
  const subscription = parseOrFail(
    remediationSubscriptionSchema,
    await stripe.subscriptions.retrieve(subscriptionId),
    eventType,
  );

  const cancellation = decideCancellation(subscription.status);
  if (cancellation.cancel) {
    // Empty params: NO cancellation date. `SubscriptionCancelParams`
    // (SubscriptionsResource.d.ts:2054-2074) offers no date field at all —
    // scheduling one is `subscriptions.update({ cancel_at })`, a different
    // call. Immediate is what stops the next invoice, which is why we cancel.
    await stripe.subscriptions.cancel(subscriptionId, {});
  }
  logger.warn(
    "STRIPE_WEBHOOK",
    "COUNTRY_DENIAL_CANCEL",
    cancellation.cancel
      ? "COUNTRY DENIAL: subscription cancelled immediately (INV-03-08). Refund follows."
      : "COUNTRY DENIAL: subscription NOT cancelled — already terminal or unreadable.",
    {
      eventId,
      eventType,
      subscriptionRef: digestId(subscriptionId),
      country: denial.country,
      cancelled: cancellation.cancel,
      reason: cancellation.reason,
    },
  );

  // ---- 2. THEN REFUND ------------------------------------------------------
  // Provenance, forwards: SESSION -> session.invoice -> invoice payment ->
  // PaymentIntent -> charge. Same hops as the reverse walk in
  // `resolveEntitlementsForCharge`; see `country-denial-remediation.ts`. The
  // root is the SESSION, not the subscription — see the note below.
  //
  // WHERE PROVENANCE CANNOT BE ESTABLISHED, CHANGE NOTHING AND SURFACE IT. Each
  // of the four bails below is a FACT ("this session produced no invoice"),
  // never a guess, and none of them refunds something it merely thinks
  // is the right charge.
  //
  // THE WALK IS ROOTED AT THE SESSION, NOT AT THE SUBSCRIPTION
  // (@revised 2026-09-01 — audit MEDIUM-1). It used to start at the
  // subscription's CURRENT `latest_invoice`, which is not a fact about THIS
  // purchase: a delayed or redelivered event on a subscription that has since
  // renewed resolves "latest" to a LATER period's invoice, and the refund would
  // return the wrong charge — a fresh renewal the customer legitimately owes,
  // while the charge we actually meant to return stayed put.
  //
  // `Checkout.Session.invoice` is Stripe's own statement of the link
  // (`node_modules/stripe/types/Checkout/Sessions.d.ts:171-173`): "ID of the
  // invoice created by the Checkout Session, if it exists." That is an exact
  // correlation to the session being remediated, so the assumption is REMOVED
  // rather than sanity-checked.
  //
  // No amount-based fallback is offered. Comparing `charge.amount` to
  // `session.amount_total` would not distinguish period 1 from period 2 of the
  // same plan — the very case this fixes — and a trial makes `amount_total`
  // zero against a non-zero charge, so it would also fail closed on correct
  // outcomes. A heuristic that cannot separate the confusable case is not a
  // second correlation; it is noise wearing one.
  if (!session.invoice) {
    return refundNotAttempted(
      "the Checkout Session names no invoice, so no charge can be tied to " +
        "THIS purchase. Refusing to fall back to the subscription's latest " +
        "invoice: on a renewed subscription that is a later period's charge",
      eventId,
      eventType,
      subscriptionId,
    );
  }
  const invoiceId = refToId(session.invoice);

  const invoicePayments = parseOrFail(
    remediationInvoicePaymentListSchema,
    await stripe.invoicePayments.list({
      invoice: invoiceId,
      limit: SUBSCRIPTION_SCAN_LIMIT,
    }),
    eventType,
  );
  const intentPayments = invoicePayments.data.filter(
    (p) => p.payment.type === "payment_intent" && p.payment.payment_intent,
  );
  if (intentPayments.length !== 1) {
    return refundNotAttempted(
      `the invoice maps to ${intentPayments.length} PaymentIntent payments; ` +
        "refusing to guess which one funded it",
      eventId,
      eventType,
      subscriptionId,
    );
  }
  const paymentIntentRef = intentPayments[0]?.payment.payment_intent;
  if (!paymentIntentRef) {
    return refundNotAttempted(
      "the invoice payment names no PaymentIntent",
      eventId,
      eventType,
      subscriptionId,
    );
  }
  const paymentIntentId = refToId(paymentIntentRef);

  const paymentIntent = parseOrFail(
    remediationPaymentIntentSchema,
    await stripe.paymentIntents.retrieve(paymentIntentId),
    eventType,
  );
  if (!paymentIntent.latest_charge) {
    return refundNotAttempted(
      "the PaymentIntent has no `latest_charge`, so no money was captured to return",
      eventId,
      eventType,
      subscriptionId,
    );
  }

  const charge = parseOrFail(
    retrievedChargeSchema,
    await stripe.charges.retrieve(refToId(paymentIntent.latest_charge)),
    eventType,
  );

  // The replay guard, and the durable half of the idempotency story. A second
  // delivery describing this same purchase reads the charge, finds it already
  // fully refunded, and stops here.
  const step = decideRemedialRefund(charge.amount, charge.amount_refunded);
  if (!step.refund) {
    logger.warn(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_REFUND_SKIPPED",
      "COUNTRY DENIAL: no refund issued.",
      {
        eventId,
        eventType,
        subscriptionRef: digestId(subscriptionId),
        chargeRef: digestId(charge.id),
        reason: step.reason,
      },
    );
    // Both skips mean "nothing further is owed", and they mean it for
    // different reasons. `step.code` carries which, so the comparison that
    // decided it is not made twice.
    return step.code === "already_refunded"
      ? "remediated_already_refunded"
      : "remediated_nothing_charged";
  }

  // NO `amount`. `RefundsResource.d.ts:125` makes the partial refund the
  // OPTIONAL case ("You can optionally refund only part of a charge"), so
  // omitting it is the full one. The projection below CHECKS that rather than
  // resting on it.
  let refundResponse: unknown;
  try {
    refundResponse = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        // BYTE-IDENTICAL ACROSS THE RETRY (@revised 2026-09-01 — audit HIGH-1).
        // `lyceon_event_id` used to be here. `completed` and
        // `async_payment_succeeded` for one purchase carry DIFFERENT event ids
        // — exactly the pair the subscription-scoped key exists to dedupe — so
        // including it made the second call a key re-use with mismatched
        // parameters, which Errors.d.ts:252-253 defines as a
        // `StripeIdempotencyError`. That surfaced as "MANUAL REFUND REQUIRED"
        // for a refund that had already SUCCEEDED, and an operator acting on it
        // would refund the customer twice by hand. Every field here is now
        // constant for a given subscription; the event id is in the log line
        // below, where it costs nothing.
        metadata: { lyceon_reason: "inv_03_08_country_ineligible" },
      },
      { idempotencyKey: refundIdempotencyKey(subscriptionId) },
    );
  } catch (err: unknown) {
    // A FAILED REFUND MUST NOT LOOP EITHER. It is an operator problem, not a
    // reason for Stripe to redeliver forever — and the subscription is already
    // cancelled above, so the customer is not billed again while it is fixed.
    // Distinct log code so this is one grep away from the success path.
    logger.error(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_REFUND_FAILED",
      "COUNTRY DENIAL: THE REFUND FAILED. The subscription IS cancelled, so no further billing occurs, but the customer's money HAS NOT been returned. MANUAL REFUND REQUIRED.",
      {
        eventId,
        eventType,
        subscriptionRef: digestId(subscriptionId),
        chargeRef: digestId(charge.id),
        paymentIntentRef: digestId(paymentIntentId),
        chargeAmount: charge.amount,
        message: err instanceof Error ? err.message : "unknown",
      },
    );
    return "remediated_refund_failed";
  }

  // The refund EXISTS from here on — the money has moved. Everything below
  // reports on it and never re-raises.
  const parsedRefund = remediationRefundSchema.safeParse(refundResponse);
  if (!parsedRefund.success) {
    // Distinct from both failure and partial: the refund was CREATED and we
    // could not read the response back, so fullness is unconfirmed rather than
    // known-bad. Saying "partial" here would report a fact we do not have.
    logger.error(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_REFUND_UNVERIFIED",
      "COUNTRY DENIAL: the refund WAS created but its response did not parse, so it could not be confirmed FULL. Subscription is cancelled. VERIFY THE REFUND AMOUNT BY HAND.",
      {
        eventId,
        eventType,
        subscriptionRef: digestId(subscriptionId),
        chargeRef: digestId(charge.id),
        paymentIntentRef: digestId(paymentIntentId),
        chargeAmount: charge.amount,
        details: JSON.stringify(parsedRefund.error.flatten().fieldErrors),
      },
    );
    return "remediated_refund_unverified";
  }
  const refund = parsedRefund.data;

  // PARTIAL-REFUND GUARD. Full by construction, checked anyway, and checked
  // with SCL-048/SCL-072's own predicate rather than a second one. A refund
  // that read as partial would leave the customer out of pocket AND, under
  // SCL-048, would not have revoked anything either.
  const projected = charge.amount_refunded + refund.amount;
  const readsFull = refundReadsAsFull(charge.amount, projected);
  if (!readsFull) {
    logger.error(
      "STRIPE_WEBHOOK",
      "COUNTRY_DENIAL_REFUND_PARTIAL",
      "COUNTRY DENIAL: the refund read as PARTIAL against the charged amount (SCL-048/SCL-072 basis). The customer is still out of pocket. MANUAL TOP-UP REQUIRED.",
      {
        eventId,
        eventType,
        subscriptionRef: digestId(subscriptionId),
        chargeRef: digestId(charge.id),
        chargeAmount: charge.amount,
        refundedAfter: projected,
      },
    );
    return "remediated_refund_partial";
  }

  logger.warn(
    "STRIPE_WEBHOOK",
    "COUNTRY_DENIAL_REFUNDED",
    "COUNTRY DENIAL REMEDIATED: subscription cancelled and the charge refunded in FULL. No entitlement was written (INV-03-08). THE CUSTOMER HAS NOT BEEN TOLD WHY — see the phase report: the customer-facing notice is blocked and is not silently skipped.",
    {
      eventId,
      eventType,
      subscriptionRef: digestId(subscriptionId),
      chargeRef: digestId(charge.id),
      refundRef: digestId(refund.id),
      country: denial.country,
      chargeAmount: charge.amount,
      refundedAfter: projected,
      reason: step.reason,
    },
  );
  return "remediated_refunded";
}

/** One shape for "the charge could not be traced, so nothing was refunded". */
function refundNotAttempted(
  reason: string,
  eventId: string,
  eventType: string,
  subscriptionId: string,
): DispatchStatus {
  logger.error(
    "STRIPE_WEBHOOK",
    "COUNTRY_DENIAL_REFUND_UNTRACEABLE",
    "COUNTRY DENIAL: the subscription is cancelled but the charge could NOT be traced, so NO refund was issued. Refusing to refund a charge we cannot prove funded this purchase. MANUAL REVIEW REQUIRED.",
    {
      eventId,
      eventType,
      subscriptionRef: digestId(subscriptionId),
      reason,
    },
  );
  return "remediated_refund_untraceable";
}

async function dispatch(event: Stripe.Event): Promise<DispatchStatus> {
  if (event.type === "customer.deleted") {
    await handleCustomerDeleted(event);
    return "processed";
  }

  if (event.type === "customer.updated") {
    await handleCustomerUpdated(event);
    return "processed";
  }

  if (event.type === "refund.updated") {
    await handleRefundUpdated(event);
    return "processed";
  }

  if (event.type === "charge.dispute.created") {
    await handleDisputeCreated(event);
    return "processed";
  }

  if (event.type === "charge.dispute.closed") {
    await handleDisputeClosed(event);
    return "processed";
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    // Parsed, not cast: a valid signature does not imply a valid shape.
    const session = parseOrFail(
      checkoutSessionSchema,
      event.data.object,
      event.type,
    );

    /**
     * SCL-071. The settlement gate, and the reason both arms are here.
     *
     * `checkout.session.completed` fires when the SESSION completes, which for
     * a delayed payment method is BEFORE the money arrives. Fulfilling on it
     * unconditionally grants premium against an unsettled payment.
     * `async_payment_succeeded` is the event that carries settlement, and it
     * was previously classified "ignored — not yet built", which is the other
     * half of the same defect.
     *
     * Inert on today's configuration (card and Link settle synchronously and
     * never emit the async pair), which is exactly why it is written now:
     * enabling a delayed method in the Dashboard is a configuration change no
     * code review would catch.
     */
    if (!isSettled(session.payment_status)) {
      logger.info(
        "STRIPE_WEBHOOK",
        event.type,
        "Session not settled; no entitlement written (SCL-071). Awaiting checkout.session.async_payment_succeeded.",
        {
          eventId: event.id,
          sessionRef: digestId(session.id),
          paymentStatus: session.payment_status,
        },
      );
      return "processed";
    }

    /**
     * A DENIAL IS A DECISION (SCL-DRAFT-B-denial-is-a-decision).
     *
     * The country gate refuses a payer whose money we have already taken.
     * Refusing to entitle them is right; throwing that refusal was not — it
     * became a 500, which Stripe retried forever, leaving money captured, no
     * entitlement, and no terminal state. Caught here so the event SETTLES.
     *
     * `CountryDenialError` ONLY. A `StripePayloadShapeError`, a Stripe API
     * error or a database failure all still propagate and are still retried,
     * because those are genuine failures and a retry can genuinely fix them.
     * Catching a broader type would turn a parse failure into an automatic
     * refund, which is the same collapse of an error into a legitimate value
     * in the opposite direction.
     */
    try {
      await fulfilCheckoutSession(session, event.type, event.id);
    } catch (err: unknown) {
      if (!(err instanceof CountryDenialError)) throw err;
      return await remediateCountryDenial(session, err, event.type, event.id);
    }
    return "processed";
  }

  if (event.type === "checkout.session.async_payment_failed") {
    // SCL-071: produces NO entitlement, and is NOT a revocation of something
    // that was never granted. Logged so a failed delayed payment is visible.
    logger.warn(
      "STRIPE_WEBHOOK",
      event.type,
      "Delayed payment failed; no entitlement was granted and none is revoked (SCL-071).",
      { eventId: event.id },
    );
    return "processed";
  }

  /**
   * THE DISPATCHER IS EXHAUSTIVE, AND SAYS SO.
   *
   * @spec [Doc-01_V8 §22.1 as amended by SCL-070 (19 subscribed events)]
   * @implemented [2026-08-31 — SCL-DRAFT-B-dispatch-exhaustive]
   *
   * plain English: everything that reaches this point must be one of the three
   * subscription lifecycle events, and anything else stops here instead of being
   * treated as one. Expected outcome: marking an event HANDLED in
   * `event-surface.ts` without giving it a branch above fails loudly and names
   * itself. Trade-off: one more comparison on a path that already branches ten
   * times. Edge case: the event still reaches this line inside `dispatch`'s
   * try/catch, so the idempotency claim is released and Stripe retries — the
   * event is not lost, it is made visible.
   *
   * WHY THIS IS NOT DECORATION. Below this comment the payload is parsed as a
   * SUBSCRIPTION and its `id` is handed to `subscriptions.retrieve`. Every
   * subscribed Stripe object has an `id`, so `subscriptionEventSchema` parses an
   * Invoice, a Charge and a Refund quite happily. A newly-HANDLED
   * `invoice.payment_succeeded` would therefore have reached this fallthrough,
   * parsed clean, and asked Stripe to retrieve a SUBSCRIPTION by an INVOICE id —
   * a "No such subscription: in_…" from the API, three hops from the file that
   * caused it. This is the same class as the matrix's Fix 2: an event hiding in
   * a path that was never told which events belong to it.
   *
   * It routes; it does not gate. Nothing here grants, extends or revokes — the
   * country and settlement gates live in the writers, and this adds none.
   */
  if (
    event.type !== "customer.subscription.created" &&
    event.type !== "customer.subscription.updated" &&
    event.type !== "customer.subscription.deleted"
  ) {
    throw new StripePayloadShapeError(
      event.type,
      "is marked HANDLED in event-surface.ts but has no branch in dispatch(); " +
        "it reached the subscription lifecycle path, which would have retrieved " +
        "a Stripe Subscription by this object's id. Refusing to guess: give the " +
        "event a branch, or mark it ignored with a stated reason.",
    );
  }

  const subscription = parseOrFail(
    subscriptionEventSchema,
    event.data.object,
    event.type,
  );

  // §4.8: a guardian subscription funds several students, one ITEM each, and
  // its SUBSCRIPTION-level metadata names the payer rather than any one
  // student. So the shape has to be read before the subject is: asking
  // `resolveStudentProfileId` first would either throw or pick the payer.
  // Annotated with the named type so this and `writeEntitlementsForAllItems`
  // agree: `parseOrFail`'s generic resolves `T` from `z.ZodType<T>`, which
  // TypeScript treats as distinct from `z.infer<typeof schema>` even though the
  // shapes are identical.
  const retrieved: RetrievedSubscription = parseOrFail(
    retrievedSubscriptionSchema,
    await getStripeClient().subscriptions.retrieve(subscription.id),
    event.type,
  );
  const studentBearingItems = (retrieved.items?.data ?? []).filter(
    (i) => i.metadata?.student_profile_id,
  );

  // Guardian-paid subscriptions take the item path at ANY item count: a
  // guardian with exactly ONE linked student still has a subscription whose
  // metadata names the payer rather than the student, so the single-subject
  // resolver would throw on it. `> 1` alone left that case unhandled.
  //
  // `isGuardianPaid` alone, with NO item-count condition. A guardian-paid
  // subscription never has a single subject — its metadata names the payer —
  // so the single-subject resolver must never run on one, not even when it
  // carries zero student-bearing items. Requiring `>= 1` sent exactly that
  // case to `resolveStudentProfileId`, which threw a generic "no valid
  // student_profile_id" and left the item writer's zero-candidate guard
  // unreachable. That guard is the one that names METADATA PROPAGATION as the
  // likely cause, which is the difference between an actionable failure and a
  // confusing one — and it is why the bare-metadata test could not reach the
  // seam it claimed to guard (Codex HIGH-7).
  const isGuardianPaid = Boolean(retrieved.metadata?.payer_profile_id);
  if (studentBearingItems.length > 1 || isGuardianPaid) {
    await writeEntitlementsForAllItems(retrieved, event.type, event.id);
    return "processed";
  }

  const studentProfileId = resolveStudentProfileId(subscription, event.type);
  await writeEntitlementFromSubscription(
    subscription.id,
    studentProfileId,
    event.type,
    event.id,
  );
  return "processed";
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

  const disposition = dispositionFor(event.type);

  if (disposition.kind === "unsubscribed") {
    // Not a shrug: this means the Dashboard endpoint and `event-surface.ts`
    // disagree about what is being delivered. Acknowledge it — refusing would
    // make Stripe retry an event nothing will ever handle — but say so loudly,
    // because the disagreement is the finding.
    logger.warn(
      "STRIPE_WEBHOOK",
      "unsubscribed_event",
      "Delivered an event that is not on the subscribed surface",
      { requestId, eventId: event.id, eventType: event.type },
    );
    return { ok: true, eventId: event.id, status: "ignored" };
  }

  if (disposition.kind === "ignored") {
    logger.info("STRIPE_WEBHOOK", "ignored", "Event ignored by design", {
      requestId,
      eventId: event.id,
      eventType: event.type,
      reason: disposition.reason,
    });
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
  let dispatchStatus: DispatchStatus;
  try {
    dispatchStatus = await dispatch(event);
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

  // The dispatcher's own answer, not a fixed literal. `remediated` and `held`
  // are terminal states an operator has to be able to see in the access log
  // without correlating it against the application log first.
  return { ok: true, eventId: event.id, status: dispatchStatus };
}
