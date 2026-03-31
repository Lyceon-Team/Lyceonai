import { vi } from 'vitest';

/**
 * Common environment variables for security tests
 */
export const SECURITY_TEST_ENV = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  SUPABASE_ANON_KEY: 'test-key',
  GEMINI_API_KEY: 'test-key',
  INGEST_ADMIN_TOKEN: 'test-token',
  API_USER_TOKEN: 'test-token',
  PUBLIC_SITE_URL: 'http://localhost:5000',
  CSRF_SECRET: 'test-csrf-secret',
};

/**
 * Sets up the process.env with security test variables immediately upon import.
 */
Object.entries(SECURITY_TEST_ENV).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

/**
 * Common mocks for security tests.
 * Use this BEFORE dynamically importing the app.
 */
export function setupSecurityMocks() {
  vi.doMock('../../server/middleware/csrf', () => ({
    csrfGuard: () => (req: any, res: any, next: any) => next(),
  }));

  vi.doMock('../../server/middleware/csrf-double-submit', () => ({
    doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
    generateToken: () => 'test-csrf-token',
  }));

  vi.doMock('../../server/middleware/supabase-auth', () => ({
    supabaseAuthMiddleware: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'test-user',
        role: 'student',
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= 'req-security-test';
      next();
    },
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'test-user',
        role: 'student',
        isGuardian: false,
        isAdmin: false,
      };
      req.requestId ??= 'req-security-test';
      next();
    },
    requireRequestUser: (req: any, res: any) => {
      if (!req.user?.id) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'You must be signed in to access this resource',
          requestId: req.requestId,
        });
        return null;
      }
      return req.user;
    },
    requireRequestAuthContext: (req: any, res: any) => {
      if (!req.user?.id) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'You must be signed in to access this resource',
          requestId: req.requestId,
        });
        return null;
      }
      return { user: req.user, supabase: req.supabase };
    },
    requireStudentOrAdmin: (_req: any, _res: any, next: any) => next(),
    requireSupabaseAdmin: (_req: any, _res: any, next: any) => next(),
    getSupabaseAdmin: () => ({
      rpc: vi.fn(async () => ({ data: "acc-test", error: null })),
    }),
    resolveTokenFromRequest: () => ({
      token: "test-token-123456789012345",
      tokenSource: "cookie:sb-access-token",
      cookieKeys: ["sb-access-token"],
      authHeaderPresent: false,
      tokenLength: 27,
      bearerParsed: false,
    }),
  }));

  vi.doMock('../../server/middleware/usage-limits', () => ({
    checkAiChatLimit: () => (req: any, res: any, next: any) => next(),
    checkPracticeLimit: () => (req: any, res: any, next: any) => next(),
  }));

  vi.doMock('../../logger.js', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
  }));
}

