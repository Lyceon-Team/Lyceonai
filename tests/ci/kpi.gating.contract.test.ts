import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const resolvePaidKpiAccessForUser = vi.fn();
const buildStudentKpiViewFromCanonical = vi.fn();
const buildScoreEstimateFromCanonical = vi.fn();
const buildStudentFullLengthReportView = vi.fn((x: any) => x);
const getExamReport = vi.fn();
const supabaseFrom = vi.fn();

vi.mock('../../server/services/kpi-access', () => ({
  resolvePaidKpiAccessForUser,
}));

vi.mock('../../server/services/canonical-runtime-views', () => ({
  buildScoreEstimateFromCanonical,
  buildStudentKpiViewFromCanonical,
  buildStudentFullLengthReportView,
}));

vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: {
    from: supabaseFrom,
  },
}));

vi.mock('../../server/middleware/supabase-auth', async () => {
  const actual = await vi.importActual<typeof import('../../server/middleware/supabase-auth')>(
    '../../server/middleware/supabase-auth'
  );

  return {
    ...actual,
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'student-1',
        role: 'student',
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= 'req-kpi-gating';
      next();
    },
  };
});

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/csrf-double-submit', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => 'test-csrf-token',
}));

vi.mock('../../apps/api/src/services/fullLengthExam', () => ({
  createExamSession: vi.fn(),
  getCurrentSession: vi.fn(),
  startExam: vi.fn(),
  submitAnswer: vi.fn(),
  submitModule: vi.fn(),
  continueFromBreak: vi.fn(),
  completeExam: vi.fn(),
  getExamReport,
  getExamReviewAfterCompletion: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: vi.fn() })),
}));

function createRes() {
  let statusCode = 200;
  let body: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe('KPI Gating Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolvePaidKpiAccessForUser.mockResolvedValue({
      hasPaidAccess: false,
      accountId: 'acc-free',
      plan: 'free',
      status: 'inactive',
      currentPeriodEnd: null,
      reason: 'Student entitlement is free/inactive/expired for premium KPI surfaces.',
    });

    buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: 'kpi_truth_v1',
      timezone: 'America/Chicago',
      week: {
        practiceSessions: 2,
        questionsSolved: 24,
        accuracy: 58,
        explanations: {
          week_sessions: {
            whatThisMeans: 'Sessions in 7 days',
            whyThisChanged: 'Increased by 1',
            whatToDoNext: 'Add one more short session',
            ruleId: 'RULE_WEEK_SESSIONS',
          },
          week_questions: {
            whatThisMeans: 'Questions attempted in 7 days',
            whyThisChanged: 'Increased by 14',
            whatToDoNext: 'Keep review time fixed',
            ruleId: 'RULE_WEEK_QUESTIONS',
          },
          week_accuracy: {
            whatThisMeans: 'Correct percent in 7 days',
            whyThisChanged: 'Up by 8 pts',
            whatToDoNext: 'Focus next set on weakest skill',
            ruleId: 'RULE_WEEK_ACCURACY',
          },
        },
      },
      recency: null,
      metrics: [],
      gating: {
        historicalTrends: {
          allowed: false,
          requiredPlan: 'paid',
          reason: 'Historical trend KPIs require an active paid entitlement.',
        },
      },
      measurementModel: {
        official: [],
        weighted: [],
        diagnostic: ['week_sessions', 'week_questions', 'week_accuracy'],
      },
    });

    buildScoreEstimateFromCanonical.mockResolvedValue({
      totalQuestionsAttempted: 40,
      lastUpdated: '2026-03-10T00:00:00.000Z',
      estimate: {
        composite: 1080,
        math: 540,
        rw: 540,
        range: { low: 1040, high: 1120 },
        confidence: 0.7,
        breakdown: { math: [], rw: [] },
      },
      masteryData: [],
    });
  });

  it('denies free-tier mastery estimate (mastery hexagon surface)', async () => {
    const { getScoreEstimate } = await import('../../server/routes/legacy/progress');

    const req: any = {
      user: { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false },
      requestId: 'req-1',
    };
    const { res, getStatus, getBody } = createRes();

    await getScoreEstimate(req, res as any);

    expect(getStatus()).toBe(402);
    const payload = getBody();
    expect(payload.code).toBe('PREMIUM_REQUIRED');
    expect(payload.feature).toBe('mastery_hexagon');
    expect(payload.requestId).toBe('req-1');
    expect(payload.entitlement).toMatchObject({
      plan: 'free',
      status: 'inactive',
    });
  });

  it('returns estimate payload shape when paid access is active', async () => {
    resolvePaidKpiAccessForUser.mockResolvedValueOnce({
      hasPaidAccess: true,
      accountId: 'acc-paid',
      plan: 'paid',
      status: 'active',
      currentPeriodEnd: null,
      reason: 'Active paid entitlement.',
    });

    const { getScoreEstimate } = await import('../../server/routes/legacy/progress');

    const req: any = {
      user: { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false },
      requestId: 'req-estimate',
    };
    const { res, getBody, getStatus } = createRes();

    await getScoreEstimate(req, res as any);

    expect(getStatus()).toBe(200);
    const payload = getBody();
    expect(payload.estimate).toBeDefined();
    expect(payload.projection).toBeUndefined();
    expect(payload.estimate.range).toEqual({ low: 1040, high: 1120 });
  });

  it('hides historical trends for free-tier KPI view', async () => {
    const { getRecencyKpis } = await import('../../server/routes/legacy/progress');

    const req: any = {
      user: { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false },
      requestId: 'req-2',
    };
    const { res, getBody } = createRes();

    await getRecencyKpis(req, res as any);

    const payload = getBody();
    expect(payload.recency).toBeNull();
    expect(payload.gating.historicalTrends.allowed).toBe(false);
    expect(payload.week.explanations.week_sessions.whatThisMeans).toEqual(expect.stringMatching(/\S/));
    expect(payload.week.explanations.week_sessions.whyThisChanged).toEqual(expect.stringMatching(/\S/));
    expect(payload.week.explanations.week_sessions.whatToDoNext).toEqual(expect.stringMatching(/\S/));
    expect(buildStudentKpiViewFromCanonical).toHaveBeenCalledWith('student-1', false);
  });

  it('denies free-tier full-test analytics report route', async () => {
    const router = (await import('../../server/routes/full-length-exam-routes')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/full-length', router);

    const res = await request(app).get('/api/full-length/sessions/session-free-1/report');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    expect(res.body.feature).toBe('full_test_analytics');
    expect(getExamReport).not.toHaveBeenCalled();
  });

  it('denies free-tier mastery skills route (mastery hexagon)', async () => {
    const { masteryRouter } = await import('../../apps/api/src/routes/mastery');

    const app = express();
    app.use((req: any, _res, next) => {
      req.user = { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false };
      req.requestId ??= 'req-mastery-skills';
      next();
    });
    app.use('/api/me/mastery', masteryRouter);

    const res = await request(app).get('/api/me/mastery/skills');

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    expect(res.body.feature).toBe('mastery_hexagon');
  });

  it('denies free-tier full-length session creation surface', async () => {
    const router = (await import('../../server/routes/full-length-exam-routes')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/full-length', router);

    const res = await request(app).post('/api/full-length/sessions').send({});

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PREMIUM_REQUIRED');
    expect(res.body.feature).toBe('full_length');
  });
});

