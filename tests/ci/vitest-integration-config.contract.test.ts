/**
 * @spec [Brief 8 Step 5 (the integration job); Brief 14 housekeeping] | @implemented [2026-09-27]
 *
 * plain English: the integration suite must be able to IMPORT the app it tests. Expected
 * outcome: if `@lyceon/shared` stops resolving under `vitest.integration.config.ts`, this
 * test says so in the default suite — where everyone runs it — instead of only on `main`.
 *
 * WHY A STATIC TEST AND NOT A RUNTIME ONE. The integration tests `describe.skipIf`
 * themselves unless SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are all
 * set. Without them the files skip and their import chain is never evaluated, so the suite
 * is GREEN locally and RED in CI — the only place the secrets exist. That asymmetry is what
 * let the breakage through:
 *
 *     Cannot find package '@lyceon/shared' imported from
 *     server/services/calendar/read-service.ts
 *     ❯ server/routes/student-resources.ts:75:1
 *
 * Both suites failed at import time, having asserted nothing, on every push to `main`.
 *
 * Reading the config file is the assertion that works everywhere: it needs no secrets, no
 * Supabase and no server, and it fails for the one reason that actually broke.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

describe("vitest.integration.config.ts can import the app it tests", () => {
  it("aliases @lyceon/shared, because nothing else resolves it", () => {
    // The ALIAS, not a mention of it. A bare `toContain("@lyceon/shared")` passed this file's
    // own header comment while the alias was deleted — the plant caught it, and an assertion
    // a comment can satisfy is worse than none.
    expect(read("vitest.integration.config.ts")).toContain(
      '"@lyceon/shared": path.resolve(',
    );
  });

  it("resolves it to the same place the other configs do", () => {
    // One mapping, three configs. A second answer to "where is @lyceon/shared" is how the
    // integration suite would load a different copy of the contract than the app does.
    const target = `path.resolve(__dirname, "./packages/shared/src")`;
    for (const config of ["vitest.config.ts", "vitest.integration.config.ts"]) {
      expect(read(config)).toContain(target);
    }
  });

  it("is load-bearing: @lyceon/shared is NOT an installed package", () => {
    // If this ever fails, the package has been properly declared and installed — at which
    // point the alias is belt-and-braces rather than the only thing making the import work,
    // and this whole file can go. Asserted so that fact is discovered deliberately.
    const rootPkg: unknown = JSON.parse(read("package.json"));
    const deps =
      typeof rootPkg === "object" && rootPkg !== null
        ? {
            ...(rootPkg as { dependencies?: Record<string, string> })
              .dependencies,
            ...(rootPkg as { devDependencies?: Record<string, string> })
              .devDependencies,
          }
        : {};
    expect(Object.keys(deps)).not.toContain("@lyceon/shared");
  });

  it("still excludes the integration directory from the DEFAULT suite", () => {
    // The two configs exist precisely so the default suite stays hermetic. If this exclusion
    // were dropped, `pnpm test` would start trying to reach a real Supabase project.
    expect(read("vitest.config.ts")).toContain("tests/integration");
  });
});
