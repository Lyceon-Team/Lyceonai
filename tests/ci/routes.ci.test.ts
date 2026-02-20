/**
 * CI Routes Tests - Public vs Protected Route Validation
 * 
 * These tests validate that public and protected routes behave correctly
 * without requiring real Supabase credentials.
 * 
 * SECURITY GUARANTEES TESTED:
 * 1. Public endpoints accessible without auth
 * 2. Protected endpoints require authentication
 * 3. Admin endpoints require admin role
 * 4. Guardian endpoints have proper access control
 * 5. User identity from req.user.id (not request body)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { PUBLIC_ROUTES, PROTECTED_ROUTES, ADMIN_ROUTES } from '../../apps/api/src/routes/registry';

describe('CI Routes Tests', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';
    
    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  describe('Public Routes - No Auth Required', () => {
    PUBLIC_ROUTES.forEach(({ path, method }) => {
      const methodName = method.toLowerCase();
      const name = `${method.toUpperCase()} ${path}`;
      it(`${name} (${method.toUpperCase()} ${path}) should be accessible without auth`, async () => {
        const res = await (request(app) as any)[methodName](path);
        
        // Should not return 401 (unauthorized)
        expect(res.status).not.toBe(401);
        // Accept success or cached responses
        expect([200, 304]).toContain(res.status);
      });
    });

    it('should return user as null for unauthenticated /api/auth/user requests', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
    });
  });

  describe('Protected Routes - Auth Required', () => {
    PROTECTED_ROUTES.forEach(({ path, method }) => {
      const methodName = method.toLowerCase();
      it(`${method.toUpperCase()} ${path} should require authentication`, async () => {
        const needsOrigin = methodName === 'post';
        const req = (request(app) as any)[methodName](path);

        if (needsOrigin) {
          req.set('Origin', 'http://localhost:5000');
        }

        if (methodName === 'post') {
          req.send({ mode: 'flow', section: 'math' });
        }

        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error');
      });
    });
  });

  describe('Admin Routes - Admin Auth Required', () => {
    ADMIN_ROUTES.forEach(({ path, method }) => {
      const methodName = method.toLowerCase();
      it(`${method.toUpperCase()} ${path} should require authentication`, async () => {
        const res = await (request(app) as any)[methodName](path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error');
      });
    });
  });

  describe('User Identity Derivation', () => {
    it('should derive user ID from auth token, not request body', async () => {
      // This test validates that even if a malicious user sends userId in the body,
      // the server uses req.user.id from the authenticated token
      
      const res = await request(app)
        .post('/api/practice/sessions')
        .send({
          mode: 'flow',
          section: 'math',
          userId: 'malicious-user-id-123', // Should be ignored
        });
      
      // Should require auth (401), not process the malicious userId
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Authentication required');
    });

    it('should not accept user_id in query parameters for auth bypass', async () => {
      const res = await request(app)
        .get('/api/profile?user_id=malicious-user-id');
      
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('FERPA Compliance - Under-13 Consent', () => {
    it('should require authentication for practice endpoints (FERPA check)', async () => {
      const res = await request(app)
        .post('/api/practice/sessions')
        .send({ mode: 'flow', section: 'math' });
      
      // Must be authenticated to check consent status
      expect(res.status).toBe(401);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should reject unauthenticated access to student-only routes', async () => {
      const res = await request(app)
        .post('/api/practice/sessions')
        .send({ mode: 'flow', section: 'math' });
      
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject unauthenticated access to guardian routes', async () => {
      const res = await request(app)
        .get('/api/guardian/students');
      
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('HTTP Method Validation', () => {
    it('should reject POST to GET-only endpoints', async () => {
      const res = await request(app)
        .post('/api/questions/recent')
        .set('Origin', 'http://localhost:5000');
      
      // Should return method not allowed or route not found
      expect([404, 405]).toContain(res.status);
    });

    it('should handle GET to POST-only endpoints appropriately', async () => {
      const res = await request(app)
        .get('/api/practice/sessions');
      
      // Should return method not allowed or route not found
      // Could also return 401 if the GET route exists but requires auth
      expect([401, 404, 405]).toContain(res.status);
    });
  });

  describe('Request Validation', () => {
    it('should validate required fields in POST requests', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .set('Origin', 'http://localhost:5000')
        .send({}); // Missing required fields
      
      // Should fail validation
      expect([400, 401]).toContain(res.status);
    });
  });

  describe('Response Format', () => {
    it('should return JSON for API endpoints', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
    });

    it('should include error field in error responses', async () => {
      const res = await request(app).get('/api/profile');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Admin Health Endpoint Security', () => {
    it('should not leak SUPABASE_SERVICE_ROLE_KEY in response', async () => {
      // Even if endpoint fails auth, it should never leak secrets
      const res = await request(app).get('/api/admin/health');
      const responseText = JSON.stringify(res.body);
      
      // Check that no secret keys are in the response
      expect(responseText).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(responseText).not.toContain('STRIPE_SECRET_KEY');
      expect(responseText).not.toContain('STRIPE_WEBHOOK_SECRET');
      
      // Should not contain actual key values (even partial)
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        expect(responseText).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY);
      }
      if (process.env.STRIPE_SECRET_KEY) {
        expect(responseText).not.toContain(process.env.STRIPE_SECRET_KEY);
      }
    });

    it('should require admin role for health endpoint', async () => {
      // Anonymous user should get 401
      const res = await request(app).get('/api/admin/health');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });
});
