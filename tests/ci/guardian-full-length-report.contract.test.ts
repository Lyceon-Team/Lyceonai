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
});

