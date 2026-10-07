import type { NextFunction, Request, Response } from "express";
import { vi } from "vitest";
import type { SupabaseUser } from "../../server/middleware/supabase-auth";

/**
 * Common environment variables for security tests
 */
export const SECURITY_TEST_ENV = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  SUPABASE_ANON_KEY: "test-key",
  GEMINI_API_KEY: "test-key",
  INGEST_ADMIN_TOKEN: "test-token",
  API_USER_TOKEN: "test-token",
  PUBLIC_SITE_URL: "http://localhost:5000",
  CSRF_SECRET: "test-csrf-secret",
};

/**
 * Sets up the process.env with security test variables immediately upon import.
 */
Object.entries(SECURITY_TEST_ENV).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

const passThrough: Middleware = (_req, _res, next) => next();

/**
 * The mocked signed-in student. Only the fields the security suites rely on are
 * set; the cast is the mock's statement that it stands in for a SupabaseUser.
 */
function attachTestUser(req: Request): void {
  req.user = {
    id: "test-user",
    role: "student",
    isGuardian: false,
    isAdmin: false,
  } as SupabaseUser;
  req.requestId ??= "req-security-test";
}

/**
 * Common mocks for security tests.
 * Use this BEFORE dynamically importing the app.
 */
export function setupSecurityMocks() {
  vi.doMock("../../server/middleware/csrf-double-submit", () => ({
    doubleCsrfProtection: passThrough,
    generateToken: () => "test-csrf-token",
  }));

  vi.doMock("../../server/middleware/supabase-auth", () => ({
    supabaseAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
      attachTestUser(req);
      next();
    },
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      attachTestUser(req);
      next();
    },
    // Global deletion lock — pass-through in security tests (not exercising deletion state).
    enforceDeletionLock: passThrough,
    requireRequestUser: (req: Request, res: Response) => {
      if (!req.user?.id) {
        res.status(401).json({
          error: "Authentication required",
          message: "You must be signed in to access this resource",
          requestId: req.requestId,
        });
        return null;
      }
      return req.user;
    },
    requireStudentOnly: passThrough,
    requireStudentOrAdmin: passThrough,
    requireStudentAccount: passThrough,
    requireSupabaseAdmin: passThrough,
    requireProfileComplete: passThrough,
    requireGuardianLinkForUnder13: passThrough,
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

  // usage-limits (System A) retired — L1.6. No mock needed.

  vi.doMock("../../logger.js", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));
}
