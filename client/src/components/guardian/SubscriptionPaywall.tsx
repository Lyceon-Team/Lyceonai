import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, CheckCircle, Loader2, CreditCard, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BillingStatus {
  accountId: string | null;
  plan: string;
  stripeStatus: string;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  effectiveAccess: boolean;
  needsPaymentUpdate: boolean;
  isPaid: boolean;
  premiumSource?: 'student' | 'guardian' | 'both' | 'none';
  hasLinkedStudent?: boolean;
  linkRequiredForPremium?: boolean;
  billingOwnerRole?: 'student' | 'guardian';
}

interface PriceOption {
  id: string;
  label: string;
  amount: number;
  interval: string;
  intervalCount: number;
  badge?: string;
  plan?: 'monthly' | 'quarterly' | 'yearly';
}

interface SubscriptionPaywallProps {
  children: React.ReactNode;
}

function formatPrice(amount: number): string {
  return `$${(amount / 100).toFixed(0)}`;
}

function formatInterval(interval: string, intervalCount: number): string {
  if (intervalCount === 1) {
    return `per ${interval}`;
  }
  if (interval === 'month' && intervalCount === 3) {
    return 'every 3 months';
  }
  return `every ${intervalCount} ${interval}s`;
}

const SHOW_BILLING_DEBUG = import.meta.env.DEV || (typeof window !== 'undefined' && window.location.search.includes('billingDebug=1'));

export function SubscriptionPaywall({ children }: SubscriptionPaywallProps) {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutErrorDetails, setCheckoutErrorDetails] = useState<{ stripeMessage?: string; requestId?: string; details?: any } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'quarterly' | 'yearly' | null>(null);
  const [pollingStartTime, setPollingStartTime] = useState<number | null>(null);

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const checkoutSuccess = urlParams?.get('checkout') === 'success';
  const POLLING_TIMEOUT_MS = 60000;
  const [shouldPoll, setShouldPoll] = useState(checkoutSuccess);

  const { data: billingStatus, isLoading: billingLoading, error: billingError, refetch } = useQuery({
    queryKey: ['billing-status'],
    queryFn: async () => {
      const res = await fetch('/api/billing/status', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to get billing status');
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

  const isPollingTimeout = pollingStartTime && (Date.now() - pollingStartTime) > POLLING_TIMEOUT_MS;

  if (checkoutSuccess && !billingStatus?.effectiveAccess && !billingStatus?.linkRequiredForPremium && !isPollingTimeout) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#0F2E48]" />
          <p className="text-[#0F2E48] text-lg font-medium">Processing your payment...</p>
          <p className="text-[#0F2E48]/70 text-sm">This usually takes just a few seconds.</p>
        </div>
      </div>
    );
  }

  if (checkoutSuccess && !billingStatus?.effectiveAccess && !billingStatus?.linkRequiredForPremium && isPollingTimeout) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-[#0F2E48]">Payment Processing</CardTitle>
            <CardDescription className="text-base">
              Your payment is taking longer than expected to process.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                If this persists, click "Manage Subscription" below to verify your payment status.
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

  const { data: pricesData, isLoading: pricesLoading, error: pricesError } = useQuery<PriceOption[]>({
    queryKey: ['billing-prices'],
    queryFn: async () => {
      const res = await fetch('/api/billing/prices', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch prices');
      const data = await res.json();
      
      let pricesArray: PriceOption[] = [];
      if (Array.isArray(data.prices)) {
        pricesArray = data.prices;
      } else if (data.prices && typeof data.prices === 'object') {
        console.error('[Billing] prices payload unexpected shape - converting object to array', data.prices);
        pricesArray = Object.values(data.prices);
      }
      
      return pricesArray;
    },
    enabled: !billingStatus?.effectiveAccess,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: 'monthly' | 'quarterly' | 'yearly') => {
      console.log('[Billing] Starting checkout with plan:', plan);
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan }),
      });
      console.log('[Billing] Checkout response status:', res.status);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || 'Failed to create checkout') as Error & { details?: any };
        (err as any).stripeMessage = data.stripeMessage;
        (err as any).requestId = data.requestId;
        (err as any).details = data.details;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error & { stripeMessage?: string; requestId?: string; details?: any }) => {
      setCheckoutError(err.message);
      setCheckoutErrorDetails({
        stripeMessage: err.stripeMessage,
        requestId: err.requestId,
        details: err.details,
      });
      console.error('[Billing] Checkout error:', { message: err.message, stripeMessage: err.stripeMessage, requestId: err.requestId, details: err.details });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      return data;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

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

  if (billingStatus?.linkRequiredForPremium) {
    return <>{children}</>;
  }

  if (billingStatus?.effectiveAccess) {
    return <>{children}</>;
  }

  if (billingStatus?.needsPaymentUpdate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md border-amber-500/50">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl text-[#0F2E48]">Payment Update Required</CardTitle>
            <CardDescription className="text-base">
              Your subscription payment needs attention to continue accessing parent features.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {billingStatus.stripeStatus === 'past_due' 
                  ? 'Your recent payment failed. Please update your payment method.'
                  : 'Your subscription period has ended. Please renew to continue.'}
              </AlertDescription>
            </Alert>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              size="lg"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
            >
              {portalMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening billing portal...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Update Payment Method
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const prices = Array.isArray(pricesData) ? pricesData : [];

  if (pricesError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md border-red-200">
          <CardContent className="pt-6">
            <div className="p-4 border border-red-200 bg-red-50 rounded-lg text-sm">
              <div className="font-semibold text-red-800">Pricing is temporarily unavailable.</div>
              <div className="mt-1 opacity-80 text-red-700">Please refresh the page or try again in a minute.</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
      <Card className="w-full max-w-2xl border-[#0F2E48]/20">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-[#0F2E48]/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-[#0F2E48]" />
          </div>
          <CardTitle className="text-2xl text-[#0F2E48]">Parent Access Subscription</CardTitle>
          <CardDescription className="text-base">
            Subscribe to monitor your child's SAT preparation progress
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-[#0F2E48]">Weekly progress summaries and accuracy reports</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-[#0F2E48]">Track study time and session activity</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-[#0F2E48]">Identify weak areas that need attention</span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <span className="text-[#0F2E48]">View your child's study calendar</span>
            </div>
          </div>

          {pricesLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-[#0F2E48]" />
            </div>
          ) : prices.length === 0 ? (
            <Alert>
              <AlertDescription>
                Subscription plans are currently unavailable. Please try again later.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {prices.map((price) => (
                <button
                  key={price.id}
                  onClick={() => {
                    if (price.plan) {
                      console.log('[Billing] Selected plan:', price.plan, 'priceId:', price.id?.slice(0, 12) + '...' + price.id?.slice(-4));
                      setSelectedPlan(price.plan);
                    }
                  }}
                  className={cn(
                    "relative p-4 rounded-lg border-2 text-left transition-all",
                    selectedPlan === price.plan
                      ? "border-[#0F2E48] bg-[#0F2E48]/5"
                      : "border-[#0F2E48]/20 hover:border-[#0F2E48]/40"
                  )}
                >
                  {price.badge && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-green-600 text-white text-xs font-medium rounded-full whitespace-nowrap">
                      {price.badge}
                    </span>
                  )}
                  <div className="text-lg font-semibold text-[#0F2E48]">{price.label}</div>
                  <div className="text-2xl font-bold text-[#0F2E48] mt-1">
                    {formatPrice(price.amount)}
                  </div>
                  <div className="text-sm text-[#0F2E48]/60">
                    {formatInterval(price.interval, price.intervalCount)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {checkoutError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium">Could not start checkout. Please try again.</div>
                {SHOW_BILLING_DEBUG && (
                  <div className="mt-2 text-xs font-mono opacity-80 space-y-1">
                    <div>Error: {checkoutError}</div>
                    {checkoutErrorDetails?.stripeMessage && <div>Stripe: {checkoutErrorDetails.stripeMessage}</div>}
                    {checkoutErrorDetails?.requestId && <div>Request ID: {checkoutErrorDetails.requestId}</div>}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {billingError && (
            <Alert>
              <AlertDescription>
                Unable to load billing information. Please try again later.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button
            className="w-full bg-[#0F2E48] hover:bg-[#0F2E48]/90 text-white"
            size="lg"
            onClick={() => {
              setCheckoutError(null);
              setCheckoutErrorDetails(null);
              if (!selectedPlan) {
                setCheckoutError('Please select a subscription plan.');
                return;
              }
              checkoutMutation.mutate(selectedPlan);
            }}
            disabled={checkoutMutation.isPending || pricesLoading || !selectedPlan}
          >
            {checkoutMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting to checkout...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Subscribe Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          
          <p className="text-xs text-center text-[#0F2E48]/60">
            Secure payment powered by Stripe. Cancel anytime.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

export function ManageSubscriptionButton() {
  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      return data;
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => portalMutation.mutate()}
      disabled={portalMutation.isPending}
    >
      {portalMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        'Manage Subscription'
      )}
    </Button>
  );
}

