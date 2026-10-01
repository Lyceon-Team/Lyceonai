/**
 * The payment-health banner, above every guardian page.
 *
 * @spec [owner decision 2026-10-01 on PR 1003 ("Move the payment-problem banner into
 *       GuardianShell, using the G4-09 billing hook"); owner ruling 2026-09-03 (a payment
 *       problem is a BANNER, never a gate); SCL-029 (`past_due` is entitled); Doc-01_V8 §31.4
 *       (the Stripe portal is where a payment method is updated); Guardian_Closure_Plan G4-09]
 *   | @implemented [2026-10-01]
 *
 * plain English: when `GET /api/billing/status` says `needsPaymentUpdate` (a renewal failed
 * and Stripe is retrying), every guardian page carries a notice ABOVE it — never instead of
 * it: the student keeps their access while the payment retries (SCL-029), so nothing the
 * guardian can see is taken away. "Update payment method" opens the billing portal through
 * the shared portal hook (its one error surface); "Dismiss" hides the notice until the next
 * page, because a parent already dealing with it should not be told twice on every click.
 *
 * Moved from the retired single-page dashboard (`pages/guardian-dashboard.tsx`), where it
 * showed on that one page only. It reads the ONE billing-status reader (`useBillingStatus`,
 * G4-09), so the shell adds no request a guardian page does not already share by query key.
 *
 * edge cases: while loading, on a failed read, or when nothing needs updating — nothing is
 * drawn (a decoration fails closed to absent, never to a false alarm). The portal button is
 * shown only when this guardian HAS a billing account; a guardian whose student pays has no
 * Stripe customer, and the portal would refuse them (`409 NO_STRIPE_CUSTOMER`).
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBillingPortal } from "@/hooks/useBillingPortal";
import { useBillingStatus } from "@/hooks/useBillingStatus";

export function GuardianPaymentBanner({
  enabled,
}: {
  enabled: boolean;
}): JSX.Element | null {
  const status = useBillingStatus({ enabled });
  const portal = useBillingPortal();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || status.data?.needsPaymentUpdate !== true) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 text-amber-800"
      data-testid="guardian-payment-health-banner"
    >
      <div className="container mx-auto flex flex-col items-center gap-3 px-4 py-3 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left lg:px-8">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-1 hidden h-5 w-5 shrink-0 sm:block"
            aria-hidden="true"
          />
          <p className="m-0 text-base">
            <span className="font-semibold">
              A subscription payment needs attention.
            </span>{" "}
            Your student keeps their access while the payment retries. Updating
            the card now avoids losing it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.data.hasBillingAccount ? (
            <Button
              className="min-h-[44px] text-base"
              onClick={() => portal.open()}
              disabled={portal.isPending}
            >
              {portal.isPending ? "Opening billing…" : "Update payment method"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="min-h-[44px] text-base"
            onClick={() => setDismissed(true)}
            data-testid="dismiss-payment-health-banner"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
