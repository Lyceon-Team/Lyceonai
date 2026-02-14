import { describe, it, expect } from "vitest";
import { 
  simpleHash, 
  deterministicSample, 
  computeDomainMixScore, 
  computeTagConfidenceAvg,
  isCleanDomainPack 
} from "../services/domainSampler";
import type { StylePageRef, MathDomain } from "../types";

describe("domainSampler", () => {
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
  });

  describe("computeDomainMixScore", () => {
    const makePage = (domain: MathDomain | null): StylePageRef => ({
      id: "uuid",
      bucket: "lyceon-style-bank",
      pdfPath: "sat/math/pdf/test.pdf",
      pageNumber: 1,
      imagePath: "sat/math/pages/test/p0001.png",
      domain,
      difficulty: null,
      tagConfidence: null,
    });

    it("returns 0 for pages with no domains (all null)", () => {
      const pages = [makePage(null), makePage(null), makePage(null)];
      expect(computeDomainMixScore(pages)).toBe(0);
    });

    it("returns 0 for pages with single domain", () => {
      const pages = [
        makePage("Algebra"),
        makePage("Algebra"),
        makePage("Algebra"),
      ];
      expect(computeDomainMixScore(pages)).toBe(0);
    });

    it("returns 1 for pages with two domains", () => {
      const pages = [
        makePage("Algebra"),
        makePage("Advanced Math"),
        makePage("Algebra"),
      ];
      expect(computeDomainMixScore(pages)).toBe(1);
    });

    it("returns 3 for pages with four domains", () => {
      const pages = [
        makePage("Algebra"),
        makePage("Advanced Math"),
        makePage("Problem Solving & Data Analysis"),
        makePage("Geometry & Trigonometry"),
      ];
      expect(computeDomainMixScore(pages)).toBe(3);
    });

    it("ignores null domains in mix calculation", () => {
      const pages = [
        makePage("Algebra"),
        makePage(null),
        makePage("Algebra"),
        makePage(null),
      ];
      expect(computeDomainMixScore(pages)).toBe(0);
    });
  });

  describe("computeTagConfidenceAvg", () => {
    const makePage = (conf: number | null): StylePageRef => ({
      id: "uuid",
      bucket: "lyceon-style-bank",
      pdfPath: "sat/math/pdf/test.pdf",
      pageNumber: 1,
      imagePath: "sat/math/pages/test/p0001.png",
      domain: null,
      difficulty: null,
      tagConfidence: conf,
    });

    it("returns null for pages with no confidence scores", () => {
      const pages = [makePage(null), makePage(null)];
      expect(computeTagConfidenceAvg(pages)).toBeNull();
    });

    it("computes average of non-null confidence scores", () => {
      const pages = [makePage(0.8), makePage(0.6), makePage(null)];
      expect(computeTagConfidenceAvg(pages)).toBeCloseTo(0.7, 5);
    });
  });

  describe("isCleanDomainPack", () => {
    const makePage = (domain: MathDomain | null): StylePageRef => ({
      id: "uuid",
      bucket: "lyceon-style-bank",
      pdfPath: "sat/math/pdf/test.pdf",
      pageNumber: 1,
      imagePath: "sat/math/pages/test/p0001.png",
      domain,
      difficulty: null,
      tagConfidence: null,
    });

    it("returns true for all null domains (unknown domains allowed)", () => {
      const pages = Array(8).fill(null).map(() => makePage(null));
      expect(isCleanDomainPack(pages)).toBe(true);
    });

    it("returns true for single domain pages", () => {
      const pages = Array(8).fill(null).map(() => makePage("Algebra"));
      expect(isCleanDomainPack(pages)).toBe(true);
    });

    it("returns false for two domain mix (default maxAllowedMixed=1)", () => {
      const pages = [
        makePage("Algebra"),
        makePage("Algebra"),
        makePage("Algebra"),
        makePage("Algebra"),
        makePage("Advanced Math"),
        makePage("Advanced Math"),
        makePage("Advanced Math"),
        makePage("Advanced Math"),
      ];
      expect(isCleanDomainPack(pages, 1)).toBe(false);
    });

    it("returns true if at least 6 pages have unknown domain", () => {
      const pages = [
        makePage(null),
        makePage(null),
        makePage(null),
        makePage(null),
        makePage(null),
        makePage(null),
        makePage("Algebra"),
        makePage("Advanced Math"),
      ];
      expect(isCleanDomainPack(pages)).toBe(true);
    });
  });
});
