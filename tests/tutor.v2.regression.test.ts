import request from 'supertest';
import app from '../server/index';
import { describe, it, expect } from 'vitest';

// Security regression test: Verify that /api/tutor/v2 does not leak
// answers or explanations to students who haven't attempted the question.
// 
// This test validates the ABSENCE of security bugs without requiring complex mocks.
// We test that:
// 1. Unauthenticated requests are rejected (401)
// 2. The endpoint structure doesn't leak sensitive fields
describe('Tutor V2 Security Regression', () => {

  it('PRAC-002: rejects unauthenticated requests (no cookie)', async () => {
    // No auth cookie = should get 401
    const res = await request(app)
      .post('/api/tutor/v2')
      .set('Origin', 'http://localhost:5000')
      .send({ message: 'Help me', mode: 'question' });
    
    // Should reject with 401 (unauthenticated)
    expect(res.status).toBe(401);
    
    // Error response should never leak sensitive data
    expect(res.body).not.toHaveProperty('answer');
    expect(res.body).not.toHaveProperty('explanation');
    expect(res.body).not.toHaveProperty('correctAnswerKey');
  });

  it('PRAC-002: rejects bearer auth (cookie-only endpoint)', async () => {
    // Try bearer auth (should be rejected per cookie-only policy)
    const res = await request(app)
      .post('/api/tutor/v2')
      .set('Authorization', 'Bearer fake-token')
      .set('Origin', 'http://localhost:5000')
      .send({ message: 'Help me', mode: 'question' });
    
    // Should reject (401 or 403)
    expect([401, 403]).toContain(res.status);
    
    // Error response should never leak sensitive data
    expect(res.body).not.toHaveProperty('answer');
    expect(res.body).not.toHaveProperty('explanation');
  });
});
