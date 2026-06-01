import { afterEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import * as accountLib from '../lib/account';

function buildChain(result: { data: any; error: any }) {
  const chain: any = {
    eq: () => chain,
    select: () => chain,
    single: async () => result,
  };
  return chain;
}

describe('Guardian payment access', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        fromMock.mockReset();
    });

    it('guardian payment does not grant guardian-owned access when student is not entitled', async () => {
        fromMock.mockImplementation((table: string) => {
            if (table === 'account_members') {
                return {
                    select: () =>
                        buildChain({
                            data: { account_id: 'guardian_account' },
                            error: null,
                        }),
                };
            }

            if (table === 'guardian_links') {
                return {
                    select: () =>
                        buildChain({
                            data: {
                                account_id: 'student_account',
                                student_user_id: 'student_123',
                            },
                            error: null,
                        }),
                };
            }

            if (table === 'entitlements') {
                return {
                    select: () => ({
                        eq: (_field: string, value: string) => ({
                            single: async () => {
                                if (value === 'guardian_account') {
                                    return {
                                        data: {
                                            account_id: 'guardian_account',
                                            plan: 'paid',
                                            status: 'active',
                                            stripe_customer_id: null,
                                            stripe_subscription_id: null,
                                            current_period_end: null,
                                        },
                                        error: null,
                                    };
                                }
                                if (value === 'student_account') {
                                    return {
                                        data: {
                                            account_id: 'student_account',
                                            plan: 'free',
                                            status: 'inactive',
                                            stripe_customer_id: null,
                                            stripe_subscription_id: null,
                                            current_period_end: null,
                                        },
                                        error: null,
                                    };
                                }
                                return { data: null, error: { code: 'PGRST116' } };
                            },
                        }),
                    }),
                };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const access = await accountLib.resolveLinkedPairPremiumAccessForGuardian('guardian_123', 'student_123');

        expect(access.hasPremiumAccess).toBe(false);
        expect(access.premiumSource).toBe('none');
        expect(access.reason).toBe('Linked student account does not have an active premium entitlement.');
    });
});
