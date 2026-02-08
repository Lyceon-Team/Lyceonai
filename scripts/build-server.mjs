#!/usr/bin/env node
/**
 * Build server bundle using esbuild - Production-ready configuration
 * 
 * Uses esbuild's built-in `packages: 'external'` option which:
 * - Automatically externalizes all node_modules
 * - Bundles all local/relative imports
 * - Never externalizes the entry point
 * 
 * This is the official esbuild approach for Node.js server bundling.
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function buildServer() {
  try {
    const outfile = join(rootDir, 'dist', 'index.js');
    const entryPoint = join(rootDir, 'server', 'index.ts');
    
    console.log('Building server with esbuild...');
    console.log(`Entry: ${entryPoint}`);
    console.log(`Output: ${outfile}`);

    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outfile,
      
      // Externalize all node_modules, bundle local code
      // This is the recommended approach for Node.js servers
      packages: 'external',
      
      logLevel: 'info',
      minify: false,
      sourcemap: true,
      target: 'node18',
    });

    if (result.errors.length > 0) {
      console.error('Build failed with errors:', result.errors);
      process.exit(1);
    }

    console.log(`✓ Server bundle created at ${outfile}`);
    console.log(`✓ All local files bundled, all npm packages external`);
    process.exit(0);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildServer();
