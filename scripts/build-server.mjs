#!/usr/bin/env node
/**
 * Build server bundle using esbuild-wasm for deterministic builds
 * This script bundles server/index.ts into dist/index.js using esbuild-wasm,
 * which avoids the native binary execution issues in some environments.
 */

import * as esbuild from 'esbuild-wasm';
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
    // Match bare imports (not starting with ./ ../ or /)
    build.onResolve({ filter: /^[^./]/ }, args => {
      return { path: args.path, external: true };
    });
  },
};

async function buildServer() {
  try {
    const outfile = join(rootDir, 'dist', 'index.js');
    
    console.log('Building server with esbuild-wasm...');

    // Bundle server (esbuild-wasm auto-initializes in Node.js)
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
