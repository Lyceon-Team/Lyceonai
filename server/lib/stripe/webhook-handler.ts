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
} from "./subscription-item";
import { dispositionFor } from "./event-surface";
import {
  disputeEventSchema,
  dispositionForClosedDispute,
  refToId,
} from "./dispute";
import { refundEventSchema, decideRefundRevocation } from "./refund";

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
  customer: z
    .union([z.string().min(1), z.object({ id: z.string().min(1) })])
    .nullish(),
});
type RetrievedCharge = z.infer<typeof retrievedChargeSchema>;

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
      status: "processed" | "already_processed" | "ignored";
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

  const customerRef = charge.customer;
  if (!customerRef) {
    // Absence of the only key. A charge with no Customer cannot be a
    // subscription charge, so there is nothing of ours to revoke.
    logger.info("STRIPE_WEBHOOK", eventType, "Charge has no Customer", {
      eventId,
      chargeRef: digestId(chargeId),
    });
    return null;
  }
  const customerId =
    typeof customerRef === "string" ? customerRef : customerRef.id;

  const subscriptions = parseOrFail(
    subscriptionListSchema,
    await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: SUBSCRIPTION_SCAN_LIMIT,
    }),
    eventType,
  );

  /**
   * @revised [2026-08-28 — Codex HIGH-4] The two "several" cases are NOT the
   * same and no longer share a branch.
   *
   *   several ROWS on ONE subscription   the normal guardian shape after
   *                                      migration 20260827010000. The charge
   *                                      paid one invoice covering every item,
   *                                      so every student on it is in scope.
   *                                      ACT ON ALL.
   *   several SUBSCRIPTIONS matching     still ambiguous. The charge paid ONE
   *                                      invoice for ONE subscription; picking
   *                                      one would change a student whose
   *                                      payment was never in question.
   *                                      FAIL CLOSED.
   *
   * Collapsing these into "exactly one row or refuse" is what made a guardian
   * chargeback revoke nobody.
   */
  const matches: { subscriptionId: string; profileIds: string[] }[] = [];
  for (const subscription of subscriptions.data) {
    const entitlements = await getEntitlementsBySubscriptionId(subscription.id);
    if (entitlements.length > 0) {
      matches.push({
        subscriptionId: subscription.id,
        profileIds: entitlements.map((e) => e.profile_id),
      });
    }
  }

  if (matches.length === 0) {
    logger.info("STRIPE_WEBHOOK", eventType, "Charge maps to no entitlement", {
      eventId,
      chargeRef: digestId(chargeId),
    });
    return null;
  }
  if (matches.length > 1) {
    throw new StripePayloadShapeError(
      eventType,
      `charge maps to ${matches.length} SUBSCRIPTIONS; refusing to guess which subscription's students to change`,
    );
  }

  const only = matches[0];
  if (!only) return null;
  return {
    profileIds: only.profileIds,
    subscriptionId: only.subscriptionId,
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
   * expressed. Trade-off: the money has already moved by this point, so a
   * denial leaves a paid customer with no access and needs an operator
   * refund — which is why the ERROR log below names that consequence
   * explicitly rather than failing quietly.
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
      "COUNTRY GATE DENIED — a real charge has been taken and NO entitlement was granted (INV-03-08). Refund it or seed tier_1_countries.",
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
    throw new StripePayloadShapeError(
      eventType,
      `billing country is not Tier-1 eligible (verdict=${eligibility.verdict}); entitlement denied per INV-03-08`,
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
    await writeEntitlementsForAllItems(retrieved, eventType, eventId);
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

async function dispatch(event: Stripe.Event): Promise<void> {
  if (event.type === "refund.updated") {
    await handleRefundUpdated(event);
    return;
  }

  if (event.type === "charge.dispute.created") {
    await handleDisputeCreated(event);
    return;
  }

  if (event.type === "charge.dispute.closed") {
    await handleDisputeClosed(event);
    return;
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
      return;
    }

    await fulfilCheckoutSession(session, event.type, event.id);
    return;
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
    return;
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
    return;
  }

  const studentProfileId = resolveStudentProfileId(subscription, event.type);
  await writeEntitlementFromSubscription(
    subscription.id,
    studentProfileId,
    event.type,
    event.id,
  );
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
  try {
    await dispatch(event);
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

  return { ok: true, eventId: event.id, status: "processed" };
}
