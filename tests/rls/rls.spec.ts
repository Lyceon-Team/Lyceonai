import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestUser, getUserJwt, deleteTestUser, canRunRlsTests } from './util/supabaseTestUsers';
import { nanoid } from 'nanoid';

// Import the Express app
// Note: Adjust this import path based on your project structure
const app = await import('../../server/index').then(m => m.default || m.app);

// Skip all tests if Supabase secrets are not available
// Integration tests require: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
describe.skipIf(!canRunRlsTests())('RLS Isolation Tests', () => {

  let userA: { id: string; email: string; password: string };
  let userB: { id: string; email: string; password: string };
  let jwtA: string;
  let jwtB: string;
  let testCourseId: string;

  beforeAll(async () => {
    // Create two test users
    const uniqueId = nanoid(8);
    userA = await createTestUser(`test-rls-a-${uniqueId}@example.com`);
    userB = await createTestUser(`test-rls-b-${uniqueId}@example.com`);

    // Get JWTs for both users
    jwtA = await getUserJwt(userA);
    jwtB = await getUserJwt(userB);

    // Create a test course ID (we'll assume courses are public or we have permission)
    testCourseId = `00000000-0000-0000-0000-000000000001`;
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    // Cleanup test users
    if (userA) await deleteTestUser(userA.id);
    if (userB) await deleteTestUser(userB.id);
  });

  describe('Progress Isolation', () => {
    it('user A cannot read user B progress', async () => {
      // User A creates a progress record
      const progressData = { pct: 20, lastItemId: 'item-123' };
      await request(app)
        .post(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send(progressData)
        .expect(200);

      // User B tries to read progress for the same course
      const res = await request(app)
        .get(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtB}`)
        .expect(200);

      // RLS should block A's row from B; list should be empty
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('user A can read their own progress', async () => {
      // User A reads their own progress
      const res = await request(app)
        .get(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtA}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].pct).toBe(20);
    });

    it('user B can create their own progress', async () => {
      // User B creates their own progress
      const progressData = { pct: 50, lastItemId: 'item-456' };
      const res = await request(app)
        .post(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtB}`)
        .send(progressData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.pct).toBe(50);
      expect(res.body.data.user_id).toBe(userB.id);
    });
  });

  describe('Attempts Isolation', () => {
    const questionId = '00000000-0000-0000-0000-000000000002';

    it('user A cannot read user B attempts', async () => {
      // User A creates an attempt
      const attemptData = {
        questionId,
        chosen: 'A',
        correct: true,
        elapsedMs: 5000
      };
      await request(app)
        .post('/api/attempts')
        .set('Authorization', `Bearer ${jwtA}`)
        .send(attemptData)
        .expect(200);

      // User B tries to read attempts (should only see their own, which is none)
      const res = await request(app)
        .get('/api/attempts')
        .set('Authorization', `Bearer ${jwtB}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0); // B has no attempts yet
    });

    it('user A can read their own attempts', async () => {
      const res = await request(app)
        .get('/api/attempts')
        .set('Authorization', `Bearer ${jwtA}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].user_id).toBe(userA.id);
    });

    it('user B can create their own attempts', async () => {
      const attemptData = {
        questionId,
        chosen: 'B',
        correct: false,
        elapsedMs: 3000
      };
      const res = await request(app)
        .post('/api/attempts')
        .set('Authorization', `Bearer ${jwtB}`)
        .send(attemptData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user_id).toBe(userB.id);
    });
  });

  describe('Authentication Required', () => {
    it('rejects requests without JWT', async () => {
      const res = await request(app)
        .get('/api/progress')
        .expect(401);

      expect(res.body.error).toContain('Authentication required');
    });

    it('rejects requests with invalid JWT', async () => {
      const res = await request(app)
        .get('/api/progress')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Database Context', () => {
    it('sets user context correctly for each request', async () => {
      // Create progress for both users
      await request(app)
        .post(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ pct: 75 })
        .expect(200);

      await request(app)
        .post(`/api/progress/${testCourseId}`)
        .set('Authorization', `Bearer ${jwtB}`)
        .send({ pct: 85 })
        .expect(200);

      // Verify each user only sees their own progress
      const resA = await request(app)
        .get('/api/progress')
        .set('Authorization', `Bearer ${jwtA}`)
        .expect(200);

      const resB = await request(app)
        .get('/api/progress')
        .set('Authorization', `Bearer ${jwtB}`)
        .expect(200);

      // User A should only see their progress
      expect(resA.body.data.every((p: any) => p.user_id === userA.id)).toBe(true);
      
      // User B should only see their progress
      expect(resB.body.data.every((p: any) => p.user_id === userB.id)).toBe(true);
    });
  });
});
