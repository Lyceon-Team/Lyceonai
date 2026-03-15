
import { describe, it, expect, vi } from 'vitest';

// ESM-safe mocking: Use vi.mock/vi.doMock and dynamic import after mocks are set.
describe('IDOR Regression Invariants', () => {
<<<<<<< HEAD
  // Security test: Verify that /api/tutor/v2 uses req.user.id, not body.userId
  // This prevents IDOR attacks where an attacker tries to impersonate another user
  it('tutor_v2_userid_from_auth_not_body', async () => {
    // This test validates that the endpoint requires authentication
    // and rejects requests without proper auth (preventing IDOR)

    // Test 1: Unauthenticated request should be rejected
    const res = await request(app)
      .post('/api/tutor/v2')
      .set('Origin', 'http://localhost:5000')
      .send({ userId: 'victim-id', message: 'hi', mode: 'concept' });

    // Should reject (401) - cannot proceed without auth
    expect(res.status).toBe(401);

    // Test 2: Bearer auth should be rejected (cookie-only policy)
    const res2 = await request(app)
      .post('/api/tutor/v2')
      .set('Authorization', 'Bearer fake-token')
      .set('Origin', 'http://localhost:5000')
      .send({ userId: 'victim-id', message: 'hi', mode: 'concept' });

    // Should reject
    expect([401, 403]).toContain(res2.status);
=======
  it('tutor_v2_userid_ignored_from_body', async () => {
    vi.resetModules();
    // Mock downstream dependencies before importing the router (ESM-safe)
    const handleRagQueryMock = vi.fn(async (args) => ({ context: {}, metadata: {}, ok: true }));
    vi.doMock('../../apps/api/src/lib/rag-service', () => ({
      getRagService: () => ({ handleRagQuery: handleRagQueryMock })
    }));
    const updateStudentStyleMock = vi.fn(async () => true);
    vi.doMock('../../apps/api/src/lib/profile-service', () => ({
      updateStudentStyle: updateStudentStyleMock
    }));
    const logTutorInteractionMock = vi.fn(async () => {});
    vi.doMock('../../apps/api/src/lib/tutor-log', () => ({
      logTutorInteraction: logTutorInteractionMock
    }));
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
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
  });

  it('progress_review_attempt_rejects_foreign_session', async () => {
    vi.resetModules();

    const sessionId = '11111111-1111-1111-1111-111111111111';
    const questionId = '22222222-2222-2222-2222-222222222222';
    const userId = 'real-user';

    const fromMock = vi.fn((table: string) => {
      if (table !== 'practice_sessions') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            single: async () => ({
              data: { id: sessionId, user_id: 'someone-else', metadata: {} },
              error: null,
            }),
          }),
        }),
      };
    });

    vi.doMock('../apps/api/src/lib/supabase-server', () => ({
      supabaseServer: {
        from: fromMock,
      },
    }));

    const { submitPracticeAnswer } = await import('../server/routes/practice-canonical');

    const req = {
      requestId: 'idor-regression',
      user: { id: userId },
      body: {
        sessionId,
        questionId,
        selectedAnswer: 'A',
      },
    } as any;

    let statusCode = 0;
    let jsonBody: any = null;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
    } as any;

    await submitPracticeAnswer(req, res);

    expect(statusCode).toBe(403);
    expect(jsonBody).toMatchObject({ error: 'forbidden' });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});
// Inject dummy env vars for deterministic test runs (no real credentials needed)
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
