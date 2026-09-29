/**
 * @spec [Coding Standards §11.2 (server state via the query layer); Doc 01 V8 §31.1–§31.3
 *        (guardian access derives from a linked student; one route, two branches); student-ui
 *        register UI-14] | @implemented [2026-09-29]
 *
 * plain English: the ONE read of `GET /api/billing/status`. Expected outcome: the profile page,
 * the premium prompt, the checkout-return poller and the guardian dashboard share one key and
 * one fetch function, so a page that mounts two of them issues one request.
 *
 * WHY THE GUARDIAN KEY FOLDED IN TOO. `["guardian-billing-status"]` was the same request — same
 * path, same credentials, no parameters — answered by the same route for the same viewer. The
 * route picks its branch from the SESSION's role, not from anything the client sends, so a
 * separate key bought nothing but a second request on the guardian dashboard, which also mounts
 * the poller under `["billing-status"]`.
 *
 * Trade-offs: the body is not Zod-parsed. No shared schema for it exists yet; adding one that
 * fails closed would change what three surfaces render on a malformed body, which is outside
 * UI-14. The type is the route's response (`server/routes/billing-routes.ts`, `/status`) with the
 * guardian-only fields optional, and declares nothing the route does not send.
 *
 * Edge cases: 401/403 and 503 all reach the caller as errors (`parseApiErrorFromResponse`), which
 * is what every consumer already rendered; none of them treated a failed read as "free".
 */
import {
  queryOptions,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";

export const BILLING_STATUS_PATH = "/api/billing/status" as const;
export const BILLING_STATUS_QUERY_KEY = [BILLING_STATUS_PATH] as const;

/** `GET /api/billing/status`, both branches. */
export type BillingStatus = {
  plan: string;
  stripeStatus: string;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  effectiveAccess: boolean;
  /** A banner, never a gate (owner ruling 2026-09-03). */
  needsPaymentUpdate: boolean;
  /** A subscription existed and stopped granting access. */
  lapsed: boolean;
  /** Whether a Stripe Customer exists — a boolean, never the id. */
  hasBillingAccount: boolean;
  isPaid: boolean;
  /**
   * Guardian branch only: linked to any student at all (§31.3's fold). Replaces
   * `linkRequiredForPremium`, `hasLinkedStudent`, `requiresStudentSubscription` and
   * `lockedReason`, which no route ever wrote — so every branch keyed on them was dead.
   */
  hasActiveLink?: boolean;
  /** Guardian branch only: the access is derived, and says so. */
  source?: "guardian_linked_student";
};

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await csrfFetch(BILLING_STATUS_PATH, { credentials: "include" });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Failed to get billing status");
  }
  return res.json() as Promise<BillingStatus>;
}

export const billingStatusQuery = queryOptions<BillingStatus, Error>({
  queryKey: BILLING_STATUS_QUERY_KEY,
  queryFn: fetchBillingStatus,
  retry: 1,
  staleTime: QUERY_FRESHNESS.billingStatus.staleTime,
});

export function useBillingStatusQuery(options?: {
  enabled?: boolean;
  /** Only the checkout-return poller sets this, and only while it waits for the webhook. */
  refetchInterval?: number | false;
}): UseQueryResult<BillingStatus, Error> {
  return useQuery({
    ...billingStatusQuery,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/** Sign-out: drop the cached status so a second account never renders the first's access. */
export function clearBillingStatusQuery(client: QueryClient): void {
  client.removeQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
}
