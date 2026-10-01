/**
 * The ONE reader of `GET /api/billing/status` on the client.
 *
 * @spec [Guardian_Closure_Plan G4-09 (G-AUD-26); Doc 01 V8 §31.1–§31.3; Coding Standards
 *       §7.1 (parse at every boundary), §11.2 (server state via the query layer)]
 * @implemented [2026-09-30]
 *
 * plain English: one query key, one fetcher, one parse. Every banner, prompt and poller that
 * needs the viewer's billing facts calls this hook, so a surface that already holds the answer
 * costs no second request, and the answer every surface reads is the same object.
 *
 * WHAT IT REPLACES. Four readers, three keys (`["billing-status"]`,
 * `["/api/billing/status"]`, `["guardian-billing-status"]`) and four private types, none of
 * which parsed — each cast `res.json()` to whatever subset it happened to read. A key the
 * server renamed then read as `undefined`, and every banner gated on it disappeared without an
 * error: the audit's "a failed billing-status fetch hides every banner silently".
 *
 * edge cases: a body that does not match the schema is an ERROR (the query's `isError`), never
 * a partial object — a reader decides on booleans, and a missing boolean read as `false` is a
 * decision nobody made. Callers that poll pass `refetchInterval`; the hook adds no retry
 * policy beyond one retry, which is what every previous reader used.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  billingStatusResponseSchema,
  type BillingStatus,
} from "@lyceon/shared/billing-schema";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";

export type { BillingStatus };

export const BILLING_STATUS_QUERY_KEY = ["billing-status"] as const;

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await csrfFetch("/api/billing/status", {
    credentials: "include",
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Failed to get billing status");
  }
  const parsed = billingStatusResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Billing status response did not match the contract");
  }
  return parsed.data;
}

export function useBillingStatus(
  options: {
    enabled?: boolean;
    refetchInterval?: number | false;
  } = {},
): UseQueryResult<BillingStatus> {
  return useQuery({
    queryKey: BILLING_STATUS_QUERY_KEY,
    queryFn: fetchBillingStatus,
    retry: 1,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
  });
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
