process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role-key';
import request from 'supertest';
import app from '../server/index';

import { vi } from 'vitest';
// Minimal mocking utilities
const mockSupabaseServer = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

describe('Practice/Questions Validate Security Regression', () => {
  beforeAll(() => {
    vi.resetModules();
    vi.doMock('../server/routes/questions-validate', () => {
      // Re-require the real module but override supabaseServer
      const real = vi.importActual('../server/routes/questions-validate');
      return {
        ...real,
        __esModule: true,
        // Patch supabaseServer for test
        supabaseServer: mockSupabaseServer,
      };
    });
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
