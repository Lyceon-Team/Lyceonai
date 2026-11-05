/**
 * Build for the cancellation screenshot harness (`client/shots-billing`).
 * Mirrors `vite.shots.config.ts`; separate so the calendar harness keeps its own entry and
 * neither vertical's scenes can break the other's build.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "client/shots-billing"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@lyceon/shared": path.resolve(
        import.meta.dirname,
        "packages/shared/src",
      ),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/shots-billing"),
    emptyOutDir: true,
  },
});
