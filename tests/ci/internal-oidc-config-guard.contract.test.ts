/**
 * @spec [Doc-03C_V3 §9.3, Doc-01A §3] | @implemented 2026-09-01
 *
 * plain English: Contract test for the OIDC configuration guard on the
 * internal Cloud Tasks routes. This file replaces
 * `retention-oidc-failfast.contract.test.ts`, which asserted the OPPOSITE
 * contract — that these modules throw at import when the OIDC env vars are
 * missing. That guard shipped on 2026-08-27 and took production down until
 * 2026-09-01: the routes share a bundle with every user-facing route, so a
 * module-scope throw is a process-wide crash, and `/auth/callback`,
 * `/api/profile` and `/api/csrf-token` all returned 500.
 *
 * expected outcome: neither route module can crash the process at import, and
 * both still refuse to serve without OIDC config.
 *
 * trade-offs:
 *  - Static source assertions, like the test they replace. A dynamic import
 *    cannot prove the absence of an import-time throw from inside a test
 *    process, because NODE_ENV=test was exactly the escape hatch that let the
 *    old guard pass CI while crashing production. The boot probe
 *    (`scripts/ci/boot-probe.mjs`) is the dynamic half of this contract: it
 *    loads the real production bundle with NODE_ENV=production.
 *  - Asserting "no import-time throw" by source-reading needs a scope-aware
 *    parse, not a substring search — a throw inside a route handler is correct
 *    and common. The check below uses the TypeScript compiler; see
 *    `importTimeThrows` for why a brace-counting version was rejected.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import path from "node:path";

const ROUTE_FILES = {
  memory: "server/routes/internal-memory-routes.ts",
  retention: "server/routes/internal-retention-routes.ts",
} as const;

const REPO_ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, rel), "utf-8");
}

/**
 * Return every `throw` that executes at IMPORT time — i.e. every throw
 * reachable from the module's top-level statements without entering a
 * function or class body.
 *
 * Parsed with the TypeScript compiler rather than by counting braces. A brace-
 * depth heuristic was tried first and was vacuous: the guard that caused the
 * outage sat at depth 2 (`if (!IS_TEST) { if (!AUDIENCE) { throw } }`), so a
 * depth<=1 rule reported zero findings on the exact source it existed to
 * reject. Verified by planting that guard back and watching this assertion
 * stay green — which is why the parser is used instead.
 */
function importTimeThrows(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];

  const isDeferred = (n: ts.Node): boolean =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isClassExpression(n) ||
    ts.isInterfaceDeclaration(n) ||
    ts.isTypeAliasDeclaration(n) ||
    ts.isModuleDeclaration(n);

  const walk = (node: ts.Node): void => {
    if (isDeferred(node)) return;
    if (ts.isThrowStatement(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push(`${fileName}:${line + 1} ${node.getText(sf).split("\n")[0]}`);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);

  return found;
}

describe("internal OIDC routes — config guard, not an import-time crash", () => {
  for (const [label, rel] of Object.entries(ROUTE_FILES)) {
    describe(`${label} (${rel})`, () => {
      const source = read(rel);

      it("has no throw that runs at import time", () => {
        expect(importTimeThrows(source, rel)).toEqual([]);
      });

      it("does not gate its OIDC config behind NODE_ENV/VITEST", () => {
        // The old guard skipped itself in test mode, which is how it reached
        // production unexercised. A request-time guard needs no such escape.
        expect(source).not.toContain("IS_TEST");
      });

      it("mounts the config-guarded OIDC middleware on every route", () => {
        const mounts = source.match(/oidcAuthMiddlewareWithConfigGuard\(/g);
        const posts = source.match(/router\.post\(/g);
        expect(mounts).not.toBeNull();
        expect(posts).not.toBeNull();
        expect(mounts?.length).toBe(posts?.length);
      });

      it("never mounts the unguarded factory directly", () => {
        // `oidcAuthMiddleware({...})` with a captured module-scope value is
        // the shape that let an empty audience reach token verification.
        expect(source).not.toMatch(/\boidcAuthMiddleware\(\s*\{/);
      });

      it("reads OIDC config from process.env inside a reader, not at import", () => {
        expect(source).toContain("const readOidcConfig: OidcConfigReader");
        expect(source).not.toMatch(
          /^const OIDC_(AUDIENCE|SERVICE_ACCOUNT)\s*=/m,
        );
      });

      it("still uses OIDC, not HMAC internal auth", () => {
        expect(source).toContain("verify-oidc-middleware");
        expect(source).not.toContain("internalAuthMiddleware");
      });
    });
  }

  it("the guard itself refuses before verifying, in one middleware", () => {
    // Config check and auth must not be separable: two chained middlewares
    // could be mounted in the wrong order, or one omitted.
    const guardSource = read(
      "packages/shared/internal-auth/verify-oidc-middleware.ts",
    );
    expect(guardSource).toContain("oidcAuthMiddlewareWithConfigGuard");
    expect(guardSource).toContain("internal_auth_not_configured");
    expect(guardSource).toContain("res.status(500)");
  });
});
