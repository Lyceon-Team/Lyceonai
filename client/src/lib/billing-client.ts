/**
 * @spec [Doc 01 V8 §20 "Who pays"; §31.4 guardian paying for linked student;
 *        §36.4 per-student billing granularity; Coding Standards §7.2, §11.1,
 *        §17] | @implemented [2026-08-31]
 *
 * plain English: the client entry point for billing. Expected outcome: it speaks
 * exactly the contract `packages/shared/src/billing-schema.ts` defines, and both
 * checkout outcomes are handled rather than one being assumed. Trade-offs: the
 * checkout helper now returns the parsed outcome instead of a bare URL string,
 * because "the URL" is not a fact on the add-item branch. Edge cases: a response
 * that does not match the contract is refused rather than half-read.
 *
 * WHY THIS FILE CHANGED. It previously declared its own
 * `BillingPlan = 'monthly' | 'quarterly' | 'yearly'`, duplicating
 * `billingPeriodSchema`, and read `payload.url` unconditionally on both
 * outcomes. The second of those is a real defect on the guardian add-item path
 * (row 20): that branch returns `{kind:"item_added", subscriptionItemId}` and no
 * `url`, so the helper threw "Billing response did not include a redirect URL"
 * AFTER the guardian's card had been charged for their second child. The purchase
 * had succeeded; the UI reported failure; a retry then hit
 * `STUDENT_ALREADY_FUNDED`. Parsing against the shared discriminated schema makes
 * that branch impossible to skip.
 */
import { csrfFetch } from '@/lib/csrf';
import { parseApiErrorFromResponse } from '@/lib/api-error';
import {
  billingCheckoutOutcomeSchema,
  type BillingCheckoutOutcome,
  type BillingPeriodChoice,
} from '../../../packages/shared/src/billing-schema';

/**
 * Re-exported from the canonical Zod enum, not redeclared. The previous
 * standalone union was a second definition of the same concept and would have
 * diverged silently the first time a period was added (Coding Standards §17,
 * "duplicate TypeScript types that shadow an existing Zod schema").
 */
export type BillingPlan = BillingPeriodChoice;

export type { BillingCheckoutOutcome };

export interface BillingPlanMetadata {
  plan: BillingPlan;
  label: string;
  amountCents: number;
  currency: string;
  intervalLabel: string;
  equivalentMonthlyCents?: number;
  savingsPercent?: number;
  stripePriceIdConfigured: boolean;
}

async function postBilling(
  endpoint: '/api/billing/checkout' | '/api/billing/portal',
  body?: unknown,
): Promise<unknown> {
  const response = await csrfFetch(endpoint, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
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
    throw await parseApiErrorFromResponse(response, 'Unable to start billing flow');
  }

  return response.json().catch(() => ({}));
}

export async function getBillingPlans(): Promise<BillingPlanMetadata[]> {
  const response = await csrfFetch('/api/billing/plans', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Unable to load billing plans');
  }

  const payload = await response.json().catch(() => ({} as { plans?: BillingPlanMetadata[] }));
  const plans = Array.isArray(payload?.plans) ? payload.plans : [];
  return plans;
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
 * Returns the parsed outcome. On `checkout_session` the browser is sent to
 * Stripe, so callers normally never observe the return value; on `item_added`
 * there is no redirect and the purchase is already complete.
 */
export async function startSubscriptionCheckout(
  plan: BillingPlan,
  options?: { readonly studentProfileId?: string },
): Promise<BillingCheckoutOutcome> {
  const payload = await postBilling('/api/billing/checkout', {
    plan,
    ...(options?.studentProfileId
      ? { student_profile_id: options.studentProfileId }
      : {}),
  });

  const parsed = billingCheckoutOutcomeSchema.safeParse(payload);
  if (!parsed.success) {
    // Fail closed and loudly. Redirecting to `undefined`, or silently reporting
    // success, are both worse than saying the response was not understood.
    throw new Error('Billing response did not match the checkout contract');
  }

  const outcome = parsed.data;
  if (outcome.kind === 'checkout_session' && typeof window !== 'undefined') {
    window.location.assign(outcome.url);
  }

  return outcome;
}

export async function openBillingPortal(): Promise<string> {
  const payload = await postBilling('/api/billing/portal');
  const url = (payload as { url?: unknown } | null)?.url;

  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Billing response did not include a redirect URL');
  }

  if (typeof window !== 'undefined') {
    window.location.assign(url);
  }

  return url;
}
