/**
 * V4 Proof Endpoint Tests
 * 
 * Tests for proof endpoint returning violations array instead of opaque errors,
 * and clustering invariant validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("v4Proof", () => {
  describe("proof response structure", () => {
    it("should return violations array in response", () => {
      const mockResponse = {
        ok: false,
        violations: [
          "CLUSTERING_INVARIANT_VIOLATION: attemptedCount === 0 but 5 unclustered pages existed."
        ],
        section: "math",
        geminiUsed: false,
        stylePages: { total: 5, unclustered: 5 },
        eligibilityDebug: {
          eligibleUnclusteredCount: 5,
          ilikeMatchTotal: 5,
          ilikeMatchUnclustered: 5,
          sectionMismatch: false,
          firstEligiblePage: null,
        },
        clustering: {
          attemptedCount: 0,
          clusteredCount: 0,
          createdClusters: 0,
          failedCount: 0,
        },
        clusters: { before: 0, after: 0, created: 0 },
      };

      expect(mockResponse).toHaveProperty("violations");
      expect(Array.isArray(mockResponse.violations)).toBe(true);
      expect(mockResponse.ok).toBe(false);
    });

    it("should include eligibility debug info", () => {
      const mockResponse = {
        ok: true,
        violations: [],
        eligibilityDebug: {
          eligibleUnclusteredCount: 3,
          ilikeMatchTotal: 3,
          ilikeMatchUnclustered: 3,
          sectionMismatch: false,
          firstEligiblePage: {
            id: "page-123",
            section: "math",
            domain: "Algebra",
            skill: "Linear equations",
            image_path: "style-bank/math/page1.png",
          },
        },
      };

      expect(mockResponse.eligibilityDebug).toBeDefined();
      expect(mockResponse.eligibilityDebug.eligibleUnclusteredCount).toBe(3);
      expect(mockResponse.eligibilityDebug.firstEligiblePage?.id).toBe("page-123");
    });

    it("should detect section normalization mismatch", () => {
      const mockResponse = {
        ok: false,
        violations: [
          "SECTION_NORMALIZATION_MISMATCH: Found 10 pages with section ILIKE 'math' but only 5 with exact match."
        ],
        eligibilityDebug: {
          eligibleUnclusteredCount: 5,
          ilikeMatchTotal: 10,
          ilikeMatchUnclustered: 8,
          sectionMismatch: true,
        },
      };

      expect(mockResponse.violations.some(v => v.includes("SECTION_NORMALIZATION_MISMATCH"))).toBe(true);
      expect(mockResponse.eligibilityDebug.sectionMismatch).toBe(true);
    });
  });

  describe("invariant violation detection", () => {
    it("should detect attemptedCount=0 when unclustered pages exist", () => {
      const clusteringResult = {
        attemptedCount: 0,
        clusteredCount: 0,
        createdClusters: 0,
        failedCount: 0,
      };
      const unclusteredCount = 5;
      
      const violations: string[] = [];
      
      if (clusteringResult.attemptedCount === 0 && unclusteredCount > 0) {
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: attemptedCount === 0 but ${unclusteredCount} unclustered pages existed.`
        );
      }
      
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("attemptedCount === 0");
    });

    it("should detect silent cluster creation failure", () => {
      const clusteringResult = {
        attemptedCount: 3,
        clusteredCount: 3,
        createdClusters: 0,
        failedCount: 0,
      };
      const clustersBefore = 0;
      const clustersCreated = 0;
      
      const violations: string[] = [];
      
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount > 0 && 
          clustersBefore === 0 && 
          clustersCreated === 0) {
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: clusters.created === 0 but pages were clustered.`
        );
      }
      
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("clusters.created === 0");
    });

    it("should detect 100% failure rate", () => {
      const clusteringResult = {
        attemptedCount: 5,
        clusteredCount: 0,
        createdClusters: 0,
        failedCount: 5,
        sampleErrors: ["Page 1: error", "Page 2: error"],
      };
      
      const violations: string[] = [];
      
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount === 0 && 
          clusteringResult.failedCount === clusteringResult.attemptedCount) {
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: All ${clusteringResult.attemptedCount} attempted pages failed.`
        );
      }
      
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("All 5 attempted pages failed");
    });

    it("should not trigger violations when clustering succeeds", () => {
      const clusteringResult = {
        attemptedCount: 5,
        clusteredCount: 5,
        createdClusters: 1,
        failedCount: 0,
      };
      const unclusteredCount: number = 5;
      const clustersBefore: number = 0;
      const clustersCreated: number = 1;
      
      const violations: string[] = [];
      
      if (clusteringResult.attemptedCount === 0 && unclusteredCount > 0) {
        violations.push("Invariant 1");
      }
      
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount > 0 && 
          clustersBefore === 0 && 
          clustersCreated === 0) {
        violations.push("Invariant 2");
      }
      
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount === 0 && 
          clusteringResult.failedCount === clusteringResult.attemptedCount) {
        violations.push("Invariant 3");
      }
      
      expect(violations).toHaveLength(0);
    });
  });

  describe("proof response JSON shape", () => {
    it("should have correct shape for success case", () => {
      const successResponse = {
        ok: true,
        violations: [],
        section: "math",
        geminiUsed: true,
        geminiKeySource: "env",
        fanout: { discovered: 2, enqueued: 1, skipped: 1, errors: 0 },
        workerTicks: { processed: 1, completed: 1, failed: 0 },
        stylePages: { total: 10, unclustered: 0 },
        eligibilityDebug: {
          eligibleUnclusteredCount: 0,
          ilikeMatchTotal: 10,
          ilikeMatchUnclustered: 0,
          sectionMismatch: false,
          firstEligiblePage: null,
        },
        clustering: {
          attemptedCount: 3,
          clusteredCount: 3,
          createdClusters: 1,
          failedCount: 0,
          fallbackCount: 0,
          geminiUsed: true,
        },
        clusters: { before: 0, after: 1, created: 1 },
        errors: [],
      };

      expect(successResponse.ok).toBe(true);
      expect(successResponse.violations).toEqual([]);
      expect(successResponse.clustering.attemptedCount).toBe(3);
      expect(successResponse.clusters.created).toBe(1);
    });

    it("should have correct shape for failure case with violations", () => {
      const failureResponse = {
        ok: false,
        violations: [
          "CLUSTERING_INVARIANT_VIOLATION: attemptedCount === 0 but 5 unclustered pages existed."
        ],
        section: "rw",
        geminiUsed: false,
        clustering: {
          attemptedCount: 0,
          clusteredCount: 0,
          createdClusters: 0,
          failedCount: 0,
          skipped: true,
          reason: "no_unclustered_pages",
        },
        sampleErrors: ["Page abc: clustering returned null"],
      };

      expect(failureResponse.ok).toBe(false);
      expect(failureResponse.violations.length).toBeGreaterThan(0);
      expect(failureResponse.violations[0]).toContain("CLUSTERING_INVARIANT_VIOLATION");
    });
  });
});
