import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * @spec [student-ui register UI-18 (cold starts: trim the function bundle); UI-00b baseline]
 *   | @implemented [2026-09-30] |
 * plain English: the Vercel function bundle (`dist/vercel-api.cjs`, the only function behind
 * `/api/*`) is built minified, with a metafile for size attribution. `--keep-names` is part of
 * the contract, not an extra: minification renames functions and classes, and both server code
 * (`err.name === "CSRFError"`) and bundled libraries (`this.name = this.constructor.name`)
 * read those names at runtime.
 *
 * trade-offs: this pins the script text, not the output. The before/after sizes and the
 * minified-bundle smoke run (health 200, auth 401, unknown route 404, CSRF token 200) are in
 * the register's UI-18 row.
 */

const ROOT = join(__dirname, "..", "..");

const packageJsonSchema = z.object({
  scripts: z.record(z.string()),
});
const vercelJsonSchema = z.object({ buildCommand: z.string() });

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, file), "utf8"));
}

describe("Vercel server bundle is minified (UI-18)", () => {
  it("vercel.json builds with build:vercel", () => {
    const vercel = vercelJsonSchema.parse(readJson("vercel.json"));
    expect(vercel.buildCommand).toBe("pnpm run build:vercel");
  });

  it("build:vercel bundles server/index.ts minified, keeping names, with a metafile", () => {
    const { scripts } = packageJsonSchema.parse(readJson("package.json"));
    const script = scripts["build:vercel"] ?? "";
    // Presence first: this is the esbuild step that writes the function bundle.
    expect(script).toContain("esbuild server/index.ts");
    expect(script).toContain("--outfile=dist/vercel-api.cjs");

    const flags = script.split(/\s+/);
    expect(flags).toContain("--minify");
    expect(flags).toContain("--keep-names");
    expect(flags).toContain("--metafile=dist/vercel-api.meta.json");
  });
});
