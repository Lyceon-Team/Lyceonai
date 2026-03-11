import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

describe('Security Headers Middleware', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  it('applies baseline security headers to API responses', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
