import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
<<<<<<< HEAD
    setupFiles: ['./vitest.setup.ts'],
    // Use threads pool instead of forks for stability (prevents worker crashes)
    pool: 'threads',
   

            // Limit concurrency to prevent worker pool instability in CI
        minThreads: 1,
        maxThreads: 1,
=======
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
    environmentMatchGlobs: [
      ['apps/api/**/*.test.ts', 'node'],
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
