/**
 * Integration Protected Routes Tests - Real Supabase Required
 * 
 * These tests validate protected route behavior with real authentication.
 * They require SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.
 * 
 * These tests are EXCLUDED from required CI and only run manually or in
 * optional integration test workflows.
 * 
 * PREREQUISITES:
 * - Real Supabase project
 * - Test user credentials
 * - Environment variables set
 * 
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Check if Supabase environment variables are available
 */
function hasSupabaseEnv(): boolean {
  return !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Get skip message for missing environment variables
 */
function getSkipMessage(): string {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  
  return `Supabase integration tests require: ${missing.join(', ')}. Set these environment variables to run integration tests.`;
}

// Skip all integration tests if Supabase env vars are not available
const runIntegrationTests = hasSupabaseEnv();

if (!runIntegrationTests) {
  console.warn('⚠️  Skipping integration tests:', getSkipMessage());
  console.warn('   These tests require real Supabase credentials.');
  console.warn('   To run: Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
}

describe.skipIf(!runIntegrationTests)('Integration Protected Routes Tests', () => {
  let app: Express;

  beforeAll(async () => {
    if (!runIntegrationTests) {
      throw new Error(getSkipMessage());
    }

    // Set production-like environment
    process.env.NODE_ENV = 'development'; // Not 'test' to use real Supabase
    
    // Import app
    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  /**
   * G1-10 (audit G-AUD-15a). These five used to be `expect(true).toBe(true)` placeholders —
   * including one titled "should enforce guardian consent for under-13 users" — so this job
   * reported them green while asserting nothing. They are replaced by assertions that CAN
   * fail, and that are safe to run against the real project this job targets: every request
   * is anonymous or carries a forged token, so nothing is created, read or written.
   *
   * THE MUTATION THAT REDS THEM (run 2026-09-29, all six red, restored green): make
   * `sendUnauthenticated` (server/middleware/supabase-auth.ts) answer 200 instead of 401.
   * Every 401 on these paths is sent through it. Removing ONE auth layer from a mount does
   * NOT red them, deliberately: each mount has a second 401 behind the first
   * (`requireRequestUser` in the role gates and in `resolveSubject`), and a test that went
   * red on a single-layer removal would be asserting that the defence in depth is absent.
   *
   * Titles say what is asserted, not what was hoped.
   */
  const SOME_STUDENT = '00000000-0000-4000-8000-000000000001';

  describe('Protected mounts refuse an anonymous caller', () => {
    it('GET /api/guardian/students → 401', async () => {
      const res = await request(app).get('/api/guardian/students');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/db-health → 401', async () => {
      const res = await request(app).get('/api/admin/db-health');
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('status', 'healthy');
    });

    it('GET /api/students/:id/mastery/domains → 401 (the guardian/student subject surface)', async () => {
      const res = await request(app).get(`/api/students/${SOME_STUDENT}/mastery/domains`);
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('domains');
    });

    it('POST /api/practice/sessions → 401', async () => {
      const res = await request(app).post('/api/practice/sessions').send({});
      expect(res.status).toBe(401);
    });

    it('POST /api/tutor/conversations → 401', async () => {
      const res = await request(app).post('/api/tutor/conversations').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('A forged session is not a session', () => {
    it('GET /api/guardian/students with a forged token → 401', async () => {
      const res = await request(app)
        .get('/api/guardian/students')
        .set('Cookie', ['sb-access-token=forged-token-abcdefghijklmnopqrstuvwxyz0123456789']);
      expect(res.status).toBe(401);
      expect(res.body).not.toHaveProperty('students');
    });
  });
});
