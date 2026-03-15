import { describe, it, expect } from "vitest";
import { simpleHash, deterministicSample } from "../services/styleSampler";

describe("styleSampler", () => {
  describe("simpleHash", () => {
    it("returns same hash for same input", () => {
      const hash1 = simpleHash("test-job-123");
      const hash2 = simpleHash("test-job-123");
      expect(hash1).toBe(hash2);
    });

    it("returns different hashes for different inputs", () => {
      const hash1 = simpleHash("job-1");
      const hash2 = simpleHash("job-2");
      expect(hash1).not.toBe(hash2);
    });

    it("returns positive number", () => {
      const hash = simpleHash("any-string");
      expect(hash).toBeGreaterThanOrEqual(0);
    });
  });

  describe("deterministicSample", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];

    it("returns same selection for same seed", () => {
      const seed = 12345;
      const sample1 = deterministicSample(items, seed, 3);
      const sample2 = deterministicSample(items, seed, 3);
      expect(sample1).toEqual(sample2);
    });

    it("returns different selection for different seeds", () => {
      const sample1 = deterministicSample(items, 100, 3);
      const sample2 = deterministicSample(items, 999, 3);
      expect(sample1).not.toEqual(sample2);
    });

    it("returns all items if k >= items.length", () => {
      const sample = deterministicSample(items, 123, 10);
      expect(sample.length).toBe(items.length);
    });

    it("returns exactly k items when k < items.length", () => {
      const sample = deterministicSample(items, 123, 3);
      expect(sample.length).toBe(3);
    });

    it("returns empty array for empty input", () => {
      const sample = deterministicSample([], 123, 3);
      expect(sample).toEqual([]);
    });

    it("returns no duplicates", () => {
      const sample = deterministicSample(items, 123, 5);
      const unique = new Set(sample);
      expect(unique.size).toBe(sample.length);
    });
  });
});
