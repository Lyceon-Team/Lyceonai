import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasSupabaseSecrets, supabaseSkipMessage } from './helpers/supabaseEnv';

const {
  handleRagQueryMock,
  callLlmMock,
  updateStudentStyleMock,
  logTutorInteractionMock,
  supabaseServerMock,
} = vi.hoisted(() => ({
  handleRagQueryMock: vi.fn(),
  callLlmMock: vi.fn(),
  updateStudentStyleMock: vi.fn(),
  logTutorInteractionMock: vi.fn(),
  supabaseServerMock: { from: vi.fn() },
}));

vi.mock('../../apps/api/src/lib/rag-service', () => ({
  getRagService: () => ({ handleRagQuery: handleRagQueryMock })
}));
vi.mock('../../apps/api/src/lib/embeddings', () => ({
  callLlm: callLlmMock
}));
vi.mock('../../apps/api/src/lib/profile-service', () => ({
  updateStudentStyle: updateStudentStyleMock
}));
vi.mock('../../apps/api/src/lib/tutor-log', () => ({
  logTutorInteraction: logTutorInteractionMock
}));
vi.mock('../../apps/api/src/lib/supabase-server', () => ({
  supabaseServer: supabaseServerMock
}));

if (!hasSupabaseSecrets()) {
  describe.skip('Tutor V2 Security Regression', () => {
    it(supabaseSkipMessage(), () => {});
  });
} else {
  describe('Tutor V2 Security Regression', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('PRAC-002: does not leak answers/explanations in prompt for students', async () => {
      handleRagQueryMock.mockResolvedValueOnce({
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
          studentProfile: { overallLevel: 3, explanationLevel: 2, primaryStyle: null, secondaryStyle: null },
        },
        metadata: { canonicalIdsUsed: ['q1'] },
      });
      callLlmMock.mockResolvedValueOnce('LLM response');
      updateStudentStyleMock.mockResolvedValueOnce(true);
      logTutorInteractionMock.mockResolvedValueOnce(undefined);
      supabaseServerMock.from.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                single: async () => ({ data: null, error: null })
              })
            })
          })
        })
      }));

      const { default: router } = await import('../server/routes/tutor-v2');
      const req: any = {
        user: { id: 'student1' },
        body: { message: 'Help me', mode: 'question' },
      };
      let statusCode = 0;
      const res: any = {
        status(code: number) { statusCode = code; return this; },
        json(obj: any) { this.body = obj; return this; },
      };
      const handler = router.stack.find(
        (r: any) => r.route && r.route.path === '/' && r.route.methods.post
      ).route.stack[0].handle;

      await handler(req, res, () => {});

      const prompt = callLlmMock.mock.calls[0][0];
      expect(prompt).not.toMatch(/The correct answer is/i);
      expect(prompt).not.toMatch(/Here's why:/i);
      expect(prompt).not.toMatch(/Because 2\+2=4/);
      expect(statusCode).toBeGreaterThanOrEqual(200);
      expect(statusCode).toBeLessThan(300);
    });
  });
}
