/**
 * Production's global rate limit is untouched by the harness's test-only override.
 *
 * @spec [owner ruling (Karl, 2026-10-24, follow-ups to #1305/#1310): "Raise the rate limit for
 *        the e2e test server ONLY ... production limits unchanged. Add a test proving the
 *        production rate-limit config is untouched"] | @implemented [2026-10-24]
 *
 * plain English: the student harness (tests/e2e/student-harness) raised its own request ceiling
 * through `STUDENT_HARNESS_RATE_LIMIT_MAX` (rate-limit.ts). This pins the other side:
 *   - server/index.ts still mounts its global limiter at 1000 requests per 15 minutes, written
 *     as literals in the limiter itself;
 *   - that limiter reads no environment variable at all (an override cannot reach it);
 *   - the override's name appears in no production source (server, client, packages, api),
 *     only in the harness;
 *   - and the harness reads it as documented: a higher default, the override when valid, the
 *     default (never "no limit") when not.
 * Source-level on purpose: server/index.ts boots the whole app on import.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  HARNESS_RATE_LIMIT_ENV,
  HARNESS_RATE_LIMIT_MAX,
  harnessRateLimitMax,
} from "../e2e/student-harness/rate-limit";

const ROOT = path.resolve(__dirname, "../..");
const INDEX = path.join(ROOT, "server/index.ts");

/** The `globalRateLimiter = rateLimit({ ... });` call in server/index.ts, as written. */
function productionLimiterBlock(): string {
  const text = fs.readFileSync(INDEX, "utf8");
  const m = /const globalRateLimiter = rateLimit\(\{([\s\S]*?)\}\);/.exec(text);
  if (m === null || m[1] === undefined)
    throw new Error("server/index.ts: no globalRateLimiter");
  return m[1];
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("production's global rate limit (server/index.ts) is untouched by the harness override", () => {
  it("is mounted at 1000 requests per 15 minutes, as literals", () => {
    const block = productionLimiterBlock();
    expect(block).toMatch(/^\s*windowMs: 15 \* 60 \* 1000,/m);
    expect(block).toMatch(/^\s*max: 1000,/m);
    expect(fs.readFileSync(INDEX, "utf8")).toMatch(
      /^app\.use\(globalRateLimiter\);$/m,
    );
  });

  it("reads no environment variable for its values", () => {
    const block = productionLimiterBlock();
    // Presence first: the block is the limiter's options.
    expect(block).toContain("windowMs");
    expect(block).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it(`the override (${HARNESS_RATE_LIMIT_ENV}) is consulted only by the harness`, () => {
    const holders = [
      ...sourceFiles(path.join(ROOT, "server")),
      ...sourceFiles(path.join(ROOT, "client/src")),
      ...sourceFiles(path.join(ROOT, "packages")),
      ...sourceFiles(path.join(ROOT, "api")),
      ...sourceFiles(path.join(ROOT, "tests/e2e")),
    ]
      .filter((f) =>
        fs.readFileSync(f, "utf8").includes(HARNESS_RATE_LIMIT_ENV),
      )
      .map((f) => path.relative(ROOT, f));
    // Presence first: the harness module reads it.
    expect(holders).toContain("tests/e2e/student-harness/rate-limit.ts");
    expect(
      holders.filter((f) => !f.startsWith("tests/e2e/student-harness/")),
    ).toEqual([]);
  });
});

describe("the harness's ceiling (tests/e2e/student-harness/rate-limit.ts)", () => {
  it("defaults above production's 1000", () => {
    expect(harnessRateLimitMax({})).toBe(HARNESS_RATE_LIMIT_MAX);
    expect(HARNESS_RATE_LIMIT_MAX).toBeGreaterThan(1000);
  });

  it("takes a valid override", () => {
    expect(harnessRateLimitMax({ [HARNESS_RATE_LIMIT_ENV]: "50000" })).toBe(
      50_000,
    );
  });

  it("falls back to its default, never to no limit, for an invalid override", () => {
    for (const bad of ["", "0", "-5", "abc", "1.5"]) {
      expect(harnessRateLimitMax({ [HARNESS_RATE_LIMIT_ENV]: bad }), bad).toBe(
        HARNESS_RATE_LIMIT_MAX,
      );
    }
  });
});
