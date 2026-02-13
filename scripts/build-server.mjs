#!/usr/bin/env node
/**
 * Build server bundle using esbuild-wasm - Production-ready configuration
 * 
 * Uses deterministic esbuild-wasm with custom externalization:
 * - Automatically externalizes all bare imports (node_modules)
 * - Bundles all local/relative imports
 * - Never externalizes the entry point or relative/absolute paths
 * 
 * This ensures cross-platform deterministic builds (including Windows).
 */

import * as esbuild from 'esbuild-wasm';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

/**
 * Check if an import path is a bare import (package from node_modules).
 * Returns false for:
 * - Relative paths (starting with ./ or ../)
 * - Absolute paths (starting with /)
 * - Windows absolute paths (C:\ or C:/, D:\ or D:/, etc.)
 * - Paths containing backslashes (Windows paths)
 */
function isBareImport(path) {
  if (!path) return false;
  // Relative paths
  if (path.startsWith("./") || path.startsWith("../")) return false;
  // Absolute paths (Unix)
  if (path.startsWith("/")) return false;
  // Windows absolute paths like C:\... or C:/...
  if (/^[A-Za-z]:[/\\]/.test(path)) return false;
  // Any path with backslashes is a Windows path
  if (path.includes("\\")) return false;
  return true;
}

async function buildServer() {
  try {
    // Initialize esbuild-wasm explicitly (required for Node.js)
    console.log('Initializing esbuild-wasm...');
    await esbuild.initialize();
    
    const outfile = join(rootDir, 'dist', 'index.js');
    const entryPoint = resolve(rootDir, 'server', 'index.ts');
    
    console.log('Building server with esbuild-wasm...');
    console.log(`Working dir: ${rootDir}`);
    console.log(`Entry: ${entryPoint}`);
    console.log(`Output: ${outfile}`);

    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outfile,
      absWorkingDir: rootDir,
      
      // Custom externalization plugin
      plugins: [{
        name: 'externalize-bare-imports',
        setup(build) {
          // Externalize only bare imports (node_modules packages)
          build.onResolve({ filter: /.*/ }, (args) => {
            // Never externalize entry points
            if (args.kind === 'entry-point') {
              console.log(`[Plugin] Entry point detected: ${args.path} (kind: ${args.kind})`);
              return; // Let esbuild handle it
            }
            
            // Never externalize relative or absolute paths
            if (!isBareImport(args.path)) {
              return; // Let esbuild bundle it
            }
            
            // Externalize bare imports (packages)
            return { path: args.path, external: true };
          });
        }
      }],
      
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
