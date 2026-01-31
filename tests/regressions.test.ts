import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { resolveTokenFromRequest } from '../server/middleware/supabase-auth';

// --- AUTH-001: Bearer rejection ---
describe('AUTH-001: Cookie-only auth for user-facing routes', () => {
  it('rejects Authorization: Bearer for user auth (resolveTokenFromRequest)', () => {
    const req: any = {
      headers: { authorization: 'Bearer faketoken' },
      cookies: {},
      get: () => undefined,
    };
    const result = resolveTokenFromRequest(req);
    expect(result.token).toBeNull();
    expect(result.tokenSource).toBe('bearer');
  });

  it('accepts sb-access-token cookie and ignores missing bearer', () => {
    const req: any = {
      headers: {},
      cookies: { 'sb-access-token': 'cookie_token_12345678901234567890' },
      get: () => undefined,
    };
    const result = resolveTokenFromRequest(req);
    expect(result.token).toBe('cookie_token_12345678901234567890');
    expect(result.tokenSource).toBe('cookie:sb-access-token');
  });

  it('middleware does not attach req.user for bearer-only', async () => {
    // Minimal express app with supabaseAuthMiddleware
    const { supabaseAuthMiddleware } = await import('../server/middleware/supabase-auth');
    const app = express();
    app.use(express.json());
    app.use(supabaseAuthMiddleware);
    app.get('/test', (req, res) => {
      res.json({ user: req.user || null });
    });
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer faketoken');
    expect(res.body.user).toBeNull();
  });

  it('middleware attaches req.user for valid cookie', async () => {
    // Mock supabaseAnon.auth.getUser to always return a user
    jest.resetModules();
    jest.doMock('@supabase/supabase-js', () => {
      const real = jest.requireActual('@supabase/supabase-js');
      return {
        ...real,
        createClient: () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } }, error: null }),
          },
          from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'u1', email: 'a@b.com', role: 'student' }, error: null }) }) }) }),
        }),
      };
    });
    const { supabaseAuthMiddleware } = await import('../server/middleware/supabase-auth');
    const app = express();
    app.use(express.json());
    app.use(supabaseAuthMiddleware);
    app.get('/test', (req, res) => {
      res.json({ user: req.user || null });
    });
    const res = await request(app)
      .get('/test')
      .set('Cookie', 'sb-access-token=cookie_token_12345678901234567890');
    expect(res.body.user).not.toBeNull();
    expect(res.body.user.id).toBe('u1');
  });
});

// --- PRAC-001: /api/questions/validate must not leak answers ---
describe('PRAC-001: /api/questions/validate response security', () => {
  it('student: response has isCorrect/feedback, not correctAnswerKey/explanation', async () => {
    vi.resetModules();
    // Mock supabaseServer for questions-validate
    vi.doMock('../server/routes/questions-validate', () => {
      const real = vi.importActual('../server/routes/questions-validate');
      return {
        ...real,
        supabaseServer: {
          from: () => ({
            select: () => ({
              eq: () => ({
                limit: () => ({
                  single: async () => ({
                    data: {
                      id: 'q1', question_type: 'mc', type: 'mc', answer_choice: 'A', answer_text: '42', answer: 'A', explanation: 'The answer is A because...'
                    },
                    error: null
                  })
                })
              })
            })
          })
        }
      };
    });
    const { validateAnswer } = await import('../server/routes/questions-validate');
    const app = express();
    app.use(express.json());
    // Fake auth injection
    app.use((req, _res, next) => {
      req.user = { id: 'u1', role: 'student', isAdmin: false, isGuardian: false };
      next();
    });
    app.post('/api/questions/validate', validateAnswer);
    const res = await request(app)
      .post('/api/questions/validate')
      .send({ questionId: 'q1', studentAnswer: 'B' });
    expect(res.body).toHaveProperty('isCorrect');
    expect(res.body).toHaveProperty('feedback');
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
  });

  it('guardian: response is 403', async () => {
    vi.resetModules();
    const { validateAnswer } = await import('../server/routes/questions-validate');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 'u2', role: 'guardian', isAdmin: false, isGuardian: true };
      next();
    });
    app.post('/api/questions/validate', validateAnswer);
    const res = await request(app)
      .post('/api/questions/validate')
      .send({ questionId: 'q1', studentAnswer: 'B' });
    expect(res.status).toBe(403);
  });
});

// --- PRAC-002: Tutor prompt must not leak answers/explanations ---
describe('PRAC-002: /api/tutor/v2 prompt security', () => {
  it('student: prompt does not include answer/explanation', async () => {
    jest.resetModules();
    // Mock RAG service and LLM call
    const mockRagService = {
      handleRagQuery: async () => ({
        context: {
          primaryQuestion: {
            stem: 'What is 2+2?',
            answer: '4',
            explanation: 'Because 2+2=4',
            canonicalId: 'q1',
            options: [
              { key: 'A', text: '3' },
              { key: 'B', text: '4' },
            ],
          },
          supportingQuestions: [
            { stem: 'What is 1+1?', answer: '2', explanation: 'Simple math', options: [] },
          ],
          competencyContext: { studentWeakAreas: [], studentStrongAreas: [], competencyLabels: [] },
          studentProfile: { overallLevel: 3 },
        },
        metadata: { canonicalIdsUsed: ['q1'] },
      })
    };
    const mockCallLlm = jest.fn().mockResolvedValue('LLM response');
    jest.doMock('../server/routes/tutor-v2', () => {
      const real = jest.requireActual('../server/routes/tutor-v2');
      return {
        ...real,
        getRagService: () => mockRagService,
        callLlm: mockCallLlm,
      };
    });
    const { default: tutorV2Router } = await import('../server/routes/tutor-v2');
    const app = express();
    app.use(express.json());
    // Fake auth injection
    app.use((req, _res, next) => {
      req.user = { id: 'u1', role: 'student', isAdmin: false, isGuardian: false };
      next();
    });
    app.use('/api/tutor/v2', tutorV2Router);
    await request(app)
      .post('/api/tutor/v2')
      .send({ userId: 'u1', message: 'Help me', mode: 'question' });
    // Assert: prompt passed to LLM does not leak answers/explanations
    const prompt = mockCallLlm.mock.calls[0][0];
    expect(prompt).not.toMatch(/the answer is/i);
    expect(prompt).not.toMatch(/because 2\+2=4/i);
    expect(prompt).not.toMatch(/correctAnswerKey/i);
    expect(prompt).not.toMatch(/explanation/i);
    expect(prompt).not.toMatch(/4/);
  });
});

// --- PRAC-003: Practice session ownership enforced ---
describe('PRAC-003: /api/practice/answer session ownership', () => {
  it('returns 403 and does not grade/insert if session does not belong to user', async () => {
    jest.resetModules();
    // Mock supabaseServer for session check and grading/insert
    const mockInsert = jest.fn();
    jest.doMock('../server/routes/practice-canonical', () => {
      const real = jest.requireActual('../server/routes/practice-canonical');
      return {
        ...real,
        supabaseServer: {
          from: (table: string) => {
            if (table === 'practice_sessions') {
              return {
                select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'sess1', user_id: 'userB' }, error: null }) }) })
              };
            }
            if (table === 'answer_attempts') {
              return { insert: mockInsert };
            }
            return { select: () => ({}) };
          }
        }
      };
    });
    const { default: router } = await import('../server/routes/practice-canonical');
    const app = express();
    app.use(express.json());
    // Fake auth injection
    app.use((req, _res, next) => {
      req.user = { id: 'userA', role: 'student', isAdmin: false, isGuardian: false };
      next();
    });
    app.use('/api/practice', router);
    const res = await request(app)
      .post('/api/practice/answer')
      .send({ sessionId: 'sess1', questionId: 'q1', selectedAnswer: 'A' });
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
