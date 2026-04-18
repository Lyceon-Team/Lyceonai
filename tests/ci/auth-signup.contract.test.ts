import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseSignUpMock = vi.hoisted(() => vi.fn());
const setAuthCookiesMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: supabaseSignUpMock,
    },
  })),
}));

vi.mock('../../server/middleware/csrf-double-submit', () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/middleware/supabase-auth', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  }),
  requireSupabaseAuth: (_req: any, _res: any, next: any) => next(),
  resolveTokenFromRequest: vi.fn(() => ({ token: null })),
  resolveUserIdFromToken: vi.fn(async () => null),
}));

vi.mock('../../server/lib/auth-cookies', () => ({
  setAuthCookies: setAuthCookiesMock,
  clearAuthCookies: vi.fn(),
}));

vi.mock('../../server/lib/email', () => ({
  sendEmail: vi.fn(async () => undefined),
}));

async function buildSignupApp() {
  vi.resetModules();
  process.env.VITEST = 'false';
  process.env.NODE_ENV = 'development';
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';

  const signupRouter = (await import('../../server/routes/supabase-auth-routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', signupRouter);
  return app;
}

describe('Auth signup session contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns authenticated status and sets canonical cookies when signup session exists', async () => {
    const app = await buildSignupApp();

    supabaseSignUpMock.mockResolvedValue({
      data: {
        user: { id: 'user-authenticated', email: 'authenticated@example.com' },
        session: { access_token: 'token-a', refresh_token: 'token-r', expires_in: 3600 },
      },
      error: null,
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5000')
      .send({
        email: 'authenticated@example.com',
        password: 'Password123!',
        role: 'student',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      status: 'authenticated',
      user: {
        id: 'user-authenticated',
        email: 'authenticated@example.com',
      },
    });
    expect(setAuthCookiesMock).toHaveBeenCalledTimes(1);
  });

  it('returns verification_required without auth-interpretable fields when signup session is missing', async () => {
    const app = await buildSignupApp();

    supabaseSignUpMock.mockResolvedValue({
      data: {
        user: { id: 'user-verify', email: 'verify@example.com' },
        session: null,
      },
      error: null,
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5000')
      .send({
        email: 'verify@example.com',
        password: 'Password123!',
        role: 'student',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      status: 'verification_required',
      verificationRequired: true,
    });
    expect(res.body).not.toHaveProperty('user');
    expect(res.body).not.toHaveProperty('authenticated');
    expect(res.body).not.toHaveProperty('session');
    expect(res.body).not.toHaveProperty('access_token');
    expect(res.body).not.toHaveProperty('refresh_token');
    expect(setAuthCookiesMock).not.toHaveBeenCalled();
  });
});
