import { describe, expect, it } from "vitest";
import {
  isMathSection,
  isRwSection,
  sectionDisplayLabel,
} from "./section-display";

describe("isMathSection", () => {
  it.each(["m", "M", "m1", "M1", "m2", "M2", "math", "Math", "MATH"])(
    "returns true for %s",
    (input) => {
      expect(isMathSection(input)).toBe(true);
    },
  );

  it.each(["rw", "RW", "reading_writing", "Reading & Writing"])(
    "returns false for R&W token %s",
    (input) => {
      expect(isMathSection(input)).toBe(false);
    },
  );

  it.each([null, undefined, "", "  ", "garbage", "science", "break"])(
    "returns false for %s",
    (input) => {
      expect(isMathSection(input as string | null | undefined)).toBe(false);
    },
  );
});

describe("isRwSection", () => {
  it.each(["rw", "RW", "Rw", "reading_writing", "Reading & Writing"])(
    "returns true for %s",
    (input) => {
      expect(isRwSection(input)).toBe(true);
    },
  );

  it.each(["m", "math", "M1", "m2"])(
    "returns false for math token %s",
    (input) => {
      expect(isRwSection(input)).toBe(false);
    },
  );

  it.each([null, undefined, "", "garbage"])("returns false for %s", (input) => {
    expect(isRwSection(input as string | null | undefined)).toBe(false);
  });
});

describe("sectionDisplayLabel — fail-closed", () => {
  it.each([
    ["m", "Math"],
    ["M", "Math"],
    ["m1", "Math"],
    ["m2", "Math"],
    ["math", "Math"],
    ["Math", "Math"],
    ["MATH", "Math"],
  ] as const)("returns 'Math' for %s", (input, expected) => {
    expect(sectionDisplayLabel(input)).toBe(expected);
  });

  it.each([
    ["rw", "R&W"],
    ["RW", "R&W"],
    ["reading_writing", "R&W"],
    ["Reading & Writing", "R&W"],
  ] as const)("returns 'R&W' for %s", (input, expected) => {
    expect(sectionDisplayLabel(input)).toBe(expected);
  });

  it.each([null, undefined, "", "  ", "garbage", "science", "break", "xyz"])(
    "returns null (fail-closed) for unknown input %s — never defaults to R&W",
    (input) => {
      expect(
        sectionDisplayLabel(input as string | null | undefined),
      ).toBeNull();
    },
  );
});
