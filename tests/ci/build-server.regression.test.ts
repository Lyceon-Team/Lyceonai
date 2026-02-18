/**
 * Build Server Regression Test
 * 
 * This test validates that the server build process:
 * 1. Never marks the entry point as external (Windows/Linux)
 * 2. Correctly identifies bare imports vs. local files
 * 3. Works with both forward slashes and backslashes
 * 
 * CRITICAL: This test prevents the recurring Windows build error:
 * "The entry point "...server\index.ts" cannot be marked as external"
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..', '..');

/**
 * Copied from build-server.mjs for testing
 * Check if an import path is a bare import (package from node_modules).
 */
function isBareImport(path: string): boolean {
  if (!path) return false;
  // Relative paths
  if (path.startsWith("./") || path.startsWith("../")) return false;
  // Absolute paths (Unix)
  if (path.startsWith("/")) return false;
  // Windows absolute paths like C:\... or C:/...
  if (/^[A-Za-z]:[/\\]/.test(path)) return false;
  // Any path with backslashes is a Windows path
  if (path.includes("\\")) return false;
  // Node.js built-in modules should not be externalized
  if (path.startsWith("node:")) return false;
  return true;
}

describe('Build Server Regression Tests', () => {
  describe('isBareImport() - Path Classification', () => {
    it('should identify bare imports (packages from node_modules)', () => {
      expect(isBareImport('express')).toBe(true);
      expect(isBareImport('esbuild-wasm')).toBe(true);
      expect(isBareImport('@radix-ui/react-dialog')).toBe(true);
      expect(isBareImport('react')).toBe(true);
    });

    it('should NOT treat relative paths as bare imports', () => {
      expect(isBareImport('./index.ts')).toBe(false);
      expect(isBareImport('../server/index.ts')).toBe(false);
      expect(isBareImport('./lib/utils')).toBe(false);
    });

    it('should NOT treat Unix absolute paths as bare imports', () => {
      expect(isBareImport('/home/user/project/server/index.ts')).toBe(false);
      expect(isBareImport('/usr/lib/node')).toBe(false);
    });

    it('should NOT treat Windows absolute paths as bare imports (forward slash)', () => {
      expect(isBareImport('C:/Users/14438/projects/lyceonai/server/index.ts')).toBe(false);
      expect(isBareImport('D:/projects/app/index.js')).toBe(false);
      expect(isBareImport('E:/data/file.txt')).toBe(false);
    });

    it('should NOT treat Windows absolute paths as bare imports (backslash)', () => {
      expect(isBareImport('C:\\Users\\14438\\projects\\lyceonai\\server\\index.ts')).toBe(false);
      expect(isBareImport('D:\\projects\\app\\index.js')).toBe(false);
      expect(isBareImport('E:\\data\\file.txt')).toBe(false);
    });

    it('should NOT treat mixed Windows paths as bare imports', () => {
      expect(isBareImport('C:/Users/14438\\projects\\lyceonai/server/index.ts')).toBe(false);
    });

    it('should NOT treat entry point paths as bare imports', () => {
      // Unix-style entry point
      const unixEntry = join(rootDir, 'server', 'index.ts');
      expect(isBareImport(unixEntry)).toBe(false);
      
      // Simulated Windows-style entry point (with backslashes)
      const windowsEntry = 'C:\\Users\\14438\\projects\\lyceonai\\server\\index.ts';
      expect(isBareImport(windowsEntry)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isBareImport('')).toBe(false);
      // Node.js built-ins with protocol should NOT be externalized
      expect(isBareImport('node:fs')).toBe(false);
      expect(isBareImport('node:path')).toBe(false);
    });
  });

  describe('Entry Point Detection', () => {
    it('should correctly identify the server entry point as a local file', () => {
      const entryPoint = resolve(rootDir, 'server', 'index.ts');
      
      // Entry point should NEVER be a bare import
      expect(isBareImport(entryPoint)).toBe(false);
    });

    it('should handle Windows-style paths in the entry point', () => {
      // Simulate Windows paths that would be passed to the plugin
      const windowsPaths = [
        'C:\\Users\\14438\\projects\\lyceonai\\server\\index.ts',
        'D:\\project\\server\\index.ts',
        'C:/Users/14438/projects/lyceonai/server/index.ts',
      ];

      for (const path of windowsPaths) {
        expect(isBareImport(path)).toBe(false);
      }
    });
  });

  describe('Build Configuration Validation', () => {
    it('should use esbuild with --packages=external flag', async () => {
      // This test validates the build configuration uses esbuild directly
      const packageJsonPath = join(rootDir, 'package.json');
      const { readFileSync } = await import('fs');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      // Validate that build script uses esbuild with correct flags
      expect(packageJson.scripts.build).toContain('esbuild');
      expect(packageJson.scripts.build).toContain('--packages=external');
      expect(packageJson.scripts.build).toContain('--bundle');
      expect(packageJson.scripts.build).toContain('--platform=node');
      expect(packageJson.scripts.build).toContain('--format=esm');
      expect(packageJson.scripts.build).toContain('--outfile=dist/index.js');
    });

    it('should build server from server/index.ts entry point', async () => {
      // This test validates the entry point is server/index.ts
      const packageJsonPath = join(rootDir, 'package.json');
      const { readFileSync } = await import('fs');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      // Validate that the entry point is server/index.ts
      expect(packageJson.scripts.build).toContain('server/index.ts');
    });

    it('should externalize npm packages while bundling local files', async () => {
      // The --packages=external flag externalizes all npm packages
      // while bundling local application files.
      // This prevents the "entry point cannot be marked as external" error on Windows.
      
      const packageJsonPath = join(rootDir, 'package.json');
      const { readFileSync } = await import('fs');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      // Verify the build uses --packages=external
      expect(packageJson.scripts.build).toContain('--packages=external');
    });
  });
});
