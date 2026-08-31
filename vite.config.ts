import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [
    react(),
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
