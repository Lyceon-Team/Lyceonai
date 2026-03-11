import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

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
      req.requestId ??= 'req-full-length-review-lock';
      next();
    },
  };
});

vi.mock('../../server/middleware/csrf', () => ({
  csrfGuard: () => (_req: any, _res: any, next: any) => next(),
}));

const serviceMocks = {
  createExamSession: vi.fn(),
  getCurrentSession: vi.fn(),
  startExam: vi.fn(),
  submitAnswer: vi.fn(),
  submitModule: vi.fn(),
  continueFromBreak: vi.fn(),
  completeExam: vi.fn(),
  getExamReport: vi.fn(),
  getExamReviewAfterCompletion: vi.fn(),
};

vi.mock('../../apps/api/src/services/fullLengthExam', () => serviceMocks);

describe('Full-Length Review Lock Route Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 423 when review is requested before completion', async () => {
    serviceMocks.getExamReviewAfterCompletion.mockRejectedValue(new Error('Review locked until completion'));

    const router = (await import('../../server/routes/full-length-exam-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/full-length', router);

    const res = await request(app).get('/api/full-length/sessions/session-locked/review');

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ error: 'Review locked until completion', requestId: 'req-full-length-review-lock' });
  });
});

