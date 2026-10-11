/**
 * The deterministic idempotency key for the one Stripe call that creates a charge.
 *
 * @revised [2026-09-29 — owner ruling: one subscription per student] There used
 *          to be two keys here, the second for `subscriptionItems.create`. That
 *          call is gone: adding an item took no money at the moment of purchase,
 *          so every guardian purchase is now a Checkout Session and
 *          `checkoutIdempotencyKey` is the only key needed.
 *
 * @spec [Doc 01 V8 §20 "Who pays"; Coding Standards §4.2 mutations are
 *        idempotent] | @implemented [2026-09-02]
 *
 * plain English: two rapid identical purchase attempts for one student must
 * produce ONE subscription. Stripe caches the response for a repeated
 * idempotency key for 24 hours and returns the original object instead of
 * creating a second one, so the key is what collapses a double-submit.
 *
 * WHY A KEY AND NOT A GUARD. `evaluateSubjectPurchaseEligibility` closes the
 * SETTLED case — the first purchase's webhook has landed and written the
 * entitlement row. It cannot close the window between
 * `checkout.sessions.create` returning and that webhook arriving: in that window
 * `entitlement_active()` is still false, both guards allow, and a double-submit
 * produces two Checkout Sessions and two subscriptions. Self-pay has no other
 * cover in that window at all.
 *
 * THIS IS STRIPE'S IDEMPOTENCY, NOT OURS. It is a per-request header on the SDK
 * call (`RequestOptions.idempotencyKey`, verified in the pinned stripe types at
 * `types/lib.d.ts:135`). Doc 01A Part IV's `idempotency_records` /
 * `idempotency_runtime_config` and the `IdempotencyService` over them were never
 * built; both tables were dropped by owner ruling 2026-10-05 (C-03).
 *
 * A DISABLED BUTTON IS UX, NEVER THE CONTROL. Nothing here depends on the
 * frontend declining to send a second request.
 */

/**
 * How long two attempts are treated as the same purchase.
 *
 * Sixty seconds: long enough to absorb a double-click, a client retry and a
 * slow network; short enough that a customer who abandons Checkout and comes
 * back is handed a fresh session rather than a stale one.
 *
 * THE BOUNDARY IS REAL AND IS NOT PAPERED OVER. Two clicks that straddle a
 * window boundary produce different keys and therefore two sessions. That is
 * accepted, not overlooked: the residual exposure is the fraction of a second
 * around the boundary, and the durable entitlement guard closes it permanently
 * once the first webhook lands. A key derived from a stored per-attempt value
 * instead of the clock would be total — and would be the reservation table this
 * design was ruled against.
 */
export const PURCHASE_IDEMPOTENCY_WINDOW_MS = 60_000;

function windowIndex(nowMs: number): number {
  return Math.floor(nowMs / PURCHASE_IDEMPOTENCY_WINDOW_MS);
}

/**
 * The key for `checkout.sessions.create`.
 *
 * `lyceon:checkout:{subject}:{price}:{window}`
 *
 * - **subject** — the STUDENT being funded, resolved server-side. Not the
 *   payer: a guardian buying for two children must produce two keys, or the
 *   second child would be handed the first child's session.
 * - **price** — a customer switching plan inside the window must not be handed
 *   the old session.
 * - **window** — bounds the collapse, so a legitimate re-purchase later is not
 *   blocked by a key that never expires.
 *
 * THE PAYER IS DELIBERATELY ABSENT, and that is load-bearing rather than an
 * omission. Student S self-paying and guardian G buying for S inside one window
 * produce the SAME key with different `client_reference_id`, `metadata` and
 * `success_url`. Stripe answers a differing request on a used key with
 * `StripeIdempotencyError` rather than a second session — which is the outcome
 * we want, since S must end up with one subscription either way. Adding the
 * payer to the key would give them different keys and hand out two
 * subscriptions. So the error is a DESIGNED path, not an exception, and the
 * caller must surface it as a refusal rather than a fault.
 */
export function checkoutIdempotencyKey(input: {
  readonly subjectProfileId: string;
  readonly priceId: string;
  readonly nowMs: number;
  /**
   * The promotion code PRE-APPLIED to this attempt (owner brief 2026-10-10, `/upgrade?promo=`),
   * or absent. It is part of the request, so it is part of the key: the one retry without a code
   * Stripe refused must not reuse the key of the attempt with it (Stripe would answer
   * `idempotency_error`, read here as "purchase in flight"). Absent leaves the key exactly as
   * before, so every existing caller and window is unchanged.
   */
  readonly promotionCodeId?: string | null;
}): string {
  const base = `lyceon:checkout:${input.subjectProfileId}:${input.priceId}:${windowIndex(input.nowMs)}`;
  return input.promotionCodeId ? `${base}:${input.promotionCodeId}` : base;
}

/**
 * Is this the error Stripe raises when a key is reused with different params?
 *
 * @revised [2026-10-10, owner brief: "the duplicate-purchase check comparing the wrong err.type
 *          (should return 409, not 500)"]
 *
 * Narrowed on the error's fields rather than `instanceof`, because the SDK's error
 * classes are constructed through a factory and an `instanceof` check across
 * two copies of the module (a real hazard in a monorepo with hoisting) silently
 * answers false — which would turn a designed refusal back into a 500.
 *
 * WHICH FIELD. stripe-node builds a `StripeIdempotencyError` whose `type` is the CLASS name
 * (`"StripeIdempotencyError"`) and whose `rawType` is the API's `"idempotency_error"`
 * (`node_modules/stripe/cjs/Error.js`: `this.type = type || this.constructor.name`,
 * `this.rawType = raw.type`). This compared `type` to `"idempotency_error"`, which no real
 * SDK error carries, so a genuine conflict fell through to the route's 500. Its test's fake
 * Stripe threw exactly that impossible shape, so both agreed and the 409 was never proved;
 * the fake now throws the SDK's own error class.
 */
export function isStripeIdempotencyConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { type?: unknown; rawType?: unknown };
  return (
    e.type === "StripeIdempotencyError" || e.rawType === "idempotency_error"
  );
}
