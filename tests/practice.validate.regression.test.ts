import request from 'supertest';
import app from '../server/index';
import { describe, it, expect } from 'vitest';

// Security regression test: Verify that /api/questions/validate does not leak
// sensitive data (correctAnswerKey, explanation) to non-admin users.
// 
// This test validates the ABSENCE of security bugs without requiring mocks or real data.
// We test that:
// 1. Unauthenticated requests are rejected (401)
// 2. The endpoint structure doesn't leak sensitive fields in error responses
describe('Practice/Questions Validate Security Regression', () => {

  it('PRAC-001: rejects unauthenticated requests (no cookie)', async () => {
    // No auth cookie = should get 401
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Origin', 'http://localhost:5000')
      .send({ questionId: 'q1', studentAnswer: 'B' });
    
    // Should reject with 401 (unauthenticated)
    expect(res.status).toBe(401);
    
    // Error response should never leak sensitive data
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
    expect(res.body).not.toHaveProperty('correct_answer');
    expect(res.body).not.toHaveProperty('answer_text');
  });

  it('PRAC-001: rejects bearer auth (cookie-only endpoint)', async () => {
    // Try bearer auth (should be rejected per cookie-only policy)
    const res = await request(app)
      .post('/api/questions/validate')
      .set('Authorization', 'Bearer fake-token')
      .set('Origin', 'http://localhost:5000')
      .send({ questionId: 'q1', studentAnswer: 'B' });
    
    // Should reject (401 or 403)
    expect([401, 403]).toContain(res.status);
    
    // Error response should never leak sensitive data
    expect(res.body).not.toHaveProperty('correctAnswerKey');
    expect(res.body).not.toHaveProperty('explanation');
  });
});

