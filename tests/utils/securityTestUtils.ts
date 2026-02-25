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

  vi.doMock('../../server/middleware/supabase-auth', () => ({
    supabaseAuthMiddleware: (req: any, res: any, next: any) => next(),
    requireSupabaseAuth: (req: any, res: any, next: any) => {
      req.user = { id: 'test-user', role: 'student' };
      next();
    },
    requireStudentOrAdmin: (req: any, res: any, next: any) => next(),
    requireSupabaseAdmin: (req: any, res: any, next: any) => next(),
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




