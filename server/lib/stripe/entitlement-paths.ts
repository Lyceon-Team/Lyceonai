/**
 * THE VALIDATION MATRIX — every subscribed event, and what it does to entitlement.
 *
 * @spec [Stripe Integration End-to-End Flow §0, §9; INV-03-08; SCL-045; SCL-046;
 *        SCL-047; SCL-048/072; SCL-070; SCL-071; SCL-073; Charter §6]
 * @implemented [2026-08-28] @revised [2026-08-31 — owner fixes 1–3]
 *
 * plain English: one row per subscribed event plus one per entitlement-granting
 * route, naming the gates, the writer, the idempotency mechanism, the test that
 * fails if the gate is removed, and a call site that is CHECKED rather than
 * asserted. Expected outcome: a path with an empty or untrue cell is a FAILING
 * TEST, not an omission a reviewer has to notice.
 *
 * WHY THIS EXISTS. Three consecutive audits each found the next ungated path:
 * the country evaluator with no caller, then six granting paths with no country
 * gate, then settlement. The common cause was never a missing rule — no document
 * listed all the paths, so each fix covered the instance in front of it.
 *
 * WHAT THE 2026-08-31 REVISION CHANGED, and why each was a real defect:
 *
 *  1. THE CALL SITE IS VERIFIED. Every row carries `callSiteExpect`, and the
 *     test READS the cited line and asserts it contains that text. Previously
 *     the test checked only that the cell looked like `file:digits` and that the
 *     file existed, so all seven citations pointed at closing parens and
 *     docblock fragments and `:999999` passed in a 1736-line file. A decorative
 *     evidence column is worse than none: it tells the next reader a claim was
 *     checked when nothing checked it.
 *
 *  2. EVERY SUBSCRIBED EVENT HAS A ROW — ignored ones included. `customer.deleted`
 *     was invisible because completeness only walked HANDLED events, so an event
 *     that SHOULD change entitlement and did not could never be seen. Enumerating
 *     all of them removes the hiding place entirely, rather than relying on
 *     somebody remembering to flag intent.
 *
 *  3. THE EFFECT IS DERIVED, NOT TYPED. A row declares a `direction` only; the
 *     effect is computed from `EVENT_DISPOSITION`. An ignored event runs no
 *     handler, so it cannot change entitlement, so its effect is `none` — and
 *     declaring a direction on one is a contradiction that throws at module
 *     load. Previously `invoice.payment_succeeded` claimed `extend` with two
 *     gates while the dispatcher ignored it: gates claimed that never execute.
 *
 * Trade-off: the rows are still hand-maintained. That is what
 * `tests/ci/stripe-entitlement-paths.contract.test.ts` is for — it turns drift
 * into a failure instead of a stale comment.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SUBSCRIBED_EVENTS,
  EVENT_DISPOSITION,
  type SubscribedEvent,
} from "./event-surface";

/** The only non-webhook trigger that grants entitlement. */
export const CHECKOUT_ROUTE_TRIGGER = "POST /api/billing/checkout" as const;
export type PathTrigger = SubscribedEvent | typeof CHECKOUT_ROUTE_TRIGGER;

/**
 * What a path does to entitlement. `revoke` includes downgrade to free.
 *
 * `none` is deliberately a member rather than a reason to omit the row: an event
 * that changes nothing must still be ENUMERATED, or "no effect, so no row"
 * becomes the hiding place that concealed `customer.deleted`.
 */
export type EntitlementEffect =
  | "grant"
  | "extend"
  | "restore"
  | "revoke"
  | "none";

/** The direction a path takes when it runs. `null` = it writes no entitlement. */
export type EntitlementDirection = Exclude<EntitlementEffect, "none">;

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

/**
 * The gates every event clears BEFORE the dispatcher looks at its type. An
 * ignored event reaches no handler, so these are the only gates it can truthfully
 * claim — asserted in the contract test.
 */
export const PRE_DISPATCH_GATES: readonly string[] = [
  GATES.SIGNATURE,
  GATES.LIVEMODE,
  GATES.IDEMPOTENCY,
];

const WH = "server/lib/stripe/webhook-handler.ts";
const ES = "server/lib/stripe/event-surface.ts";
const BR = "server/routes/billing-routes.ts";

type PathSpec = {
  readonly path: string;
  readonly trigger: PathTrigger;
  /**
   * What this path does to entitlement WHEN IT RUNS, or null when it writes
   * none. Never the effect itself — see `deriveEffect`.
   */
  readonly direction: EntitlementDirection | null;
  readonly gates: readonly string[];
  readonly writer: string;
  readonly idempotency: string;
  readonly gateTest: string;
  /** `file:line` of the production call site. VERIFIED, not asserted. */
  readonly callSite: string;
  /** Text the cited line must contain. This is what makes the citation evidence. */
  readonly callSiteExpect: string;
};

export type EntitlementPath = PathSpec & { readonly effect: EntitlementEffect };

function isRouteTrigger(t: PathTrigger): t is typeof CHECKOUT_ROUTE_TRIGGER {
  return t === CHECKOUT_ROUTE_TRIGGER;
}

/**
 * Fix 3: the effect is COMPUTED so it cannot contradict the dispatcher.
 *
 * An ignored event runs no handler and therefore changes no entitlement — its
 * effect is `none` whatever anyone types. Declaring a direction on one is not a
 * value to be quietly coerced, it is a contradiction between this matrix and
 * `EVENT_DISPOSITION`, so it throws. Module-load is the right place: nothing in
 * production imports this file, and a matrix that lies is worth failing loudly.
 */
export function deriveEffect(
  trigger: PathTrigger,
  direction: EntitlementDirection | null,
): EntitlementEffect {
  if (isRouteTrigger(trigger)) return direction ?? "none";

  const disposition = EVENT_DISPOSITION[trigger];
  if (disposition.kind === "ignored") {
    if (direction !== null) {
      throw new Error(
        `entitlement matrix contradicts EVENT_DISPOSITION: "${trigger}" is ignored ` +
          `(no handler runs) but the row declares direction "${direction}". An ignored ` +
          `event cannot change entitlement. Either handle the event or declare no direction.`,
      );
    }
    return "none";
  }

  return direction ?? "none";
}

function definePath(spec: PathSpec): EntitlementPath {
  return { ...spec, effect: deriveEffect(spec.trigger, spec.direction) };
}

/**
 * EVERY subscribed event, plus the one granting route.
 *
 * Revocation paths deliberately carry NO country gate: refusing to revoke
 * because a country cannot be established would leave premium in place, which is
 * the failure the gate exists to prevent. That asymmetry is tested.
 */
export const ENTITLEMENT_PATHS: readonly EntitlementPath[] = [
  definePath({
    path: "Checkout completed, settled",
    trigger: "checkout.session.completed",
    direction: "grant",
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
    callSite: `${WH}:1663`,
    callSiteExpect: "await fulfilCheckoutSession(session, event.type, event.id)",
  }),
  definePath({
    path: "Delayed payment settled",
    trigger: "checkout.session.async_payment_succeeded",
    direction: "grant",
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
    callSite: `${WH}:1663`,
    callSiteExpect: "await fulfilCheckoutSession(session, event.type, event.id)",
  }),
  definePath({
    path: "Delayed payment failed",
    trigger: "checkout.session.async_payment_failed",
    direction: null,
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY],
    writer:
      "none — SCL-071: grants nothing, and is NOT a revocation of something never granted",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-settlement.contract.test.ts",
    callSite: `${WH}:1667`,
    callSiteExpect: 'event.type === "checkout.session.async_payment_failed"',
  }),
  definePath({
    path: "Subscription created",
    trigger: "customer.subscription.created",
    direction: "grant",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "writeEntitlementsForAllItems | writeEntitlementFromSubscription",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:1724`,
    callSiteExpect: "await writeEntitlementFromSubscription(",
  }),
  definePath({
    path: "Subscription updated",
    trigger: "customer.subscription.updated",
    direction: "extend",
    gates: [
      GATES.SIGNATURE,
      GATES.LIVEMODE,
      GATES.IDEMPOTENCY,
      GATES.SHAPE,
      GATES.COUNTRY,
      GATES.SUBJECT_AUTH,
    ],
    writer: "writeEntitlementsForAllItems | writeEntitlementFromSubscription",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:1724`,
    callSiteExpect: "await writeEntitlementFromSubscription(",
  }),
  definePath({
    path: "Subscription canceled",
    trigger: "customer.subscription.deleted",
    direction: "revoke",
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY, GATES.SHAPE],
    writer: "writeEntitlementFromSubscription (tier=free)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:1724`,
    callSiteExpect: "await writeEntitlementFromSubscription(",
  }),
  definePath({
    path: "Country egress (payer left Tier-1)",
    trigger: "customer.updated",
    direction: null,
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY, GATES.SHAPE],
    writer:
      "none — writes NO entitlement; sets cancel_at_period_end on Stripe (SCL-047). " +
      "The revoke arrives later through customer.subscription.updated/deleted",
    idempotency: "event id insert-once; cancel_at_period_end is idempotent",
    gateTest: "tests/ci/stripe-lifecycle-gate.contract.test.ts",
    callSite: `${WH}:1604`,
    callSiteExpect: "await handleCustomerUpdated(event)",
  }),
  definePath({
    path: "Customer deleted — billing relationship ended",
    trigger: "customer.deleted",
    direction: "revoke",
    gates: [GATES.SIGNATURE, GATES.LIVEMODE, GATES.IDEMPOTENCY, GATES.SHAPE],
    writer: "handleCustomerDeleted -> revokeAllProfiles (tier=free)",
    idempotency: "event id insert-once; upsert on profile_id",
    gateTest: "tests/ci/stripe-customer-deleted.contract.test.ts",
    callSite: `${WH}:1599`,
    callSiteExpect: "await handleCustomerDeleted(event)",
  }),
  definePath({
    path: "Chargeback opened",
    trigger: "charge.dispute.created",
    direction: "revoke",
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
    callSite: `${WH}:1614`,
    callSiteExpect: "await handleDisputeCreated(event)",
  }),
  definePath({
    path: "Dispute closed in our favour",
    trigger: "charge.dispute.closed",
    direction: "restore",
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
    callSite: `${WH}:1619`,
    callSiteExpect: "await handleDisputeClosed(event)",
  }),
  definePath({
    path: "Full refund",
    trigger: "refund.updated",
    direction: "revoke",
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
    callSite: `${WH}:1609`,
    callSiteExpect: "await handleRefundUpdated(event)",
  }),

  // ---- Subscribed and IGNORED -------------------------------------------
  // Enumerated, not omitted. Each reaches no handler, so each can claim only
  // the pre-dispatch gates, and each cites the disposition entry that records
  // WHY it is ignored. `customer.deleted` hid in this group until 2026-08-31.
  definePath({
    path: "Renewal paid (observability only)",
    trigger: "invoice.payment_succeeded",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer:
      "none — §4.5 single-writer: the period is written from " +
      "customer.subscription.updated and from nothing else",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:118`,
    callSiteExpect: '"invoice.payment_succeeded": ignored(',
  }),
  definePath({
    path: "Renewal failed (observability only)",
    trigger: "invoice.payment_failed",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer:
      "none — past_due arrives through customer.subscription.updated (§4.5)",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:125`,
    callSiteExpect: '"invoice.payment_failed": ignored(',
  }),
  definePath({
    path: "Refund created (not yet settled)",
    trigger: "refund.created",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — revocation waits for refund.updated reaching succeeded",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:130`,
    callSiteExpect: '"refund.created": ignored(',
  }),
  definePath({
    path: "Discount created",
    trigger: "customer.discount.created",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — SCL-072 observability of the charged amount",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:97`,
    callSiteExpect: '"customer.discount.created": ignored(',
  }),
  definePath({
    path: "Discount updated",
    trigger: "customer.discount.updated",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — SCL-072 observability of the charged amount",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:102`,
    callSiteExpect: '"customer.discount.updated": ignored(',
  }),
  definePath({
    path: "Discount deleted",
    trigger: "customer.discount.deleted",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — SCL-072 observability of the charged amount",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:106`,
    callSiteExpect: '"customer.discount.deleted": ignored(',
  }),
  definePath({
    path: "Promotion code created",
    trigger: "promotion_code.created",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — SCL-072 observability of the charged amount",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:110`,
    callSiteExpect: '"promotion_code.created": ignored(',
  }),
  definePath({
    path: "Promotion code updated",
    trigger: "promotion_code.updated",
    direction: null,
    gates: PRE_DISPATCH_GATES,
    writer: "none — SCL-072 observability of the charged amount",
    idempotency: "event id insert-once",
    gateTest: "tests/ci/stripe-entitlement-paths.contract.test.ts",
    callSite: `${ES}:114`,
    callSiteExpect: '"promotion_code.updated": ignored(',
  }),

  // ---- The one non-webhook granting path ---------------------------------
  definePath({
    path: "Guardian adds a student (add-item)",
    trigger: CHECKOUT_ROUTE_TRIGGER,
    direction: "grant",
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
    callSite: `${BR}:286`,
    callSiteExpect: "deniesEntitlement(eligibility)",
  }),
];

/**
 * Reads the line a row cites and returns it. Exported so the contract test does
 * the reading rather than trusting a string — Fix 1's whole point.
 */
export function readCitedLine(
  repoRoot: string,
  callSite: string,
): { file: string; line: number; text: string | null } {
  const idx = callSite.lastIndexOf(":");
  const file = callSite.slice(0, idx);
  const line = Number(callSite.slice(idx + 1));
  const lines = readFileSync(resolve(repoRoot, file), "utf8").split("\n");
  return { file, line, text: lines[line - 1] ?? null };
}

/** Every subscribed event, for the completeness assertion. */
export const ALL_SUBSCRIBED_EVENTS: readonly SubscribedEvent[] =
  SUBSCRIBED_EVENTS;
