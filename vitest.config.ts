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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
})
