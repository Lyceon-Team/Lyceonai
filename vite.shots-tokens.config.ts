/**
 * Build for the `--primary` token gallery (`client/shots-tokens`).
 * Mirrors `vite.shots.config.ts`; its own entry so neither harness can break the other.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "client/shots-tokens"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@lyceon/shared": path.resolve(import.meta.dirname, "packages/shared/src"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/shots-tokens"),
    emptyOutDir: true,
  },
});
