/**
 * Guardian access gate — NOT a purchase surface.
 *
 * @spec [Doc-01_V8 §31.3 guardian access derives from a linked student's
 *        entitlement; §31.4] | @implemented [2026-08-31, rescoped 2026-09-02]
 *
 * plain English: decides whether a guardian sees their dashboard or a
 * "payment needs attention" notice. Expected outcome: a guardian whose linked
 * student is paid, or who still has buying to do, reaches the dashboard; a
 * guardian whose student's payment has FAILED is told so and sent to the
 * portal, which is the one thing the portal is for.
 *
 * WHAT THIS NO LONGER DOES, AND WHY. It used to own the guardian purchase
 * surface: a pricing page with a student picker, rendered only while
 * `effectiveAccess` was false. That gating was the defect. §31.3's fold grants
 * a guardian access as soon as ANY ONE linked student is premium, so the moment
 * a guardian paid for their first child the paywall stepped aside — taking the
 * only picker in the app with it, and leaving no way to buy for the second.
 * Guardian `c6d3fc60` sat in exactly that state: two active links, one student
 * premium, zero deployed paths to fund the other.
 *
 * A purchase surface must be keyed on "is there a linked student nobody has
 * paid for", which is a fact about STUDENTS. This component only knows a fact
 * about the GUARDIAN. So the surface moved to `GuardianPurchaseCard`, on the
 * dashboard, where the per-student answer lives — and this component must now
 * let the guardian THROUGH to reach it. Blocking them here with the picker
 * gone would rebuild the same trap facing the other way: a pricing page in
 * front of the dashboard that holds the only way to pay.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CreditCard, AlertTriangle } from "lucide-react";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";

/**
 * ONLY the fields this component reads. Seven more were declared here and never
 * read — accountId, plan, currentPeriodEnd, stripeSubscriptionId, isPaid,
 * premiumSource and billingOwnerRole. The last two were the same defect as the
 * four named below: no server route ever wrote them, so they could only ever be
 * `undefined`. Declaring a field the server does not send is how the escape
 * hatch came to be dead in the first place; the type states what arrives.
 */
interface BillingStatus {
  stripeStatus: string;
  effectiveAccess: boolean;
  needsPaymentUpdate: boolean;
  /**
   * Written by the guardian branch of `/api/billing/status` from §31.3's fold.
   * Replaces `linkRequiredForPremium`, `hasLinkedStudent`,
   * `requiresStudentSubscription` and `lockedReason`, none of which any server
   * route ever wrote — so every branch keyed on them was dead.
   */
  hasActiveLink?: boolean;
  isPaid?: boolean;
}

interface SubscriptionPaywallProps {
  children: React.ReactNode;
}

export function SubscriptionPaywall({ children }: SubscriptionPaywallProps) {
  const [pollingStartTime, setPollingStartTime] = useState<number | null>(null);

  const urlParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const checkoutSuccess = urlParams?.get("checkout") === "success";
  const POLLING_TIMEOUT_MS = 60000;
  const [shouldPoll, setShouldPoll] = useState(checkoutSuccess);

  const {
    data: billingStatus,
    isLoading: billingLoading,
    refetch,
  } = useQuery({
    queryKey: ["billing-status"],
    queryFn: async () => {
      const res = await csrfFetch("/api/billing/status", {
        credentials: "include",
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(
          res,
          "Failed to get billing status",
        );
      }
      return res.json() as Promise<BillingStatus>;
    },
    retry: 1,
    refetchInterval: shouldPoll ? 2000 : false,
  });

  useEffect(() => {
    if (billingStatus?.effectiveAccess && shouldPoll) {
      setShouldPoll(false);
    }
  }, [billingStatus?.effectiveAccess, shouldPoll]);

  useEffect(() => {
    if (checkoutSuccess && !pollingStartTime) {
      setPollingStartTime(Date.now());
    }
  }, [checkoutSuccess, pollingStartTime]);

  const isPollingTimeout =
    pollingStartTime && Date.now() - pollingStartTime > POLLING_TIMEOUT_MS;

  if (
    checkoutSuccess &&
    !billingStatus?.effectiveAccess &&
    billingStatus?.hasActiveLink &&
    !isPollingTimeout
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2E48]" />
          <p className="text-[#0F2E48] text-lg font-medium">
            Processing your payment...
          </p>
          <p className="text-[#0F2E48]/70 text-sm">
            This usually takes just a few seconds.
          </p>
        </div>
      </div>
    );
  }

  if (
    checkoutSuccess &&
    !billingStatus?.effectiveAccess &&
    billingStatus?.hasActiveLink &&
    isPollingTimeout
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-[#0F2E48]">
              Payment Processing
            </CardTitle>
            <CardDescription className="text-base">
              Your payment is taking longer than expected to process.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                If this persists, click "Manage Subscription" below to verify
                your payment status.
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => refetch()}
              variant="outline"
              className="w-full"
            >
              Check Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (billingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2E48]" />
          <p className="text-[#0F2E48]">Checking subscription status...</p>
        </div>
      </div>
    );
  }

  /**
   * A FAILED payment is the one state worth interrupting for, because the fix
   * is the portal and the portal only works when a subscription already exists.
   * Everything else — no link yet, links but nothing bought, fully paid — is a
   * dashboard state, because the dashboard is where both remedies live: the
   * link panel and the purchase card.
   */
  if (billingStatus?.needsPaymentUpdate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md border-amber-500/50">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-[#0F2E48]">
              Payment Update Required
            </CardTitle>
            <CardDescription className="text-base">
              Your linked student's subscription needs attention before guardian
              reporting can unlock again.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {billingStatus.stripeStatus === "past_due"
                  ? "The linked student subscription payment failed. Please update the payment method."
                  : "The linked student subscription has expired. Renew it to restore guardian visibility."}
              </AlertDescription>
            </Alert>
          </CardContent>

          <CardFooter>
            <ManageSubscriptionButton
              effectiveAccess={billingStatus.effectiveAccess}
              isPaid={billingStatus.isPaid}
              forcePortal
              label="Update Payment Method"
            />
          </CardFooter>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

type ManageSubscriptionButtonProps = {
  /** From `/api/billing/status`. Absent while the status is still loading. */
  readonly effectiveAccess?: boolean;
  readonly isPaid?: boolean;
  /**
   * The payment-update card owns its own decision: `needsPaymentUpdate` means a
   * subscription EXISTS and is failing, which is precisely what the portal
   * fixes, even though `effectiveAccess` is false while it fails.
   */
  readonly forcePortal?: boolean;
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
  forcePortal = false,
  label = "Manage Subscription",
}: ManageSubscriptionButtonProps = {}) {
  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch("/api/billing/portal", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(
          res,
          "Failed to open billing portal",
        );
      }
      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  if (!forcePortal && !(effectiveAccess === true && isPaid === true)) {
    return null;
  }

  return (
    <Button
      variant={forcePortal ? "default" : "outline"}
      size={forcePortal ? "lg" : "sm"}
      className={
        forcePortal
          ? "w-full bg-amber-600 hover:bg-amber-700 text-white"
          : undefined
      }
      data-testid="manage-subscription-button"
      onClick={() => portalMutation.mutate()}
      disabled={portalMutation.isPending}
    >
      {portalMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : forcePortal ? (
        <>
          <CreditCard className="mr-2 h-4 w-4" />
          {label}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
