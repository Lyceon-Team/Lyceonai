/**
 * Auth Test Helpers
 * 
 * Helper functions for testing authentication flows in CI tests.
 * These helpers create valid test requests with proper auth cookies
 * without requiring real Supabase credentials.
 */

import { generateMockToken } from './mock-supabase';

/**
 * Create a cookie string for authenticated requests
 * Simulates the sb-access-token cookie that would be set by the auth flow
 */
export function createAuthCookie(userId: string): string {
  const token = generateMockToken(userId);
  return `sb-access-token=${token}`;
}

/**
 * Create auth cookies object for supertest requests
 */
export function createAuthCookies(userId: string): Record<string, string> {
  return {
    'sb-access-token': generateMockToken(userId),
  };
}

/**
 * Create a Bearer token header (should be rejected by the auth middleware)
 */
export function createBearerHeader(userId: string): string {
  const token = generateMockToken(userId);
  return `Bearer ${token}`;
}

/**
 * Test user IDs for consistent testing
 */
export const TEST_USER_IDS = {
  student: 'mock-student-id-123',
  admin: 'mock-admin-id-456',
  guardian: 'mock-guardian-id-789',
  under13: 'mock-under13-id-101',
} as const;

/**
 * Valid test origins for CSRF testing
 */
export const TEST_ORIGINS = {
  valid: [
    'http://localhost:5000',
    'http://localhost:3000',
  ],
  invalid: [
    'https://evil.com',
    'http://localhost:5000.evil.com',
    'http://evil.com',
    'https://attacker.com',
  ],
} as const;
