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

/**
 * jsdom implements no CSS Object Model, so `window.matchMedia` is simply absent — the same
 * gap the ResizeObserver shim above fills. Any component using a media query (the calendar's
 * §17.7 phone layout, the sidebar, the practice page's calculator) throws
 * "window.matchMedia is not a function" on render without it.
 *
 * Defined only when missing, so a test that installs its own mock to simulate a viewport
 * still wins. The default answers "no match", which with jsdom's 1024px `innerWidth` is the
 * desktop layout — the one a test that never mentions viewports means to be rendering.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

console.log('[VITEST-SETUP] Test environment configured with placeholder Supabase credentials');
