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
  type BillingPlanMetadata,
  getBillingPlans,
  startSubscriptionCheckout,
} from "@/lib/billing-client";
import { useToast } from "@/hooks/use-toast";

const fallbackPlans: BillingPlanMetadata[] = [
  {
    plan: "monthly",
    label: "Monthly",
    amountCents: 9999,
    currency: "usd",
    intervalLabel: "per month",
    equivalentMonthlyCents: 9999,
    savingsPercent: 0,
    stripePriceIdConfigured: false,
  },
  {
    plan: "quarterly",
    label: "Quarterly",
    amountCents: 19999,
    currency: "usd",
    intervalLabel: "per 3 months",
    equivalentMonthlyCents: 6666,
    savingsPercent: 33.3,
    stripePriceIdConfigured: false,
  },
  {
    plan: "yearly",
    label: "Yearly",
    amountCents: 69999,
    currency: "usd",
    intervalLabel: "per year",
    equivalentMonthlyCents: 5833,
    savingsPercent: 41.7,
    stripePriceIdConfigured: false,
  },
];

const planCardTestIds: Record<BillingPlan, string> = {
  monthly: "upgrade-plan-monthly",
  quarterly: "upgrade-plan-quarterly",
  yearly: "upgrade-plan-yearly",
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

  const plans = useMemo(() => {
    const remoteByPlan = new Map((remotePlans ?? []).map((plan) => [plan.plan, plan]));
    return fallbackPlans.map((fallback) => {
      const fromApi = remoteByPlan.get(fallback.plan);
      if (!fromApi) return fallback;
      return {
        ...fallback,
        ...fromApi,
        equivalentMonthlyCents: fromApi.equivalentMonthlyCents ?? fallback.equivalentMonthlyCents,
        savingsPercent: fromApi.savingsPercent ?? fallback.savingsPercent,
      };
    });
  }, [remotePlans]);

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
              <span>Plan metadata is temporarily unavailable. Fallback pricing is shown.</span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isBestValue = plan.plan === "yearly";
            const equivalentMonthly = typeof plan.equivalentMonthlyCents === "number"
              ? formatPrice(plan.equivalentMonthlyCents, plan.currency)
              : null;
            const savingsText = typeof plan.savingsPercent === "number"
              ? `${plan.savingsPercent.toFixed(1)}% off`
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
                    <p className="text-4xl font-semibold tracking-tight">
                      {formatPrice(plan.amountCents, plan.currency)}
                    </p>
                    {equivalentMonthly && (
                      <p className="text-sm text-muted-foreground">{equivalentMonthly} / month equivalent</p>
                    )}
                  </div>
                  {savingsText && plan.plan !== "monthly" && (
                    <div className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
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
