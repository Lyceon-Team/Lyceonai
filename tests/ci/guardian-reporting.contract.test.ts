import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const accountMocks = {
  createGuardianLink: vi.fn(),
  revokeGuardianLink: vi.fn(),
  isGuardianLinkedToStudent: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(),
  ensureAccountForUser: vi.fn(),
};

const kpiMocks = {
  buildStudentKpiViewFromCanonical: vi.fn(),
  buildStudentFullLengthReportView: vi.fn(),
  projectGuardianFullLengthReportView: vi.fn(),
};
const calendarMocks = {
  buildCalendarMonthView: vi.fn(),
};
const weaknessViewMocks = {
  buildWeaknessSkillsView: vi.fn(async () => ({ ok: true, count: 0, skills: [] })),
};

const systemEventInserts: Record<string, unknown>[] = [];
const guardianAuditInserts: Record<string, unknown>[] = [];
let profileSelectError: { message: string } | null = null;

class FakeSelectBuilder {
  private readonly rows: any[];
  private readonly error: any;

  constructor(rows: any[], error: any = null) {
    this.rows = rows;
    this.error = error;
  }

  eq(): this {
    return this;
  }

  in(): this {
    return this;
  }

  gte(): this {
    return this;
  }

  lte(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    if (count < this.rows.length) {
      this.rows.length = count;
    }
    return this;
  }

  async single() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    const row = this.rows[0] ?? null;
    if (!row) {
      return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
    }
    return { data: row, error: null };
  }

  async maybeSingle() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    return { data: this.rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any[]; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.error ? null : this.rows, error: this.error }).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

const seed = {
  profiles: [
    {
      id: 'student-1',
      role: 'student',
      email: 'student1@example.com',
      display_name: 'Student One',
      created_at: '2026-03-01T00:00:00.000Z',
    },
  ],
  student_study_profile: [
    {
      user_id: 'student-1',
      timezone: 'America/Chicago',
    },
  ],
  student_study_plan_days: [
    {
      user_id: 'student-1',
      day_date: '2026-03-01',
      planned_minutes: 45,
      completed_minutes: 30,
      status: 'in_progress',
      focus: [{ section: 'Math', weight: 1 }],
      tasks: [{ type: 'practice' }],
      is_user_override: true,
      plan_version: 3,
    },
  ],
  student_question_attempts: [
    {
      user_id: 'student-1',
      attempted_at: '2026-03-01T15:00:00.000Z',
      is_correct: true,
      time_spent_ms: 120000,
      event_type: null,
    },
  ],
};

vi.mock('../../server/middleware/supabase-auth', async () => {
  const actual = await vi.importActual<typeof import('../../server/middleware/supabase-auth')>(
    '../../server/middleware/supabase-auth',
  );
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.requestId ??= 'req-guardian-reporting';
      next();
    },
  };
});

vi.mock('../../server/middleware/guardian-entitlement', () => ({
  requireGuardianEntitlement: (req: any, res: any, next: any) => {
    if (req.headers['x-entitled'] === 'false') {
      return res.status(402).json({ error: 'Subscription required', code: 'PAYMENT_REQUIRED' });
    }
    next();
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
    from: (table: string) => {
      if (table === 'system_event_logs') {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              systemEventInserts.push(...payload);
            } else {
              systemEventInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      if (table === 'guardian_link_audit') {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              guardianAuditInserts.push(...payload);
            } else if (payload) {
              guardianAuditInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      const rows = (seed as Record<string, any[]>)[table] ?? [];
      const selectError = table === 'student_study_profile'
          ? profileSelectError
          : null;
      return {
        select: () => new FakeSelectBuilder([...rows], selectError),
        insert: async () => ({ error: null }),
      };
    },
  },
}));

vi.mock('../../server/lib/account', () => accountMocks);
vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../apps/api/src/services/fullLengthExam', () => ({
  getExamReport: vi.fn(),
}));
vi.mock('../../apps/api/src/services/weakness-view', () => ({
  buildWeaknessSkillsView: weaknessViewMocks.buildWeaknessSkillsView,
}));
vi.mock('../../apps/api/src/services/calendar-month-view', () => ({
  buildCalendarMonthView: calendarMocks.buildCalendarMonthView,
}));
vi.mock('../../server/services/canonical-runtime-views', () => kpiMocks);

function buildApp(role: 'guardian' | 'student' = 'guardian') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: role === 'guardian' ? 'guardian-1' : 'student-9',
      role,
      email: role === 'guardian' ? 'guardian@example.com' : 'student9@example.com',
    };
    next();
  });
  return app;
}

describe('Guardian reporting runtime contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemEventInserts.length = 0;
    guardianAuditInserts.length = 0;
    profileSelectError = null;
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      { student_user_id: 'student-1', linked_at: '2026-03-01T00:00:00.000Z' },
    ]);

    kpiMocks.buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: 'kpi-v1',
      timezone: 'America/Chicago',
      week: {
        practiceSessions: 4,
        questionsSolved: 30,
        accuracy: 80,
        explanations: {},
      },
      recency: {
        window: 200,
        totalAttempts: 200,
        accuracy: 78,
        avgSecondsPerQuestion: 75.3,
        explanations: {},
      },
      metrics: [
        {
          id: 'week_minutes',
          label: 'Practice Minutes (7d)',
          kind: 'diagnostic',
          unit: 'minutes',
          value: 120,
          explanation: { ruleId: 'RULE_WEEK_MINUTES', whatThisMeans: 'wm', whyThisChanged: 'up', whatToDoNext: 'keep going' },
        },
        {
          id: 'week_sessions',
          label: 'Practice Sessions (7d)',
          kind: 'diagnostic',
          unit: 'count',
          value: 4,
          explanation: { ruleId: 'RULE_WEEK_SESSIONS', whatThisMeans: 'ws', whyThisChanged: 'up', whatToDoNext: 'keep going' },
        },
        {
          id: 'week_questions',
          label: 'Questions Solved (7d)',
          kind: 'diagnostic',
          unit: 'count',
          value: 30,
          explanation: { ruleId: 'RULE_WEEK_QUESTIONS', whatThisMeans: 'wq', whyThisChanged: 'up', whatToDoNext: 'keep going' },
        },
        {
          id: 'week_accuracy',
          label: 'Accuracy (7d)',
          kind: 'diagnostic',
          unit: 'percent',
          value: 80,
          explanation: { ruleId: 'RULE_WEEK_ACCURACY', whatThisMeans: 'wa', whyThisChanged: 'up', whatToDoNext: 'keep going' },
        },
        {
          id: 'recency_accuracy',
          label: 'Accuracy (last 200 attempts)',
          kind: 'diagnostic',
          unit: 'percent',
          value: 78,
          explanation: { ruleId: 'RULE_RECENCY_ACCURACY', whatThisMeans: 'ra', whyThisChanged: 'flat', whatToDoNext: 'maintain' },
        },
      ],
      gating: {
        historicalTrends: { allowed: true, requiredPlan: 'paid', reason: 'allowed' },
      },
      measurementModel: {
        official: [],
        weighted: [],
        diagnostic: ['week_minutes', 'week_sessions', 'week_questions', 'week_accuracy', 'recency_accuracy'],
      },
    });
    kpiMocks.buildStudentFullLengthReportView.mockImplementation((report: any) => report);
    kpiMocks.projectGuardianFullLengthReportView.mockImplementation((view: any) => view);
    weaknessViewMocks.buildWeaknessSkillsView.mockResolvedValue({ ok: true, count: 0, skills: [] });
    calendarMocks.buildCalendarMonthView.mockResolvedValue({
      days: [
        {
          day_date: '2026-03-01',
          planned_minutes: 45,
          completed_minutes: 30,
          status: 'in_progress',
          attempt_count: 1,
          accuracy: 100,
          avg_seconds_per_question: 120,
          focus: [{ section: 'Math' }],
          tasks: [{ type: 'practice' }],
          plan_version: 3,
          is_user_override: true,
        },
      ],
      streak: { current: 2, longest: 4 },
    });
  });

  it('returns linked students list and emits guardian_dashboard_viewed', async () => {
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.students)).toBe(true);
    expect(response.body.students).toHaveLength(1);
    expect(response.body.students[0]).toMatchObject({
      id: 'student-1',
      display_name: 'Student One',
    });

    const dashboardViewed = systemEventInserts.find((row) => row.event_type === 'guardian_dashboard_viewed');
    expect(dashboardViewed).toBeDefined();
    expect(dashboardViewed).toMatchObject({
      user_id: 'guardian-1',
      details: expect.objectContaining({
        linked_student_count: 1,
      }),
    });
  });

  it('fails closed when guardian link source lookup fails for students list', async () => {
    accountMocks.getAllGuardianStudentLinks.mockRejectedValueOnce(new Error('guardian_links_source_failed'));
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error');
    const dashboardViewed = systemEventInserts.find((row) => row.event_type === 'guardian_dashboard_viewed');
    expect(dashboardViewed).toBeUndefined();
  });

  it('fails closed on unlink conflict when link is no longer active and does not emit unlink success audit', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    const conflict = new Error('Guardian link is not active') as Error & { code?: string };
    conflict.code = 'LINK_NOT_ACTIVE';
    accountMocks.revokeGuardianLink.mockRejectedValueOnce(conflict);
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).delete('/api/guardian/link/student-1');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LINK_NOT_ACTIVE');
    const unlinkSuccess = guardianAuditInserts.find((row: any) => row.action === 'unlink_success' && row.outcome === 'success');
    expect(unlinkSuccess).toBeUndefined();
  });

  it('keeps valid unlink transition behavior and emits unlink success audit', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.revokeGuardianLink.mockResolvedValueOnce(undefined);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValueOnce([]);
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).delete('/api/guardian/link/student-1');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.students).toEqual([]);
    const unlinkSuccess = guardianAuditInserts.find((row: any) => row.action === 'unlink_success' && row.outcome === 'success');
    expect(unlinkSuccess).toBeDefined();
    expect(unlinkSuccess).toMatchObject({
      guardian_profile_id: 'guardian-1',
      student_profile_id: 'student-1',
    });
  });

  it('denies non-guardian users at guardian reporting routes', async () => {
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('student');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/summary');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Guardian role required');
  });

  it('denies entitlement-gated summary surfaces when entitlement check fails', async () => {
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app)
      .get('/api/guardian/students/student-1/summary')
      .set('x-entitled', 'false');

    expect(response.status).toBe(402);
    expect(response.body.code).toBe('PAYMENT_REQUIRED');
  });

  it('returns guardian-safe summary payload and emits guardian_report_viewed', async () => {
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/summary');

    expect(response.status).toBe(200);
    expect(response.body.student).toEqual({
      id: 'student-1',
      displayName: 'Student One',
    });
    expect(response.body.student.email).toBeUndefined();
    expect(response.body.questions).toBeUndefined();
    expect(response.body.correct_answer).toBeUndefined();
    expect(response.body.explanation).toBeUndefined();
    expect(response.body.tutorInteractions).toBeUndefined();
    expect(response.body.mastery_score).toBeUndefined();
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledTimes(1);
    expect(kpiMocks.buildStudentKpiViewFromCanonical).toHaveBeenCalledWith('student-1', true);
    expect(response.body.progress).toEqual({
      practiceMinutesLast7Days: 120,
      sessionsLast7Days: 4,
      questionsAttempted: 30,
      accuracy: 80,
      explanations: {
        week_minutes: expect.objectContaining({ ruleId: 'RULE_WEEK_MINUTES' }),
        week_sessions: expect.objectContaining({ ruleId: 'RULE_WEEK_SESSIONS' }),
        week_questions: expect.objectContaining({ ruleId: 'RULE_WEEK_QUESTIONS' }),
        week_accuracy: expect.objectContaining({ ruleId: 'RULE_WEEK_ACCURACY' }),
      },
    });
    expect(response.body.metrics.map((metric: any) => metric.id)).toEqual([
      'week_minutes',
      'week_sessions',
      'week_questions',
      'week_accuracy',
    ]);
    expect(response.body.metrics.find((metric: any) => metric.id === 'week_minutes')?.value).toBe(120);
    expect(response.body.metrics.find((metric: any) => metric.id === 'week_sessions')?.value).toBe(4);
    expect(response.body.metrics.find((metric: any) => metric.id === 'week_questions')?.value).toBe(30);
    expect(response.body.metrics.find((metric: any) => metric.id === 'week_accuracy')?.value).toBe(80);
    expect(response.body.measurementModel).toEqual({
      official: [],
      weighted: [],
      diagnostic: ['week_minutes', 'week_sessions', 'week_questions', 'week_accuracy'],
    });
    expect(response.body.metrics.find((metric: any) => metric.id === 'recency_accuracy')).toBeUndefined();

    const reportViewed = systemEventInserts.find((row) => row.event_type === 'guardian_report_viewed');
    expect(reportViewed).toBeDefined();
    expect(reportViewed).toMatchObject({
      user_id: 'guardian-1',
      details: expect.objectContaining({
        student_id: 'student-1',
        surface: 'summary',
      }),
    });
  });

  it('returns guardian-safe calendar payload and emits guardian_calendar_viewed', async () => {
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.days)).toBe(true);
    expect(response.body.days.length).toBeGreaterThan(0);

    const day = response.body.days[0];
    expect(day).toMatchObject({
      day_date: '2026-03-01',
      planned_minutes: 45,
      completed_minutes: 30,
      status: 'in_progress',
      attempt_count: 1,
      accuracy: 100,
    });
    expect(day.focus).toBeUndefined();
    expect(day.tasks).toBeUndefined();
    expect(day.plan_version).toBeUndefined();
    expect(day.is_user_override).toBeUndefined();
    expect(calendarMocks.buildCalendarMonthView).toHaveBeenCalledWith('student-1', '2026-03-01', '2026-03-31', 'America/Chicago');

    const calendarViewed = systemEventInserts.find((row) => row.event_type === 'guardian_calendar_viewed');
    expect(calendarViewed).toBeDefined();
    expect(calendarViewed).toMatchObject({
      user_id: 'guardian-1',
      details: expect.objectContaining({
        student_id: 'student-1',
        surface: 'calendar',
      }),
    });
  });

  it('fails closed when canonical student KPI snapshot source fails', async () => {
    kpiMocks.buildStudentKpiViewFromCanonical.mockRejectedValueOnce(new Error('snapshot_failed'));
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/summary');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error');
    const reportViewed = systemEventInserts.find((row) => row.event_type === 'guardian_report_viewed');
    expect(reportViewed).toBeUndefined();
  });

  it('fails closed when canonical student calendar source fails', async () => {
    calendarMocks.buildCalendarMonthView.mockRejectedValueOnce(new Error('calendar_source_failed'));
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error');
    const calendarViewed = systemEventInserts.find((row) => row.event_type === 'guardian_calendar_viewed');
    expect(calendarViewed).toBeUndefined();
  });

  it('fails closed when calendar timezone source query fails', async () => {
    profileSelectError = { message: 'profile_timezone_query_failed' };
    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/calendar/month?start=2026-03-01&end=2026-03-31');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Failed to load calendar data');
    const calendarViewed = systemEventInserts.find((row) => row.event_type === 'guardian_calendar_viewed');
    expect(calendarViewed).toBeUndefined();
  });

  it('fails closed when canonical weakness view source fails', async () => {
    weaknessViewMocks.buildWeaknessSkillsView.mockRejectedValueOnce(new Error('weakness_view_failed'));

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/weaknesses/student-1');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Internal server error');
    const weaknessViewed = systemEventInserts.find((row) =>
      row.event_type === 'guardian_report_viewed'
      && (row.details as any)?.surface === 'weaknesses');
    expect(weaknessViewed).toBeUndefined();
  });

  it('returns canonical student weakness view payload', async () => {
    weaknessViewMocks.buildWeaknessSkillsView.mockResolvedValueOnce({
      ok: true,
      count: 1,
      skills: [
        {
          section: 'math',
          domain: 'Algebra',
          skill: 'Linear Equations',
          attempts: 8,
          correct: 2,
          accuracy: 0.25,
          mastery_score: 25,
        },
      ],
    });

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/weaknesses/student-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      count: 1,
      skills: [
        expect.objectContaining({
          section: 'math',
          domain: 'Algebra',
          skill: 'Linear Equations',
          attempts: 8,
          correct: 2,
          accuracyPercent: 25,
          status: 'weak',
        }),
      ],
    }));
    expect(weaknessViewMocks.buildWeaknessSkillsView).toHaveBeenCalledWith({
      userId: 'student-1',
      section: undefined,
      limit: undefined,
      minAttempts: undefined,
    });
    const weaknessViewed = systemEventInserts.find((row) =>
      row.event_type === 'guardian_report_viewed'
      && (row.details as any)?.surface === 'weaknesses');
    expect(weaknessViewed).toBeDefined();
  });

  it('projects guardian weakness output without raw mastery internals', async () => {
    weaknessViewMocks.buildWeaknessSkillsView.mockResolvedValue({
      ok: true,
      count: 2,
      skills: [
        {
          section: 'math',
          domain: 'Algebra',
          skill: 'Linear Equations',
          attempts: 8,
          correct: 2,
          accuracy: 0.25,
          mastery_score: 25,
        },
        {
          section: 'rw',
          domain: 'Information and Ideas',
          skill: 'Main Idea',
          attempts: 6,
          correct: 3,
          accuracy: 0.5,
          mastery_score: 50,
        },
      ],
    });

    const { weaknessRouter } = await import('../../apps/api/src/routes/weakness');
    const studentApp = express();
    studentApp.use(express.json());
    studentApp.use((req: any, _res, next) => {
      req.user = { id: 'student-1', role: 'student', isGuardian: false, isAdmin: false };
      next();
    });
    studentApp.use('/api/me/weakness', weaknessRouter);

    const guardianRouter = (await import('../../server/routes/guardian-routes')).default;
    const guardianApp = buildApp('guardian');
    guardianApp.use('/api/guardian', guardianRouter);

    const studentResponse = await request(studentApp).get('/api/me/weakness/skills');
    const guardianResponse = await request(guardianApp).get('/api/guardian/weaknesses/student-1');

    expect(studentResponse.status).toBe(200);
    expect(guardianResponse.status).toBe(200);
    expect(guardianResponse.body.skills[0].mastery_score).toBeUndefined();
    expect(guardianResponse.body.skills[0].accuracyPercent).toBe(25);
    expect(guardianResponse.body.skills[0].status).toBe('weak');
    expect(guardianResponse.body.skills[1].accuracyPercent).toBe(50);
    expect(guardianResponse.body.skills[1].status).toBe('improving');
  });

  it('denies unlinked guardian summary requests and emits denied event', async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(false);

    const router = (await import('../../server/routes/guardian-routes')).default;
    const app = buildApp('guardian');
    app.use('/api/guardian', router);

    const response = await request(app).get('/api/guardian/students/student-1/summary');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Student not found');

    const denied = systemEventInserts.find((row) => row.event_type === 'guardian_access_denied');
    expect(denied).toBeDefined();
    expect(denied).toMatchObject({
      user_id: 'guardian-1',
      details: expect.objectContaining({
        student_id: 'student-1',
        surface: 'summary',
        reason: 'not_linked',
      }),
    });
  });
});

