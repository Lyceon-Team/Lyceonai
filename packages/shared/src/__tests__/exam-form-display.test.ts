/**
 * @spec [Owner ruling, Karl, 2026-10-05 — form names display "Full-Length Test 1/2/3"]
 * @implemented [2026-10-05]
 *
 * plain English: a table test of `displayFormName`. The two stored shapes map; everything else,
 * including near misses (case, whitespace, suffixes), passes through unchanged.
 */
import { describe, expect, it } from "vitest";
import { displayFormName } from "../exam-form-display";

describe("displayFormName", () => {
  it.each([
    // The stored shapes.
    ["Practice Test 1", "Full-Length Test 1"],
    ["Practice Test 2", "Full-Length Test 2"],
    ["Practice Test 3", "Full-Length Test 3"],
    ["Full-Length Practice Test 1", "Full-Length Test 1"],
    ["Full-Length Practice Test 3", "Full-Length Test 3"],
    // N >= 10 keeps every digit.
    ["Practice Test 10", "Full-Length Test 10"],
    ["Practice Test 123", "Full-Length Test 123"],
    ["Full-Length Practice Test 11", "Full-Length Test 11"],
    // Not the stored pattern: unchanged.
    ["practice test 1", "practice test 1"],
    ["PRACTICE TEST 1", "PRACTICE TEST 1"],
    ["Full-length Practice Test 1", "Full-length Practice Test 1"],
    [" Practice Test 1", " Practice Test 1"],
    ["Practice Test 1 ", "Practice Test 1 "],
    ["Practice  Test 1", "Practice  Test 1"],
    ["Practice Test 1", "Practice Test 1"],
    ["Practice Test", "Practice Test"],
    ["Practice Test one", "Practice Test one"],
    ["Practice Test 1A", "Practice Test 1A"],
    ["Practice Test 1\n", "Practice Test 1\n"],
    ["My Practice Test 1", "My Practice Test 1"],
    ["Full-Length Test 1", "Full-Length Test 1"],
    ["Spring Mock Exam", "Spring Mock Exam"],
    ["", ""],
  ])("%j -> %j", (stored, shown) => {
    expect(displayFormName(stored)).toBe(shown);
  });
});
