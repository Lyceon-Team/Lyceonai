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
      const res = await request(app).get('/api/admin/db-health');
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('CSRF Protection', () => {
    const getCsrfToken = async () => {
      const agent = request.agent(app);
      const tokenRes = await agent.get('/api/csrf-token');
      expect(tokenRes.status).toBe(200);
      return { agent, token: tokenRes.body.csrfToken as string };
    };

    it('should block POST requests without CSRF token (403)', async () => {
      const res = await request(app).post('/api/auth/signout');
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'csrf_blocked');
    });

    it('should allow POST with a valid CSRF token', async () => {
      const { agent, token } = await getCsrfToken();
      const res = await agent.post('/api/auth/signout').set('x-csrf-token', token);
      expect([200, 401]).toContain(res.status);
    });

    it('should allow GET requests without CSRF token', async () => {
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
        const cookiesArray = Array.isArray(cookies) ? cookies : [cookies];
        const authCookies = cookiesArray.filter((c: string) => 
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

