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

function extractBetween(source: string, startToken: string, endToken: string): string {
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

function extractFrom(source: string, startToken: string): string {
  const start = source.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing start token: ${startToken}`);
  }
  return source.slice(start);
}

describe("Canonical runtime materialization law invariants", () => {
  it("practice runtime handlers are fail-closed and do not read raw questions", () => {
    const source = readRepoFile("server/routes/practice-canonical.ts");
    const submitBlock = extractBetween(
      source,
      "export async function submitPracticeAnswer",
      "async function submitPracticeSkip"
    );
    const serveBlock = extractBetween(
      source,
      "async function serveNextForSession",
      "async function findSessionItemForSubmission"
    );

    expect(submitBlock.includes('.from("questions")')).toBe(false);
    expect(serveBlock.includes("prebuildSessionItems(")).toBe(false);
    expect(serveBlock).toContain("PRACTICE_SESSION_ITEMS_NOT_MATERIALIZED");
    expect(serveBlock).toContain("PRACTICE_SESSION_ITEMS_MISSING");
  });

  it("full-length runtime handlers do not read raw questions after materialization", () => {
    const source = readRepoFile("apps/api/src/services/fullLengthExam.ts");
    const createBlock = extractBetween(
      source,
      "export async function createExamSession",
      "export async function getCurrentSession"
    );
    const materializeBlock = extractBetween(
      source,
      "async function materializeModuleFromResolvedForm",
      "async function prepareDeferredModule2FromPersistedOutcome"
    );
    const submitBlock = extractBetween(
      source,
      "export async function submitAnswer",
      "export async function persistModuleCalculatorState"
    );
    const submitModuleBlock = extractBetween(
      source,
      "export async function submitModule",
      "export async function startExam"
    );
    const reviewBlock = extractFrom(source, "export async function getExamReview(");

    expect(createBlock).toContain("moduleKey(section, 1)");
    expect(createBlock).toContain("moduleIndex: 1");
    expect(createBlock).not.toContain("for (const moduleIndex of [1, 2] as const)");
    expect(materializeBlock).toContain('.from("questions")');
    expect(submitBlock.includes('.from("questions")')).toBe(false);
    expect(reviewBlock.includes('.from("questions")')).toBe(false);
    expect(submitBlock).toContain("Runtime fallback to raw questions is disabled by contract.");
    expect(reviewBlock).toContain("Runtime fallback to raw questions is disabled by contract.");
    expect(submitModuleBlock).toContain("prepareDeferredModule2FromPersistedOutcome");
    expect(source).toContain(
      "Module 2 bucket persisted without deferred materialization proof from persisted Module 1 outcomes"
    );
  });

  it("review runtime queue/session builders do not use raw questions lookups", () => {
    const queueSource = readRepoFile("server/services/review-queue.ts");
    const sessionSource = readRepoFile("server/routes/review-session-routes.ts");

    expect(queueSource.includes('.from("questions")')).toBe(false);
    expect(sessionSource.includes('.from("questions")')).toBe(false);
  });
});
