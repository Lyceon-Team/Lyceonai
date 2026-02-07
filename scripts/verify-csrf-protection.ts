#!/usr/bin/env tsx
/**
 * CSRF Protection Verification Script
 * 
 * This script verifies that ALL mutating HTTP endpoints (POST/PUT/PATCH/DELETE)
 * that use cookie-based authentication are protected by CSRF protection.
 * 
 * CSRF protection can be applied in three ways:
 * A) csrfProtection passed inline to the route handler
 * B) router.use(csrfProtection) applied before mutating routes in that router file
 * C) server/index.ts mounts that router behind csrfProtection (app.use(prefix, csrfProtection, router))
 * 
 * This script fails deterministically if any mutating route is not protected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RouteDefinition {
  file: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  lineNumber: number;
  hasInlineCsrf: boolean;
  hasRouterLevelCsrf: boolean;
  csrfExemptReason?: string;
}

interface ValidationResult {
  passed: boolean;
  totalRoutes: number;
  protectedRoutes: number;
  unprotectedRoutes: RouteDefinition[];
  exemptRoutes: RouteDefinition[];
}

// Routes that should be excluded from CSRF checks (e.g., webhooks that use signature verification)
const CSRF_EXEMPT_ROUTES = [
  '/api/billing/webhook', // Stripe webhook - uses signature verification instead of CSRF
];

/**
 * Check if a line contains CSRF protection middleware
 */
function hasCsrfProtection(line: string): boolean {
  return /csrfProtection|csrfGuard/.test(line);
}

/**
 * Extract route definitions from a TypeScript file
 */
function extractRouteDefinitions(filePath: string): RouteDefinition[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const routes: RouteDefinition[] = [];
  
  // Check for router-level CSRF protection
  let hasRouterLevelCsrf = false;
  for (const line of lines) {
    if (/router\.use\(csrfProtection\)|router\.use\(csrfGuard\(\)\)/.test(line)) {
      hasRouterLevelCsrf = true;
      break;
    }
  }
  
  // Find all route definitions
  const routePattern = /router\.(post|put|patch|delete)\(/gi;
  
  lines.forEach((line, index) => {
    const matches = line.matchAll(routePattern);
    for (const match of matches) {
      const method = match[1].toUpperCase() as 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      
      // Extract path (rough heuristic - looks for first string after method)
      const pathMatch = line.match(/['"](\/[^'"]*)['"]/);
      const routePath = pathMatch ? pathMatch[1] : '<unknown>';
      
      // Check if this line has inline CSRF protection
      const hasInlineCsrf = hasCsrfProtection(line);
      
      // Check for CSRF_EXEMPT_REASON comment in current line or preceding lines
      let csrfExemptReason: string | undefined;
      
      // Check current line
      const exemptMatch = line.match(/CSRF_EXEMPT_REASON:\s*(.+)/);
      if (exemptMatch) {
        csrfExemptReason = exemptMatch[1].trim();
      }
      
      // If not found, check up to 10 preceding lines for comment blocks
      if (!csrfExemptReason) {
        for (let i = Math.max(0, index - 10); i < index; i++) {
          const prevLine = lines[i];
          const prevExemptMatch = prevLine.match(/CSRF_EXEMPT_REASON:\s*(.+)/);
          if (prevExemptMatch) {
            csrfExemptReason = prevExemptMatch[1].trim();
            break;
          }
        }
      }
      
      routes.push({
        file: path.basename(filePath),
        method,
        path: routePath,
        lineNumber: index + 1,
        hasInlineCsrf,
        hasRouterLevelCsrf,
        csrfExemptReason,
      });
    }
  });
  
  return routes;
}

/**
 * Check if a route is mounted with CSRF protection in server/index.ts
 */
function checkServerMountProtection(routePath: string): boolean {
  const indexPath = path.join(__dirname, '..', 'server', 'index.ts');
  const content = fs.readFileSync(indexPath, 'utf-8');
  
  // Look for app.use patterns that mount this route with CSRF
  // Example: app.use("/api/...", csrfProtection, routerName)
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Check if line mounts a router
    if (/app\.(use|post|put|patch|delete)\(/.test(line)) {
      // Check if it has the route path and CSRF protection
      if (line.includes(routePath) && hasCsrfProtection(line)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Validate all routes in the server/routes directory
 */
function validateRoutes(): ValidationResult {
  const routesDir = path.join(__dirname, '..', 'server', 'routes');
  const routeFiles = fs.readdirSync(routesDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  
  const allRoutes: RouteDefinition[] = [];
  
  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const routes = extractRouteDefinitions(filePath);
    allRoutes.push(...routes);
  }
  
  // Also check server/index.ts for inline route definitions
  const indexPath = path.join(__dirname, '..', 'server', 'index.ts');
  const indexRoutes = extractRouteDefinitions(indexPath);
  allRoutes.push(...indexRoutes);
  
  // Classify routes
  const exemptRoutes: RouteDefinition[] = [];
  const unprotectedRoutes: RouteDefinition[] = [];
  let protectedCount = 0;
  
  for (const route of allRoutes) {
    // Check if route is exempt
    if (route.csrfExemptReason) {
      exemptRoutes.push(route);
      continue;
    }
    
    // Check if route path is in exempt list
    if (CSRF_EXEMPT_ROUTES.includes(route.path)) {
      exemptRoutes.push(route);
      continue;
    }
    
    // Check if route is protected
    const hasProtection = route.hasInlineCsrf || 
                         route.hasRouterLevelCsrf || 
                         checkServerMountProtection(route.path);
    
    if (hasProtection) {
      protectedCount++;
    } else {
      unprotectedRoutes.push(route);
    }
  }
  
  return {
    passed: unprotectedRoutes.length === 0,
    totalRoutes: allRoutes.length - exemptRoutes.length,
    protectedRoutes: protectedCount,
    unprotectedRoutes,
    exemptRoutes,
  };
}

/**
 * Main execution
 */
function main() {
  console.log('🔒 CSRF Protection Verification Script\n');
  console.log('Scanning all mutating HTTP endpoints for CSRF protection...\n');
  
  const result = validateRoutes();
  
  console.log(`📊 Summary:`);
  console.log(`  Total mutating routes: ${result.totalRoutes}`);
  console.log(`  Protected routes: ${result.protectedRoutes}`);
  console.log(`  Exempt routes: ${result.exemptRoutes.length}`);
  console.log(`  Unprotected routes: ${result.unprotectedRoutes.length}\n`);
  
  if (result.exemptRoutes.length > 0) {
    console.log(`⚪ Exempt Routes (${result.exemptRoutes.length}):`);
    for (const route of result.exemptRoutes) {
      console.log(`  ${route.method} ${route.path}`);
      console.log(`    File: ${route.file}:${route.lineNumber}`);
      if (route.csrfExemptReason) {
        console.log(`    Reason: ${route.csrfExemptReason}`);
      }
    }
    console.log('');
  }
  
  if (result.unprotectedRoutes.length > 0) {
    console.log(`❌ UNPROTECTED ROUTES (${result.unprotectedRoutes.length}):`);
    for (const route of result.unprotectedRoutes) {
      console.log(`  ${route.method} ${route.path}`);
      console.log(`    File: ${route.file}:${route.lineNumber}`);
      console.log(`    MISSING CSRF PROTECTION!`);
    }
    console.log('');
  }
  
  if (result.passed) {
    console.log('✅ PASS: All mutating routes are properly protected by CSRF!\n');
    process.exit(0);
  } else {
    console.log('❌ FAIL: Some mutating routes are NOT protected by CSRF!\n');
    console.log('To fix: Add csrfProtection middleware to the unprotected routes above.\n');
    console.log('Three ways to add CSRF protection:');
    console.log('  A) Inline: router.post("/path", csrfProtection, handler)');
    console.log('  B) Router-level: router.use(csrfProtection) before route definitions');
    console.log('  C) Server mount: app.use("/prefix", csrfProtection, router)\n');
    process.exit(1);
  }
}

main();
