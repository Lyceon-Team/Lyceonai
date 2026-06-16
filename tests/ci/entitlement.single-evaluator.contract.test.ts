/**
 * @spec [SP25-001 | Doc-05B §5.3 canonical predicate; Coding Standards §10] @implemented 2026-06-14
 *
 * SP25-001 USAGE GATE — there must be exactly ONE entitlement evaluator, and every route-facing
 * entitlement decision must reach it.
 *
 * This gate verifies ROUTE USAGE, not two-definition agreement:
 *  1. The single evaluator is EntitlementService.isEntitlementActiveForProfile, which is the ONLY place
 *     that calls the canonical SQL predicate rpc("entitlement_active", ...).
 *  2. The divergent TS predicate `isEntitlementActive` no longer exists anywhere in runtime source
 *     (it was deleted — no second evaluator).
 *  3. The entitlement_active RPC is invoked from exactly one runtime file (the EntitlementService) — no
 *     parallel hand-rolled RPC consumer can drift.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const RUNTIME_ROOTS = ["apps/api/src", "server"];
const EXCLUDED_SEGMENTS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "__tests__",
  ".test.ts",
  ".spec.ts",
  ".d.ts",
];

const ENTITLEMENT_SERVICE_FILE = "server/services/entitlement-service.ts";

function normalizeRepoPath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function scanFiles(dir: string, repoRoot: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = normalizeRepoPath(repoRoot, fullPath);

    if (EXCLUDED_SEGMENTS.some((segment) => relativePath.includes(segment))) {
      continue;
    }

    if (entry.isDirectory()) {
      out.push(...scanFiles(fullPath, repoRoot));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(fullPath);
    }
  }

  return out;
}

type Hit = { file: string; lineNumber: number; lineContent: string };

function findHits(repoRoot: string, predicate: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const root of RUNTIME_ROOTS) {
    for (const filePath of scanFiles(path.join(repoRoot, root), repoRoot)) {
      const relativePath = normalizeRepoPath(repoRoot, filePath);
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (predicate(line)) {
          hits.push({ file: relativePath, lineNumber: i + 1, lineContent: line.trim() });
        }
      }
    }
  }
  return hits;
}

describe("SP25-001 single entitlement evaluator contract", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");

  it("has no divergent TS `isEntitlementActive` evaluator anywhere in runtime source", () => {
    // The second evaluator was deleted. No definition or call may reappear. The regex is paren-anchored
    // so it catches the bare predicate `isEntitlementActive(...)` (definition or call) but NOT the
    // single canonical evaluator `isEntitlementActiveForProfile(...)` and NOT prose mentions in comments.
    const hits = findHits(repoRoot, (line) => /\bisEntitlementActive\s*\(/.test(line));
    expect(hits, JSON.stringify(hits, null, 2)).toHaveLength(0);
  });

  it("invokes the canonical entitlement_active RPC from exactly one runtime file (the EntitlementService)", () => {
    const rpcHits = findHits(repoRoot, (line) => /rpc\(\s*["']entitlement_active["']/.test(line));
    const files = Array.from(new Set(rpcHits.map((h) => h.file)));
    expect(files, JSON.stringify(rpcHits, null, 2)).toEqual([ENTITLEMENT_SERVICE_FILE]);
  });

  it("exposes exactly one evaluator entry point: EntitlementService.isEntitlementActiveForProfile", () => {
    const serviceSource = fs.readFileSync(path.join(repoRoot, ENTITLEMENT_SERVICE_FILE), "utf8");
    expect(serviceSource).toContain("static async isEntitlementActiveForProfile(");
    expect(serviceSource).toContain('rpc("entitlement_active"');

    // Every other runtime caller must reach the evaluator through the service, never re-deriving it.
    const serviceCallHits = findHits(repoRoot, (line) =>
      /EntitlementService\.isEntitlementActiveForProfile\(/.test(line)
    );
    // resolveLinkedPairPremiumAccessForStudent + resolveLinkedPairPremiumAccessForGuardian (account.ts)
    // are the route-facing consumers; both must route through the service.
    const consumerFiles = new Set(serviceCallHits.map((h) => h.file));
    expect(consumerFiles.has("server/lib/account.ts"), JSON.stringify(serviceCallHits, null, 2)).toBe(true);
  });
});
