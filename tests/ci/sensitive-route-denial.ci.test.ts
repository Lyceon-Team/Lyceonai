import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resolveTokenFromRequest } from '../../server/middleware/supabase-auth';

describe('Sensitive Route Denial', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';

    const serverModule = await import('../../server/index');
    app = serverModule.default;
  });

  it('rejects bearer token source even when auth cookie is present', () => {
    const req = {
      headers: { authorization: 'Bearer this-should-be-denied' },
      cookies: { 'sb-access-token': 'x'.repeat(64) },
      get: (name: string) => {
        if (name.toLowerCase() === 'authorization') {
          return 'Bearer this-should-be-denied';
        }
        return undefined;
      },
    } as any;

    const result = resolveTokenFromRequest(req);

    expect(result.tokenSource).toBe('bearer');
    expect(result.bearerParsed).toBe(true);
    expect(result.token).toBeNull();
  });

  it('denies /api/profile when bearer header is provided alongside cookie', async () => {
    const res = await request(app)
      .get('/api/profile')
      .set('Authorization', 'Bearer ey.fake.jwt.token')
      .set('Cookie', [`sb-access-token=${'x'.repeat(64)}`]);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Authentication required',
      message: 'You must be signed in to access this resource',
    });
    expect(res.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('ey.fake.jwt.token');
  });
});
