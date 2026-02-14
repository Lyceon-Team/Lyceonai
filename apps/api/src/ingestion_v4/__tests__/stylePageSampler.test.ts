import { describe, it, expect } from "vitest";
import { 
  simpleHash, 
  deterministicSample, 
  computeDomainMixScore, 
  computeTagConfidenceAvg,
  isCleanDomainPack 
} from "../services/stylePageSampler";
import type { StylePageRecord } from "../services/stylePageSampler";
import type { MathDomain } from "../types";

function makeStylePage(overrides: Partial<StylePageRecord> = {}): StylePageRecord {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    bucket: "lyceon-style-bank",
    pdf_path: "sat/math/pdf/test.pdf",
    page_number: 1,
    image_path: "sat/math/pages/test/p0001.png",
    exam: "SAT",
    section: "math",
    domain: null,
    difficulty: null,
    skill: null,
    tag_confidence: null,
    diagram_present: null,
    teacher_used_count: 0,
    qa_used_count: 0,
    ...overrides
  };
}

describe("stylePageSampler", () => {
  describe("simpleHash", () => {
    it("produces consistent hash for same input", () => {
      const h1 = simpleHash("job-123-5");
      const h2 = simpleHash("job-123-5");
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different inputs", () => {
      const h1 = simpleHash("job-123-1");
      const h2 = simpleHash("job-123-2");
      expect(h1).not.toBe(h2);
    });

    it("determinism test: same (jobId, iteration) returns same hash", () => {
      const jobId = "abc-123";
      const iteration = 5;
      const seed1 = simpleHash(`${jobId}-${iteration}`);
      const seed2 = simpleHash(`${jobId}-${iteration}`);
      expect(seed1).toBe(seed2);
    });
  });

  describe("deterministicSample", () => {
    it("returns empty array for empty input", () => {
      expect(deterministicSample([], 42, 5)).toEqual([]);
    });

    it("returns all items if k >= items.length", () => {
      const items = [1, 2, 3];
      expect(deterministicSample(items, 42, 5)).toEqual([1, 2, 3]);
    });

    it("samples deterministically with same seed", () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const s1 = deterministicSample(items, 42, 3);
      const s2 = deterministicSample(items, 42, 3);
      expect(s1).toEqual(s2);
    });

    it("produces different samples with different seeds", () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const s1 = deterministicSample(items, 42, 3);
      const s2 = deterministicSample(items, 99, 3);
      expect(s1).not.toEqual(s2);
    });

    it("returns exact k items when possible", () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = deterministicSample(items, 42, 5);
      expect(result.length).toBe(5);
    });
  });

  describe("computeDomainMixScore", () => {
    it("returns 0 for pages with no domains (all null)", () => {
      const pages = [makeStylePage(), makeStylePage(), makeStylePage()];
      expect(computeDomainMixScore(pages)).toBe(0);
    });

    it("returns 0 for pages with single domain", () => {
      const pages = [
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Algebra" }),
      ];
      expect(computeDomainMixScore(pages)).toBe(0);
    });

    it("returns 1 for pages with two domains", () => {
      const pages = [
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Advanced Math" }),
        makeStylePage({ domain: "Algebra" }),
      ];
      expect(computeDomainMixScore(pages)).toBe(1);
    });

    it("returns 3 for pages with four domains", () => {
      const pages = [
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Advanced Math" }),
        makeStylePage({ domain: "Problem Solving & Data Analysis" }),
        makeStylePage({ domain: "Geometry & Trigonometry" }),
      ];
      expect(computeDomainMixScore(pages)).toBe(3);
    });

    it("ignores null domains in mix calculation", () => {
      const pages = [
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: null }),
      ];
      expect(computeDomainMixScore(pages)).toBe(0);
    });
  });

  describe("computeTagConfidenceAvg", () => {
    it("returns null for pages with no confidence scores", () => {
      const pages = [makeStylePage(), makeStylePage()];
      expect(computeTagConfidenceAvg(pages)).toBeNull();
    });

    it("computes average of non-null confidence scores", () => {
      const pages = [
        makeStylePage({ tag_confidence: 0.8 }),
        makeStylePage({ tag_confidence: 0.6 }),
        makeStylePage({ tag_confidence: null }),
      ];
      expect(computeTagConfidenceAvg(pages)).toBeCloseTo(0.7, 5);
    });
  });

  describe("isCleanDomainPack", () => {
    it("returns true for all null domains (unknown domains allowed)", () => {
      const pages = Array(8).fill(null).map(() => makeStylePage());
      expect(isCleanDomainPack(pages)).toBe(true);
    });

    it("returns true for single domain pages", () => {
      const pages = Array(8).fill(null).map(() => makeStylePage({ domain: "Algebra" }));
      expect(isCleanDomainPack(pages)).toBe(true);
    });

    it("returns false for two domain mix (rejects mushy packs)", () => {
      const pages = [
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Advanced Math" }),
        makeStylePage({ domain: "Advanced Math" }),
        makeStylePage({ domain: "Advanced Math" }),
        makeStylePage({ domain: "Advanced Math" }),
      ];
      expect(isCleanDomainPack(pages)).toBe(false);
    });

    it("returns true if at least 6 pages have unknown domain", () => {
      const pages = [
        makeStylePage({ domain: null }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: null }),
        makeStylePage({ domain: "Algebra" }),
        makeStylePage({ domain: "Advanced Math" }),
      ];
      expect(isCleanDomainPack(pages)).toBe(true);
    });
  });

  describe("determinism", () => {
    it("same (jobId, iteration) produces same ordered page IDs", () => {
      const pages = Array(20).fill(null).map((_, i) => 
        makeStylePage({ 
          id: `page-${i}`,
          page_number: i + 1 
        })
      );
      
      const seed1 = simpleHash("job-abc-5");
      const seed2 = simpleHash("job-abc-5");
      
      const sample1 = deterministicSample(pages, seed1, 8);
      const sample2 = deterministicSample(pages, seed2, 8);
      
      expect(sample1.map(p => p.id)).toEqual(sample2.map(p => p.id));
    });
  });
});
