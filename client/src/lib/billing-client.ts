import { csrfFetch } from '@/lib/csrf';

export type BillingPlan = 'monthly' | 'quarterly' | 'yearly';

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
    throw new Error(payload.error || 'Unable to start billing flow');
  }

  if (!payload.url || typeof payload.url !== 'string') {
    throw new Error('Billing response did not include a redirect URL');
  }

  if (typeof window !== 'undefined') {
    window.location.assign(payload.url);
  }

  return payload.url;
}

export async function startSubscriptionCheckout(plan: BillingPlan = 'monthly'): Promise<string> {
  return requestBillingRedirect('/api/billing/checkout', { plan });
}

export async function openBillingPortal(): Promise<string> {
  return requestBillingRedirect('/api/billing/portal');
}
