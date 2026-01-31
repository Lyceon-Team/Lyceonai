import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Load environment variables from a local .env file for both local and CI runs.  This
    // ensures values like SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available when
    // tests execute.  Using dotenv/config automatically reads a .env file at the
    // project root before any test code runs.
    setupFiles: ['dotenv/config'],
    environmentMatchGlobs: [
      // Run API tests and integration tests in a Node-like environment.  Without
      // specifying these globs Vitest falls back to the default environment,
      // which may be jsdom or node depending on Vitest version.  Explicitly
      // configuring integration tests avoids accidental jsdom usage in Node
      // contexts.
      ['apps/api/**/*.test.ts', 'node'],
      ['integration/**/*.{spec,test}.{ts,tsx}', 'node'],
      // Client-side React tests need a DOM.  Use jsdom for any client tests.
      ['client/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    include: ['**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
})
