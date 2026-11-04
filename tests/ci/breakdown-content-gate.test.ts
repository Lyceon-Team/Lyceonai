/**
 * The breakdown content gate (scripts/ci/breakdown-content-gate.ts).
 *
 * @spec [Karl's ruling 2026-11-02 (third rulings, 2): no breakdown script, audio, real-answer
 *       fixture, log or artifact in the public repo, and a CI check that fails if a breakdown
 *       script file appears; Karl's ruling 2026-11-03 (1): the synthetic fixture and the
 *       breakdown-content-gate with its own plants; SCL-266] | @implemented [2026-11-03]
 *
 * plain English: the fixture for every script case is the REAL synthetic script the breakdown
 * tests run on (read from disk, never re-typed), copied to where a leak would put it. Presence is
 * asserted before absence: the committed tree is shown to hold that script before its clean pass
 * is believed. The plants in scripts/ci/breakdown-content-gate.mutations.sh turn each test here
 * red by name.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_FILES,
  SYNTHETIC_QUESTION_ID,
  SYNTHETIC_ROOT,
  breakdownContentFindings,
  looksLikeScript,
  trackedFiles,
  type GateFile,
} from "../../scripts/ci/breakdown-content-gate";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT_PATH = `${SYNTHETIC_ROOT}content/qotd-breakdowns/2026-W03/2026-01-14/script.json`;
const SCRIPT_TEXT = readFileSync(resolve(ROOT, SCRIPT_PATH), "utf8");
const SCRIPT: Record<string, unknown> = JSON.parse(SCRIPT_TEXT);

function file(path: string, text = ""): GateFile {
  return { path, read: () => text };
}

function rulesAt(files: GateFile[], path: string): string[] {
  return breakdownContentFindings(files)
    .filter((f) => f.path === path)
    .map((f) => f.rule);
}

describe("the breakdown content gate", () => {
  it("the committed tree passes, and it holds the synthetic script it allows", () => {
    const files = trackedFiles(ROOT);
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES);
    // Presence first: the gate sees the synthetic script, and it is script-shaped.
    expect(files.some((f) => f.path === SCRIPT_PATH)).toBe(true);
    expect(looksLikeScript(SCRIPT)).toBe(true);
    expect(SYNTHETIC_QUESTION_ID.test(String(SCRIPT.question_id))).toBe(true);
    expect(breakdownContentFindings(files)).toEqual([]);
  });

  it("a breakdown path outside the synthetic root is BD-PATH", () => {
    const wav = "content/qotd-breakdowns/2026-W45/2026-11-08/voice/hook.wav";
    expect(rulesAt([file(wav)], wav)).toEqual(["BD-PATH"]);
    // The real-day fixture #1398 merged is caught twice: its path and its script.
    const old =
      "tests/fixtures/qotd-breakdowns/social/content/qotd-breakdowns/2026-W40/2026-10-02/script.json";
    expect(rulesAt([file(old, SCRIPT_TEXT)], old)).toEqual([
      "BD-PATH",
      "BD-SCRIPT",
    ]);
  });

  it("the schedule export is BD-EXPORT anywhere, the synthetic root included", () => {
    for (const p of [
      "qotd-breakdown-schedule.json",
      "docs/qotd-breakdown-schedule-2026-11-09.json",
      `${SYNTHETIC_ROOT}qotd-breakdown-schedule.json`,
    ])
      expect(rulesAt([file(p, "[]")], p)).toEqual(["BD-EXPORT"]);
  });

  it("a script under any name outside the synthetic root is BD-SCRIPT", () => {
    const p = "docs/marketing/cmo/notes.json";
    expect(rulesAt([file(p, SCRIPT_TEXT)], p)).toEqual(["BD-SCRIPT"]);
  });

  it("a trimmed or renamed script is still BD-SCRIPT", () => {
    const trimmed = {
      qotd_date: SCRIPT.qotd_date,
      correct_display_letter: SCRIPT.correct_display_letter,
      answer: SCRIPT.answer,
    };
    const p = "scripts/qotd-social/draft.json";
    expect(rulesAt([file(p, JSON.stringify(trimmed))], p)).toEqual([
      "BD-SCRIPT",
    ]);
  });

  it("an array of scripts is BD-SCRIPT, one finding per element", () => {
    const p = "docs/batch.json";
    const found = breakdownContentFindings([
      file(p, JSON.stringify([SCRIPT, SCRIPT])),
    ]);
    expect(found.map((f) => [f.rule, f.path])).toEqual([
      ["BD-SCRIPT", p],
      ["BD-SCRIPT", p],
    ]);
  });

  it("a script under the synthetic root with a real question id is BD-SCRIPT", () => {
    const p = `${SYNTHETIC_ROOT}content/qotd-breakdowns/2026-W03/2026-01-15/script.json`;
    expect(
      rulesAt(
        [file(p, JSON.stringify({ ...SCRIPT, question_id: "SATM1FXQ001" }))],
        p,
      ),
    ).toEqual(["BD-SCRIPT"]);
    expect(rulesAt([file(p, SCRIPT_TEXT)], p)).toEqual([]);
  });

  it("the QOTD fixture rows are not scripts (no false positive on the shared QOTD fixture)", () => {
    const p = "tests/fixtures/qotd/rows.json";
    const text = readFileSync(resolve(ROOT, p), "utf8");
    // Presence first: the rows do carry a stored letter, so only the script fields tell them apart.
    expect(text).toContain('"correct_display_letter"');
    expect(rulesAt([file(p, text)], p)).toEqual([]);
  });

  it("a finding names the rule and the path, never the file's content", () => {
    const p = "docs/notes.json";
    const [f] = breakdownContentFindings([file(p, SCRIPT_TEXT)]);
    expect(f).toBeDefined();
    const answer = SCRIPT.answer as { voice: string; notepad: string };
    expect(f?.detail).not.toContain(answer.notepad);
    expect(f?.detail).not.toContain(answer.voice);
  });
});
