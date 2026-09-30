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
import { useBillingStatus } from "@/hooks/useBillingStatus";

/**
 * How long the processing state polls before it gives up and says so.
 *
 * G4-09 (G-AUD-26): THE TIMEOUT NOW STOPS THE POLLING. `refetchInterval` used to be cleared
 * only when `effectiveAccess` came back true, so after the "taking longer than expected" card
 * appeared the query kept hitting `/api/billing/status` every two seconds for as long as the
 * tab stayed open — and the card itself appeared only because those refetches happened to
 * re-render. A timer now ends the polling at the timeout; "Check again" is a single read.
 */
export const POLLING_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

interface CheckoutReturnPollerProps {
  children: React.ReactNode;
}

export function CheckoutReturnPoller({ children }: CheckoutReturnPollerProps) {
  const urlParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const checkoutSuccess = urlParams?.get("checkout") === "success";
  const [timedOut, setTimedOut] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const shouldPoll = checkoutSuccess && !timedOut && !confirmed;

  const {
    data: billingStatus,
    isLoading: billingLoading,
    refetch,
  } = useBillingStatus({
    refetchInterval: shouldPoll ? POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (billingStatus?.effectiveAccess) setConfirmed(true);
  }, [billingStatus?.effectiveAccess]);

  useEffect(() => {
    if (!checkoutSuccess) return;
    const timer = setTimeout(() => setTimedOut(true), POLLING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [checkoutSuccess]);

  const isPollingTimeout = timedOut;

  if (
    checkoutSuccess &&
    !billingStatus?.effectiveAccess &&
    billingStatus?.hasActiveLink &&
    !isPollingTimeout
  ) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-brand-cream"
        data-testid="checkout-processing"
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
          <p className="text-brand-navy text-lg font-medium">
            Processing your payment...
          </p>
          <p className="text-brand-navy/70 text-base">
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
      <div
        className="min-h-screen flex items-center justify-center bg-brand-cream p-4"
        data-testid="checkout-timeout"
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-brand-navy">
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
                Stripe has your payment; we are waiting for it to confirm. Check
                again in a minute, or refresh this page later.
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => void refetch()}
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
      <div className="min-h-screen flex items-center justify-center bg-brand-cream">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-brand-navy" />
          <p className="text-brand-navy">Checking subscription status...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
