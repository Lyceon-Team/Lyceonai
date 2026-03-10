import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const accountMocks = {
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  isGuardianLinkedToStudent: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(),
};

const reportServiceMocks = {
  getExamReport: vi.fn(),
};

vi.mock('../../server/middleware/supabase-auth', () => ({
  requireSupabaseAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'guardian-1', role: 'guardian' };
    next();
  },
}));

vi.mock('../../server/middleware/guardian-entitlement', () => ({
  requireGuardianEntitlement: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/lib/durable-rate-limiter', () => ({
  createDurableRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(async () => ({ data: [], error: null })),
          gte: vi.fn(async () => ({ data: [], error: null })),
          single: vi.fn(async () => ({ data: null, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  },
}));

vi.mock('../../server/lib/account', () => accountMocks);
vi.mock('../../apps/api/src/services/fullLengthExam', () => reportServiceMocks);
vi.mock('../../apps/api/src/services/mastery-derived', () => ({
  getDerivedWeaknessSignals: vi.fn(async () => ({ weakestAreas: [] })),
}));
vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Guardian Full-Length Report Visibility Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hard-denies unlinked guardian with 403 and never returns report', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(false);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app).get('/api/guardian/students/student-404/exams/full-length/session-xyz/report');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not authorized to view this student');
    expect(reportServiceMocks.getExamReport).not.toHaveBeenCalled();
  });

  it('never includes question-level dumps in guardian report payload', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);

    reportServiceMocks.getExamReport.mockResolvedValue({
      sessionId: 'session-safe-1',
      rawScore: {
        rw: { correct: 20, total: 54 },
        math: { correct: 18, total: 44 },
        total: { correct: 38, total: 98 },
      },
      scaledScore: { rw: 560, math: 540, total: 1100 },
      domainBreakdown: { rw: [], math: [] },
      skillDiagnostics: { rw: [], math: [] },
      rwScore: {
        module1: { correct: 10, total: 27 },
        module2: { correct: 10, total: 27 },
        totalCorrect: 20,
        totalQuestions: 54,
      },
      mathScore: {
        module1: { correct: 9, total: 22 },
        module2: { correct: 9, total: 22 },
        totalCorrect: 18,
        totalQuestions: 44,
      },
      overallScore: {
        totalCorrect: 38,
        totalQuestions: 98,
        percentageCorrect: 38.8,
        scaledTotal: 1100,
      },
      completedAt: '2026-01-02T00:00:00.000Z',
      questions: [{ id: 'q-should-not-leak' }],
      responses: [{ questionId: 'q-should-not-leak', selectedAnswer: 'A' }],
      rawQuestionDump: { should: 'never leak' },
    });

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app).get('/api/guardian/students/student-1/exams/full-length/session-safe-1/report');

    expect(res.status).toBe(200);
    expect(res.body.report.sessionId).toBe('session-safe-1');
    expect(res.body.report.rawScore).toBeDefined();
    expect(res.body.report.questions).toBeUndefined();
    expect(res.body.report.responses).toBeUndefined();
    expect(res.body.report.rawQuestionDump).toBeUndefined();
  });
});

