import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Use threads pool instead of forks for stability (prevents worker crashes)
    pool: 'threads',
   
        // Limit concurrency to prevent worker pool instability in CI
        minThreads: 1,
        maxThreads: 1,
  
    environmentMatchGlobs: [
      ['apps/api/**/*.test.ts', 'node'],
      ['client/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    include: ['**/*.test.{ts,tsx}'],
    exclude: [
      'tests/regressions.test.ts', // Legacy file with jest syntax, tests migrated to separate files
      'tests/auth.integration.test.ts', // Moved to tests/integration/
      'tests/integration/**', // Integration tests require real Supabase, excluded from default test run
      '**/node_modules/**',
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
})
