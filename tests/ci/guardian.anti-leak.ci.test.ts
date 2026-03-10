import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { requireGuardianEntitlement } from '../../server/middleware/guardian-entitlement';
import * as accountLib from '../../server/lib/account';

// Mock dependencies
vi.mock('../../server/lib/account', () => ({
    getAccountIdForUser: vi.fn(),
    getEntitlement: vi.fn(),
    getPrimaryGuardianLink: vi.fn(),
    ensureAccountForUser: vi.fn(),
    getGuardianLinkForStudent: vi.fn()
}));

vi.mock('../../server/middleware/supabase-auth', () => ({
    getSupabaseAdmin: vi.fn()
}));

vi.mock('../../server/logger', () => ({
    logger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
    }
}));

describe('Guardian Entitlement Anti-Leak Tests', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: vi.Mock;
    let statusMock: vi.Mock;
    let jsonMock: vi.Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        jsonMock = vi.fn();
        statusMock = vi.fn().mockReturnValue({ json: jsonMock });

        req = {
            requestId: 'req-123',
            user: {
                id: 'guardian-123',
                role: 'guardian',
                email: 'guardian@test.com'
            } as any,
            params: {
                studentId: 'student-456'
            }
        };

        res = {
            status: statusMock,
            json: jsonMock
        };

        next = vi.fn();
    });

    it('DENIAL: Unlinked guardian (isGuardianLinkedToStudent = false)', async () => {
        // Mock getGuardianLinkForStudent to return null (no active link)
        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue(null);

        await requireGuardianEntitlement(req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Guardian not linked to requested student'
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('DENIAL: Revoked link (guardian was linked, but status is now revoked)', async () => {
        // A revoked link behaves identical to an unlinked state at the DB query level
        // getGuardianLinkForStudent only returns status='active'
        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue(null);

        await requireGuardianEntitlement(req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Guardian not linked to requested student'
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('DENIAL: Linked guardian + Inactive student entitlement', async () => {
        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue({
            account_id: 'acc-789',
            student_user_id: 'student-456'
        });
        vi.mocked(accountLib.ensureAccountForUser).mockResolvedValue('acc-789');

        // Mock entitlement to be inactive (canceled)
        vi.mocked(accountLib.getEntitlement).mockResolvedValue({
            id: 'ent-1',
            account_id: 'acc-789',
            plan: 'paid',
            status: 'canceled',
            stripe_customer_id: 'cus_123',
            stripe_subscription_id: 'sub_123',
            current_period_end: new Date(Date.now() + 100000).toISOString(), // Future, but canceled
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        await requireGuardianEntitlement(req as Request, res as Response, next);

        // 402 Payment Required for missing entitlement on a linked student
        expect(statusMock).toHaveBeenCalledWith(402);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'subscription_canceled',
            error: 'Subscription required'
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('DENIAL: Guardian loses visibility when student entitlement expires', async () => {
        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue({
            account_id: 'acc-789',
            student_user_id: 'student-456'
        });
        vi.mocked(accountLib.ensureAccountForUser).mockResolvedValue('acc-789');

        // Mock entitlement to be active BUT period has expired
        vi.mocked(accountLib.getEntitlement).mockResolvedValue({
            id: 'ent-1',
            account_id: 'acc-789',
            plan: 'paid',
            status: 'active',
            stripe_customer_id: 'cus_123',
            stripe_subscription_id: 'sub_123',
            current_period_end: new Date(Date.now() - 10000).toISOString(), // Expired 10 seconds ago
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        await requireGuardianEntitlement(req as Request, res as Response, next);

        expect(statusMock).toHaveBeenCalledWith(402);
        expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'subscription_expired',
            error: 'Subscription required'
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('DENIAL: Guardian loses visibility immediately after unlink', async () => {
        // 1st request: Link exists, Entitlement Active
        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue({
            account_id: 'acc-789',
            student_user_id: 'student-456'
        });
        vi.mocked(accountLib.ensureAccountForUser).mockResolvedValue('acc-789');
        vi.mocked(accountLib.getEntitlement).mockResolvedValue({
            id: 'ent-1',
            account_id: 'acc-789',
            plan: 'paid',
            status: 'active',
            stripe_customer_id: 'cus_123',
            stripe_subscription_id: 'sub_123',
            current_period_end: new Date(Date.now() + 100000).toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        await requireGuardianEntitlement(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledTimes(1); // Granted

        // 2nd request: Link is removed (e.g., DELETE /api/guardian/link/:studentId was called)
        vi.clearAllMocks();
        const freshStatusMock = vi.fn().mockReturnValue({ json: vi.fn() });
        const freshRes = { status: freshStatusMock, json: vi.fn() } as unknown as Response;

        vi.mocked(accountLib.getGuardianLinkForStudent).mockResolvedValue(null); // Now revoked!

        await requireGuardianEntitlement(req as Request, freshRes, next);

        // visibility lost immediately
        expect(freshStatusMock).toHaveBeenCalledWith(403);
        expect(next).toHaveBeenCalledTimes(0); // Not called again
    });
});
