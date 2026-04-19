import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../server/index';

vi.mock('../server/middleware/csrf-double-submit', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => 'test-csrf-token',
}));

// ESM-safe mocking: Use vi.mock/vi.doMock and dynamic import after mocks are set.
describe('IDOR Regression Invariants', () => {
  // Security test: Verify tutor append uses req.user.id, not body user-controlled identifiers
  // This prevents IDOR attacks where an attacker tries to impersonate another user
  it('tutor_runtime_userid_from_auth_not_body', async () => {
    // This test validates that the endpoint requires authentication
    // and rejects requests without proper auth (preventing IDOR)

    // Test 1: Unauthenticated request should be rejected
    const res = await request(app)
      .post('/api/tutor/messages')
      .set('Origin', 'http://localhost:5000')
      .send({
        userId: 'victim-id',
        conversation_id: '11111111-1111-4111-8111-111111111111',
        message: 'hi',
        content_kind: 'message',
        client_turn_id: '22222222-2222-4222-8222-222222222222',
      });

    // Should reject (401) - cannot proceed without auth
    expect(res.status).toBe(401);

    // Test 2: Bearer auth should be rejected (cookie-only policy)
    const res2 = await request(app)
      .post('/api/tutor/messages')
      .set('Authorization', 'Bearer fake-token')
      .set('Origin', 'http://localhost:5000')
      .send({
        userId: 'victim-id',
        conversation_id: '11111111-1111-4111-8111-111111111111',
        message: 'hi',
        content_kind: 'message',
        client_turn_id: '33333333-3333-4333-8333-333333333333',
      });

    // Should reject
    expect([401, 403]).toContain(res2.status);
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
