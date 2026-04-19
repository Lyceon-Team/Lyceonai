#!/usr/bin/env tsx
/**
 * CSRF Protection Verification Script
 *
 * Verifies that mutating HTTP routes are CSRF-protected through one of:
 * 1. Inline middleware on the route declaration
 * 2. Router-level middleware (router.use(...))
 * 3. Mount-level middleware in server/index.ts (app.use("/api/...", ..., router))
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSRF_MIDDLEWARE_PATTERN = /\b(doubleCsrfProtection|csrfProtection|csrfGuard)\b/;
const CSRF_EXEMPT_ROUTES = new Set<string>([
  "/api/billing/webhook",
]);

interface RouteDefinition {
  file: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  lineNumber: number;
  hasInlineCsrf: boolean;
  hasRouterLevelCsrf: boolean;
  hasMountLevelCsrf: boolean;
  csrfExemptReason?: string;
}

interface ValidationResult {
  passed: boolean;
  totalRoutes: number;
  protectedRoutes: number;
  unprotectedRoutes: RouteDefinition[];
  exemptRoutes: RouteDefinition[];
}

function hasCsrfProtection(chunk: string): boolean {
  return CSRF_MIDDLEWARE_PATTERN.test(chunk);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function extractFirstPathLiteral(chunk: string): string {
  const match = chunk.match(/['"`](\/[^'"`]+)['"`]/);
  return match ? match[1] : "<unknown>";
}

function extractCsrfExemptReason(content: string, lineNumber: number): string | undefined {
  const lines = content.split("\n");
  const start = Math.max(0, lineNumber - 10);
  const end = Math.min(lines.length - 1, lineNumber + 1);
  for (let i = start; i <= end; i += 1) {
    const line = lines[i];
    const match = line.match(/CSRF_EXEMPT_REASON:\s*(.+)/);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function lineNumberForIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function stripRouteImportExtension(routeImportPath: string): string {
  return routeImportPath.replace(/\.js$/i, "").replace(/\.ts$/i, "");
}

function ensureRouteFilePath(routeImportPath: string): string {
  const normalized = stripRouteImportExtension(routeImportPath);
  const candidateTs = path.join(__dirname, "..", "server", "routes", `${normalized}.ts`);
  if (fs.existsSync(candidateTs)) {
    return path.resolve(candidateTs);
  }
  return path.resolve(path.join(__dirname, "..", "server", "routes", normalized));
}

function parseImportIdentifiers(clause: string): string[] {
  const identifiers: string[] = [];
  const trimmed = clause.trim();
  if (!trimmed) return identifiers;

  // Default import, possibly followed by named imports.
  if (!trimmed.startsWith("{")) {
    const defaultPart = trimmed.split(",")[0]?.trim();
    if (defaultPart) identifiers.push(defaultPart);
  }

  const namedMatch = trimmed.match(/\{([^}]+)\}/);
  if (namedMatch) {
    const named = namedMatch[1]
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        const asMatch = token.match(/^(.+)\s+as\s+(.+)$/);
        return asMatch ? asMatch[2].trim() : token;
      });
    identifiers.push(...named);
  }

  return identifiers;
}

function buildRouteImportMap(indexContent: string): Map<string, string> {
  const map = new Map<string, string>();
  const importPattern = /^import\s+(.+?)\s+from\s+["']\.\/routes\/([^"']+)["'];\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(indexContent)) !== null) {
    const clause = match[1];
    const routeImportPath = match[2];
    const routeFile = ensureRouteFilePath(routeImportPath);
    for (const identifier of parseImportIdentifiers(clause)) {
      map.set(identifier, routeFile);
    }
  }
  return map;
}

function combinePath(prefix: string, routePath: string): string {
  if (routePath === "<unknown>") return "<unknown>";
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${normalizedPrefix}${normalizedRoute}`;
}

function extractMountCsrfProtection(indexContent: string): Map<string, Set<string>> {
  const routeImportMap = buildRouteImportMap(indexContent);
  const mountMap = new Map<string, Set<string>>();
  const mountPattern = /app\.(use|post|put|patch|delete)\s*\(([\s\S]*?)\);/g;
  let match: RegExpExecArray | null;

  while ((match = mountPattern.exec(indexContent)) !== null) {
    const args = match[2];
    if (!hasCsrfProtection(args)) continue;

    const mountPrefix = extractFirstPathLiteral(args);
    for (const [identifier, routeFile] of routeImportMap.entries()) {
      const identifierPattern = new RegExp(`\\b${identifier}\\b`);
      if (!identifierPattern.test(args)) continue;
      if (!mountMap.has(routeFile)) {
        mountMap.set(routeFile, new Set<string>());
      }
      mountMap.get(routeFile)!.add(mountPrefix);
    }
  }

  return mountMap;
}

function walkRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path.resolve(fullPath));
    }
  }
  return files;
}

function extractRouteDefinitions(
  filePath: string,
  mountPrefixes: Set<string>,
): RouteDefinition[] {
  const content = readFile(filePath);
  const routes: RouteDefinition[] = [];

  let hasRouterLevelCsrf = false;
  const routerUsePattern = /router\.use\(([\s\S]*?)\);/g;
  let routerUseMatch: RegExpExecArray | null;
  while ((routerUseMatch = routerUsePattern.exec(content)) !== null) {
    if (hasCsrfProtection(routerUseMatch[1])) {
      hasRouterLevelCsrf = true;
      break;
    }
  }

  const routePattern = /router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g;
  let routeMatch: RegExpExecArray | null;
  while ((routeMatch = routePattern.exec(content)) !== null) {
    const method = routeMatch[1].toUpperCase() as RouteDefinition["method"];
    const args = routeMatch[2];
    const routePath = extractFirstPathLiteral(args);
    const lineNumber = lineNumberForIndex(content, routeMatch.index);
    const exemptReason = extractCsrfExemptReason(content, lineNumber);

    routes.push({
      file: path.relative(path.join(__dirname, ".."), filePath),
      method,
      path: routePath,
      lineNumber,
      hasInlineCsrf: hasCsrfProtection(args),
      hasRouterLevelCsrf,
      hasMountLevelCsrf: mountPrefixes.size > 0,
      csrfExemptReason: exemptReason,
    });
  }

  return routes;
}

function extractIndexMutatingRoutes(indexPath: string): RouteDefinition[] {
  const content = readFile(indexPath);
  const routes: RouteDefinition[] = [];
  const pattern = /app\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const method = match[1].toUpperCase() as RouteDefinition["method"];
    const args = match[2];
    const routePath = extractFirstPathLiteral(args);
    const lineNumber = lineNumberForIndex(content, match.index);
    routes.push({
      file: path.relative(path.join(__dirname, ".."), indexPath),
      method,
      path: routePath,
      lineNumber,
      hasInlineCsrf: hasCsrfProtection(args),
      hasRouterLevelCsrf: false,
      hasMountLevelCsrf: false,
      csrfExemptReason: extractCsrfExemptReason(content, lineNumber),
    });
  }
  return routes;
}

function isRouteExempt(route: RouteDefinition, mountPrefixes: Set<string>): boolean {
  if (route.csrfExemptReason) return true;
  if (CSRF_EXEMPT_ROUTES.has(route.path)) return true;

  if (mountPrefixes.size > 0) {
    for (const prefix of mountPrefixes) {
      const combined = combinePath(prefix, route.path);
      if (CSRF_EXEMPT_ROUTES.has(combined)) {
        return true;
      }
    }
  }

  return false;
}

function validateRoutes(): ValidationResult {
  const indexPath = path.join(__dirname, "..", "server", "index.ts");
  const routesDir = path.join(__dirname, "..", "server", "routes");
  const indexContent = readFile(indexPath);
  const mountProtectionByFile = extractMountCsrfProtection(indexContent);

  const allRoutes: RouteDefinition[] = [];
  const routeFiles = walkRouteFiles(routesDir);
  for (const routeFile of routeFiles) {
    const mounts = mountProtectionByFile.get(path.resolve(routeFile)) ?? new Set<string>();
    allRoutes.push(...extractRouteDefinitions(routeFile, mounts));
  }

  allRoutes.push(...extractIndexMutatingRoutes(indexPath));

  const exemptRoutes: RouteDefinition[] = [];
  const unprotectedRoutes: RouteDefinition[] = [];
  let protectedRoutes = 0;

  for (const route of allRoutes) {
    const fileAbsolute = path.resolve(path.join(__dirname, ".."), route.file);
    const mounts = mountProtectionByFile.get(fileAbsolute) ?? new Set<string>();
    if (isRouteExempt(route, mounts)) {
      exemptRoutes.push(route);
      continue;
    }

    const protectedByMiddleware =
      route.hasInlineCsrf || route.hasRouterLevelCsrf || route.hasMountLevelCsrf;

    if (protectedByMiddleware) {
      protectedRoutes += 1;
    } else {
      unprotectedRoutes.push(route);
    }
  }

  return {
    passed: unprotectedRoutes.length === 0,
    totalRoutes: allRoutes.length - exemptRoutes.length,
    protectedRoutes,
    unprotectedRoutes,
    exemptRoutes,
  };
}

function main() {
  console.log("🔒 CSRF Protection Verification Script\n");
  console.log("Scanning mutating HTTP endpoints for CSRF protection...\n");

  const result = validateRoutes();

  console.log("📊 Summary:");
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
    console.log("");
  }

  if (result.unprotectedRoutes.length > 0) {
    console.log(`❌ UNPROTECTED ROUTES (${result.unprotectedRoutes.length}):`);
    for (const route of result.unprotectedRoutes) {
      console.log(`  ${route.method} ${route.path}`);
      console.log(`    File: ${route.file}:${route.lineNumber}`);
      console.log("    MISSING CSRF PROTECTION!");
    }
    console.log("");
  }

  if (result.passed) {
    console.log("✅ PASS: All mutating routes are CSRF protected.\n");
    process.exit(0);
  }

  console.log("❌ FAIL: Some mutating routes are not CSRF protected.\n");
  console.log("To fix: add CSRF middleware inline, router-level, or mount-level.\n");
  process.exit(1);
}

main();
