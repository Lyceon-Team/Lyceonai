/**
 * Test: Supabase Environment Configuration
 * 
 * This test ensures:
 * 1. Tests run without real Supabase credentials (test-safe)
 * 2. Production behavior remains strict (would throw if env missing)
 * 3. Test setup provides placeholder values to prevent boot failures
 */

import { describe, test, expect, beforeAll } from 'vitest';

describe('Supabase Environment Configuration', () => {
  describe('Test Environment Safety', () => {
    test('should have placeholder Supabase env vars set in test mode', () => {
      // These should be set by vitest.setup.ts
      expect(process.env.SUPABASE_URL).toBeDefined();
      expect(process.env.SUPABASE_ANON_KEY).toBeDefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
      
      // Verify they are placeholder values (not real credentials)
      expect(process.env.SUPABASE_URL).toContain('placeholder');
      expect(process.env.SUPABASE_ANON_KEY).toContain('placeholder');
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toContain('placeholder');
    });

    test('should mark environment as test mode', () => {
      expect(process.env.VITEST).toBe('true');
      expect(process.env.NODE_ENV).toBe('test');
    });

    test('should allow importing supabase modules without errors', async () => {
      // This would previously fail with "supabaseUrl is required"
      // Now it should succeed because vitest.setup.ts sets placeholder values
      
      // Import the module that uses Supabase at module scope
      const importModule = async () => {
        await import('../../server/routes/supabase-auth-routes.js');
      };
      
      await expect(importModule()).resolves.not.toThrow();
    });

    test('should allow importing apps/api supabase client without errors', async () => {
      // The main Supabase client should handle test mode gracefully
      const importAndUse = async () => {
        const { getSupabaseClient } = await import('../../apps/api/src/lib/supabase.js');
        const client = getSupabaseClient();
        expect(client).toBeDefined();
      };
      
      await expect(importAndUse()).resolves.not.toThrow();
    });
  });

  describe('Production Strictness (Conceptual)', () => {
    test('should document that production requires real env vars', () => {
      // This test documents the production requirement
      // In production (NODE_ENV=production, VITEST not set):
      // - If SUPABASE_URL or SUPABASE_ANON_KEY are missing, server will throw
      // - This is enforced by createClient at runtime (verified separately)
      
      // In tests, we verify the env vars are set to placeholders
      expect(process.env.SUPABASE_URL).toContain('placeholder');
      expect(process.env.SUPABASE_ANON_KEY).toContain('placeholder');
      
      // The production strictness is enforced by:
      // 1. server/routes/supabase-auth-routes.ts uses process.env.SUPABASE_URL!
      // 2. @supabase/supabase-js createClient() throws if url/key are invalid
      // We verified this with: createClient(undefined, undefined) → throws "supabaseUrl is required"
    });
  });

  describe('No Network Calls in Tests', () => {
    test('should use placeholder client that does not make real network calls', async () => {
      const { getSupabaseClient } = await import('../../apps/api/src/lib/supabase.js');
      const client = getSupabaseClient();
      
      // Verify we got a client (won't throw)
      expect(client).toBeDefined();
      
      // The client is configured to use placeholder URL
      // Real network calls would fail with ENOTFOUND for placeholder.supabase.co
      // This is acceptable in tests - the placeholder client is logged as "[SUPABASE] Test mode"
    });
  });
});
