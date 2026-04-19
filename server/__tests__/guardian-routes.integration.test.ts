import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import guardianRoutes from '../routes/guardian-routes';

const mockResolveGuardianAccess = vi.fn();
const mockIsGuardianLinkedToStudent = vi.fn();
const mockGetExamReport = vi.fn();

vi.mock('../lib/account', () => ({
    resolveLinkedPairPremiumAccessForGuardian: (...args: any[]) => mockResolveGuardianAccess(...args),
    isGuardianLinkedToStudent: (...args: any[]) => mockIsGuardianLinkedToStudent(...args),
    createGuardianLink: vi.fn(),
    revokeGuardianLink: vi.fn(),
    getAllGuardianStudentLinks: vi.fn(),
    ensureAccountForUser: vi.fn(),
}));

vi.mock('../middleware/supabase-auth', () => ({
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
        req.user = { id: 'guardian_123', role: 'guardian', email: 'guard@mail.com' };
        req.requestId = 'req_test';
        next();
    },
    getSupabaseAdmin: vi.fn(),
}));

vi.mock('../middleware/guardian-role', () => ({
    requireGuardianRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../apps/api/src/services/fullLengthExam', () => ({
    getExamReport: (...args: any[]) => mockGetExamReport(...args),
}));

vi.mock('../services/canonical-runtime-views', () => ({
    buildStudentFullLengthReportView: vi.fn(),
    projectGuardianFullLengthReportView: vi.fn(),
    buildStudentKpiViewFromCanonical: vi.fn(),
}));

describe('Guardian routes integration - access enforcement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const makeApp = () => {
        const app = express();
        app.use(express.json());
        app.use('/api/guardian', guardianRoutes);
        return app;
    };

    it('unlinked guardian denied (403)', async () => {
        mockResolveGuardianAccess.mockResolvedValue({
            hasActiveLink: false,
            hasPremiumAccess: false,
        });

        const app = makeApp();
        const res = await request(app)
            .get('/api/guardian/students/student_123/exams/full-length/session_123/report');

        expect(res.status).toBe(403);
        expect(res.body).toEqual(expect.objectContaining({ code: 'NO_LINKED_STUDENT' }));
        expect(mockGetExamReport).not.toHaveBeenCalled();
    });

    it('revoked link denied immediately (403)', async () => {
        mockResolveGuardianAccess.mockResolvedValue({
            hasActiveLink: false,
            hasPremiumAccess: true,
        });

        const app = makeApp();
        const res = await request(app)
            .get('/api/guardian/students/student_123/exams/full-length/session_123/report');

        expect(res.status).toBe(403);
        expect(res.body).toEqual(expect.objectContaining({ code: 'NO_LINKED_STUDENT' }));
        expect(mockGetExamReport).not.toHaveBeenCalled();
    });

    it('linked but unpaid student locked (402)', async () => {
        mockResolveGuardianAccess.mockResolvedValue({
            hasActiveLink: true,
            hasPremiumAccess: false,
            studentEntitlementStatus: 'inactive',
            studentEntitlementExpired: false,
        });

        const app = makeApp();
        const res = await request(app)
            .get('/api/guardian/students/student_123/exams/full-length/session_123/report');

        expect(res.status).toBe(402);
        expect(res.body).toEqual(expect.objectContaining({ code: 'PAYMENT_REQUIRED', reason: 'no_active_subscription' }));
        expect(mockGetExamReport).not.toHaveBeenCalled();
    });

    it('entitlement expiry removes guardian visibility (402)', async () => {
        mockResolveGuardianAccess.mockResolvedValue({
            hasActiveLink: true,
            hasPremiumAccess: false,
            studentEntitlementExpired: true,
            studentEntitlementStatus: 'inactive',
        });

        const app = makeApp();
        const res = await request(app)
            .get('/api/guardian/students/student_123/exams/full-length/session_123/report');

        expect(res.status).toBe(402);
        expect(res.body).toEqual(expect.objectContaining({ code: 'PAYMENT_REQUIRED', reason: 'subscription_expired' }));
        expect(mockGetExamReport).not.toHaveBeenCalled();
    });
});
