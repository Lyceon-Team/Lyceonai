import * as accountLib from '../lib/account';

describe('Guardian payment access', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('guardian payment does not grant guardian-owned access when student is not entitled', async () => {
        jest.spyOn(accountLib, 'getAccountIdForUser').mockResolvedValue('guardian_account');
        jest.spyOn(accountLib, 'getGuardianLinkForStudent').mockResolvedValue({
            account_id: 'student_account',
            student_user_id: 'student_123',
        } as any);

        jest.spyOn(accountLib, 'getEntitlement').mockImplementation(async (accountId: string) => {
            if (accountId === 'guardian_account') {
                return {
                    account_id: 'guardian_account',
                    plan: 'paid',
                    status: 'active',
                    stripe_customer_id: null,
                    stripe_subscription_id: null,
                    current_period_end: null,
                } as any;
            }
            if (accountId === 'student_account') {
                return {
                    account_id: 'student_account',
                    plan: 'free',
                    status: 'inactive',
                    stripe_customer_id: null,
                    stripe_subscription_id: null,
                    current_period_end: null,
                } as any;
            }
            return null;
        });

        const access = await accountLib.resolveLinkedPairPremiumAccessForGuardian('guardian_123', 'student_123');

        expect(access.hasPremiumAccess).toBe(false);
        expect(access.premiumSource).toBe('none');
        expect(access.reason).toBe('Linked student account does not have an active premium entitlement.');
    });
});
