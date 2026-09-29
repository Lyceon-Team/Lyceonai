import { useMemo } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
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
    <AppShell showFooter>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        <div className="mb-8">
          <Button asChild variant="ghost" className="mb-4">
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">Membership</p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-2">
            Choose Your Lyceon Plan
          </h1>
          <p className="text-muted-foreground">
            One secure checkout flow for monthly, quarterly, and yearly subscriptions.
          </p>
        </div>

        {error && (
          <Alert className="mb-6">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>Plan pricing is temporarily unavailable.</span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <Card
                key={plan.plan}
                className={isBestValue ? "border-primary shadow-sm" : "border-border/60"}
                data-testid={planCardTestIds[plan.plan]}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{plan.label}</CardTitle>
                    {isBestValue && (
                      <Badge className="bg-primary text-primary-foreground">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Best value
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{plan.intervalLabel}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    {headlinePrice ? (
                      <p
                        className="text-4xl font-semibold tracking-tight"
                        data-testid={planPriceTestIds[plan.plan]}
                      >
                        {headlinePrice}
                      </p>
                    ) : (
                      // NO NUMBER RATHER THAN A REMEMBERED ONE. An unconfigured
                      // price id and a Stripe outage both land here.
                      <p
                        className="text-sm text-muted-foreground"
                        data-testid={planPriceUnavailableTestIds[plan.plan]}
                      >
                        Price unavailable right now.
                      </p>
                    )}
                    {equivalentMonthly && (
                      <p
                        className="text-sm text-muted-foreground"
                        data-testid={planEquivalentTestIds[plan.plan]}
                      >
                        {equivalentMonthly} / month equivalent
                      </p>
                    )}
                  </div>
                  {savingsText && (
                    <div
                      className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
                      data-testid={planSavingsTestIds[plan.plan]}
                    >
                      {savingsText}
                    </div>
                  )}
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Full KPI + mastery + projection access
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Premium tutor and full-test analytics
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    onClick={() => checkoutMutation.mutate(plan.plan)}
                    disabled={checkoutMutation.isPending}
                    data-testid={planChooseTestIds[plan.plan]}
                  >
                    {checkoutMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      "Choose plan"
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {isLoading && (
          <div className="mt-6 flex items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Loading plan metadata...
          </div>
        )}
      </div>
    </AppShell>
  );
}
