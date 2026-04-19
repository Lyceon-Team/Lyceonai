import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type MatchRecord = {
  file: string;
  lineNumber: number;
  line: string;
};

const repoRoot = process.cwd();
const auditRoots = ["client/src/pages", "client/src/components"];
const auditPattern = /variant=['"]destructive|bg-red|text-red|border-red|destructive/g;

const allowedLineMatchers: Array<{ file: string; matcher: RegExp }> = [
  {
    file: "client/src/pages/guardian-dashboard.tsx",
    matcher: /hover:text-red-600|bg-red-600|hover:bg-red-700/,
  },
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isUiPrimitive(filePath: string): boolean {
  return normalizePath(filePath).startsWith("client/src/components/ui/");
}

function isAllowedMatch(filePath: string, line: string): boolean {
  if (isUiPrimitive(filePath)) return true;
  return allowedLineMatchers.some(
    (allowed) => normalizePath(filePath) === allowed.file && allowed.matcher.test(line),
  );
}

function walkFiles(relativeDir: string): string[] {
  const absDir = path.join(repoRoot, relativeDir);
  const output: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relPath = normalizePath(path.relative(repoRoot, absPath));
    if (entry.isDirectory()) {
      output.push(...walkFiles(relPath));
      continue;
    }
    if (entry.isFile() && /\.(tsx?|jsx?)$/i.test(entry.name)) {
      output.push(relPath);
    }
  }
  return output;
}

function collectMatches(): MatchRecord[] {
  const matches: MatchRecord[] = [];
  for (const root of auditRoots) {
    for (const file of walkFiles(root)) {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
      const lines = source.split("\n");
      lines.forEach((line, idx) => {
        auditPattern.lastIndex = 0;
        if (auditPattern.test(line)) {
          matches.push({
            file,
            lineNumber: idx + 1,
            line: line.trim(),
          });
        }
      });
    }
  }
  return matches;
}

describe("Destructive usage audit", () => {
  it("keeps red/destructive usage to explicit allowlist contexts", () => {
    const matches = collectMatches();
    const disallowed = matches.filter((match) => !isAllowedMatch(match.file, match.line));

    if (disallowed.length > 0) {
      const printable = disallowed
        .map((entry) => `${entry.file}:${entry.lineNumber} -> ${entry.line}`)
        .join("\n");
      throw new Error(`Disallowed destructive usage found:\n${printable}`);
    }

    expect(disallowed).toHaveLength(0);
  });
});
