import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openBillingPortal, startSubscriptionCheckout } from './billing-client';

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
});
