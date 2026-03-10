/**
 * Practice Contract Validation Test
 *
 * Validates canonical practice runtime behavior:
 * 1. Refresh resumes the same unanswered item
 * 2. Duplicate answer submit returns prior result (idempotency)
 * 3. Second tab gets conflict behavior using client_instance_id
 * 4. No correct_answer or explanation pre-submit (anti-leak)
 * 5. Invalid canonical/schema/answer cases fail safely
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express, Request, Response, NextFunction } from 'express';
import { supabaseServer } from '../../apps/api/src/lib/supabase-server';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000000';

vi.mock('../../apps/api/src/lib/supabase-server', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    supabaseServer: {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    },
  };
});

describe('Practice Runtime Contract', () => {
  let app: Express;

  const mockQuestion = {
    id: '00000000-0000-0000-0000-000000000001',
    canonical_id: 'SATM1ABC123',
    section: 'Math',
    stem: 'What is 1+1?',
    type: 'mc',
    options: JSON.stringify([{ key: 'A', text: '2' }, { key: 'B', text: '3' }]),
    answer_choice: 'A',
    explanation: '1+1=2',
    created_at: new Date().toISOString(),
  };

  const mockSession = {
    id: '00000000-0000-0000-0000-000000000002',
    user_id: TEST_USER_ID,
    section: 'Math',
    status: 'in_progress',
    metadata: { client_instance_id: 'tab1', active_question_id: '00000000-0000-0000-0000-000000000001' },
  };

  function createMockBuilder() {
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation(function (cb: any) {
        return Promise.resolve(cb({ data: [], error: null }));
      }),
    };
    return builder;
  }

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    const authModule = await import('../../server/middleware/supabase-auth');
    vi.spyOn(authModule, 'supabaseAuthMiddleware').mockImplementation(
      (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: TEST_USER_ID, email: 'contract-test@example.com', role: 'student' };
        next();
      }
    );
    vi.spyOn(authModule, 'requireSupabaseAuth').mockImplementation((_req, _res, next) => next());
    vi.spyOn(authModule, 'requireStudentOrAdmin').mockImplementation((_req, _res, next) => next());

    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  afterAll(async () => {
    delete process.env.VITEST;
    vi.restoreAllMocks();
  });

  it('CONTRACT-001: neutralizes correct_answer and explanation in /next', async () => {
    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.maybeSingle.mockResolvedValue({ data: null, error: null });
        builder.single.mockResolvedValue({ data: mockSession, error: null });
      } else if (table === 'questions') {
        builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [mockQuestion], error: null })));
      } else if (table === 'answer_attempts') {
        builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [], error: null })));
      }
      return builder;
    });

    const res = await request(app)
      .get('/api/practice/next?section=math&client_instance_id=tab1')
      .set('Origin', 'http://localhost:5000');

    expect(res.status).toBe(200);
    expect(res.body.question).toBeDefined();
    expect(res.body.question.correct_answer).toBeNull();
    expect(res.body.question.explanation).toBeNull();
    expect(res.body.question.answer_choice).toBeUndefined();
  });

  it('CONTRACT-002: resumes the same unanswered item on refresh', async () => {
    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.maybeSingle.mockResolvedValue({ data: mockSession, error: null });
        builder.update.mockResolvedValue({ error: null });
      } else if (table === 'answer_attempts') {
        builder.maybeSingle.mockResolvedValue({ data: null, error: null });
        builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [], error: null })));
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({ data: mockQuestion, error: null });
      }
      return builder;
    });

    const res = await request(app)
      .get('/api/practice/next?section=math&client_instance_id=tab1')
      .set('Origin', 'http://localhost:5000');

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(mockSession.id);
    expect(res.body.question.id).toBe(mockQuestion.id);
  });

  it('CONTRACT-003: returns 409 when second tab attempts submission', async () => {
    const sessionTakenOver = { ...mockSession, metadata: { client_instance_id: 'tab2' } };

    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.single.mockResolvedValue({ data: sessionTakenOver, error: null });
      } else if (table === 'answer_attempts') {
        builder.maybeSingle.mockResolvedValue({ data: null, error: null });
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({ data: mockQuestion, error: null });
      }
      return builder;
    });

    const res = await request(app)
      .post('/api/practice/answer')
      .set('Origin', 'http://localhost:5000')
      .send({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        selectedAnswer: 'A',
        client_instance_id: 'tab1',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
  });

  it('CONTRACT-004: duplicate answer submissions remain idempotent', async () => {
    const idempotencyKey = 'ik-fixed';
    const successfulAttempt = { is_correct: true, outcome: 'correct', attempted_at: new Date().toISOString() };

    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.single.mockResolvedValue({ data: mockSession, error: null });
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({ data: mockQuestion, error: null });
      } else if (table === 'answer_attempts') {
        builder.insert.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } });
        builder.single.mockResolvedValue({ data: successfulAttempt, error: null });
        builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [successfulAttempt], error: null })));
      }
      return builder;
    });

    const res = await request(app)
      .post('/api/practice/answer')
      .set('Origin', 'http://localhost:5000')
      .send({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        selectedAnswer: 'A',
        idempotencyKey,
        client_instance_id: 'tab1',
      });

    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.idempotentRetried).toBe(true);
  });

  it('CONTRACT-005: invalid canonical ID hard-fails safely', async () => {
    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.single.mockResolvedValue({ data: mockSession, error: null });
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({
          data: { ...mockQuestion, canonical_id: 'INVALID001' },
          error: null,
        });
      } else if (table === 'answer_attempts') {
        builder.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      return builder;
    });

    const res = await request(app)
      .post('/api/practice/answer')
      .set('Origin', 'http://localhost:5000')
      .send({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        selectedAnswer: 'A',
        client_instance_id: 'tab1',
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_question_data');
  });

  it('CONTRACT-006: invalid selectedAnswer key hard-fails safely', async () => {
    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.single.mockResolvedValue({ data: mockSession, error: null });
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({ data: mockQuestion, error: null });
      } else if (table === 'answer_attempts') {
        builder.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      return builder;
    });

    const res = await request(app)
      .post('/api/practice/answer')
      .set('Origin', 'http://localhost:5000')
      .send({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        selectedAnswer: 'Z',
        client_instance_id: 'tab1',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_answer');
  });

  it('CONTRACT-007: post-submit reveal returns correct answer and explanation in practice', async () => {
    (supabaseServer.from as any).mockImplementation((table: string) => {
      const builder = createMockBuilder();
      if (table === 'practice_sessions') {
        builder.single.mockResolvedValue({ data: mockSession, error: null });
      } else if (table === 'questions') {
        builder.single.mockResolvedValue({ data: mockQuestion, error: null });
      } else if (table === 'answer_attempts') {
        builder.insert.mockResolvedValue({ error: null });
        builder.then.mockImplementation((cb: any) => Promise.resolve(cb({ data: [{ is_correct: true, outcome: 'correct' }], error: null })));
      } else if (table === 'practice_events') {
        builder.insert.mockResolvedValue({ error: null });
      }
      return builder;
    });

    const res = await request(app)
      .post('/api/practice/answer')
      .set('Origin', 'http://localhost:5000')
      .send({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        selectedAnswer: 'A',
        client_instance_id: 'tab1',
      });

    expect(res.status).toBe(200);
    expect(res.body.correctAnswerKey).toBe('A');
    expect(res.body.explanation).toBe('1+1=2');
  });

  it('CONTRACT-008: full-length review remains separate from practice reveal', async () => {
    const res = await request(app)
      .get('/api/full-length/sessions/session-review-1/review')
      .set('Origin', 'http://localhost:5000');

    expect([423, 404, 500]).toContain(res.status);
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('isCorrect');
  });
});
