#!/usr/bin/env node
/**
 * Route Registry Validation Script
 *
 * @spec [Doc-06A §5.3.1; docs/plans/seo/seo-marketing-vertical.md §5 F12; owner ruling 2026-10-03:
 *   infra/route-surface-classification.yaml is the canonical registry, docs/route-registry.md is
 *   prose checked against it] | @implemented [2026-10-03]
 *
 * Ensures that:
 * 1. Every route in client/src/App.tsx (and GUARDIAN_ROUTES) has a row in
 *    infra/route-surface-classification.yaml — "CI fails on an unregistered route" (F12).
 * 2. Every row in the YAML names a route App.tsx mounts (no stale classifications).
 * 3. docs/route-registry.md lists exactly the YAML's routes as ACTIVE, so the prose (roles,
 *    entitlements, endpoints) cannot describe a different route set.
 * The YAML is parsed by shared/seo/route-registry.ts — the same parser the build uses — so a row
 * the build would reject fails here too. Run with tsx (it imports TypeScript).
 *
 * Exit codes:
 * - 0: All routes are properly documented
 * - 1: Validation failed (missing or undocumented routes)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRouteRegistry } from '../shared/seo/route-registry.ts';
import { CONTENT_PAGE_PATHS } from '../shared/content/pages/paths.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Extract route paths from App.tsx
 * Looks for <Route path="..." patterns
 */
function extractAppRoutes() {
  const appTsxPath = path.join(projectRoot, 'client/src/App.tsx');
  const content = fs.readFileSync(appTsxPath, 'utf-8');
  
  const routes = new Set();
  
  // Match <Route path="/some-path" or <Route path="/some/:param"
  const routeRegex = /<Route\s+path="([^"]+)"/g;
  let match;
  
  while ((match = routeRegex.exec(content)) !== null) {
    const routePath = match[1];
    routes.add(routePath);
  }

  // G4-01: the guardian routes are mounted from one table (GUARDIAN_ROUTES), so they are read
  // from that table rather than restated in App.tsx. Fail loudly if App.tsx stops mounting it
  // or the table stops declaring paths — a silent zero would let the registry drift.
  if (content.includes('GUARDIAN_ROUTES')) {
    const guardianRoutesPath = path.join(projectRoot, 'client/src/features/guardian/routes.tsx');
    const guardianContent = fs.readFileSync(guardianRoutesPath, 'utf-8');
    const pathRegex = /\bpath:\s*"([^"]+)"/g;
    let found = 0;
    while ((match = pathRegex.exec(guardianContent)) !== null) {
      routes.add(match[1]);
      found += 1;
    }
    if (found === 0) {
      throw new Error('GUARDIAN_ROUTES is mounted in App.tsx but declares no paths');
    }
  }

  // SEO Wave 3 (C2, 2026-10-05): the content pages are mounted from one list
  // (CONTENT_PAGE_PATHS), read here as the module itself rather than by pattern. Same loud
  // failure as the guardian table if App.tsx mounts it and it is empty.
  if (content.includes('CONTENT_PAGE_PATHS')) {
    if (CONTENT_PAGE_PATHS.length === 0) {
      throw new Error('CONTENT_PAGE_PATHS is mounted in App.tsx but lists no paths');
    }
    for (const contentPath of CONTENT_PAGE_PATHS) routes.add(contentPath);
  }

  return Array.from(routes).sort();
}

/**
 * Extract ACTIVE routes from route-registry.md
 * Parses the markdown table to find routes marked as ACTIVE
 */
function extractRegistryActiveRoutes() {
  const registryPath = path.join(projectRoot, 'docs/route-registry.md');
  
  if (!fs.existsSync(registryPath)) {
    console.error(`${colors.red}ERROR: Route registry not found at ${registryPath}${colors.reset}`);
    return [];
  }
  
  const content = fs.readFileSync(registryPath, 'utf-8');
  const routes = new Set();
  
  // Match markdown table rows with route paths and ACTIVE status
  // Looking for patterns like: | `/path` | ... | ... | ACTIVE |
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Skip header rows and separator rows
    if (line.includes('|---') || line.includes('Route') || line.includes('Path')) {
      continue;
    }
    
    // Match table rows with route paths
    const tableRowMatch = line.match(/^\|\s*`([^`]+)`/);
    if (tableRowMatch) {
      const routePath = tableRowMatch[1];
      
      // Check if this row contains "ACTIVE" status
      if (line.includes('ACTIVE')) {
        routes.add(routePath);
      }
    }
  }
  
  return Array.from(routes).sort();
}

/**
 * Rows of infra/route-surface-classification.yaml (throws on a malformed registry).
 */
function extractYamlRoutes() {
  const yamlPath = path.join(projectRoot, 'infra/route-surface-classification.yaml');
  return parseRouteRegistry(fs.readFileSync(yamlPath, 'utf-8'))
    .map((row) => row.path_pattern)
    .sort();
}

/** Prints the routes in `a` that are not in `b`; returns true if there were any. */
function reportMissing(a, b, heading) {
  const missing = a.filter((route) => !b.includes(route));
  if (missing.length === 0) return false;
  console.log(`${colors.red}❌ ${heading}:${colors.reset}`);
  missing.forEach((route) => console.log(`   ${colors.red}  - ${route}${colors.reset}`));
  console.log('');
  return true;
}

/**
 * Main validation function
 */
function validateRoutes() {
  console.log(`${colors.blue}=== Route Registry Validation ===${colors.reset}\n`);

  const appRoutes = extractAppRoutes();
  const yamlRoutes = extractYamlRoutes();
  const proseRoutes = extractRegistryActiveRoutes();

  console.log(`${colors.magenta}Found ${appRoutes.length} routes in App.tsx${colors.reset}`);
  console.log(`${colors.magenta}Found ${yamlRoutes.length} rows in infra/route-surface-classification.yaml${colors.reset}`);
  console.log(`${colors.magenta}Found ${proseRoutes.length} ACTIVE routes in docs/route-registry.md${colors.reset}\n`);

  const errors = [
    reportMissing(appRoutes, yamlRoutes, 'Routes in App.tsx but NOT classified in infra/route-surface-classification.yaml'),
    reportMissing(yamlRoutes, appRoutes, 'Rows in infra/route-surface-classification.yaml naming no App.tsx route'),
    reportMissing(yamlRoutes, proseRoutes, 'Registry routes NOT listed ACTIVE in docs/route-registry.md'),
    reportMissing(proseRoutes, yamlRoutes, 'ACTIVE routes in docs/route-registry.md NOT in the registry'),
  ].some(Boolean);

  if (!errors) {
    console.log(`${colors.green}✅ All routes are properly documented!${colors.reset}`);
    console.log(`${colors.green}   - ${appRoutes.length} routes in App.tsx${colors.reset}`);
    console.log(`${colors.green}   - ${yamlRoutes.length} rows in the registry${colors.reset}`);
    console.log(`${colors.green}   - ${proseRoutes.length} ACTIVE routes in docs/route-registry.md${colors.reset}`);
    console.log('');
    return 0;
  }
  console.log(`${colors.yellow}Classify every App.tsx route in infra/route-surface-classification.yaml, and keep docs/route-registry.md in step with it${colors.reset}\n`);
  return 1;
}

// Run validation
let exitCode;
try {
  exitCode = validateRoutes();
} catch (error) {
  console.error(`${colors.red}❌ ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
  exitCode = 1;
}
process.exit(exitCode);
