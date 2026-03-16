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
  buildCanonicalPracticeKpiSnapshot: vi.fn(),
  buildGuardianSummaryKpiView: vi.fn(),
  buildFullTestKpis: vi.fn(),
  fullTestMeasurementModel: vi.fn(),
};

const systemEventInserts: Record<string, unknown>[] = [];

class FakeSelectBuilder {
  private readonly rows: any[];

  constructor(rows: any[]) {
    this.rows = rows;
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
    const row = this.rows[0] ?? null;
    if (!row) {
      return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
    }
    return { data: row, error: null };
  }

  async maybeSingle() {
    return { data: this.rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled ?? undefined, onrejected ?? undefined);
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
          insert: async () => ({ error: null }),
        };
      }

      const rows = (seed as Record<string, any[]>)[table] ?? [];
      return {
        select: () => new FakeSelectBuilder([...rows]),
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
vi.mock('../../apps/api/src/services/mastery-derived', () => ({
  getDerivedWeaknessSignals: vi.fn(async () => []),
}));
vi.mock('../../server/services/kpi-truth-layer', () => kpiMocks);

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
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);

    kpiMocks.buildCanonicalPracticeKpiSnapshot.mockResolvedValue({
      modelVersion: 'kpi-v1',
      progress: {},
      metrics: [],
    });
    kpiMocks.buildGuardianSummaryKpiView.mockReturnValue({
      progress: {
        practiceMinutesLast7Days: 120,
        sessionsLast7Days: 4,
        questionsAttempted: 30,
        accuracy: 80,
      },
      metrics: [],
      measurementModel: {
        version: '2026-03-guardian-summary',
      },
    });
    kpiMocks.buildFullTestKpis.mockReturnValue([]);
    kpiMocks.fullTestMeasurementModel.mockReturnValue({ version: '2026-03-full-test' });
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

