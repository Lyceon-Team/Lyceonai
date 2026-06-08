import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * @spec [Lyceon_Coding_Standards, §12.1] [Lyceon_Coding_Standards, §12.2] [Privacy_Policy_V1.0, §3.4]
 * @implemented [2026-06-06]
 *
 * Forward regression guard for the tutor-runtime unit (PR1, Part A). The verbatim
 * tutor-exchange persistence path on the non-canonical `tutor_interactions` audit
 * side-table has been eliminated:
 *   - the `TUTOR_VERBATIM_PERSIST` stop-the-bleed flag is removed,
 *   - the dead writer `apps/api/src/lib/tutor-log.ts` is deleted,
 *   - the `tutor_interactions` table is dropped entirely by the WS-1 provenance migration,
 *   - the review mastery-bridge read is repointed off `tutor_interactions`.
 *
 * This suite replaces the old flag-behavior contract test (which exercised a path
 * that no longer exists). It is intentionally a static source/migration scan: it
 * proves the path stays gone, with no DB dependency.
 *
 * NOTE: the canonical verbatim conversation store `tutor_messages` is OUT OF SCOPE
 * here — it legitimately retains verbatim content under Doc 03 §14.2 / Privacy
 * Policy §9.7 (7-day retention, enforced by PR2). This guard must never assert
 * against tutor_messages.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

/** Recursively collect *.ts source files under a dir, skipping tests + node_modules. */
function collectSources(relDir: string): string[] {
  const abs = path.join(repoRoot, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      out.push(rel);
    }
  }
  return out;
}

const APP_SOURCE_DIRS = [
  "server",
  "apps",
  "client/src",
  "shared",
  "packages",
] as const;

describe("tutor_interactions — verbatim persistence eliminated (tutor-runtime PR1; Privacy Policy §3.4 / Coding Standards §12.2)", () => {
  it("the TUTOR_VERBATIM_PERSIST stop-the-bleed flag is gone from all application source", () => {
    const offenders = APP_SOURCE_DIRS.flatMap(collectSources).filter((rel) =>
      read(rel).includes("TUTOR_VERBATIM_PERSIST"),
    );
    expect(offenders).toEqual([]);
  });

  it("the dead verbatim writer apps/api/src/lib/tutor-log.ts no longer exists", () => {
    expect(
      existsSync(path.join(repoRoot, "apps/api/src/lib/tutor-log.ts")),
    ).toBe(false);
  });

  it("the WS-1 provenance drops migration removes the tutor_interactions table entirely (supersedes the never-applied 20260606 column-ALTER)", () => {
    const sql = read("supabase/migrations/20260608_ws1_provenance_drops.sql");
    expect(sql).toMatch(
      /DROP TABLE\s+(IF EXISTS\s+)?public\.tutor_interactions/i,
    );
  });

  it("the review mastery-bridge read no longer depends on the dormant tutor_interactions table", () => {
    const src = read("server/routes/review-session-routes.ts");
    expect(src).not.toMatch(/from\(["']tutor_interactions["']\)/);
    // and it reads the canonical conversation store instead
    expect(src).toMatch(/from\(["']tutor_messages["']\)/);
  });
});
