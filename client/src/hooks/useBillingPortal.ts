/**
 * The ONE way a surface opens the Stripe Customer Portal.
 *
 * @spec [Doc 01 V8 §31.4; Subscription and Auto-Renewal Notice §6.4 — Stripe
 *        supplies the cancellation surface; Coding Standards §11.1, §13]
 * @implemented [2026-09-03]
 *
 * plain English: opens the portal, and — this is the part that did not exist —
 * says something when it cannot. Expected outcome: every portal button in the
 * app fails the same way, out loud.
 *
 * WHAT WENT WRONG WITHOUT IT. There were three portal call sites and one error
 * surface between them. `UserProfile` toasted. `ManageSubscriptionButton` had
 * an `onSuccess` handler only, so `portalMutation.error` was set and rendered
 * nowhere. `PremiumUpgradePrompt` called `void handlePrimaryAction()` inside a
 * `try/finally` with no `catch`, discarding the rejection outright. A guardian
 * whose student self-paid holds no Stripe Customer of their own, so the route
 * answers `409 NO_STRIPE_CUSTOMER` — and on two of those three surfaces the
 * button simply stopped spinning. On the `needsPaymentUpdate` interstitial that
 * used to wrap the whole guardian dashboard, that was a silent, total lockout.
 *
 * `NO_STRIPE_CUSTOMER` GETS ITS OWN SENTENCE. "Try again" is wrong advice for
 * it: there is nothing to retry and nothing to manage. Saying whose account
 * holds the subscription is the only useful thing to say.
 */
import { useMutation } from "@tanstack/react-query";
import { openBillingPortal } from "@/lib/billing-client";
import { isApiError, toUserFacingMessage } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

/**
 * @spec [server/routes/billing-routes.ts — the 409 raised when the profile has
 *        no `stripe_customer_id`]
 */
const NO_STRIPE_CUSTOMER = "NO_STRIPE_CUSTOMER";

export function portalErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === NO_STRIPE_CUSTOMER) {
    return "There is no billing account on this profile. If someone else pays for this subscription, they can manage it from their own account settings.";
  }
  return error instanceof Error
    ? error.message
    : toUserFacingMessage(error).message;
}

export type UseBillingPortalResult = {
  readonly open: () => void;
  readonly isPending: boolean;
};

export function useBillingPortal(): UseBillingPortalResult {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => openBillingPortal(),
    onError: (error: unknown) => {
      toast({
        title: "Could not open billing",
        description: portalErrorMessage(error),
      });
    },
  });

  return {
    open: () => mutation.mutate(),
    isPending: mutation.isPending,
  };
}
