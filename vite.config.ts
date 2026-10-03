import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { legalContentPlugin } from "./vite-plugin-legal-content";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [
    react(),
    legalContentPlugin(import.meta.dirname),
    // runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
      ? [
        // await import("@replit/vite-plugin-cartographer").then((m) =>
        //   m.cartographer(),
        // ),
      ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      // The client had NO module path to packages/shared, so every client-side DTO was
      // hand-written with a "kept in step by review" note — and eleven of those hand-written
      // guardian types produced the GuardianWeaknessResponse crash, a type that matched no
      // server response. One alias makes "derive from the server contract" achievable
      // instead of aspirational.
      "@lyceon/shared": path.resolve(import.meta.dirname, "packages", "shared", "src"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // Dev server only. Without this, Vite finds dependencies as the browser first imports them,
  // re-bundles, and reloads every open page ("optimized dependencies changed. reloading"). On
  // a cold CI start that reload landed mid-test in guardian-e2e: opening the add-student
  // dialog first imports @radix-ui/react-dialog, so the page reloaded while the test measured
  // it (the Suspense fallback on screen, or "Execution context was destroyed"). Crawling every
  // client source file at startup bundles all of them before the first page loads. Tests are
  // left out: they import test-only packages the browser never loads.
  optimizeDeps: {
    entries: [
      "index.html",
      "src/**/*.{ts,tsx}",
      "!src/**/*.test.{ts,tsx}",
      "!src/**/__tests__/**",
    ],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },

    chunkSizeWarningLimit: 500
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:" + (env.PORT || 5000),
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:" + (env.PORT || 5000),
        changeOrigin: true,
      },
    },
  },
  };
});
