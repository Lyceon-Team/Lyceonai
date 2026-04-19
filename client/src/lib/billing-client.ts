import { csrfFetch } from '@/lib/csrf';
import { parseApiErrorFromResponse } from '@/lib/api-error';

export type BillingPlan = 'monthly' | 'quarterly' | 'yearly';

export interface BillingPlanMetadata {
  plan: BillingPlan;
  label: string;
  amountCents: number;
  currency: string;
  intervalLabel: string;
  equivalentMonthlyCents?: number;
  savingsPercent?: number;
  stripePriceIdConfigured: boolean;
}

type BillingRedirectPayload = {
  url?: string;
  error?: string;
  requestId?: string;
};

async function requestBillingRedirect(
  endpoint: '/api/billing/checkout' | '/api/billing/portal',
  body?: unknown,
): Promise<string> {
  const response = await csrfFetch(endpoint, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload: BillingRedirectPayload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, payload.error || 'Unable to start billing flow');
  }

  if (!payload.url || typeof payload.url !== 'string') {
    throw new Error('Billing response did not include a redirect URL');
  }

  if (typeof window !== 'undefined') {
    window.location.assign(payload.url);
  }

  return payload.url;
}

export async function getBillingPlans(): Promise<BillingPlanMetadata[]> {
  const response = await csrfFetch('/api/billing/plans', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await parseApiErrorFromResponse(response, 'Unable to load billing plans');
  }

  const payload = await response.json().catch(() => ({} as { plans?: BillingPlanMetadata[] }));
  const plans = Array.isArray(payload?.plans) ? payload.plans : [];
  return plans;
}

export async function startSubscriptionCheckout(plan: BillingPlan): Promise<string> {
  return requestBillingRedirect('/api/billing/checkout', { plan });
}

export async function openBillingPortal(): Promise<string> {
  return requestBillingRedirect('/api/billing/portal');
}
