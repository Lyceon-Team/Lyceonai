import { describe, expect, it } from "vitest";
import { normalizePracticeTopicDomains } from "./practice-topic-taxonomy";

describe("normalizePracticeTopicDomains", () => {
  it("normalizes mixed string/object domain entries", () => {
    const result = normalizePracticeTopicDomains([
      "Algebra",
      { domain: "Geometry", skills: ["Triangles", " Circles ", "", "  "] },
      { domain: "  Statistics  ", skills: null },
    ]);

    expect(result).toEqual([
      { domain: "Algebra", skills: [] },
      { domain: "Geometry", skills: ["Triangles", "Circles"] },
      { domain: "Statistics", skills: [] },
    ]);
  });

  it("filters malformed or empty entries", () => {
    const result = normalizePracticeTopicDomains([
      "",
      "   ",
      { domain: "", skills: ["One"] },
      { domain: " ", skills: [] },
      { skills: ["Missing domain"] },
      "Functions",
    ] as any);

    expect(result).toEqual([{ domain: "Functions", skills: [] }]);
  });

  it("returns empty array for undefined input", () => {
    expect(normalizePracticeTopicDomains(undefined)).toEqual([]);
  });
});
