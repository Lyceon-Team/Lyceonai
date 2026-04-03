import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import billingRoutes from '../routes/billing-routes';

const mockStripe = {
    prices: { retrieve: vi.fn().mockResolvedValue({}) },
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_123' }) },
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'http://checkout', id: 'cs_123' }) } },
};

vi.mock('../lib/stripeClient', () => ({
    getUncachableStripeClient: () => mockStripe,
    getStripePublishableKeySafe: vi.fn(),
}));

const mockGetPrimaryGuardianLink = vi.fn();
const mockEnsureAccountForUser = vi.fn();
const mockGetOrCreateEntitlement = vi.fn();
const mockSetEntitlementStripeCustomerId = vi.fn();

vi.mock('../lib/account', () => ({
    getPrimaryGuardianLink: (...args: any[]) => mockGetPrimaryGuardianLink(...args),
    ensureAccountForUser: (...args: any[]) => mockEnsureAccountForUser(...args),
    getOrCreateEntitlement: (...args: any[]) => mockGetOrCreateEntitlement(...args),
    setEntitlementStripeCustomerId: (...args: any[]) => mockSetEntitlementStripeCustomerId(...args),
    mapStripeStatusToEntitlement: vi.fn(),
    resolveLinkedPairPremiumAccessForGuardian: vi.fn(),
    resolveLinkedPairPremiumAccessForStudent: vi.fn(),
}));

vi.mock('../middleware/supabase-auth', () => ({
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
        req.user = { id: 'guardian_123', role: 'guardian', email: 'guard@mail.com' };
        req.requestId = 'req_test';
        next();
    },
    sendUnauthenticated: (res: any, requestId: string) => res.status(401).json({ error: 'Unauthenticated', requestId }),
    getSupabaseAdmin: vi.fn(),
}));

vi.mock('../middleware/csrf-double-submit', () => ({
    doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
}));

describe('Billing checkout (guardian)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STRIPE_PRICE_PARENT_MONTHLY = 'price_monthly';
        process.env.STRIPE_PRICE_PARENT_QUARTERLY = 'price_quarterly';
        process.env.STRIPE_PRICE_PARENT_YEARLY = 'price_yearly';
    });

    it('guardian checkout targets linked student account in metadata', async () => {
        mockGetPrimaryGuardianLink.mockResolvedValue({
            student_user_id: 'student_123',
            account_id: 'student_acc_123',
        });
        mockGetOrCreateEntitlement.mockResolvedValue({ stripe_customer_id: null });

        const app = express();
        app.use(express.json());
        app.use('/api/billing', billingRoutes);

        const response = await request(app)
            .post('/api/billing/checkout')
            .send({ plan: 'monthly' });

        expect(response.status).toBe(200);
        expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);

        const callArgs = mockStripe.checkout.sessions.create.mock.calls[0][0];
        expect(callArgs.metadata).toEqual(expect.objectContaining({
            account_id: 'student_acc_123',
            linked_student_id: 'student_123',
            payer_user_id: 'guardian_123',
            payer_role: 'guardian',
        }));
        expect(callArgs.subscription_data.metadata).toEqual(expect.objectContaining({
            account_id: 'student_acc_123',
            linked_student_id: 'student_123',
            payer_user_id: 'guardian_123',
            payer_role: 'guardian',
        }));
        expect(mockSetEntitlementStripeCustomerId).toHaveBeenCalledWith('student_acc_123', 'cus_123');
    });
});
