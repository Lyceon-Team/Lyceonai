/**
 * Mock Supabase Client Factory
 * 
 * Creates mock Supabase clients for deterministic CI testing.
 * These mocks simulate authenticated and unauthenticated states
 * without requiring real Supabase credentials.
 * 
 * SECURITY: These mocks are ONLY for testing HTTP boundary behavior.
 * They do NOT bypass auth logic - they simulate what Supabase would return.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface MockUser {
  id: string;
  email: string;
  user_metadata?: Record<string, any>;
}

export interface MockProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: 'student' | 'admin' | 'guardian';
  is_under_13?: boolean;
  guardian_consent?: boolean;
  guardian_email?: string | null;
  student_link_code?: string | null;
}

/**
 * Create a mock Supabase client that simulates an authenticated user
 */
export function createMockAuthenticatedClient(
  user: MockUser,
  profile: MockProfile
): Partial<SupabaseClient> {
  return {
    auth: {
      getUser: async (token: string) => {
        // Simulate successful authentication
        if (token && token.length >= 20) {
          return {
            data: { user },
            error: null,
          };
        }
        return {
          data: { user: null },
          error: { message: 'Invalid token', status: 401 },
        };
      },
    } as any,
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: profile,
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === 'users') {
        return {
          upsert: async () => ({ data: null, error: null }),
        } as any;
      }
      return {} as any;
    },
  } as Partial<SupabaseClient>;
}

/**
 * Create a mock Supabase client that simulates an unauthenticated request
 */
export function createMockUnauthenticatedClient(): Partial<SupabaseClient> {
  return {
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: 'No user found', status: 401 },
      }),
    } as any,
    from: () => ({} as any),
  } as Partial<SupabaseClient>;
}

/**
 * Mock user factory - creates test users with predictable IDs
 */
export const mockUsers = {
  student: (): MockUser => ({
    id: 'mock-student-id-123',
    email: 'student@test.com',
    user_metadata: {
      display_name: 'Test Student',
    },
  }),

  admin: (): MockUser => ({
    id: 'mock-admin-id-456',
    email: 'admin@test.com',
    user_metadata: {
      display_name: 'Test Admin',
    },
  }),

  guardian: (): MockUser => ({
    id: 'mock-guardian-id-789',
    email: 'guardian@test.com',
    user_metadata: {
      display_name: 'Test Guardian',
    },
  }),

  under13: (): MockUser => ({
    id: 'mock-under13-id-101',
    email: 'kid@test.com',
    user_metadata: {
      display_name: 'Test Kid',
      is_under_13: true,
    },
  }),
};

/**
 * Mock profile factory - creates test profiles matching users
 */
export const mockProfiles = {
  student: (): MockProfile => ({
    id: 'mock-student-id-123',
    email: 'student@test.com',
    display_name: 'Test Student',
    role: 'student',
    is_under_13: false,
    guardian_consent: true,
  }),

  admin: (): MockProfile => ({
    id: 'mock-admin-id-456',
    email: 'admin@test.com',
    display_name: 'Test Admin',
    role: 'admin',
    is_under_13: false,
    guardian_consent: true,
  }),

  guardian: (): MockProfile => ({
    id: 'mock-guardian-id-789',
    email: 'guardian@test.com',
    display_name: 'Test Guardian',
    role: 'guardian',
    is_under_13: false,
    guardian_consent: true,
  }),

  under13NoConsent: (): MockProfile => ({
    id: 'mock-under13-id-101',
    email: 'kid@test.com',
    display_name: 'Test Kid',
    role: 'student',
    is_under_13: true,
    guardian_consent: false,
  }),

  under13WithConsent: (): MockProfile => ({
    id: 'mock-under13-id-102',
    email: 'kid2@test.com',
    display_name: 'Test Kid 2',
    role: 'student',
    is_under_13: true,
    guardian_consent: true,
  }),
};

/**
 * Generate a mock JWT token (for cookie simulation)
 * NOT a real JWT - just a deterministic string for testing
 */
export function generateMockToken(userId: string): string {
  // Create a deterministic but sufficiently long token for testing
  // Real JWT format: header.payload.signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 3600000 })).toString('base64');
  const signature = 'mock-signature-' + userId.slice(0, 8);
  return `${header}.${payload}.${signature}`;
}
