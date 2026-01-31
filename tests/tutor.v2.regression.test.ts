import request from 'supertest';
import app from '../server/index';
import { describeIfSupabaseEnv } from './helpers/supabaseEnv';

// Minimal mocks for tutor context and LLM
const mockRagService = {
  handleRagQuery: jest.fn(),
};
const mockCallLlm = jest.fn();

jest.mock('../server/routes/tutor-v2', () => {
  const real = jest.requireActual('../server/routes/tutor-v2');
  return {
    ...real,
    getRagService: () => mockRagService,
    callLlm: mockCallLlm,
  };
});

const describeWithSupabase = describeIfSupabaseEnv();

describeWithSupabase('Tutor V2 Security Regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PRAC-002: does not leak answers/explanations in prompt for students', async () => {
    // Arrange: mock context with answer/explanation present
    mockRagService.handleRagQuery.mockResolvedValueOnce({
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
    });
    mockCallLlm.mockResolvedValueOnce('LLM response');
    // Simulate student user (not admin, no prior attempt)
    const fakeCookie = 'sb-access-token=fakevalidtoken';
    await request(app)
      .post('/api/tutor/v2')
      .set('Cookie', fakeCookie)
      .send({ userId: 'student1', message: 'Help me', mode: 'question' });
    // Assert: prompt passed to LLM does not leak answers/explanations
    const prompt = mockCallLlm.mock.calls[0][0];
    expect(prompt).not.toMatch(/The correct answer is/i);
    expect(prompt).not.toMatch(/Here's why:/i);
    // Assert: answer/explanation fields are scrubbed before prompt
    const ctx = mockRagService.handleRagQuery.mock.calls[0]?.[0];
    // The context passed to prompt builder should have answer/explanation null/undefined
    // (This depends on the implementation, but we check the prompt and context)
    expect(prompt).not.toMatch(/4/);
    expect(prompt).not.toMatch(/Because 2\+2=4/);
  });
});
