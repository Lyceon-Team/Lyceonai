import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, CheckCircle, Loader2, CreditCard, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { csrfFetch } from '@/lib/csrf';
import { parseApiErrorFromResponse, isApiError, isSessionError, toUserFacingMessage } from '@/lib/api-error';
import { AppNotice } from '@/components/feedback/AppNotice';
import { RecoveryNotice } from '@/components/feedback/RecoveryNotice';
import { SessionNotice } from '@/components/feedback/SessionNotice';
import {
  getBillingPlans,
  startSubscriptionCheckout,
  type BillingPlan,
  type BillingPlanMetadata,
} from '@/lib/billing-client';

interface BillingStatus {
  accountId: string | null;
  plan: string;
  stripeStatus: string;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
  effectiveAccess: boolean;
  needsPaymentUpdate: boolean;
  requiresStudentSubscription?: boolean;
  isPaid: boolean;
  premiumSource?: 'student' | 'guardian' | 'both' | 'none';
  hasLinkedStudent?: boolean;
  linkRequiredForPremium?: boolean;
  billingOwnerRole?: 'student' | 'guardian';
  lockedReason?: 'link_required' | 'student_subscription_required' | 'student_subscription_expired' | 'student_payment_past_due' | null;
}

interface SubscriptionPaywallProps {
  children: React.ReactNode;
}

function formatPrice(amountCents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
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
      const res = await csrfFetch('/api/billing/status', { credentials: 'include' });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, 'Failed to get billing status');
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

  const { data: pricesData, isLoading: pricesLoading, error: pricesError, refetch: refetchPrices } = useQuery<BillingPlanMetadata[]>({
    queryKey: ['/api/billing/plans'],
    queryFn: getBillingPlans,
    enabled: !billingStatus?.effectiveAccess,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: BillingPlan) => {
      await startSubscriptionCheckout(plan);
      return { url: true };
    },
    onSuccess: () => {},
    onError: (err: unknown) => {
      const fallbackMessage = err instanceof Error ? err.message : 'Could not start checkout. Please try again.';
      const details = isApiError(err) ? err.details : (err as any)?.details;
      const detailsRecord = details && typeof details === 'object' ? (details as Record<string, unknown>) : null;
      setCheckoutError(fallbackMessage);
      setCheckoutErrorDetails({
        stripeMessage:
          typeof (err as any)?.stripeMessage === 'string'
            ? (err as any).stripeMessage
            : detailsRecord && typeof detailsRecord.stripeMessage === 'string'
              ? detailsRecord.stripeMessage
              : undefined,
        requestId:
          typeof (err as any)?.requestId === 'string'
            ? (err as any).requestId
            : detailsRecord && typeof detailsRecord.requestId === 'string'
              ? detailsRecord.requestId
              : undefined,
        details: detailsRecord,
      });
      console.error('[Billing] Checkout error:', {
        message: fallbackMessage,
        stripeMessage: detailsRecord?.stripeMessage ?? (err as any)?.stripeMessage,
        requestId: detailsRecord?.requestId ?? (err as any)?.requestId,
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, 'Failed to open billing portal');
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
              Your linked student's subscription needs attention before guardian reporting can unlock again.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {billingStatus.stripeStatus === 'past_due' 
                  ? 'The linked student subscription payment failed. Please update the payment method.'
                  : 'The linked student subscription has expired. Renew it to restore guardian visibility.'}
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
  const requiresStudentSubscription = !!billingStatus?.requiresStudentSubscription;

  if (pricesError) {
    const pricesErrorMessage = pricesError instanceof Error
      ? pricesError.message
      : toUserFacingMessage(pricesError).message;
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAEF] p-4">
        <Card className="w-full max-w-md border-[#0F2E48]/20">
          <CardContent className="pt-6">
            <RecoveryNotice
              title="Pricing is temporarily unavailable."
              message={pricesErrorMessage}
              onRetry={() => void refetchPrices()}
            />
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
          <CardTitle className="text-2xl text-[#0F2E48]">
            {requiresStudentSubscription ? 'Student Subscription Required' : 'Parent Access Subscription'}
          </CardTitle>
          <CardDescription className="text-base">
            {requiresStudentSubscription
              ? "Guardian reporting unlocks only when your linked student's subscription is active."
              : "Subscribe to monitor your child's SAT preparation progress"}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {requiresStudentSubscription && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                Billing is tied to the linked student account. Start or renew the student subscription to unlock guardian visibility.
              </AlertDescription>
            </Alert>
          )}

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

          {/* TODO(billing): Guardian selector is legacy and should be removed only after /upgrade parity tests pass. */}
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
                {prices.map((price) => {
                  const savingsBadge = typeof price.savingsPercent === "number" && price.savingsPercent > 0
                    ? `Save ${price.savingsPercent.toFixed(1)}%`
                    : null;

                  return (
                    <button
                      key={price.plan}
                      onClick={() => {
                        setSelectedPlan(price.plan);
                      }}
                      className={cn(
                        "relative p-4 rounded-lg border-2 text-left transition-all",
                        selectedPlan === price.plan
                          ? "border-[#0F2E48] bg-[#0F2E48]/5"
                          : "border-[#0F2E48]/20 hover:border-[#0F2E48]/40"
                      )}
                    >
                      {savingsBadge && (
                        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-green-600 text-white text-xs font-medium rounded-full whitespace-nowrap">
                          {savingsBadge}
                        </span>
                      )}
                      <div className="text-lg font-semibold text-[#0F2E48]">{price.label}</div>
                      <div className="text-2xl font-bold text-[#0F2E48] mt-1">
                        {formatPrice(price.amountCents, price.currency)}
                      </div>
                      <div className="text-sm text-[#0F2E48]/60">
                        {price.intervalLabel}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}

          {checkoutError && (
            <AppNotice
              variant="warning"
              title="Could not start checkout."
              message={checkoutError}
              mode="inline"
            />
          )}

          {SHOW_BILLING_DEBUG && checkoutErrorDetails && (
            <div className="rounded-lg border border-border/70 bg-card/70 p-3 text-xs font-mono space-y-1">
              <div>Error: {checkoutError}</div>
              {checkoutErrorDetails?.stripeMessage && <div>Stripe: {checkoutErrorDetails.stripeMessage}</div>}
              {checkoutErrorDetails?.requestId && <div>Request ID: {checkoutErrorDetails.requestId}</div>}
            </div>
          )}

          {billingError && (
            isSessionError(billingError) ? (
              <SessionNotice
                message={billingError instanceof Error ? billingError.message : toUserFacingMessage(billingError).message}
                onRefreshSession={() => window.location.reload()}
              />
            ) : (
              <RecoveryNotice
                message={billingError instanceof Error ? billingError.message : toUserFacingMessage(billingError).message}
                onRetry={() => void refetch()}
              />
            )
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
                {requiresStudentSubscription ? 'Start Student Subscription' : 'Subscribe Now'}
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
      const res = await csrfFetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw await parseApiErrorFromResponse(res, 'Failed to open billing portal');
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

