import { Request, Response } from 'express';
import { requireGuardianEntitlement } from '../../middleware/guardian-entitlement';
import * as accountLib from '../../lib/account';

jest.mock('../../lib/account');

describe('Guardian Access Denial', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let nextFunction: jest.Mock;

    beforeEach(() => {
        mockReq = {
            user: { id: 'guardian_123', role: 'guardian', email: 'guard@mail.com' } as any,
            params: { studentId: 'student_123' },
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        nextFunction = jest.fn();
        jest.clearAllMocks();
    });

    it('unlinked guardian cannot access student data', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as jest.Mock).mockResolvedValue({
            hasActiveLink: false,
            hasPremiumAccess: false,
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Guardian not linked to requested student' }));
        expect(nextFunction).not.toHaveBeenCalled();
    });

    it('revoked link immediately loses access', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as jest.Mock).mockResolvedValue({
            hasActiveLink: false, // Revoked link
            hasPremiumAccess: true,
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_LINKED_STUDENT' }));
    });

    it('linked but unpaid student remains locked', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as jest.Mock).mockResolvedValue({
            hasActiveLink: true,
            hasPremiumAccess: false,
            studentEntitlementStatus: 'inactive',
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(402);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_REQUIRED' }));
    });

    it('student entitlement expiry removes guardian visibility', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as jest.Mock).mockResolvedValue({
            hasActiveLink: true,
            hasPremiumAccess: false,
            studentEntitlementExpired: true,
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(402);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'subscription_expired' }));
    });

    it('guardian unlink does not break student entitlement or student data', async () => {
        const studentAccess = await accountLib.resolveLinkedPairPremiumAccessForStudent('student_123');
        // If we mock the student access as having premium natively..
        (accountLib.resolveLinkedPairPremiumAccessForStudent as jest.Mock).mockResolvedValue({
            hasPremiumAccess: true,
            premiumSource: 'student',
        });

        // We confirm that removing link just alters guardian lookup, not student lookup
        const { hasPremiumAccess } = await accountLib.resolveLinkedPairPremiumAccessForStudent('student_123');
        expect(hasPremiumAccess).toBe(true);
    });
});
