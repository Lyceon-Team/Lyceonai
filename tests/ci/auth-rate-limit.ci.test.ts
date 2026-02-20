import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

describe('CI Auth Rate Limiting', () => {
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

  it('rate-limits repeated POST /api/auth/signin attempts', async () => {
    const responses = [] as Array<{ status: number; headers: Record<string, string> }>;

    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .post('/api/auth/signin')
        .set('Origin', 'http://localhost:5000')
        .send({ email: `ratelimit-${i}@example.com`, password: 'wrong-password' });

      responses.push({
        status: res.status,
        headers: res.headers as Record<string, string>,
      });
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses.some((status) => status === 429)).toBe(true);

    const limited = responses.find((r) => r.status === 429);
    expect(limited?.headers).toHaveProperty('ratelimit-limit');
  });
});
