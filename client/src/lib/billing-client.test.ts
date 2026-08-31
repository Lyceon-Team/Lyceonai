import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBillingPlans, openBillingPortal, startSubscriptionCheckout } from './billing-client';

const csrfFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csrf', () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const assignMock = vi.fn();

function bodyOf(call: unknown[]): unknown {
  const init = call[1] as { body?: string } | undefined;
  return init?.body ? JSON.parse(init.body) : undefined;
}

describe('billing-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // This suite runs in the node environment, where `window` is undefined and
    // the helper's `typeof window !== 'undefined'` guard would skip the redirect
    // silently. Stubbing a window makes the redirect half of each outcome
    // observable, so "did not navigate" is an assertion rather than an accident.
    vi.stubGlobal('window', { location: { assign: assignMock } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls checkout endpoint, returns the session outcome, and redirects to Stripe', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          kind: 'checkout_session',
          url: 'https://stripe.example/checkout',
          sessionId: 'cs_test_1',
          requestId: 'req-1',
        },
        200,
      ),
    );

    const outcome = await startSubscriptionCheckout('monthly');

    expect(csrfFetchMock).toHaveBeenCalledWith('/api/billing/checkout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    // The contract, not an incidental string: `requestId` is stripped.
    expect(outcome).toEqual({
      kind: 'checkout_session',
      url: 'https://stripe.example/checkout',
      sessionId: 'cs_test_1',
    });
    expect(assignMock).toHaveBeenCalledWith('https://stripe.example/checkout');
  });

  /**
   * ROW 20 REGRESSION. The guardian add-item branch returns no `url`. The
   * previous client read `payload.url` unconditionally and threw "Billing
   * response did not include a redirect URL" here — reporting failure for a
   * purchase that had already charged the card.
   */
  it('accepts the add-item outcome without a url, and does NOT redirect', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse(
        { kind: 'item_added', subscriptionItemId: 'si_second_child', requestId: 'req-2' },
        200,
      ),
    );

    const outcome = await startSubscriptionCheckout('monthly', {
      studentProfileId: '22222222-2222-4222-8222-222222222222',
    });

    expect(outcome).toEqual({ kind: 'item_added', subscriptionItemId: 'si_second_child' });
    // The state half: a completed server-side purchase must not navigate away.
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("sends the guardian's selected student as student_profile_id", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ kind: 'item_added', subscriptionItemId: 'si_1' }, 200),
    );

    await startSubscriptionCheckout('yearly', {
      studentProfileId: '33333333-3333-4333-8333-333333333333',
    });

    expect(bodyOf(csrfFetchMock.mock.calls[0])).toEqual({
      plan: 'yearly',
      student_profile_id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('omits student_profile_id entirely when no student is selected', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({ kind: 'checkout_session', url: 'https://stripe.example/c', sessionId: 'cs_1' }, 200),
    );

    await startSubscriptionCheckout('monthly');

    expect(bodyOf(csrfFetchMock.mock.calls[0])).toEqual({ plan: 'monthly' });
  });

  it('refuses a checkout response that matches neither branch of the contract', async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ url: 'https://stripe.example/checkout' }, 200));

    await expect(startSubscriptionCheckout('monthly')).rejects.toThrow(
      'Billing response did not match the checkout contract',
    );
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('surfaces the server message for a guardian refusal rather than a generic one', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            message: 'This student is already covered by your subscription.',
            code: 'STUDENT_ALREADY_FUNDED',
          },
        },
        409,
      ),
    );

    await expect(
      startSubscriptionCheckout('monthly', { studentProfileId: '44444444-4444-4444-8444-444444444444' }),
    ).rejects.toThrow('This student is already covered by your subscription.');
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
    expect(assignMock).toHaveBeenCalledWith('https://stripe.example/portal');
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
