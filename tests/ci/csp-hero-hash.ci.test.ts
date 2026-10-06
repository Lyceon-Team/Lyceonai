/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner ruling 2026-10-05, Step 0 decision 5
 *       ("inline script with a CSP hash"); student-UI register §8 F-58 (hash, never
 *       'unsafe-inline')] | @implemented [2026-10-05]
 *
 * plain English: the homepage hero's swap script runs only if the page CSP carries its exact
 * sha256. This hashes the script from its source constant and requires vercel.json's page
 * script-src to list it, so editing the copy or the script without updating the policy fails
 * here, before a build. scripts/ci/page-csp-built-hash-gate.mjs then checks the BUILT page
 * (every inline script hashed, no stale hash allowed).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_SWAP_SCRIPT } from "../../client/src/lib/analytics/hero-experiment";

const vercel: unknown = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8"),
);

function pageScriptSrc(): string {
  const routes =
    typeof vercel === "object" && vercel !== null && "routes" in vercel
      ? (vercel as { routes: unknown }).routes
      : [];
  const list = Array.isArray(routes) ? routes : [];
  for (const r of list) {
    const csp: unknown = r?.headers?.["Content-Security-Policy"];
    if (typeof csp === "string" && csp.includes("script-src")) {
      return (
        csp
          .split(";")
          .map((d) => d.trim())
          .find((d) => d.startsWith("script-src ")) ?? ""
      );
    }
  }
  return "";
}

describe("homepage hero swap script: CSP hash", () => {
  it("vercel.json's page script-src carries the script's sha256", () => {
    const src = pageScriptSrc();
    expect(src).toContain("script-src");
    const digest = createHash("sha256")
      .update(HERO_SWAP_SCRIPT)
      .digest("base64");
    expect(src).toContain(`'sha256-${digest}'`);
  });
});
