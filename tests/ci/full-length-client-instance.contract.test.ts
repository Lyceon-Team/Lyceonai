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
      req.requestId ??= 'req-full-length-client-conflict';
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

describe('Full-Length Client Instance Conflict Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 when submitAnswer is attempted by a different client instance', async () => {
    serviceMocks.submitAnswer.mockRejectedValue(new Error('Session client instance conflict'));

    const router = (await import('../../server/routes/full-length-exam-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/full-length', router);

    const res = await request(app)
      .post('/api/full-length/sessions/550e8400-e29b-41d4-a716-446655440000/answer')
      .send({
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        selectedAnswer: 'A',
        client_instance_id: '550e8400-e29b-41d4-a716-446655440002',
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'Session client instance conflict',
      requestId: 'req-full-length-client-conflict',
    });
  });

  it('returns 409 when duplicate answer submit replays with a conflicting answer', async () => {
    serviceMocks.submitAnswer.mockRejectedValue(new Error('Answer already submitted with different selection'));

    const router = (await import('../../server/routes/full-length-exam-routes')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/full-length', router);

    const res = await request(app)
      .post('/api/full-length/sessions/550e8400-e29b-41d4-a716-446655440000/answer')
      .send({
        questionId: '550e8400-e29b-41d4-a716-446655440001',
        selectedAnswer: 'B',
        client_instance_id: '550e8400-e29b-41d4-a716-446655440002',
        client_attempt_id: '550e8400-e29b-41d4-a716-446655440003',
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'Duplicate answer submission',
      requestId: 'req-full-length-client-conflict',
    });
  });
});
