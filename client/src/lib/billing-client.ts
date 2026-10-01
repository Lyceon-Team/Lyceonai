/**
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for linked student;
 *        §36.4 per-student billing granularity; Coding Standards §7.2, §11.1,
 *        §17] | @implemented [2026-08-31]
 *
 * plain English: the client entry point for billing. Expected outcome: the two
 * MUTATING routes — POST /checkout and POST /portal — parse their responses
 * against `packages/shared/src/billing-schema.ts`, so both checkout outcomes are
 * handled rather than one being assumed. Trade-offs: the checkout helper returns
 * the parsed outcome instead of a bare URL string, because "the URL" is not a
 * fact on the add-item branch. Edge cases: a response that does not match the
 * contract is refused rather than half-read.
 *
 * ALL THREE READS ARE SCHEMA-BACKED. `getBillingPlans` was not, and its local
 * `BillingPlanMetadata` interface had drifted from the route it described:
 * the route returns `amountCents` and `currency` as NULLABLE and the interface
 * declared them non-null, so every consumer was typed to believe a price always
 * exists. `formatPrice(null)` is `$NaN`, and TypeScript could not warn about it
 * because the lie was in the type. The shape now comes from
 * `billingPlanMetadataSchema` by inference — one definition, and a null is
 * visible to the compiler at every use (Coding Standards §7.1, §7.2, §17).
 *
 * WHY THIS FILE CHANGED. It previously declared its own
 * `BillingPlan = 'monthly' | 'quarterly' | 'yearly'`, duplicating
 * `billingPeriodSchema`, and read `payload.url` unconditionally across both
 * checkout outcomes. The second of those was a real defect on the guardian
 * add-item path: that branch returned `{kind:"item_added", subscriptionItemId}`
 * and no `url`, so the helper threw "Billing response did not include a redirect
 * URL" AFTER the guardian's card had been charged for their second child. The
 * purchase had succeeded; the UI reported failure; a retry then hit
 * `STUDENT_ALREADY_FUNDED`.
 *
 * That branch no longer exists (owner ruling 2026-09-29, one subscription per
 * student): every guardian purchase is a Checkout Session, so there is one
 * outcome and one redirect. Parsing against the shared schema stays, because
 * what it guards is a response this client does not understand — which a deploy
 * skew can still produce — not that one branch in particular.
 */
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import {
  billingCheckoutOutcomeSchema,
  billingPlansResponseSchema,
  billingPortalOutcomeSchema,
  type BillingCheckoutOutcome,
  type BillingPeriodChoice,
  type BillingPlanMetadata,
} from "../../../packages/shared/src/billing-schema";

/**
 * Re-exported from the canonical Zod enum, not redeclared. The previous
 * standalone union was a second definition of the same concept and would have
 * diverged silently the first time a period was added (Coding Standards §17,
 * "duplicate TypeScript types that shadow an existing Zod schema").
 */
export type BillingPlan = BillingPeriodChoice;

export type { BillingCheckoutOutcome };

/**
 * Inferred from the shared Zod schema, never redeclared. The interface that
 * stood here typed `amountCents` and `currency` as non-null against a route that
 * returns both nullable, and carried `equivalentMonthlyCents` and
 * `savingsPercent` — two fields the route has never sent, which is why the only
 * thing that ever filled them was a hardcoded table.
 */
export type { BillingPlanMetadata };

async function postBilling(
  endpoint: "/api/billing/checkout" | "/api/billing/portal",
  body?: unknown,
): Promise<unknown> {
  const response = await csrfFetch(endpoint, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  // ORDER MATTERS. `parseApiErrorFromResponse` reads the body via
  // `response.clone()`, and cloning a Response whose body has ALREADY been
  // consumed throws — so it silently fell back to a generic message. The
  // previous version read `.json()` first and papered over this by passing
  // `payload.error` as the fallback string, which worked only for the flat
  // `{ error: "..." }` shape. Every guardian refusal uses the nested
  // `{ error: { message, code } }` shape instead, so its `code`
  // (STUDENT_NOT_LINKED, STUDENT_ALREADY_FUNDED, COUNTRY_NOT_ELIGIBLE, ...)
  // never reached the UI that switches on it. The body is now left untouched
  // until the error path has had it.
  if (!response.ok) {
    throw await parseApiErrorFromResponse(
      response,
      "Unable to start billing flow",
    );
  }

  return readJson(response);
}

/**
 * Read a 2xx body as JSON.
 *
 * G4-09 (G-AUD-26): both readers here used to swallow a parse failure —
 * `.catch(() => ({}))` and `.catch(() => null)` — and hand the schema an empty
 * stand-in, so a truncated or HTML body surfaced as a contract mismatch naming
 * the wrong cause. A body that is not JSON now fails as itself; the caller's
 * schema parse still decides the shape of one that is.
 */
async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return body;
}

export async function getBillingPlans(): Promise<BillingPlanMetadata[]> {
  const response = await csrfFetch("/api/billing/plans", {
    credentials: "include",
  });

  if (!response.ok) {
    throw await parseApiErrorFromResponse(
      response,
      "Unable to load billing plans",
    );
  }

  // PARSED, NOT SHAPE-SNIFFED. `Array.isArray(payload.plans)` proved the
  // container was an array and nothing about what was in it, so a row with a
  // null amount, a missing interval or a plan name the client does not know
  // reached the renderer typed as complete. Coding Standards §7.1.
  const payload = await readJson(response);
  const parsed = billingPlansResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Billing plans response did not match the contract");
  }
  return parsed.data.plans;
}

/**
 * Start (or extend) a subscription.
 *
 * `studentProfileId` is the guardian's SELECTION of which linked student they
 * are paying for. It is not an authorisation and is not treated as one: the
 * server reads the guardian's active `guardian_links` rows and refuses any id
 * that is not among them (Charter §6). Sending it from a student account is
 * rejected server-side rather than ignored.
 *
 * Returns the parsed outcome. Every guardian purchase — first or fifth — is a
 * Checkout Session, so the browser is always sent to Stripe and callers
 * normally never observe the return value. It is still returned rather than
 * discarded, because in a non-browser environment there is nowhere to redirect
 * to and the caller needs the session back.
 */
export async function startSubscriptionCheckout(
  plan: BillingPlan,
  options?: { readonly studentProfileId?: string },
): Promise<BillingCheckoutOutcome> {
  const payload = await postBilling("/api/billing/checkout", {
    plan,
    ...(options?.studentProfileId
      ? { student_profile_id: options.studentProfileId }
      : {}),
  });

  const parsed = billingCheckoutOutcomeSchema.safeParse(payload);
  if (!parsed.success) {
    // Fail closed and loudly. Redirecting to `undefined`, or silently reporting
    // success, are both worse than saying the response was not understood.
    throw new Error("Billing response did not match the checkout contract");
  }

  const outcome = parsed.data;
  if (typeof window !== "undefined") {
    window.location.assign(outcome.url);
  }

  return outcome;
}

export async function openBillingPortal(): Promise<string> {
  const payload = await postBilling("/api/billing/portal");

  const parsed = billingPortalOutcomeSchema.safeParse(payload);
  if (!parsed.success) {
    // Mirrors the checkout path's fail-closed throw. Previously this narrowed
    // with a cast, which asserts a shape rather than checking one.
    throw new Error("Billing response did not include a redirect URL");
  }

  if (typeof window !== "undefined") {
    window.location.assign(parsed.data.url);
  }

  return parsed.data.url;
}
