#!/usr/bin/env node
/**
 * Route Registry Validation Script
 * 
 * Ensures that:
 * 1. All routes in client/src/App.tsx are documented in docs/route-registry.md
 * 2. All ACTIVE routes in docs/route-registry.md exist in client/src/App.tsx
 * 
 * Exit codes:
 * - 0: All routes are properly documented
 * - 1: Validation failed (missing or undocumented routes)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
 * Main validation function
 */
function validateRoutes() {
  console.log(`${colors.blue}=== Route Registry Validation ===${colors.reset}\n`);
  
  const appRoutes = extractAppRoutes();
  const registryRoutes = extractRegistryActiveRoutes();
  
  console.log(`${colors.magenta}Found ${appRoutes.length} routes in App.tsx${colors.reset}`);
  console.log(`${colors.magenta}Found ${registryRoutes.length} ACTIVE routes in route-registry.md${colors.reset}\n`);
  
  // Find routes in App.tsx but not in registry
  const undocumented = appRoutes.filter(route => !registryRoutes.includes(route));
  
  // Find ACTIVE routes in registry but not in App.tsx
  const missing = registryRoutes.filter(route => !appRoutes.includes(route));
  
  let hasErrors = false;
  
  if (undocumented.length > 0) {
    hasErrors = true;
    console.log(`${colors.red}❌ Routes in App.tsx but NOT documented in route-registry.md:${colors.reset}`);
    undocumented.forEach(route => {
      console.log(`   ${colors.red}  - ${route}${colors.reset}`);
    });
    console.log('');
  }
  
  if (missing.length > 0) {
    hasErrors = true;
    console.log(`${colors.red}❌ ACTIVE routes in route-registry.md but NOT found in App.tsx:${colors.reset}`);
    missing.forEach(route => {
      console.log(`   ${colors.red}  - ${route}${colors.reset}`);
    });
    console.log('');
  }
  
  if (!hasErrors) {
    console.log(`${colors.green}✅ All routes are properly documented!${colors.reset}`);
    console.log(`${colors.green}   - ${appRoutes.length} routes in App.tsx${colors.reset}`);
    console.log(`${colors.green}   - ${registryRoutes.length} ACTIVE routes in registry${colors.reset}`);
    console.log('');
    return 0;
  } else {
    console.log(`${colors.yellow}Please update docs/route-registry.md to match App.tsx${colors.reset}\n`);
    return 1;
  }
}

// Run validation
const exitCode = validateRoutes();
process.exit(exitCode);
