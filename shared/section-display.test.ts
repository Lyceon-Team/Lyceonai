import { describe, expect, it } from "vitest";
import {
  isMathSection,
  isRwSection,
  sectionCodeForDisplay,
  sectionCodeFromLabel,
  sectionDisplayLabel,
  sectionDisplayLabelOr,
  SECTION_LABEL_MATH,
  SECTION_LABEL_RW,
} from "./section-display";

describe("isMathSection", () => {
  it.each(["m", "M", "m1", "M1", "m2", "M2", " M "])(
    "returns true for %s",
    (input) => {
      expect(isMathSection(input)).toBe(true);
    },
  );

  it.each(["rw", "RW", "rw1", "RW2"])(
    "returns false for an R&W token %s",
    (input) => {
      expect(isMathSection(input)).toBe(false);
    },
  );

  // The retired vocabularies. These used to return true; a caller still holding one
  // has a bug, and the point of this change is that the bug surfaces instead of being
  // absorbed by the display layer.
  // canonicality-gate: negative-fixture — these ARE the retired spellings; the
  // assertion is that the display mapping now rejects them.
  it.each(["math", "Math", "MATH", "reading_writing", "Reading & Writing"])(
    "returns false for the retired spelling %s",
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
  // rw1/rw2 are the load-bearing cases: MATH_TOKENS carried m1/m2 while RW_TOKENS
  // omitted rw1/rw2, so the two halves of the same ModuleId shape behaved differently.
  it.each(["rw", "RW", "Rw", "rw1", "RW1", "rw2", "RW2", " rw "])(
    "returns true for %s",
    (input) => {
      expect(isRwSection(input)).toBe(true);
    },
  );

  it.each(["m", "M", "M1", "m2"])(
    "returns false for a math token %s",
    (input) => {
      expect(isRwSection(input)).toBe(false);
    },
  );

  it.each([null, undefined, "", "garbage", "reading_writing"])(
    "returns false for %s",
    (input) => {
      expect(isRwSection(input as string | null | undefined)).toBe(false);
    },
  );
});

describe("the two token sets are symmetric", () => {
  it.each([
    ["m", "rw"],
    ["m1", "rw1"],
    ["m2", "rw2"],
  ] as const)(
    "%s and %s are both recognised, at the same shape",
    (mathToken, rwToken) => {
      expect(sectionDisplayLabel(mathToken)).toBe(SECTION_LABEL_MATH);
      expect(sectionDisplayLabel(rwToken)).toBe(SECTION_LABEL_RW);
    },
  );
});

describe("sectionDisplayLabel — one label per section, fail-closed", () => {
  it.each(["m", "M", "m1", "m2"] as const)(
    "returns 'Math' for %s",
    (input) => {
      expect(sectionDisplayLabel(input)).toBe("Math");
    },
  );

  // Not "R&W". The module produced that while eleven files hardcoded the long form,
  // including two that imported isMathSection from here and hand-rolled the label.
  it.each(["rw", "RW", "rw1", "rw2"] as const)(
    "returns 'Reading & Writing' for %s",
    (input) => {
      expect(sectionDisplayLabel(input)).toBe("Reading & Writing");
    },
  );

  it("never returns the abbreviated R&W form", () => {
    for (const input of ["rw", "RW", "rw1", "rw2"]) {
      expect(sectionDisplayLabel(input)).not.toBe("R&W");
    }
  });

  it.each([null, undefined, "", "  ", "garbage", "science", "break", "xyz"])(
    "returns null (fail-closed) for unknown input %s — never defaults to a section",
    (input) => {
      expect(
        sectionDisplayLabel(input as string | null | undefined),
      ).toBeNull();
    },
  );
});

describe("sectionCodeForDisplay", () => {
  it.each([
    ["m", "M"],
    ["M1", "M"],
    ["rw", "RW"],
    ["RW2", "RW"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(sectionCodeForDisplay(input)).toBe(expected);
  });

  it.each([null, undefined, "math", "Math", "reading_writing"])(
    "returns null for %s",
    (input) => {
      expect(
        sectionCodeForDisplay(input as string | null | undefined),
      ).toBeNull();
    },
  );
});

describe("sectionCodeFromLabel — the declared inverse", () => {
  it("round-trips every code through its label and back", () => {
    for (const code of ["M", "RW"] as const) {
      expect(sectionCodeFromLabel(sectionDisplayLabel(code))).toBe(code);
    }
  });

  it.each([
    [SECTION_LABEL_MATH, "M"],
    [SECTION_LABEL_RW, "RW"],
    ["reading and writing", "RW"],
    // Emitted by this module before this change; persisted calendar blobs may hold it.
    ["R&W", "RW"],
    ["M", "M"],
    ["rw", "RW"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(sectionCodeFromLabel(input)).toBe(expected);
  });

  it.each([null, undefined, "", "garbage", "Mathematics"])(
    "returns null for %s",
    (input) => {
      expect(
        sectionCodeFromLabel(input as string | null | undefined),
      ).toBeNull();
    },
  );
});

describe("sectionDisplayLabelOr", () => {
  it("returns the label when the section is known", () => {
    expect(sectionDisplayLabelOr("M", "Practice")).toBe("Math");
  });

  it("returns the caller's fallback when it is not", () => {
    expect(sectionDisplayLabelOr("garbage", "Practice")).toBe("Practice");
  });
});
