/**
 * The guardian's return from Stripe Checkout: a processing state that polls.
 *
 * @spec [Doc-01_V8 §31.3 guardian access derives from a linked student's
 *        entitlement; §31.4; SCL-029 `past_due` is ENTITLED]
 * @implemented [2026-08-31, rescoped 2026-09-02, gate deleted 2026-09-03]
 *
 * plain English: while a guardian is coming back from Stripe it shows a
 * "processing your payment" state and polls until the webhook lands. Every
 * other time it renders its children. Expected outcome: nothing this component
 * knows can stop a guardian reaching their dashboard.
 *
 * IT WAS CALLED `SubscriptionPaywall` UNTIL 2026-09-03, and by then the name
 * was a lie: the gate it was named for had been deleted and all that remained
 * was the polling described above. A component whose name describes something
 * it stopped doing is how the next reader is misled — the same class of defect
 * as the "Parent Access Subscription" copy and the `linkRequiredForPremium`
 * branch, both of which read as true and were not. Owner ruling: rename it.
 *
 * THE GATE THAT USED TO BE HERE, AND WHY IT IS GONE (owner ruling 2026-09-03).
 * An early return on `needsPaymentUpdate` replaced the ENTIRE dashboard with a
 * "Payment Update Required" card — link panel, purchase card, progress and all.
 * `needsPaymentUpdate` is true for `past_due`, and SCL-029 rules a `past_due`
 * student ENTITLED, precisely so that "a student whose card is mid-retry does
 * not lose their tutor". So `GET /api/billing/status` reported
 * `effectiveAccess: true` and `needsPaymentUpdate: true` for one student at
 * once, this component tested the second and ignored the first, and a guardian
 * who by the platform's own predicate had full access was locked out of
 * everything — including the only surface where they could have fixed it. A
 * payment-health notice is a BANNER above the dashboard, never a screen in
 * front of it; `guardian-dashboard.tsx` renders one.
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { useBillingStatusQuery } from "@/hooks/useBillingStatusQuery";

interface CheckoutReturnPollerProps {
  children: React.ReactNode;
}

export function CheckoutReturnPoller({ children }: CheckoutReturnPollerProps) {
  const [pollingStartTime, setPollingStartTime] = useState<number | null>(null);

  const urlParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const checkoutSuccess = urlParams?.get("checkout") === "success";
  const POLLING_TIMEOUT_MS = 60000;
  const [shouldPoll, setShouldPoll] = useState(checkoutSuccess);

  // @spec [student-ui register UI-14] | @implemented [2026-09-29] | plain English: the shared
  // billing-status query (one key with the guardian dashboard and the premium prompt); only the
  // poll interval is this component's own, and only while it waits for the webhook.
  const {
    data: billingStatus,
    isLoading: billingLoading,
    refetch,
  } = useBillingStatusQuery({ refetchInterval: shouldPoll ? 2000 : false });

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

  return <>{children}</>;
}
