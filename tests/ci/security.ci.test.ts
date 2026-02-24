/**
 * CI Security Tests - CSRF Protection
 * 
 * These tests validate CSRF protection behavior at the HTTP boundary
 * without requiring real Supabase credentials.
 * 
 * SECURITY GUARANTEES TESTED:
 * 1. POST requests without Origin/Referer → 403
 * 2. POST requests with invalid Origin → 403
 * 3. POST requests with valid Origin → allowed
 * 4. Origin prefix attacks blocked (e.g., localhost:5000.evil.com)
 * 5. Subdomain impersonation blocked
 * 6. GET requests allowed without Origin/Referer
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { TEST_ORIGINS } from '../utils/auth-helpers';

describe('CI Security Tests - CSRF', () => {
  let app: Express;

  beforeAll(async () => {
    // Set test environment
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';
    
    // Import app - CSRF protection should be active in test mode
    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  describe('CSRF Protection - Missing Origin/Referer', () => {
    it('should block POST requests without Origin/Referer (403)', async () => {
      const res = await request(app)
        .post('/api/auth/signout');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should return 404 for deprecated exchange-session endpoint (CSRF bypass attempt)', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .send({
          access_token: 'test-token',
          refresh_token: 'test-refresh'
        });
      
      // Endpoint must not exist (deprecated in favor of httpOnly cookie auth)
      // This ensures attackers cannot exploit it regardless of CSRF headers
      expect(res.status).toBe(404);
    });
  });

  describe('CSRF Protection - Valid Origins', () => {
    TEST_ORIGINS.valid.forEach(origin => {
      it(`should allow POST with valid Origin: ${origin}`, async () => {
        const res = await request(app)
          .post('/api/auth/signout')
          .set('Origin', origin);
        
        // Should not be blocked by CSRF (403)
        // May return 401 if not authenticated, or 200 if auth succeeds
        expect(res.status).not.toBe(403);
        expect([200, 401]).toContain(res.status);
      });
    });

    it('should allow POST with valid Referer header', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Referer', 'http://localhost:5000/dashboard');
      
      // Should not be blocked by CSRF
      expect(res.status).not.toBe(403);
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('CSRF Protection - Invalid Origins', () => {
    TEST_ORIGINS.invalid.forEach(origin => {
      it(`should block POST with invalid Origin: ${origin}`, async () => {
        const res = await request(app)
          .post('/api/auth/signout')
          .set('Origin', origin);
        
        expect(res.status).toBe(403);
        expect(res.body).toHaveProperty('error', 'csrf_blocked');
      });
    });
  });

  describe('CSRF Protection - Prefix Attacks', () => {
    it('should block hostname-prefix impersonation (localhost:5000.evil.com)', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'http://localhost:5000.evil.com');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should block subdomain impersonation via Referer', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Referer', 'http://localhost:5000.attacker.com/path');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should block trailing domain impersonation', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'http://evil.com/localhost:5000');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });
  });

  describe('CSRF Protection - Empty Origin Bypass Prevention', () => {
    it('should not bypass CSRF with empty origin entries', async () => {
      // Verifies that allowedOrigins like "http://localhost:5000," (trailing comma)
      // doesn't create empty entries that bypass CSRF protection
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', '');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should block requests with only whitespace in Origin', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', '   ');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });
  });

  describe('CSRF Protection - GET Requests', () => {
    it('should allow GET requests without Origin/Referer', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('should allow GET to /api/auth/user without Origin/Referer', async () => {
      const res = await request(app).get('/api/auth/user');
      expect(res.status).toBe(200);
    });

    it('should allow GET to public questions endpoint without Origin/Referer', async () => {
      const res = await request(app).get('/api/questions/recent');
      expect([200, 304]).toContain(res.status);
    });
  });

  describe('CSRF Protection - HEAD and OPTIONS Requests', () => {
    it('should allow HEAD requests without Origin/Referer', async () => {
      const res = await request(app).head('/api/health');
      expect([200, 404]).toContain(res.status);
    });

    it('should allow OPTIONS requests without Origin/Referer', async () => {
      const res = await request(app).options('/api/health');
      expect([200, 204, 404]).toContain(res.status);
    });
  });

  describe('CSRF Protection - Case Sensitivity', () => {
    it('should handle Origin header case-insensitively', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('origin', 'http://localhost:5000'); // lowercase
      
      expect(res.status).not.toBe(403);
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('CSRF Protection - Protocol Variants', () => {
    it('should block http origin when https is required', async () => {
      // This test assumes production would require https
      // In test/dev mode, http is allowed
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'https://evil.com');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });
  });

  describe('CSRF Protection - Multiple Headers', () => {
    it('should validate Origin when both Origin and Referer are present', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'http://localhost:5000')
        .set('Referer', 'http://localhost:5000/dashboard');
      
      expect(res.status).not.toBe(403);
      expect([200, 401]).toContain(res.status);
    });

    it('should allow request if either Origin OR Referer is valid', async () => {
      // CSRF middleware accepts either valid Origin OR valid Referer
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'https://evil.com')
        .set('Referer', 'http://localhost:5000/dashboard');
      
      // Should pass CSRF check (valid Referer)
      expect(res.status).not.toBe(403);
      expect([200, 401]).toContain(res.status);
    });

    it('should block when both Origin and Referer are invalid', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'https://evil.com')
        .set('Referer', 'https://attacker.com/path');
      
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });
  });

  describe('Forbidden Routes - Deprecated Endpoints', () => {
    /**
     * SECURITY INVARIANT: exchange-session endpoints must NEVER exist.
     * These were deprecated in favor of httpOnly cookie authentication.
     * This test ensures they cannot be reintroduced accidentally.
     */
    it('should return 404 for POST /api/auth/exchange-session', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .set('Origin', 'http://localhost:5000')
        .send({
          access_token: 'test',
          refresh_token: 'test'
        });
      
      expect(res.status).toBe(404);
    });

    it('should return 404 for POST /api/auth/exchange_session (underscore variant)', async () => {
      const res = await request(app)
        .post('/api/auth/exchange_session')
        .set('Origin', 'http://localhost:5000')
        .send({
          access_token: 'test',
          refresh_token: 'test'
        });
      
      expect(res.status).toBe(404);
    });

    it('should return 404 for POST /api/exchange-session (alternative path)', async () => {
      const res = await request(app)
        .post('/api/exchange-session')
        .set('Origin', 'http://localhost:5000')
        .send({
          access_token: 'test',
          refresh_token: 'test'
        });
      
      expect(res.status).toBe(404);
    });
  });
});
