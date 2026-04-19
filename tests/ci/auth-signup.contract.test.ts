<<<<<<< HEAD
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUpMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const profileEqMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const profileUpdateMock = vi.hoisted(() => vi.fn(() => ({ eq: profileEqMock })));
const profileFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        update: profileUpdateMock,
      };
    }

    if (table === "legal_acceptances") {
      return {
        upsert: upsertMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
);

vi.mock("../../server/middleware/csrf-double-submit.js", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/supabase-auth.js", () => ({
  getSupabaseAdmin: () => ({
    from: profileFromMock,
  }),
  requireSupabaseAuth: (_req: any, _res: any, next: any) => next(),
  resolveTokenFromRequest: vi.fn(() => ({
    token: null,
    tokenSource: null,
    tokenLength: null,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: [],
  })),
  resolveUserIdFromToken: vi.fn(async () => null),
}));

vi.mock("../../server/lib/email.js", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: vi.fn(),
      refreshSession: vi.fn(),
      getUser: vi.fn(),
=======
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseSignUpMock = vi.hoisted(() => vi.fn());
const setAuthCookiesMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: supabaseSignUpMock,
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
    },
  })),
}));

<<<<<<< HEAD
const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};

async function loadAuthApp() {
  vi.resetModules();
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.SUPABASE_URL = "https://lyceon-prod.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";

  const { default: authRoutes } = await import("../../server/routes/supabase-auth-routes");
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

describe("Auth Signup Contract", () => {
=======
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
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
  beforeEach(() => {
    vi.clearAllMocks();
  });

<<<<<<< HEAD
  it("rejects signup payloads that omit canonical legal consent", async () => {
    const app = await loadAuthApp();

    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "student@example.com",
        password: "Password123!",
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("returns verification_required when Supabase signup has no session", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-verification",
          email: "verify@example.com",
        },
        session: null,
=======
  it('returns authenticated status and sets canonical cookies when signup session exists', async () => {
    const app = await buildSignupApp();

    supabaseSignUpMock.mockResolvedValue({
      data: {
        user: { id: 'user-authenticated', email: 'authenticated@example.com' },
        session: { access_token: 'token-a', refresh_token: 'token-r', expires_in: 3600 },
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
      },
      error: null,
    });

<<<<<<< HEAD
    const app = await loadAuthApp();

    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "verify@example.com",
        password: "Password123!",
        displayName: "Verify User",
        legalConsent: {
          studentTermsAccepted: true,
          privacyPolicyAccepted: true,
          consentSource: "email_signup_form",
        },
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      outcome: "verification_required",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);

    const upsertRows = upsertMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(Array.isArray(upsertRows)).toBe(true);
    expect(upsertRows).toHaveLength(2);
    expect(upsertRows.every((row) => row.consent_source === "email_signup_form")).toBe(true);
  });

  it("returns authenticated outcome and canonical cookies when session is present", async () => {
    signUpMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-authenticated",
          email: "auth@example.com",
        },
        session: {
          access_token: "a".repeat(48),
          refresh_token: "r".repeat(48),
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "user-authenticated",
            email: "auth@example.com",
          },
        },
      },
      error: null,
    });

    const app = await loadAuthApp();

    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "auth@example.com",
        password: "Password123!",
        displayName: "Auth User",
        legalConsent: {
          studentTermsAccepted: true,
          privacyPolicyAccepted: true,
          consentSource: "email_signup_form",
        },
=======
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5000')
      .send({
        email: 'authenticated@example.com',
        password: 'Password123!',
        role: 'student',
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
<<<<<<< HEAD
      outcome: "authenticated",
      nextPath: "/profile/complete",
    });

    const setCookies = res.headers["set-cookie"] ?? [];
    expect(setCookies.some((cookie: string) => cookie.startsWith("sb-access-token="))).toBe(true);
    expect(setCookies.some((cookie: string) => cookie.startsWith("sb-refresh-token="))).toBe(true);
  });
});

afterEach(() => {
  process.env.NODE_ENV = baselineEnv.NODE_ENV;
  process.env.VITEST = baselineEnv.VITEST;
  process.env.SUPABASE_URL = baselineEnv.SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = baselineEnv.SUPABASE_ANON_KEY;
});
=======
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
>>>>>>> 8acb2add0221722e9c0895b0dce6c2778f44c4fc
