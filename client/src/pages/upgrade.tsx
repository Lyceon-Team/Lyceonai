/**
 * The plans page (`/upgrade`).
 *
 * @spec [DESIGN.md §4 "Not prototyped: the upgrade/plans page" (build to the shell spec; Karl
 *        gets screenshots before merge), §1 (tokens only, 14px floor, one filled action, no
 *        motion beyond the LISA dots), §2 App shell; student-UI register UI-58, OQ-49 (off the
 *        light lock once on tokens), UI-41 (the in-body back link was interim duplication of the
 *        shell's navigation; removed); wiring-table §13 (`GET /api/billing/plans`, checkout)]
 *        | @implemented [2026-10-03 restyle; billing behaviour unchanged]
 *
 * plain English: the same three plan cards from the same live prices, and the same server-made
 * Stripe checkout per plan; only the presentation moved onto the student tokens. The best-value
 * card's button is the page's one filled action (the others are outline), the spinner icons are
 * gone (no motion), and the "Back to Dashboard" link is removed (the rail is the way back). Every
 * word is the page's shipped copy.
 */
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import { Notice, PageHeader } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type BillingPlan,
  getBillingPlans,
  startSubscriptionCheckout,
} from "@/lib/billing-client";
import {
  bestValuePlan,
  deriveBillingPlanPricing,
  monthlyAmountFrom,
} from "../../../packages/shared/src/billing-pricing";
import { useToast } from "@/hooks/use-toast";

const planCardTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-plan-monthly",
  quarterly: "upgrade-plan-quarterly",
  yearly: "upgrade-plan-yearly",
};

const planPriceTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-price-monthly",
  quarterly: "upgrade-price-quarterly",
  yearly: "upgrade-price-yearly",
};

const planPriceUnavailableTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-price-unavailable-monthly",
  quarterly: "upgrade-price-unavailable-quarterly",
  yearly: "upgrade-price-unavailable-yearly",
};

const planEquivalentTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-equivalent-monthly",
  quarterly: "upgrade-equivalent-quarterly",
  yearly: "upgrade-equivalent-yearly",
};

const planSavingsTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-savings-monthly",
  quarterly: "upgrade-savings-quarterly",
  yearly: "upgrade-savings-yearly",
};

const planChooseTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-choose-monthly",
  quarterly: "upgrade-choose-quarterly",
  yearly: "upgrade-choose-yearly",
};

function formatPrice(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export default function UpgradePage() {
  const { toast } = useToast();

  const {
    data: remotePlans,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/billing/plans"],
    queryFn: getBillingPlans,
    retry: 1,
    // UI-14: live prices change when the owner reprices, not within a session.
    staleTime: QUERY_FRESHNESS.pricing.staleTime,
  });

  /**
   * What the API returned, and nothing else.
   *
   * WHAT WAS HERE. `fallbackPlans.map(...)` with `{...fallback, ...fromApi}`,
   * which had three defects at once: it rendered a card list even when the API
   * said nothing, it let a NULL `amountCents` from the API overwrite the
   * fallback and reach the formatter as `$NaN`, and — because the route has
   * never sent `equivalentMonthlyCents` or `savingsPercent` — its "fallback"
   * for those two was in fact their ONLY source. That is how the page printed
   * "$59.99" above "$99.99 / month equivalent".
   *
   * There is no fallback now. No plans, no cards; no price, no number.
   */
  const plans = remotePlans ?? [];

  /**
   * The basis for every percentage: the monthly plan's OWN live amount, from
   * this same response. A discount measured against a remembered monthly price
   * is the defect in miniature — it was "33.3% off" on a quarterly that is 17%
   * off what Stripe actually charges monthly.
   */
  const monthlyAmountCents = useMemo(() => monthlyAmountFrom(plans), [plans]);

  /**
   * "Best value" is a claim about the prices, so it is read FROM the prices. It
   * was `plan === "yearly"` — true today, guaranteed by nothing, and free to
   * contradict the live per-month figures printed directly beneath it.
   */
  const bestValue = useMemo(() => bestValuePlan(plans), [plans]);

  const checkoutMutation = useMutation({
    mutationFn: async (plan: BillingPlan) => startSubscriptionCheckout(plan),
    onError: (checkoutError) => {
      toast({
        title: "Unable to start checkout",
        description:
          checkoutError instanceof Error
            ? checkoutError.message
            : "Please try again in a moment.",
      });
    },
  });

  return (
    <div className="flex flex-col gap-8" data-testid="upgrade-page">
      <PageHeader
        eyebrow="Membership"
        title="Choose Your Lyceon Plan"
        description="One secure checkout flow for monthly, quarterly, and yearly subscriptions."
      />

      {error && (
        <Notice
          tone="warning"
          title="Plan pricing is temporarily unavailable."
          actionLabel="Retry"
          onAction={() => void refetch()}
        />
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {plans.map((plan) => {
          const isBestValue = bestValue === plan.plan;
          // DERIVED HERE, FROM THE LIVE AMOUNTS. Both figures are functions of
          // `amountCents` and the interval; neither is transmitted, so neither
          // can disagree with the price printed above it.
          const { equivalentMonthlyCents, savingsPercent } =
            deriveBillingPlanPricing(plan, monthlyAmountCents);
          const currency = plan.currency;
          const headlinePrice =
            plan.amountCents !== null && currency !== null
              ? formatPrice(plan.amountCents, currency)
              : null;
          const equivalentMonthly =
            equivalentMonthlyCents !== null && currency !== null
              ? formatPrice(equivalentMonthlyCents, currency)
              : null;
          const savingsText =
            savingsPercent !== null && savingsPercent > 0
              ? `${savingsPercent.toFixed(1)}% off`
              : null;

          return (
            <section
              key={plan.plan}
              aria-label={plan.label}
              className={cn(
                "flex flex-col gap-4 rounded-lg bg-lyc-sheet px-6 py-6",
                isBestValue
                  ? "border-2 border-lyc-ink-strong"
                  : "border border-lyc-rule",
              )}
              data-testid={planCardTestIds[plan.plan]}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 font-lyc-serif text-lyc-panel font-semibold tracking-normal text-lyc-ink-strong">
                  {plan.label}
                </h2>
                {isBestValue && (
                  <span className="rounded-full border border-lyc-ink-strong px-2.5 py-0.5 text-lyc-meta font-semibold text-lyc-ink-strong">
                    Best value
                  </span>
                )}
              </div>
              <p className="m-0 text-lyc-meta-lg text-lyc-muted">
                {plan.intervalLabel}
              </p>
              <div className="flex flex-col gap-1">
                {headlinePrice ? (
                  <p
                    className="m-0 font-lyc-serif text-[36px] font-semibold leading-tight text-lyc-ink-strong"
                    data-testid={planPriceTestIds[plan.plan]}
                  >
                    {headlinePrice}
                  </p>
                ) : (
                  // NO NUMBER RATHER THAN A REMEMBERED ONE. An unconfigured
                  // price id and a Stripe outage both land here.
                  <p
                    className="m-0 text-lyc-body text-lyc-muted"
                    data-testid={planPriceUnavailableTestIds[plan.plan]}
                  >
                    Price unavailable right now.
                  </p>
                )}
                {equivalentMonthly && (
                  <p
                    className="m-0 text-lyc-meta-lg text-lyc-muted"
                    data-testid={planEquivalentTestIds[plan.plan]}
                  >
                    {equivalentMonthly} / month equivalent
                  </p>
                )}
              </div>
              {savingsText && (
                <span
                  className="self-start rounded-full bg-lyc-chip px-2.5 py-1 text-lyc-meta font-semibold text-lyc-ink"
                  data-testid={planSavingsTestIds[plan.plan]}
                >
                  {savingsText}
                </span>
              )}
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-lyc-meta-lg text-lyc-ink">
                <li className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-lyc-ink-strong"
                    aria-hidden="true"
                  />
                  Full KPI + mastery + projection access
                </li>
                <li className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0 text-lyc-ink-strong"
                    aria-hidden="true"
                  />
                  Premium tutor and full-test analytics
                </li>
              </ul>
              <Button
                type="button"
                variant={isBestValue ? "lyc-primary" : "lyc-outline"}
                className="mt-auto w-full"
                onClick={() => checkoutMutation.mutate(plan.plan)}
                disabled={checkoutMutation.isPending}
                data-testid={planChooseTestIds[plan.plan]}
              >
                {checkoutMutation.isPending ? "Redirecting..." : "Choose plan"}
              </Button>
            </section>
          );
        })}
      </div>

      {isLoading && (
        <p className="m-0 text-lyc-body text-lyc-muted">
          Loading plan metadata...
        </p>
      )}
    </div>
  );
}
