import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing start token: ${startToken}`);
  }

  const end = source.indexOf(endToken, start + startToken.length);
  if (end === -1) {
    throw new Error(`Missing end token: ${endToken}`);
  }

  return source.slice(start, end);
}

describe("Canonical runtime materialization law invariants", () => {
  it("practice runtime handlers are fail-closed and do not read raw questions", () => {
    const source = readRepoFile("server/routes/practice-canonical.ts");
    const submitBlock = extractBetween(
      source,
      "export async function submitPracticeAnswer",
      "async function submitPracticeSkip",
    );
    const serveBlock = extractBetween(
      source,
      "async function serveNextForSession",
      "async function findSessionItemForSubmission",
    );

    expect(submitBlock.includes('.from("questions")')).toBe(false);
    expect(serveBlock.includes("prebuildSessionItems(")).toBe(false);
    expect(serveBlock).toContain("PRACTICE_SESSION_ITEMS_NOT_MATERIALIZED");
    expect(serveBlock).toContain("PRACTICE_SESSION_ITEMS_MISSING");
  });

  // E1 exam deletion ruling, 2026-09-23: pre-baseline full-length runtime removed
  // pending Doc 04 rebuild. The full-length half of this law read function bodies in
  // apps/api/src/services/fullLengthExam.ts, which is deleted; it is removed here and
  // must be re-authored against the Doc 04 rebuild's own modules. The practice and
  // review halves are unchanged.

  // RESTORED 2026-09-21 (R3), against the rebuilt module paths. Parked in R1 because
  // both files it read were deleted with the old runtime
  // (server/services/review-queue.ts, server/routes/review-session-routes.ts).
  //
  // Ruled plan §3 ruling 19: review content and metadata come from the
  // `servable_questions` join at prefill, exactly as practice does, so the
  // published / issue_flags gate applies to a re-served miss too. A retired question
  // keeps its queue entry (ruling 18) and simply stops being poolable.
  it("review runtime pool and route modules do not use raw questions lookups", () => {
    for (const relativePath of [
      "server/services/review-pool.ts",
      "server/routes/review-canonical.ts",
    ]) {
      const src = readRepoFile(relativePath);
      expect(
        src.includes('.from("questions")'),
        `${relativePath} reads the raw questions table`,
      ).toBe(false);
      expect(
        src.includes(".from('questions')"),
        `${relativePath} reads the raw questions table`,
      ).toBe(false);
    }
  });

  // The positive half of the same law: review's ONLY question source is the servable
  // view. Absence of `questions` would also be satisfied by a module that reads no
  // bank at all, which would pass while serving nothing.
  it("review pool reads servable_questions", () => {
    const src = readRepoFile("server/services/review-pool.ts");
    expect(src.includes('.from("servable_questions")')).toBe(true);
  });
});
