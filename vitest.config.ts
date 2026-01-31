import { configDefaults, defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"
import { loadEnvFile } from "./shared/loadEnv"

loadEnvFile();

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.INGESTION_ENABLED === "true"
        ? []
        : ["apps/api/src/ingestion_v4/__tests__/**"]),
    ],
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
