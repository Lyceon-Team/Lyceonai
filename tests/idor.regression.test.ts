import { describe, it, expect, vi } from 'vitest';
import * as tutorV2Module from '../server/routes/tutor-v2';
import * as ragServiceModule from '../../apps/api/src/lib/rag-service';
import * as profileServiceModule from '../../apps/api/src/lib/profile-service';
import * as tutorLogModule from '../../apps/api/src/lib/tutor-log';
import * as progressModule from '../../apps/api/src/routes/progress';
import * as supabaseServerModule from '../../apps/api/src/lib/supabase-server';

describe('IDOR Regression Invariants', () => {
  it('tutor_v2_userid_ignored_from_body', async () => {
    vi.resetModules();
    // Mock downstream dependencies
    const handleRagQueryMock = vi.fn(async (args) => ({ context: {}, metadata: {}, ok: true }));
    vi.spyOn(ragServiceModule, 'getRagService').mockReturnValue({ handleRagQuery: handleRagQueryMock });
    const updateStudentStyleMock = vi.fn(async () => true);
    vi.spyOn(profileServiceModule, 'updateStudentStyle').mockImplementation(updateStudentStyleMock);
    const logTutorInteractionMock = vi.fn(async () => {});
    vi.spyOn(tutorLogModule, 'logTutorInteraction').mockImplementation(logTutorInteractionMock);

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
    const router = tutorV2Module.default;
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
    // Mock supabaseServer to return a session owned by someone else
    const fromMock = vi.fn().mockReturnThis();
    const selectMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();
    const singleMock = vi.fn().mockResolvedValue({ data: { id: 'session-b', user_id: 'not-user-a' }, error: null });
    supabaseServerModule.supabaseServer = {
      from: () => ({ select: selectMock, eq: eqMock, single: singleMock }),
    } as any;
    // Patch the rest of the supabaseServer chain for questions
    selectMock.mockReturnThis();
    eqMock.mockReturnThis();
    // Patch recordCompetencyEvent to fail if called
    const recordCompetencyEventMock = vi.fn();
    progressModule.recordCompetencyEvent = recordCompetencyEventMock;
    // Prepare request/response mocks
    const req = {
      user: { id: 'user-a' },
      body: { questionId: 'q1', eventType: 'correct', sessionId: 'session-b' },
    };
    let statusCode = 0;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(obj) { jsonBody = obj; return this; },
    };
    await progressModule.recordReviewAttempt(req as any, res as any);
    expect(statusCode).toBe(403);
    expect(recordCompetencyEventMock).not.toHaveBeenCalled();
  });
});
