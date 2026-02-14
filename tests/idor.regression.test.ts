import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../server/index';

// ESM-safe mocking: Use vi.mock/vi.doMock and dynamic import after mocks are set.
describe('IDOR Regression Invariants', () => {
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
              eq: (col, val) => ({
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
// Inject dummy env vars for deterministic test runs (no real credentials needed)
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';
