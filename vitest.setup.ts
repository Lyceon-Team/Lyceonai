/**
 * Vitest setup file - runs before all tests
 * 
 * Sets up test-safe environment variables and mocks to prevent:
 * - "supabaseUrl is required" errors during module imports
 * - Accidental network calls to real Supabase in tests
 */

import '@testing-library/jest-dom/vitest';

// Set test-safe Supabase env vars if not already set
// These are dummy values - the actual Supabase client in apps/api/src/lib/supabase.ts
// will detect test mode and use a placeholder client that won't make real network calls
if (!process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = 'https://test-placeholder.supabase.co';
}

if (!process.env.SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = 'test-placeholder-anon-key';
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder-service-role-key';
}

// Do-not-contact suppression (owner brief 2026-09-17 §2.1). The notification dispatcher fails
// CLOSED without this secret — it can no longer check the suppression list, so it defers every
// message rather than risk mailing somebody who asked never to be contacted again. That is the
// right production behaviour and the wrong default for a test run, where it would silently turn
// every send assertion in every notification suite into a deferral. A dummy value here restores
// "sending works unless something says otherwise"; the suites that test the absent-secret path
// pass an explicit empty environment instead of relying on the global.
if (!process.env.SUPPRESSION_HMAC_SECRET) {
  process.env.SUPPRESSION_HMAC_SECRET = 'test-placeholder-suppression-hmac-secret';
}

// Ensure test environment is properly marked
process.env.VITEST = 'true';
process.env.NODE_ENV = 'test';

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

console.log('[VITEST-SETUP] Test environment configured with placeholder Supabase credentials');
