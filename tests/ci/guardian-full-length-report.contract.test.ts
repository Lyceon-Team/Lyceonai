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
  listExamSessions: vi.fn(),
};

vi.mock('../../server/middleware/supabase-auth', async () => {
  const actual = await vi.importActual<typeof import('../../server/middleware/supabase-auth')>(
    '../../server/middleware/supabase-auth'
  );

  return {
    ...actual,
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      const role = req.headers['x-test-role'] === 'student' ? 'student' : 'guardian';
      req.user = {
        id: role === 'student' ? 'student-1' : 'guardian-1',
        role,
        isGuardian: role === 'guardian',
        isAdmin: false,
      };
      req.requestId ??= 'req-guardian-full-length-report';
      next();
    },
  };
});

vi.mock('../../server/middleware/guardian-entitlement', () => ({
  requireGuardianEntitlement: (req: any, res: any, next: any) => {
    if (req.headers['x-test-entitlement'] === 'deny') {
      return res.status(402).json({ error: 'Guardian premium required', requestId: req.requestId });
    }
    return next();
  },
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/csrf-double-submit', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => 'test-csrf-token',
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
vi.mock('../../server/services/kpi-access', () => ({
  resolvePaidKpiAccessForUser: vi.fn(async () => ({ hasPaidAccess: true, reason: 'allowed' })),
}));
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

  it('returns guardian full-length history as linked student projection', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    reportServiceMocks.listExamSessions.mockResolvedValue([
      {
        sessionId: 'sess-completed-1',
        status: 'completed',
        currentSection: 'math',
        currentModule: 2,
        testFormId: 'form-1',
        startedAt: '2026-03-20T09:00:00.000Z',
        completedAt: '2026-03-20T11:15:00.000Z',
        createdAt: '2026-03-20T08:58:00.000Z',
        updatedAt: '2026-03-20T11:15:00.000Z',
      },
      {
        sessionId: 'sess-live-1',
        status: 'in_progress',
        currentSection: 'rw',
        currentModule: 1,
        testFormId: 'form-1',
        startedAt: '2026-03-21T10:00:00.000Z',
        completedAt: null,
        createdAt: '2026-03-21T09:58:00.000Z',
        updatedAt: '2026-03-21T10:10:00.000Z',
      },
    ]);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app).get('/api/guardian/students/student-1/exams/full-length/sessions?limit=20&include_incomplete=true');

    expect(res.status).toBe(200);
    expect(reportServiceMocks.listExamSessions).toHaveBeenCalledWith({
      userId: 'student-1',
      limit: 20,
      includeIncomplete: true,
    });
    expect(res.body.studentId).toBe('student-1');
    expect(res.body.sessions).toEqual([
      expect.objectContaining({
        sessionId: 'sess-completed-1',
        reportAvailable: true,
        reviewAvailable: false,
      }),
      expect.objectContaining({
        sessionId: 'sess-live-1',
        reportAvailable: false,
        reviewAvailable: false,
      }),
    ]);
  });

  it('denies unlinked guardian for full-length history projection', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(false);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app).get('/api/guardian/students/student-404/exams/full-length/sessions');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not authorized to view this student');
    expect(reportServiceMocks.listExamSessions).not.toHaveBeenCalled();
  });

  it('denies free guardian access for full-length history when entitlement is missing', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app)
      .get('/api/guardian/students/student-1/exams/full-length/sessions')
      .set('x-test-entitlement', 'deny');

    expect(res.status).toBe(402);
    expect(reportServiceMocks.listExamSessions).not.toHaveBeenCalled();
  });

  it('never includes question-level, mastery, tutor, or raw-delta internals in guardian report payload', async () => {
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
      tutorInteractions: [{ prompt: 'leak' }],
      mastery_score: 88,
      rawDelta: { value: 12 },
    });

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/guardian', router);

    const res = await request(app).get('/api/guardian/students/student-1/exams/full-length/session-safe-1/report');

    expect(res.status).toBe(200);
    expect(res.body.report.sessionId).toBe('session-safe-1');
    expect(res.body.report.estimatedScore).toEqual({ rw: 560, math: 540, total: 1100 });

    expect(res.body.report.rawScore).toBeUndefined();
    expect(res.body.report.domainBreakdown).toBeUndefined();
    expect(res.body.report.skillDiagnostics).toBeUndefined();
    expect(res.body.report.rwScore).toBeUndefined();
    expect(res.body.report.mathScore).toBeUndefined();

    expect(res.body.report.questions).toBeUndefined();
    expect(res.body.report.responses).toBeUndefined();
    expect(res.body.report.rawQuestionDump).toBeUndefined();
    expect(res.body.report.tutorInteractions).toBeUndefined();
    expect(res.body.report.mastery_score).toBeUndefined();
    expect(res.body.report.rawDelta).toBeUndefined();

    expect(Array.isArray(res.body.report.kpis)).toBe(true);
    expect(res.body.report.kpis.length).toBeGreaterThan(0);
    for (const metric of res.body.report.kpis) {
      expect(metric.explanation).toBeDefined();
      expect(metric.explanation.whatThisMeans).toBeTruthy();
      expect(metric.explanation.whyThisChanged).toBeTruthy();
      expect(metric.explanation.whatToDoNext).toBeTruthy();
    }
  });

  it('projects the same student full-length report view builder output for guardian visibility', async () => {
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
      questions: [],
      responses: [],
    });

    const studentRouter = (await import('../../server/routes/full-length-exam-routes')).default;
    const studentApp = express();
    studentApp.use(express.json());
    studentApp.use('/api/full-length', studentRouter);
    const studentRes = await request(studentApp)
      .get('/api/full-length/sessions/session-safe-1/report')
      .set('x-test-role', 'student');

    const guardianRouter = (await import('../../server/routes/guardian-routes')).default;
    const guardianApp = express();
    guardianApp.use(express.json());
    guardianApp.use('/api/guardian', guardianRouter);
    const guardianRes = await request(guardianApp).get('/api/guardian/students/student-1/exams/full-length/session-safe-1/report');

    expect(studentRes.status).toBe(200);
    expect(guardianRes.status).toBe(200);
    expect(guardianRes.body.report).toEqual({
      sessionId: studentRes.body.sessionId,
      estimatedScore: {
        rw: studentRes.body.scaledScore.rw,
        math: studentRes.body.scaledScore.math,
        total: studentRes.body.scaledScore.total,
      },
      completedAt: studentRes.body.completedAt,
      kpis: studentRes.body.kpis,
      measurementModel: studentRes.body.measurementModel,
    });
  });
});

