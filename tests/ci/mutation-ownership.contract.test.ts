import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
// @ts-ignore
import practiceCanonicalRouter from '../../server/routes/practice-canonical';
import fullLengthExamRouter from '../../server/routes/full-length-exam-routes';
import guardianRoutes from '../../server/routes/guardian-routes';
import { diagnosticRouter } from '../../apps/api/src/routes/diagnostic';

// HOISTED MOCKS
const examMocks = vi.hoisted(() => ({
    submitModule: vi.fn(),
    submitAnswer: vi.fn(),
    persistModuleCalculatorState: vi.fn(),
}));

const accountMocks = vi.hoisted(() => ({
    revokeGuardianLink: vi.fn(),
    isGuardianLinkedToStudent: vi.fn(),
    getAllGuardianStudentLinks: vi.fn(),
}));

const diagnosticMocks = vi.hoisted(() => ({
    recordDiagnosticAnswer: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
    requireSupabaseAuth: (req: any, res: any, next: any) => {
        req.user = req.user || { id: 'test-user', role: 'student' };
        next();
    },
    requireGuardianRole: () => (req: any, res: any, next: any) => {
        req.user = { id: 'guardian-1', role: 'guardian' };
        next();
    },
    requireRequestUser: (req: any) => req.user || { id: 'test-user', role: 'student' },
}));

// Apply mocks before any imports
vi.mock('../../apps/api/src/services/fullLengthExam', () => ({
    submitModule: examMocks.submitModule,
    submitAnswer: examMocks.submitAnswer,
    persistModuleCalculatorState: examMocks.persistModuleCalculatorState,
    createExamSession: vi.fn(),
    startExam: vi.fn(),
    getExamReport: vi.fn(),
    getExamReviewAfterCompletion: vi.fn(),
    getCurrentSession: vi.fn(),
    continueFromBreak: vi.fn(),
    completeExam: vi.fn(),
}));

vi.mock('../../server/lib/account', () => ({
    createGuardianLink: vi.fn(),
    revokeGuardianLink: accountMocks.revokeGuardianLink,
    isGuardianLinkedToStudent: accountMocks.isGuardianLinkedToStudent,
    getAllGuardianStudentLinks: accountMocks.getAllGuardianStudentLinks,
    ensureAccountForUser: vi.fn(),
    getAccountIdForUser: vi.fn(),
}));

vi.mock('../../apps/api/src/services/diagnostic-service', () => ({
    recordDiagnosticAnswer: diagnosticMocks.recordDiagnosticAnswer,
    startDiagnosticSession: vi.fn(),
    getCurrentDiagnosticQuestion: vi.fn(),
}));

vi.mock('../../server/middleware/supabase-auth', () => ({
    requireSupabaseAuth: authMocks.requireSupabaseAuth,
    requireStudentOrAdmin: (req: any, res: any, next: any) => next(),
    requireSupabaseAdmin: (req: any, res: any, next: any) => next(),
    getSupabaseAdmin: vi.fn(() => require('../../apps/api/src/lib/supabase-server').supabaseServer),
    requireRequestUser: authMocks.requireRequestUser,
    sendForbidden: (res: any) => res.status(403).json({ error: 'forbidden' }),
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => {
    const chain: any = {
        then: (resolve: any) => resolve({ data: [], error: null })
    };
    const identity = () => chain;
    Object.assign(chain, {
        eq: identity, is: identity, in: identity, match: identity, order: identity, limit: identity, select: identity, update: identity, insert: identity, upsert: identity,
        single: () => Promise.resolve({ data: { student_id: 'test-user', id: 'q-1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
    });
    return {
        supabaseServer: { from: vi.fn(() => chain), rpc: vi.fn() }
    };
});

vi.mock('../../apps/api/src/lib/supabase-admin', () => {
    const chain: any = {
        then: (resolve: any) => resolve({ data: [], error: null })
    };
    const identity = () => chain;
    Object.assign(chain, {
        eq: identity, is: identity, in: identity, match: identity, order: identity, limit: identity, select: identity, update: identity, insert: identity, upsert: identity,
        single: () => Promise.resolve({ data: { student_id: 'test-user', correct_answer: 'B', answer_text: null, explanation: null }, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
    });
    return {
        getSupabaseAdmin: () => ({ from: vi.fn(() => chain) }),
    };
});

vi.mock('../../server/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../../server/middleware/csrf', () => ({
    csrfGuard: () => (req: any, res: any, next: any) => next()
}));

vi.mock('../../server/middleware/guardian-entitlement', () => ({
    requireGuardianEntitlement: (req: any, res: any, next: any) => next()
}));

function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use((req: any, res, next) => {
        req.requestId = 'test-req-id';
        next();
    });
    app.use(authMocks.requireSupabaseAuth);
    app.use('/api/practice', practiceCanonicalRouter);
    app.use('/api/full-length', fullLengthExamRouter);
    app.use('/api/guardian', (req: any, _res, next) => {
        req.user = { id: 'guardian-1', role: 'guardian' };
        next();
    }, guardianRoutes);
    app.use('/api/me/mastery/diagnostic', diagnosticRouter);
    return app;
}

describe('Mutation Ownership Contract', () => {
    let app: Express;

    beforeEach(() => {
        vi.clearAllMocks();
        app = buildApp();
    });

    describe('Surface Ownership Verification', () => {
        it('Full-Length: module submit delegates to service', async () => {
            examMocks.submitModule.mockResolvedValue({ success: true });
            const res = await request(app).post('/api/full-length/sessions/sess-1/module/submit').send({});
            expect(res.status).toBe(200);
            expect(examMocks.submitModule).toHaveBeenCalled();
        });

        it('Full-Length: answer delegates to service', async () => {
            examMocks.submitAnswer.mockResolvedValue(undefined);
            await request(app).post('/api/full-length/sessions/sess-1/answer').send({
                questionId: '00000000-0000-0000-0000-000000000001', selectedAnswer: 'B'
            });
            expect(examMocks.submitAnswer).toHaveBeenCalled();
        });

        it('Guardian: revoke link delegates to account service', async () => {
            accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
            accountMocks.revokeGuardianLink.mockResolvedValue(undefined);
            accountMocks.getAllGuardianStudentLinks.mockResolvedValue([]);

            const res = await request(app)
                .delete('/api/guardian/link/student-1')
                .set('Origin', 'http://localhost:5000');
            // If it hits the service call, the ownership is correct. 
            // We tolerate 500/403 if it happens after the service call or during post-processing
            // but here we just want to ensure it calls revokeGuardianLink.
            expect(accountMocks.revokeGuardianLink).toHaveBeenCalledWith('guardian-1', 'student-1');
        });

        it('Diagnostic: answer delegates to diagnostic service', async () => {
            diagnosticMocks.recordDiagnosticAnswer.mockResolvedValue({ success: true, isComplete: false });
            await request(app)
                .post('/api/me/mastery/diagnostic/answer')
                .set('Origin', 'http://localhost:5000')
                .send({
                    sessionId: 'd-1', questionCanonicalId: 'q-1', selectedChoice: 'A', timeSpentMs: 1000
                });
            expect(diagnosticMocks.recordDiagnosticAnswer).toHaveBeenCalled();
        });

        it('Practice: answer is unified in practice-canonical router', async () => {
            const res = await request(app).post('/api/practice/answer').send({});
            expect(res.status).toBe(400); // Proves it hits the zod guard in the route
            expect(res.body.error).toMatch(/invalid_request/i);
        });
    });
});
