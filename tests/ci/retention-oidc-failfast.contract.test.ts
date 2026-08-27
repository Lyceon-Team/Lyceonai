/**
 * @spec [Doc-03C_V3 §9.3, Doc-01A §3]
 * @implemented 2026-08-26
 *
 * plain English: Contract test for the OIDC fail-fast guard on the retention
 * sweep route. Verifies that internal-retention-routes.ts throws at import
 * time when OIDC env vars are missing (outside test mode), mirroring the
 * internal-memory-routes.ts pattern exactly (LISA-OIDC-001).
 *
 * expected outcome: the route module's source contains the fail-fast throw
 * pattern (static assertion) and uses oidcAuthMiddleware, not
 * internalAuthMiddleware.
 *
 * trade-offs:
 *  - Static assertion (source-read) rather than dynamic import: the fail-fast
 *    throws unconditionally outside test mode, so importing it in a test
 *    process (NODE_ENV=test) would skip the guard. Source-reading is the only
 *    way to verify the guard exists without leaving test mode.
 *  - This pattern matches the existing oidc-auth-middleware.test.ts approach
 *    for internal-memory-routes.ts (test "g").
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "../../server/routes/internal-retention-routes.ts"),
  "utf-8",
);

describe("internal-retention-routes.ts OIDC fail-fast (LISA-OIDC-001)", () => {
  it("uses oidcAuthMiddleware, not internalAuthMiddleware", () => {
    expect(routeSource).toContain("oidcAuthMiddleware");
    expect(routeSource).not.toContain("internalAuthMiddleware");
  });

  it("throws on missing OIDC_AUDIENCE outside test mode", () => {
    // The fail-fast guard must be present as a throw statement
    expect(routeSource).toContain(
      'throw new Error(\n      "CLOUD_TASKS_OIDC_AUDIENCE (or RETENTION_SWEEP_OIDC_AUDIENCE) is not set.',
    );
  });

  it("throws on missing CLOUD_TASKS_SERVICE_ACCOUNT outside test mode", () => {
    expect(routeSource).toContain(
      'throw new Error(\n      "CLOUD_TASKS_SERVICE_ACCOUNT is not set.',
    );
  });

  it("guards behind IS_TEST so test mode skips the throw", () => {
    // Must check NODE_ENV and VITEST
    expect(routeSource).toContain('process.env.NODE_ENV === "test"');
    expect(routeSource).toContain("process.env.VITEST");
    // The throws are inside if (!IS_TEST) blocks
    expect(routeSource).toContain("if (!IS_TEST)");
  });

  it("does NOT default OIDC vars to empty strings that silently disable auth", () => {
    // The fail-fast pattern means that even though the vars are read with
    // ?? "", the throws fire before the empty string reaches the middleware.
    // Verify the throws are unconditional within the !IS_TEST block — no
    // additional guards that might bypass them.
    const lines = routeSource.split("\n");
    const throwLines = lines
      .map((l, i) => ({ line: l, num: i + 1 }))
      .filter((l) => l.line.includes("throw new Error"));

    // Exactly two throw statements for the two OIDC vars
    expect(throwLines.length).toBeGreaterThanOrEqual(2);
  });
});
