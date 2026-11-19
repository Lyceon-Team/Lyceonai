/**
 * Build for the guardian-seat screenshot harness (`client/shots-guardian`). NOT shipped.
 * Mirrors `vite.shots-billing.config.ts`, with one addition: the auth context is aliased to a
 * stub that reads the signed-in user from the scene, because the real provider needs a live
 * Supabase session. The alias is listed BEFORE "@" so it wins.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const r = (p: string): string => path.resolve(import.meta.dirname, p);
export default defineConfig({
  plugins: [react()],
  root: r("client/shots-guardian"),
  resolve: {
    alias: [
      {
        find: "@/contexts/SupabaseAuthContext",
        replacement: r("client/shots-guardian/auth-stub.tsx"),
      },
      { find: "@shared", replacement: r("shared") },
      { find: "@lyceon/shared", replacement: r("packages/shared/src") },
      { find: "@assets", replacement: r("attached_assets") },
      { find: "@", replacement: r("client/src") },
    ],
  },
  build: { outDir: r("dist/shots-guardian"), emptyOutDir: true },
});
