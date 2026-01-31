import request from 'supertest';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { hasSupabaseSecrets, supabaseSkipMessage } from './helpers/supabaseEnv';

// Minimal mocking utilities
const mockSupabaseServer = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

let app: typeof import('../server/index').default;

if (!hasSupabaseSecrets()) {
  describe.skip('Practice/Questions Validate Security Regression', () => {
    it(supabaseSkipMessage(), () => {});
  });
} else {
  describe('Practice/Questions Validate Security Regression', () => {
    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../server/routes/questions-validate', async () => {
        const real = await vi.importActual('../server/routes/questions-validate');
        return {
          ...(real as any),
          __esModule: true,
          supabaseServer: mockSupabaseServer,
        };
      });

      const mod = await import('../server/index');
      app = mod.default;
    });

  it('PRAC-001: does not leak correctAnswerKey or explanation to students', async () => {
    // Arrange: mock DB response for a question
    mockSupabaseServer.single.mockResolvedValueOnce({
      data: {
        id: 'q1',
        question_type: 'mc',
        type: 'mc',
        answer_choice: 'A',
        answer_text: '42',
        answer: 'A',
        explanation: 'The answer is A because...',
      },
      error: null,
    });
    // Simulate student user
    const fakeCookie = 'sb-access-token=fakevalidtoken';
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Cookie', fakeCookie)
      .send({ questionId: 'q1', studentAnswer: 'B' });
    // Assert: no correctAnswerKey or explanation
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
    // Assert: has isCorrect and feedback
    expect(res.body).toHaveProperty('isCorrect');
    expect(res.body).toHaveProperty('feedback');
  });
  });
}
