import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { setupSecurityMocks } from '../utils/securityTestUtils';

setupSecurityMocks();

vi.doMock('../../server/middleware/guardian-role', () => ({
  requireGuardianRole: () => (_req: any, _res: any, next: any) => next(),
}));

const { default: app } = await import('../../server/index');

describe.sequential('Production Debug Surface Hardening', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('production_hides_public_debug_surfaces', async () => {
    const paths = [
      '/api/_whoami',
      '/api/auth/debug',
      '/api/auth/google/debug',
      '/api/health/practice',
    ];

    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    }
  });

  it('public_health_remains_minimal_in_production', async () => {
    const healthz = await request(app).get('/healthz');
    expect(healthz.status).toBe(200);
    expect(healthz.body).toEqual({ status: 'ok' });

    const apiHealth = await request(app).get('/api/health');
    expect(apiHealth.status).toBe(200);
    expect(apiHealth.body).toEqual({ status: 'ok' });
  });

  it('production_hides_billing_debug_routes', async () => {
    const envRes = await request(app).get('/api/billing/debug/env');
    expect(envRes.status).toBe(404);
    expect(envRes.body).toEqual({ error: 'Not found' });

    const validateRes = await request(app).get('/api/billing/debug/validate');
    expect(validateRes.status).toBe(404);
    expect(validateRes.body).toEqual({ error: 'Not found' });
  });
});
