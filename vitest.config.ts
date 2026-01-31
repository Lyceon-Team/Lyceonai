import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['apps/api/**/*.test.ts', 'node'],
      ['client/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    include: ['**/*.test.{ts,tsx}'],
    // Exclude ingestion tests unless INGESTION_ENABLED=true
    exclude: process.env.INGESTION_ENABLED === 'true' 
      ? []
      : [
          'apps/api/src/ingestion_v4/**/*.test.ts',
          'apps/api/src/ingestion/**/*.test.ts',
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
