import { describe, it, expect } from "vitest";
import { normalizeClusterKey, GetUnclusteredPagesResult } from "../services/v4Clustering";

describe("v4Clustering", () => {
  describe("getUnclusteredPages query contract", () => {
    it("GetUnclusteredPagesResult type has error field", () => {
      const result: GetUnclusteredPagesResult = {
        pages: [],
        error: "test error",
      };
      expect(result.error).toBe("test error");
      expect(result.pages).toEqual([]);
    });

    it("GetUnclusteredPagesResult allows null error on success", () => {
      const result: GetUnclusteredPagesResult = {
        pages: [{ id: "test", bucket: "b", image_path: "p", section: "math", domain: null, difficulty: null, skill: null, primary_cluster_id: null, structure_signature: null }],
        error: null,
      };
      expect(result.error).toBeNull();
      expect(result.pages.length).toBe(1);
    });
  });

  describe("normalizeClusterKey", () => {
    it("converts to lowercase", () => {
      expect(normalizeClusterKey("MATH_LINEAR")).toBe("math_linear");
    });

    it("replaces spaces with underscores", () => {
      expect(normalizeClusterKey("linear equation solve")).toBe("linear_equation_solve");
    });

    it("removes special characters but preserves colons", () => {
      expect(normalizeClusterKey("math: linear-equations!")).toBe("math:_linearequations");
    });

    it("collapses multiple underscores", () => {
      expect(normalizeClusterKey("math___linear___equations")).toBe("math_linear_equations");
    });

    it("trims leading/trailing underscores", () => {
      expect(normalizeClusterKey("_math_linear_")).toBe("math_linear");
    });

    it("truncates to 128 chars", () => {
      const longKey = "a".repeat(200);
      expect(normalizeClusterKey(longKey).length).toBeLessThanOrEqual(128);
    });

    it("handles empty string", () => {
      expect(normalizeClusterKey("")).toBe("");
    });

    it("handles numbers", () => {
      expect(normalizeClusterKey("math123_test")).toBe("math123_test");
    });
  });

  describe("cluster key format validation", () => {
    it("produces valid cluster keys from various inputs", () => {
      const testCases = [
        { input: "Solve for X", expected: "solve_for_x" },
        { input: "Punctuation & Grammar", expected: "punctuation__grammar" },
        { input: "Graph Analysis (Charts)", expected: "graph_analysis_charts" },
        { input: "SAT Math - Algebra", expected: "sat_math__algebra" },
      ];

      for (const { input, expected } of testCases) {
        const result = normalizeClusterKey(input);
        expect(result).toMatch(/^[a-z0-9_]*$/);
      }
    });
  });
});
