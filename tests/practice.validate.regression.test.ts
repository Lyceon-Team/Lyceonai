import request from 'supertest';
import app from '../server/index';

<<<<<<< HEAD
describe('Legacy Questions Validate Path Quarantine', () => {
  it('returns 404 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Origin', 'http://localhost:5000')
      .send({ questionId: 'q1', studentAnswer: 'B' });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
    expect(res.body).not.toHaveProperty('correct_answer');
    expect(res.body).not.toHaveProperty('answer_text');
  });

  it('returns 404 even with bearer auth', async () => {
=======
// Minimal mocking utilities
const mockSupabaseServer = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  single: jest.fn(),
};

describe('Practice/Questions Validate Security Regression', () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../server/routes/questions-validate', () => {
      // Re-require the real module but override supabaseServer
      const real = jest.requireActual('../server/routes/questions-validate');
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
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Cookie', fakeCookie)
      .send({ questionId: 'q1', studentAnswer: 'B' });
<<<<<<< HEAD

    expect(res.status).toBe(404);
=======
    // Assert: no correctAnswerKey or explanation
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
    // Assert: has isCorrect and feedback
    expect(res.body).toHaveProperty('isCorrect');
    expect(res.body).toHaveProperty('feedback');
  });
});

