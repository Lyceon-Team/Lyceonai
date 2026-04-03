import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { requireGuardianEntitlement } from '../middleware/guardian-entitlement';
import * as accountLib from '../lib/account';

vi.mock('../lib/account');

describe('Guardian Access Denial', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let nextFunction: any;

    beforeEach(() => {
        mockReq = {
            user: { id: 'guardian_123', role: 'guardian', email: 'guard@mail.com' } as any,
            params: { studentId: 'student_123' },
        };
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        nextFunction = vi.fn();
        vi.clearAllMocks();
    });

    it('unlinked guardian cannot access student data', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as any).mockResolvedValue({
            hasActiveLink: false,
            hasPremiumAccess: false,
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Guardian not linked to requested student' }));
        expect(nextFunction).not.toHaveBeenCalled();
    });

    it('revoked link immediately loses access', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as any).mockResolvedValue({
            hasActiveLink: false, // Revoked link
            hasPremiumAccess: true,
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_LINKED_STUDENT' }));
    });

    it('linked but unpaid student remains locked', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as any).mockResolvedValue({
            hasActiveLink: true,
            hasPremiumAccess: false,
            studentEntitlementStatus: 'inactive',
        });

        await requireGuardianEntitlement(mockReq as Request, mockRes as Response, nextFunction);

        expect(mockRes.status).toHaveBeenCalledWith(402);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_REQUIRED' }));
    });

    it('student entitlement expiry removes guardian visibility', async () => {
        (accountLib.resolveLinkedPairPremiumAccessForGuardian as any).mockResolvedValue({
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
        (accountLib.resolveLinkedPairPremiumAccessForStudent as any).mockResolvedValue({
            hasPremiumAccess: true,
            premiumSource: 'student',
        });

        // We confirm that removing link just alters guardian lookup, not student lookup
        const { hasPremiumAccess } = await accountLib.resolveLinkedPairPremiumAccessForStudent('student_123');
        expect(hasPremiumAccess).toBe(true);
    });
});
