/**
 * THE VALIDATION MATRIX — every path that changes entitlement, and its gates.
 *
 * @spec [Stripe Integration End-to-End Flow §0, §9; INV-03-08; SCL-046;
 *        SCL-047; SCL-048/072; SCL-071; SCL-073; Charter §6]
 * @implemented [2026-08-28]
 *
 * plain English: one row per path that grants, extends, restores or revokes
 * entitlement, naming the trigger, the gates, the writer, the idempotency
 * mechanism, the test that fails if the gate is removed, and the production
 * call site. Expected outcome: a new path with an empty cell is a FAILING TEST,
 * not an omission a reviewer has to notice.
 *
 * WHY THIS EXISTS. Three consecutive audits each found the next ungated path:
 * the country evaluator with no caller at all, then six granting paths with no
 * country gate, then settlement. The common cause was never a missing rule — it
 * was that no document listed all the paths, so each fix covered the instance
 * in front of it. This is the enumeration.
 *
 * Trade-off: the matrix is hand-maintained and can drift from the code. That is
 * what `tests/ci/stripe-entitlement-paths.contract.test.ts` is for — it asserts
 * every subscribed event that can change entitlement appears here, every cell
 * is filled, and every named call site and test file actually exists. Drift
 * becomes a failure rather than a stale comment.
 */
import type { SubscribedEvent } from "./event-surface";

/**
 * What a path does to entitlement. `revoke` includes downgrade to free.
 *
 * `none` is deliberately a member rather than a reason to omit the row. A
 * HANDLED event that changes nothing still has to be ENUMERATED, or "handled
 * but absent from the matrix" becomes a hiding place — which is precisely how
 * the previous ungated paths stayed invisible.
 */
export type EntitlementEffect =
  | "grant"
  | "extend"
  | "restore"
  | "revoke"
  | "none";

export type EntitlementPath = {
  /** Human name of the path. */
  readonly path: string;
  /** The Stripe event that triggers it, or `null` for an API route. */
  readonly trigger: SubscribedEvent | "POST /api/billing/checkout";
  readonly effect: EntitlementEffect;
  /**
   * Every gate applied before the write. A GRANT path with no country gate is
   * the defect class this matrix exists to make impossible.
   */
  readonly gates: readonly string[];
  /** The function that performs the entitlement write. */
  readonly writer: string;
  /** How a replay is made harmless. */
  readonly idempotency: string;
  /** The test file whose failure proves a removed gate. */
  readonly gateTest: string;
  /** `file:line` of the production call site. */
  readonly callSite: string;
};

/**
 * Gate vocabulary. Closed on purpose: a typo'd gate name is a compile error
 * rather than a row that looks gated and is not.
 */
export const GATES = {
  SIGNATURE: "stripe signature verification",
  LIVEMODE: "livemode assertion (SCL-049)",
  IDEMPOTENCY: "stripe_webhook_events insert-once (23505)",
  SHAPE: "Zod boundary parse",
  SETTLEMENT: "payment_status settled (SCL-071)",
  COUNTRY: "INV-03-08 Tier-1 country (SCL-046)",
  PAYMENT_LINK: "Payment Link refusal (Charter §6)",
  SUBJECT_AUTH: "subject resolved against active guardian_links (Charter §6)",
  PROVENANCE: "charge -> invoice -> subscription provenance",
  AUTH: "authenticated session + role",
  SELECTION_AUTH: "selected student is an ACTIVE link (Charter §6)",
} as const;

const WH = "server/lib/stripe/webhook-handler.ts";
const BR = "server/routes/billing-routes.ts";

/**
 * EVERY entitlement-changing path.
 *
 * Revocation paths deliberately carry NO country gate: refusing to revoke
 * because a country cannot be established would leave premium in place, which
 * is the failure the gate exists to prevent. That asymmetry is tested.
 */
export const ENTITLEMENT_PATHS: readonly EntitlementPath[] = [
  {
    path: "Checkout completed, settled",
    trigger: "checkout.session.completed",
    effect: "grant",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.PAYMENT_LINK,
      GATES.SETTLEMENT,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "fulfilCheckoutSession -> writeEntitlement*",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-settlement.contract.test.ts",
    callSite: `${WH}:1233`,
  },
  {
    path: "Delayed payment settled",
    trigger: "checkout.session.async_payment_succeeded",
    effect: "grant",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.PAYMENT_LINK,
      GATES.SETTLEMENT,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "fulfilCheckoutSession -> writeEntitlement*",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-settlement.contract.test.ts",
    callSite: `${WH}:1233`,
  },
  {
    path: "Subscription created",
    trigger: "customer.subscription.created",
    effect: "grant",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "writeEntitlementFromSubscription | writeEntitlementsForAllItems",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:476`,
  },
  {
    path: "Subscription updated (grant or extend)",
    trigger: "customer.subscription.updated",
    effect: "extend",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "writeEntitlementFromSubscription | writeEntitlementsForAllItems",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:476`,
  },
  {
    path: "Renewal paid",
    trigger: "invoice.payment_succeeded",
    effect: "extend",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer:
      "none directly — the period comes from customer.subscription.updated (one writer, SCL-029)",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:476`,
  },
  {
    path: "Subscription canceled / deleted",
    trigger: "customer.subscription.deleted",
    effect: "revoke",
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY, GATES.SHAPE],
    writer: "writeEntitlementFromSubscription (tier=free)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:476`,
  },
  {
    path: "Chargeback opened",
    trigger: "charge.dispute.created",
    effect: "revoke",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.PROVENANCE,
    ],
    writer: "revokeAllProfiles (pause_collection first, SCL-073)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-dispute.contract.test.ts",
    callSite: `${WH}:629`,
  },
  {
    path: "Dispute closed in our favour",
    trigger: "charge.dispute.closed",
    effect: "restore",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.PROVENANCE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "rederiveEntitlementsForSubscription (resume first, SCL-073)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:796`,
  },
  {
    path: "Full refund",
    trigger: "refund.updated",
    effect: "revoke",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.PROVENANCE,
    ],
    writer: "revokeAllProfiles (pause_collection first, SCL-048/072)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-refund.contract.test.ts",
    callSite: `${WH}:629`,
  },
  {
    path: "Country egress (payer left Tier-1)",
    trigger: "customer.updated",
    effect: "revoke",
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY, GATES.SHAPE],
    writer:
      "none directly — cancel_at_period_end on Stripe; free arrives at period end (SCL-047)",
    idempotency: "event id insert-once; cancel_at_period_end is idempotent",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:1411`,
  },
  {
    path: "Delayed payment failed",
    trigger: "checkout.session.async_payment_failed",
    effect: "none",
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY],
    writer:
      "none — SCL-071: grants nothing, and is NOT a revocation of something never granted",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-settlement.contract.test.ts",
    callSite: `${WH}:1520`,
  },
  {
    path: "Guardian adds a student (add-item)",
    trigger: "POST /api/billing/checkout",
    effect: "grant",
    gates: [
      GATES.AUTH,
      GATES.SHAPE,
      GATES.SELECTION_AUTH,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer:
      "subscriptionItems.create; the row is written by customer.subscription.updated",
    idempotency:
      "already-funded guard refuses a second item for the same student",
    gateTest: "tests/ci/identity-entitlement.contract.test.ts",
    callSite: `${BR}:227`,
  },
];
