import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBillingPlans, openBillingPortal, startSubscriptionCheckout } from './billing-client';

const csrfFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csrf', () => ({
  csrfFetch: (...args: any[]) => csrfFetchMock(...args),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('billing-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls checkout endpoint and returns the Stripe URL', async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ url: 'https://stripe.example/checkout' }, 200));

    const url = await startSubscriptionCheckout('monthly');

    expect(csrfFetchMock).toHaveBeenCalledWith('/api/billing/checkout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(url).toBe('https://stripe.example/checkout');
  });

  it('throws a safe error when checkout fails', async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Failed to create checkout session' }, 400));

    await expect(startSubscriptionCheckout('monthly')).rejects.toThrow('Failed to create checkout session');
  });

  it('calls billing portal endpoint and returns portal URL', async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ url: 'https://stripe.example/portal' }, 200));

    const url = await openBillingPortal();

    expect(csrfFetchMock).toHaveBeenCalledWith('/api/billing/portal', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(url).toBe('https://stripe.example/portal');
  });

  it('loads canonical billing plan metadata', async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({
      plans: [
        { plan: 'monthly', amountCents: 9999, currency: 'usd', intervalLabel: 'per month', label: 'Monthly', stripePriceIdConfigured: true },
        { plan: 'quarterly', amountCents: 19999, currency: 'usd', intervalLabel: 'per 3 months', label: 'Quarterly', stripePriceIdConfigured: true },
        { plan: 'yearly', amountCents: 69999, currency: 'usd', intervalLabel: 'per year', label: 'Yearly', stripePriceIdConfigured: true },
      ],
    }, 200));

    const plans = await getBillingPlans();

    expect(csrfFetchMock).toHaveBeenCalledWith('/api/billing/plans', expect.objectContaining({
      credentials: 'include',
    }));
    expect(plans).toHaveLength(3);
    expect(plans.map((plan) => plan.plan)).toEqual(['monthly', 'quarterly', 'yearly']);
  });
});
