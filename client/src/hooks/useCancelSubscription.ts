/**
 * The ONE reader and the ONE writer of cancellation state, for both surfaces.
 *
 * @spec [SCL-271; SCL-272 clause 4 (the UI shows the button only to the payer —
 *        and it is the SERVER that decides who that is, by answering with an
 *        empty list to everyone else); Coding Standards §11.1, §11.3]
 * | @implemented [2026-11-03]
 *
 * plain English: student Settings and the guardian billing page read the same
 * query and call the same mutations, so the two cannot disagree about what is
 * cancellable or when access ends. Expected outcome: no surface derives a
 * decision or a date — both arrive from the server already decided.
 *
 * NO CLIENT PRIVILEGE, AND IT NEEDS NO CLIENT LOGIC TO ACHIEVE IT. There is no
 * `if (role === 'guardian')` anywhere in this flow. `GET /cancel-state` answers
 * with the subscriptions the CALLER is the payer of — an empty array for a
 * student whose guardian pays, for a student who never paid, and for anyone
 * else — so "show the button only to the payer" is a consequence of the
 * server's answer rather than a rule the client enforces. Editing anything in
 * devtools changes what is requested; `POST /cancel` re-resolves the id against
 * the caller's own Stripe Customer before acting.
 *
 * edge case: both mutations invalidate the billing status as well as this query.
 * A cancellation changes what Settings says about the plan, and leaving the
 * status cached would show "Manage billing" beside a subscription the customer
 * has just cancelled.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CancellableSubscription,
  CancelResponse,
  CancelStateResponse,
  CancelUndoResponse,
} from "@lyceon/shared/billing-schema";
import {
  CANCEL_STATE_PATH,
  cancelSubscription,
  fetchCancelState,
  undoSubscriptionCancellation,
} from "@/lib/billing-client";
import { BILLING_STATUS_QUERY_KEY } from "@/hooks/useBillingStatusQuery";
import { isApiError, toUserFacingMessage } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

export type { CancellableSubscription };

export const CANCEL_STATE_QUERY_KEY = [CANCEL_STATE_PATH] as const;

/** @spec [server/routes/billing-routes.ts — the 403 raised when the caller is not the payer] */
const NOT_THE_PAYER = "NOT_THE_PAYER";

export function cancelErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === NOT_THE_PAYER) {
    return "Only the person who pays for this subscription can cancel it. If a parent or guardian pays, they can cancel it from their own account.";
  }
  return error instanceof Error
    ? error.message
    : toUserFacingMessage(error).message;
}

export function useCancelState(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<CancelStateResponse> {
  return useQuery({
    queryKey: CANCEL_STATE_QUERY_KEY,
    queryFn: fetchCancelState,
    enabled: options.enabled ?? true,
    // Not cached across mounts: a cancellation made in another tab, or the
    // moment a scheduled one takes effect, must not be read from a stale list.
    staleTime: 0,
    retry: false,
  });
}

export type UseCancelSubscriptionResult = {
  readonly cancel: (subscriptionId: string) => void;
  readonly isPending: boolean;
  readonly result: CancelResponse | undefined;
  readonly error: unknown;
  readonly reset: () => void;
};

export function useCancelSubscription(): UseCancelSubscriptionResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (subscriptionId: string) =>
      cancelSubscription(subscriptionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CANCEL_STATE_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: BILLING_STATUS_QUERY_KEY,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not cancel",
        description: cancelErrorMessage(error),
      });
    },
  });

  return {
    cancel: (subscriptionId: string) => mutation.mutate(subscriptionId),
    isPending: mutation.isPending,
    result: mutation.data,
    error: mutation.error,
    reset: () => mutation.reset(),
  };
}

export type UseUndoCancellationResult = {
  readonly undo: (subscriptionId: string) => void;
  readonly isPending: boolean;
  readonly result: CancelUndoResponse | undefined;
};

export function useUndoCancellation(): UseUndoCancellationResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (subscriptionId: string) =>
      undoSubscriptionCancellation(subscriptionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CANCEL_STATE_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: BILLING_STATUS_QUERY_KEY,
      });
      toast({
        title: "Subscription restored",
        description: "Your plan will continue and billing resumes as normal.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not restore the subscription",
        description: cancelErrorMessage(error),
      });
    },
  });

  return {
    undo: (subscriptionId: string) => mutation.mutate(subscriptionId),
    isPending: mutation.isPending,
    result: mutation.data,
  };
}
