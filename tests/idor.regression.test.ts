
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handleRagQueryMock = vi.hoisted(() =>
  vi.fn(async () => ({
    context: {
      primaryQuestion: null,
      supportingQuestions: [],
      competencyContext: {
        studentWeakAreas: [],
        studentStrongAreas: [],
        competencyLabels: [],
      },
      studentProfile: null,
    },
    metadata: { canonicalIdsUsed: [] },
    ok: true,
  }))
);

const updateStudentStyleMock = vi.hoisted(() => vi.fn(async () => true));
const logTutorInteractionMock = vi.hoisted(() => vi.fn(async () => {}));

const supabaseServerMock = vi.hoisted(() => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          limit: () => ({
            single: async () => ({ data: null, error: null })
          })
        })
      })
    })
  })
}));

vi.mock('../../apps/api/src/lib/rag-service', () => ({
  getRagService: () => ({ handleRagQuery: handleRagQueryMock })
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

// ESM-safe mocking: Use vi.mock/vi.doMock and dynamic import after mocks are set.
describe('IDOR Regression Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tutor_v2_userid_ignored_from_body', async () => {
    vi.resetModules();
    // Import router after mocks are set
    const { default: router } = await import('../server/routes/tutor-v2');
    // Prepare request/response mocks
    const req = {
      user: { id: 'real-user' },
      body: { userId: 'victim-id', message: 'hi', mode: 'concept' },
    };
    let statusCode = 0;
    const res = {
      status(code) { statusCode = code; return this; },
      json(obj) { this.body = obj; return this; },
    };
    // Find the POST handler
    const postLayer = router.stack.find(
      (r) => r.route && r.route.path === '/' && r.route.methods.post
    );
    expect(postLayer).toBeTruthy();
    const handler = postLayer.route.stack[0].handle;
    await handler(req, res, () => {});
    // Assert downstream only receives req.user.id
    expect(handleRagQueryMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'real-user' }));
    expect(handleRagQueryMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'victim-id' }));
    expect(updateStudentStyleMock).toHaveBeenCalledWith('real-user', expect.anything());
    expect(logTutorInteractionMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'real-user' }));
  });

  it('progress_review_attempt_rejects_foreign_session', async () => {
    vi.resetModules();
    // ESM-safe: Mock the exact modules as imported in progress.ts
    // 1. Mock supabaseServer to return a session owned by someone else for practice_sessions
    const sessionId = 'foreign-session';
    const userId = 'real-user';
    const supabaseMock = {
      from: (table) => {
        if (table === 'practice_sessions') {
          return {
            select: () => ({
              eq: (_col, _val) => ({
                single: async () => ({ data: { id: sessionId, user_id: 'someone-else' }, error: null })
              })
            })
          };
        }
        // Any other table: throw to fail test if called unexpectedly
        throw new Error('Unexpected table: ' + table);
      }
    };
    vi.doMock('../../apps/api/src/lib/supabase-server', () => ({
      supabaseServer: supabaseMock
    }));
    // 2. Mock recordCompetencyEvent to fail if called
    const recordCompetencyEventMock = vi.fn();
    vi.doMock('../../apps/api/src/routes/progress', async () => {
      // Import the real module to spread all other exports
      const actual = await vi.importActual('../../apps/api/src/routes/progress');
      return {
        ...actual,
        recordCompetencyEvent: recordCompetencyEventMock
      };
    });
    // Import after mocks
    const { recordReviewAttempt } = await import('../../apps/api/src/routes/progress');
    // Prepare request/response mocks
    const req = {
      user: { id: userId },
      body: { questionId: 'q1', eventType: 'correct', sessionId },
    };
    let statusCode = 0;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(obj) { jsonBody = obj; return this; },
    };
    await recordReviewAttempt(req, res);
    expect(statusCode).toBe(403);
    expect(recordCompetencyEventMock).not.toHaveBeenCalled();
  });
});
