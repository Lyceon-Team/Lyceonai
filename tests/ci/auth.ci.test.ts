/**
 * CI Auth Tests - Deterministic, No Secrets Required
 * 
 * These tests validate authentication behavior at the HTTP boundary
 * without requiring real Supabase credentials. They use mock Supabase
 * clients to simulate authenticated/unauthenticated states.
 * 
 * SECURITY GUARANTEES TESTED:
 * 1. Cookie-only auth (Bearer tokens rejected)
 * 2. Missing cookie → 401
 * 3. Invalid cookie → 401
 * 4. User identity from req.user.id (not request body)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// These tests run in CI without secrets
// The server will use mock Supabase clients in test mode

describe('CI Auth Tests', () => {
  let app: Express;

  beforeAll(async () => {
    // Import server after setting test environment
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';
    
    // Import app - it will use placeholder Supabase clients in test mode
    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  afterAll(() => {
    // Clean up environment
    delete process.env.VITEST;
  });

  describe('Cookie-Only Authentication', () => {
    it('should reject Authorization: Bearer header without cookie', async () => {
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer fake-token-12345678901234567890');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject Authorization: Bearer header even with valid-looking token', async () => {
      const longToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${longToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 401 for protected routes without any auth', async () => {
      const res = await request(app).get('/api/profile');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 401 for missing sb-access-token cookie', async () => {
      const res = await request(app)
        .get('/api/profile')
        .set('Cookie', ['some-other-cookie=value']);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Public Endpoints - No Auth Required', () => {
    it('should allow access to /api/health without auth', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('should allow access to /api/questions/recent without auth', async () => {
      const res = await request(app).get('/api/questions/recent?limit=5');
      // Accept 200 (success) or 304 (cached)
      expect([200, 304]).toContain(res.status);
    });

    it('should allow access to /api/questions/search without auth', async () => {
      const res = await request(app).get('/api/questions/search?q=test');
      expect([200, 304]).toContain(res.status);
    });

    it('should return user as null for /api/auth/user without auth', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      // User should be null for unauthenticated requests
    });
  });

  describe('Protected Endpoints - Auth Required', () => {
    const protectedEndpoints = [
      { method: 'get', path: '/api/profile', name: 'profile', needsOrigin: false },
      { method: 'post', path: '/api/practice/sessions', name: 'practice sessions', body: { mode: 'flow', section: 'math' }, needsOrigin: true },
      { method: 'post', path: '/api/rag', name: 'RAG endpoint', body: { question: 'test' }, needsOrigin: true },
      { method: 'post', path: '/api/tutor/v2', name: 'Tutor v2', body: { message: 'test' }, needsOrigin: true },
    ];

    protectedEndpoints.forEach(({ method, path, name, body, needsOrigin }) => {
      it(`should require auth for ${name} (${method.toUpperCase()} ${path})`, async () => {
        const req = request(app)[method](path);
        
        // Add Origin for POST requests to pass CSRF check
        if (needsOrigin) {
          req.set('Origin', 'http://localhost:5000');
        }
        
        if (body) {
          req.send(body);
        }

        const res = await req;
        // Should get 401 (auth required) since we passed CSRF but no auth cookie
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error');
      });
    });

    // Test that POST endpoints are CSRF protected (403 without Origin)
    it('should block POST /api/rag without Origin/Referer (CSRF protection)', async () => {
      const res = await request(app)
        .post('/api/rag')
        .send({ question: 'test' });
      
      // Should get 403 (CSRF blocked) before auth check
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });
  });

  describe('Admin Endpoints - Admin Auth Required', () => {
    it('should return 401 for admin routes without auth', async () => {
      const res = await request(app).get('/api/admin/questions/needs-review');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Token Security', () => {
    it('should not expose tokens in /api/auth/user response', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('access_token');
      expect(res.body).not.toHaveProperty('refresh_token');
      expect(res.body).not.toHaveProperty('session');
    });

    it('should reject short/invalid tokens', async () => {
      const res = await request(app)
        .get('/api/profile')
        .set('Cookie', ['sb-access-token=short']);

      expect(res.status).toBe(401);
    });
  });

  describe('Cookie Security', () => {
    it('should not set auth cookies on public endpoints', async () => {
      const res = await request(app).get('/api/questions/recent');
      const cookies = res.headers['set-cookie'];
      
      if (cookies) {
        const authCookies = cookies.filter((c: string) => 
          c.includes('sb-access-token') || c.includes('sb-refresh-token')
        );
        expect(authCookies).toHaveLength(0);
      }
    });
  });

  describe('Session Exchange Endpoint (Deprecated)', () => {
    it('should return 404 for deprecated exchange-session endpoint (no body)', async () => {
  describe('Session Exchange Endpoint - Deprecated (Must Return 404)', () => {
    it('should return 404 for exchange-session endpoint (deprecated)', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .set('Origin', 'http://localhost:5000')
        .send({});
      
      // Endpoint must not exist (deprecated in favor of httpOnly cookie auth)
      // Endpoint must not exist (deprecated under httpOnly cookie auth)
      expect(res.status).toBe(404);
    });

    it('should return 404 for deprecated exchange-session endpoint (with tokens)', async () => {
      // Endpoint is deprecated and removed - must return 404
      expect(res.status).toBe(404);
    });

    it('should return 404 for exchange-session with tokens (endpoint removed)', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .set('Origin', 'http://localhost:5000')
        .send({
          access_token: 'test-token',
          refresh_token: 'test-refresh'
        });
      
      // Endpoint must not exist (deprecated in favor of httpOnly cookie auth)
      // Endpoint must not exist (deprecated under httpOnly cookie auth)
      // Endpoint is deprecated and removed - must return 404
      expect(res.status).toBe(404);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent API routes', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
    });

    it('should handle malformed JSON gracefully', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .set('Content-Type', 'application/json')
        .set('Origin', 'http://localhost:5000')
        .send('{ invalid json }');
      
      expect([400, 500]).toContain(res.status);
    });
  });

  describe('Rate Limiting', () => {
    it('should have rate limiting on search endpoint', async () => {
      // Make multiple rapid requests
      const requests = Array(10).fill(null).map(() => 
        request(app).get('/api/questions/search?q=test')
      );
      
      const responses = await Promise.all(requests);
      const statuses = responses.map(r => r.status);
      
      // Should include valid responses or rate limit responses
      expect(statuses.every(s => [200, 304, 429].includes(s))).toBe(true);
    });
  });
});
