/**
 * @spec [Coding Standards §7.1 (parse at every boundary), §11.2 (server state via the query
 *        layer); Doc 01 V8 §31.1–§31.3 (guardian access derives from a linked student; one route,
 *        two branches); student-ui register UI-14; Guardian_Closure_Plan G4-09 (G-AUD-26)]
 *   | @implemented [2026-09-29]
 *
 * plain English: the ONE read of `GET /api/billing/status`. Expected outcome: the profile page,
 * the premium prompt, the checkout-return poller, the guardian shell's payment banner and the
 * guardian billing page share one key, one fetch function and one parse, so a page that mounts
 * two of them issues one request and every surface reads the same object.
 *
 * WHY THE GUARDIAN KEY FOLDED IN TOO. `["guardian-billing-status"]` was the same request — same
 * path, same credentials, no parameters — answered by the same route for the same viewer. The
 * route picks its branch from the SESSION's role, not from anything the client sends, so a
 * separate key bought nothing but a second request.
 *
 * ONE HOOK, TWO HISTORIES (merge of main into guardian, 2026-10-01). UI-14 (main) and G4-09
 * (guardian) each built a single billing-status reader on their own branch: this module, and
 * `useBillingStatus` with a Zod parse through the shared `billingStatusResponseSchema`. Two
 * "one reader" modules is the duplication both were written to remove, so they are one again:
 * this module keeps UI-14's key, freshness and sign-out clear, and takes G4-09's parse and
 * label. `useBillingStatus.ts` is deleted.
 *
 * Edge cases: 401/403 and 503 reach the caller as errors (`parseApiErrorFromResponse`). A body
 * that does not match the shared schema is an ERROR too (the query's `isError`), never a
 * partial object — every reader decides on booleans, and a missing boolean read as `false` is a
 * decision nobody made.
 */
import {
  queryOptions,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  billingStatusResponseSchema,
  type BillingStatus,
} from "@lyceon/shared/billing-schema";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";

export type { BillingStatus };

export const BILLING_STATUS_PATH = "/api/billing/status" as const;
export const BILLING_STATUS_QUERY_KEY = [BILLING_STATUS_PATH] as const;

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await csrfFetch(BILLING_STATUS_PATH, { credentials: "include" });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Failed to get billing status");
  }
  const parsed = billingStatusResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Billing status response did not match the contract");
  }
  return parsed.data;
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

/**
 * The words a surface shows for the viewer's billing state.
 *
 * G4-09 label copy: the profile page printed `stripeStatus.replace("_", " ")`, which put the
 * route's private vocabulary on screen — "missing" for someone who has never subscribed. The
 * label now comes from the booleans the server DECIDED (`effectiveAccess`,
 * `needsPaymentUpdate`, `lapsed`), never from re-reading the raw status on the client.
 */
export function billingStatusLabel(
  status: Pick<
    BillingStatus,
    "effectiveAccess" | "needsPaymentUpdate" | "lapsed"
  >,
): string {
  if (status.effectiveAccess) {
    return status.needsPaymentUpdate
      ? "Active — a payment needs attention"
      : "Active";
  }
  return status.lapsed ? "Ended" : "No subscription";
}
