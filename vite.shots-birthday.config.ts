/**
 * Build for the birthday-input screenshot harness (`client/shots-birthday`).
 * Mirrors `vite.shots-billing.config.ts`; separate so each vertical's scenes keep their own
 * entry and neither can break the other's build.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "client/shots-birthday"),
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
    outDir: path.resolve(import.meta.dirname, "dist/shots-birthday"),
    emptyOutDir: true,
  },
});
