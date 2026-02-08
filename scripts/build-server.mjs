#!/usr/bin/env node
/**
 * Build server bundle using esbuild
 * This script bundles server/index.ts into dist/index.js using esbuild.
 */

import * as esbuild from 'esbuild';
import { existsSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Plugin to externalize all bare imports (simulates --packages=external)
const externalizePlugin = {
  name: 'externalize-deps',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      // Never externalize the entry point
      if (args.kind === "entry-point") return;

      const p = args.path;

      // Relative paths
      if (p.startsWith("./") || p.startsWith("../")) return;

      // POSIX absolute paths
      if (p.startsWith("/")) return;

      // Windows absolute paths (C:\ or C:/)
      if (/^[A-Za-z]:[\\/]/.test(p)) return;

      // UNC paths (\\server\share\...)
      if (p.startsWith("\\\\")) return;

      // Otherwise treat as bare package import
      return { path: p, external: true };
    });
  },
};

async function buildServer() {
  try {
    const outfile = join(rootDir, 'dist', 'index.js');
    
    console.log('Building server with esbuild...');

    // Bundle server with esbuild
    const result = await esbuild.build({
      entryPoints: [join(rootDir, 'server', 'index.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outfile,
      plugins: [externalizePlugin],
      logLevel: 'info',
    });

    if (result.errors.length > 0) {
      console.error('Build failed with errors:', result.errors);
      process.exit(1);
    }

    console.log(`✓ Server bundle created at ${outfile}`);
    process.exit(0);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildServer();
