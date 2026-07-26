import { describe, expect, it } from "vitest";
import { isSubmittableAnswer } from "./practice-submission";

describe("isSubmittableAnswer — unified dispatcher", () => {
  it("rejects null question", () => {
    expect(isSubmittableAnswer(null, "A")).toBe(false);
  });

  describe("MCQ (multiple_choice)", () => {
    const mcq = { questionType: "multiple_choice" as const };

    it("accepts non-empty option id", () => {
      expect(isSubmittableAnswer(mcq, "A")).toBe(true);
      expect(isSubmittableAnswer(mcq, "B")).toBe(true);
    });

    it("rejects null answer", () => {
      expect(isSubmittableAnswer(mcq, null)).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isSubmittableAnswer(mcq, "")).toBe(false);
      expect(isSubmittableAnswer(mcq, "   ")).toBe(false);
    });
  });

  describe("grid_in", () => {
    const gridIn = { questionType: "grid_in" as const };

    it("accepts valid formats", () => {
      for (const v of ["42", "0.2", "1/5", "-4", "7/2", "3.5"]) {
        expect(isSubmittableAnswer(gridIn, v)).toBe(true);
      }
    });

    it("rejects malformed values", () => {
      for (const v of ["1/2/3", "1..2", ".", "/", "-", "abc", ""]) {
        expect(isSubmittableAnswer(gridIn, v)).toBe(false);
      }
    });

    it("rejects null answer", () => {
      expect(isSubmittableAnswer(gridIn, null)).toBe(false);
    });
  });

  describe("unknown question type (fail closed)", () => {
    it("rejects unknown type", () => {
      expect(isSubmittableAnswer({ questionType: null }, "A")).toBe(false);
    });

    it("rejects missing questionType", () => {
      expect(isSubmittableAnswer({}, "A")).toBe(false);
    });
  });
});
