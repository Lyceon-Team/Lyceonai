/**
 * The control that opens the Stripe Customer Portal.
 *
 * @spec [Doc-01_V8 §31.4; Subscription and Auto-Renewal Notice §6.4 — Stripe
 *        supplies the cancellation surface] | @implemented [2026-09-02]
 *
 * plain English: shown only when there is something to manage. What it used to
 * do: take no props, query nothing, and render for every guardian who could
 * load the page — which is how an unpaid guardian reached a Stripe portal
 * reading "No payment method / No invoice history". That was correct portal
 * behaviour answering a question that should never have been asked.
 *
 * WHY IT IS ITS OWN FILE. It lived in `SubscriptionPaywall.tsx`, and when that
 * file was renamed to `CheckoutReturnPoller` on 2026-09-03 the button had no
 * business in it — a poller file exporting a subscription button is the same
 * misdirection the rename existed to remove. Its test file was already called
 * `ManageSubscriptionButton.test.tsx`, importing from a module of a different
 * name; now the two agree.
 */
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useBillingPortal } from "@/hooks/useBillingPortal";

type ManageSubscriptionButtonProps = {
  /** From `/api/billing/status`. Absent while the status is still loading. */
  readonly effectiveAccess?: boolean;
  readonly isPaid?: boolean;
  /**
   * A subscription EXISTS on this profile even though it grants nothing right
   * now — `lapsed` from `/api/billing/status`. The portal is the right control
   * for it, and `effectiveAccess` is false, so this is the one case that is not
   * covered by the paid gate below.
   */
  readonly lapsed?: boolean;
  readonly label?: string;
};

/**
 * The portal MANAGES an existing subscription and cannot create one.
 *
 * @spec [Doc-01_V8 §31.4] | @implemented [2026-09-02]
 *
 * plain English: shown only when there is something to manage. What it used to
 * do: take no props, query nothing, and render for every guardian who could
 * load the page — which is how an unpaid guardian reached a Stripe portal
 * reading "No payment method / No invoice history". That was correct portal
 * behaviour answering a question that should never have been asked. Edge case:
 * while the status is loading both props are `undefined` and the button stays
 * hidden, because a control that appears and then vanishes is worse than one
 * that arrives a beat late.
 */
export function ManageSubscriptionButton({
  effectiveAccess,
  isPaid,
  lapsed = false,
  label = "Manage Subscription",
}: ManageSubscriptionButtonProps = {}) {
  /**
   * ONE PORTAL HOOK, ONE ERROR SURFACE.
   *
   * This used to hold its own `useMutation` with an `onSuccess` handler and no
   * `onError`, so a failure set `portalMutation.error` and rendered it nowhere:
   * the button stopped spinning and said nothing. A guardian whose linked
   * student SELF-PAID has no Stripe Customer of their own, so the route answers
   * `409 NO_STRIPE_CUSTOMER` — and that silence, on the interstitial this file
   * used to render, was a total lockout with no visible reason.
   */
  const portal = useBillingPortal();

  // Nothing to manage, nothing shown. While the status is still loading both
  // props are `undefined` and the button stays hidden, because a control that
  // appears and then vanishes is worse than one that arrives a beat late.
  const hasSomethingToManage =
    lapsed === true || (effectiveAccess === true && isPaid === true);
  if (!hasSomethingToManage) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="manage-subscription-button"
      onClick={() => portal.open()}
      disabled={portal.isPending}
    >
      {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </Button>
  );
}
