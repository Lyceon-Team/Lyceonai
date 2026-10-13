/**
 * Vite for the calculator harness (tests/e2e/desmos-harness), with the app's aliases and its
 * PostCSS/Tailwind setup, so `DesmosCalculator` renders with the real stylesheet.
 * @spec [n/a — e2e test-harness tooling; the calculator is Doc-02B_v4 §28] | @implemented [2026-10-11]
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const repo = path.resolve(import.meta.dirname, "..", "..", "..");

export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  resolve: {
    alias: {
      "@": path.resolve(repo, "client", "src"),
      "@shared": path.resolve(repo, "shared"),
      "@lyceon/shared": path.resolve(repo, "packages", "shared", "src"),
    },
  },
  css: { postcss: repo },
  envDir: repo,
  server: {
    port: Number(process.env.DESMOS_HARNESS_PORT ?? "5174"),
    strictPort: true,
  },
});
