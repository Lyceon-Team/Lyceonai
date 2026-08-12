import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * @spec [Doc-03B_V2 §3.1; Karl ruling 2026-08-05] | @implemented 2026-08-05
 * plain English: Forward regression guard — five dead client components
 * (chat-interface, DemoChatPreview, TutorInsights, ChatDock, floating-actions)
 * were deleted in L1.5 because they are orphaned legacy UI with no live
 * importers. TutorInsights additionally hardcoded vanity metrics (INV-03-11).
 *
 * expected outcome: deleted files stay deleted; no new import references appear.
 * trade-offs: none — these are dead code.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const DEAD_FILES = [
  "client/src/components/chat-interface.tsx",
  "client/src/components/DemoChatPreview.tsx",
  "client/src/components/TutorInsights.tsx",
  "client/src/components/ChatDock.tsx",
  "client/src/components/floating-actions.tsx",
] as const;

/** Recursively collect *.ts / *.tsx source files, skipping tests + node_modules. */
function collectSources(relDir: string): string[] {
  const abs = path.join(repoRoot, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(rel);
    }
  }
  return out;
}

const CLIENT_SOURCE_DIRS = ["client/src"] as const;

describe("dead client components — L1.5 deletion guard", () => {
  for (const deadFile of DEAD_FILES) {
    const basename = path.basename(deadFile);
    it(`${basename} no longer exists on disk`, () => {
      expect(existsSync(path.join(repoRoot, deadFile))).toBe(false);
    });
  }

  it("no application source imports the deleted component modules", () => {
    const importPatterns = [
      /chat-interface/,
      /DemoChatPreview/,
      /TutorInsights/,
      /ChatDock/,
      /floating-actions/,
    ];
    const sources = CLIENT_SOURCE_DIRS.flatMap(collectSources);
    const offenders: string[] = [];
    for (const rel of sources) {
      const content = readFileSync(path.join(repoRoot, rel), "utf8");
      if (importPatterns.some((pat) => pat.test(content))) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
