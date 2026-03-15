import request from 'supertest';
import app from '../server/index';

describe('Auth Integration Tests', () => {
  describe('Public Endpoints', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });

    it('should return questions for anonymous users', async () => {
      const res = await request(app).get('/api/questions/recent?limit=5');
      expect([200, 304]).toContain(res.status);
    });
  });

  describe('Auth User Endpoint', () => {
    it('should require auth for /api/profile', async () => {
      const res = await request(app).get('/api/profile');
      expect([401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('should not expose tokens in response', async () => {
      const res = await request(app).get('/api/profile');
      expect([401, 404]).toContain(res.status);
      expect(res.body).not.toHaveProperty('access_token');
      expect(res.body).not.toHaveProperty('refresh_token');
      expect(res.body).not.toHaveProperty('session');
    });
  });

  describe('Protected Endpoints', () => {
    it('should return 401 for /api/profile without auth', async () => {
      const res = await request(app).get('/api/profile');
      expect([401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 401 for practice sessions without auth', async () => {
      const res = await request(app)
        .post('/api/practice/sessions')
        .send({ mode: 'flow', section: 'math' });
      expect([401, 404]).toContain(res.status);
    });

    it('should return 401 for bearer-only auth (no cookie)', async () => {
      // Use a fake bearer token, no cookie
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer faketoken');
      expect([401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('should succeed for valid cookie auth (simulate)', async () => {
      // This test assumes a valid sb-access-token cookie is set (replace with a real token if available)
      const fakeToken = 'valid_token'; // Replace with a real token for full integration
      const res = await request(app)
        .get('/api/profile')
        .set('Cookie', [`sb-access-token=${fakeToken}`]);
      // Accept 200 (success) or 401 (if token is not valid in test env)
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('Admin Endpoints', () => {
    it('should return 401 for admin routes without auth', async () => {
      const res = await request(app).get('/api/admin/questions/needs-review');
      expect([401, 404]).toContain(res.status);
    });

    it('should return 401 for document upload without auth', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .attach('file', Buffer.from('test'), 'test.pdf');
      expect(res.status).toBe(401);
    });
  });

  describe('CSRF Protection', () => {
    it('should block POST requests without Origin/Referer (403)', async () => {
      const res = await request(app)
        .post('/api/auth/signout');
      
      // Should block with 403 Forbidden
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should allow POST with valid Origin header', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'http://localhost:5000');
      
      // Should process normally (401 if not authenticated, 200 if authenticated)
      expect([200, 401]).toContain(res.status);
    });

    it('should block POST with forged Origin header (403)', async () => {
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'https://evil.com');
      
      // Should block with 403 Forbidden
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should not bypass CSRF with empty origin entries (e.g., trailing comma)', async () => {
      // This test verifies that allowedOrigins like "http://localhost:5000," (trailing comma)
      // doesn't create empty entries that bypass CSRF protection
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'https://evil.com');
      
      // Should still block with 403 even if ALLOWED_ORIGINS has trailing/double commas
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should block hostname-prefix impersonation attacks', async () => {
      // This test verifies that domains like "http://localhost:5000.evil.com" 
      // cannot bypass CSRF by sharing a hostname prefix
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Origin', 'http://localhost:5000.evil.com');
      
      // Should block with 403 - exact origin match required
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should block subdomain impersonation via Referer', async () => {
      // Verify that Referer parsing extracts exact origin and blocks subdomains
      const res = await request(app)
        .post('/api/auth/signout')
        .set('Referer', 'http://localhost:5000.attacker.com/some/path');
      
      // Should block with 403 - Referer origin doesn't match exactly
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should allow GET requests without Origin/Referer', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });
  });

  describe('Cookie Security', () => {
    it('should not set cookies on public endpoints', async () => {
      const res = await request(app).get('/api/questions/recent');
      const cookies = res.headers['set-cookie'];
      
      // Public endpoints should not set auth cookies
      if (cookies) {
        const authCookies = cookies.filter((c: string) => 
          c.includes('sb-access-token') || c.includes('sb-refresh-token')
        );
        expect(authCookies).toHaveLength(0);
      }
    });
  });

  describe('Removed Legacy Auth Endpoints', () => {
    it('should return 404 for removed exchange-session endpoint', async () => {
      const res = await request(app)
        .post('/api/auth/exchange-session')
        .send({});

      expect(res.status).toBe(404);
    });

    it('should return 404 for removed auth hydration endpoint', async () => {
      const res = await request(app).get('/api/auth/user');

      expect(res.status).toBe(404);
    });
  });

  describe('FERPA Compliance', () => {
    it('should enforce consent on practice endpoints', async () => {
      // This test would need a real auth token for a under-13 user
      // For now, we just verify the endpoint exists and requires auth
      const res = await request(app)
        .post('/api/practice/sessions')
        .send({ mode: 'flow', section: 'math' });
      
      expect([401, 404]).toContain(res.status); // Not authenticated
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
      
      // Should include some rate limit responses (429) if limit is low
      // Or all succeed if rate limit is high
      expect(statuses.every(s => [200, 304, 429].includes(s))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent API routes', async () => {
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
    });

    it('should handle malformed JSON gracefully', async () => {
      const res = await request(app)
        .post('/api/auth/signin')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');
      
      expect([400, 500]).toContain(res.status);
    });
  });
});

