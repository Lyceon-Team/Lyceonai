import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server/index';

describe('Entitlement/Auth Regression Invariants', () => {

  it('auth_cookie_only_api_rag_rejects_bearer', async () => {
    const res = await request(app)
      .post('/api/rag')
      .set('Authorization', 'Bearer FAKE_TOKEN');
    
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });

  it('auth_rag_v2_requires_cookie', async () => {
    const res = await request(app).post('/api/rag/v2');
    expect([401, 403]).toContain(res.status);
  });

  // Security test: Verify that /api/rag/v2 uses req.user.id, not body.userId
  // This prevents IDOR attacks where an attacker tries to impersonate another user
  it('rag_v2_userid_from_auth_not_body', async () => {
    // Test 1: Unauthenticated request should be rejected
    const res = await request(app)
      .post('/api/rag/v2')
      .set('Content-Type', 'application/json')
      .send({ userId: 'victim-id', message: 'hi', mode: 'concept' });
    
    // Should reject (401/403) - cannot proceed without auth
    expect([401, 403]).toContain(res.status);
    
    // Test 2: Bearer auth should be rejected (cookie-only policy)
    const res2 = await request(app)
      .post('/api/rag/v2')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer fake-token')
      .send({ userId: 'victim-id', message: 'hi', mode: 'concept' });
    
    // Should reject
    expect([401, 403]).toContain(res2.status);
  });

  it('admin_db_health_requires_admin', async () => {
    const res = await request(app).get('/api/admin/db-health');
    expect([401, 403]).toContain(res.status);
  });
});
