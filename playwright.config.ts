import { defineConfig } from "@playwright/test";

// @spec [n/a — e2e test-harness tooling, no governing docs/Spec section] | @implemented [2026-06-17]
// plain English: durable Playwright e2e harness config. Tests live in tests/e2e; baseURL comes from
// E2E_BASE_URL (CI points it at the Vercel preview URL pulled via the Vercel connector) and falls
// back to the local dev server on :3000. chromium-only to start (covers the e2e path); add
// firefox/webkit later if cross-browser coverage is needed.
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
});
