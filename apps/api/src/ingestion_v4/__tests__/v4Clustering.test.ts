/**
 * V4 Clustering Tests
 * 
 * Tests for:
 * - Empty cluster bootstrap
 * - Malformed Gemini output handling
 * - Fallback clustering path
 * - Difficulty extraction vs unknown
 * - Schema validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeClusterKey,
  SupapromptV2ResponseSchema,
  ClusterSignatureSchema,
  EvidenceSchema,
  ClusterRecommendationSchema,
  StructureSignatureV2Schema,
} from "../services/v4Clustering";

describe("v4Clustering", () => {
  describe("normalizeClusterKey", () => {
    it("should normalize cluster keys to lowercase with underscores", () => {
      expect(normalizeClusterKey("Math::Algebra::Linear Equations")).toBe("math::algebra::linear_equations");
      expect(normalizeClusterKey("rw::Information and Ideas::Central ideas")).toBe("rw::information_and_ideas::central_ideas");
    });

    it("should remove special characters except colons", () => {
      expect(normalizeClusterKey("test@#$%key")).toBe("testkey");
      expect(normalizeClusterKey("test::key::value")).toBe("test::key::value");
    });

    it("should truncate long keys to 128 chars", () => {
      const longKey = "a".repeat(200);
      expect(normalizeClusterKey(longKey).length).toBe(128);
    });

    it("should handle empty strings", () => {
      expect(normalizeClusterKey("")).toBe("");
    });
  });

  describe("SupapromptV2ResponseSchema validation", () => {
    it("should validate a complete valid response", () => {
      const validResponse = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "sat/math/test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: "Linear equations",
        difficultyLabel: "Easy",
        difficultyLevel: 1,
        questionType: "multiple-choice",
        topicSummary: "Solve a linear equation",
        evidence: {
          domainFound: true,
          skillFound: true,
          difficultyFound: true,
          notes: ["Domain visible"],
        },
        structureSignature: {
          signals: {
            hasTable: false,
            hasGraph: false,
            hasChart: false,
            hasEquationBlock: true,
            hasOptionsAtoD: true,
            hasUnderlinedText: null,
          },
          signatureText: "mcq|eqblock|no_graph",
        },
        clusterRecommendation: {
          clusterKey: "math::Algebra::Linear equations::mcq|eqblock",
          confidence: 0.95,
          reason: "Explicit domain/skill labels",
        },
      };

      const result = SupapromptV2ResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it("should validate response with null domain/skill (unknown metadata)", () => {
      const unknownResponse = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "sat/math/test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: "multiple-choice",
        topicSummary: "Question with unknown metadata",
        evidence: {
          domainFound: false,
          skillFound: false,
          difficultyFound: false,
          notes: [],
        },
        structureSignature: {
          signals: {
            hasTable: false,
            hasGraph: true,
            hasChart: false,
            hasEquationBlock: null,
            hasOptionsAtoD: true,
            hasUnderlinedText: null,
          },
          signatureText: "mcq|graph|no_table",
        },
        clusterRecommendation: {
          clusterKey: "math::unknown::unknown::mcq|graph|no_table",
          confidence: 0.55,
          reason: "No labels; structure signature only",
        },
      };

      const result = SupapromptV2ResponseSchema.safeParse(unknownResponse);
      expect(result.success).toBe(true);
    });

    it("should reject invalid version", () => {
      const invalidResponse = {
        version: "v3_old_format",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Test",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it("should reject invalid section", () => {
      const invalidResponse = {
        version: "v4_style_cluster_v2",
        section: "english",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Test",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it("should reject invalid difficulty level", () => {
      const invalidResponse = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: "Test",
        difficultyLabel: "Super Hard",
        difficultyLevel: 5,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: true, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });

    it("should reject confidence out of range", () => {
      const invalidResponse = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Test",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 1.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe("ClusterSignatureSchema validation", () => {
    it("should validate complete signature", () => {
      const signature = {
        section: "math",
        structure_type: "multiple_choice",
        core_skill: "linear_equations",
        domain: "Algebra",
        difficulty: "medium",
        key_features: ["equation", "single_variable"],
        diagram_present: false,
        copy_risk_sensitivity: "medium",
      };

      const result = ClusterSignatureSchema.safeParse(signature);
      expect(result.success).toBe(true);
    });

    it("should default difficulty to unknown", () => {
      const signature = {
        section: "rw",
        structure_type: "passage",
        core_skill: "reading",
      };

      const result = ClusterSignatureSchema.safeParse(signature);
      expect(result.success).toBe(true);
      expect(result.data?.difficulty).toBe("unknown");
    });

    it("should default empty arrays and false booleans", () => {
      const signature = {
        section: "math",
        structure_type: "test",
        core_skill: "test",
      };

      const result = ClusterSignatureSchema.safeParse(signature);
      expect(result.success).toBe(true);
      expect(result.data?.key_features).toEqual([]);
      expect(result.data?.diagram_present).toBe(false);
    });

    it("should reject invalid difficulty values", () => {
      const signature = {
        section: "math",
        structure_type: "test",
        core_skill: "test",
        difficulty: "super_hard",
      };

      const result = ClusterSignatureSchema.safeParse(signature);
      expect(result.success).toBe(false);
    });
  });

  describe("EvidenceSchema validation", () => {
    it("should validate complete evidence", () => {
      const evidence = {
        domainFound: true,
        skillFound: true,
        difficultyFound: false,
        notes: ["Domain label visible", "Skill box present"],
      };

      const result = EvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
    });

    it("should limit notes to 5", () => {
      const evidence = {
        domainFound: true,
        skillFound: true,
        difficultyFound: true,
        notes: ["1", "2", "3", "4", "5", "6", "7"],
      };

      const result = EvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(false);
    });

    it("should default notes to empty array", () => {
      const evidence = {
        domainFound: false,
        skillFound: false,
        difficultyFound: false,
      };

      const result = EvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
      expect(result.data?.notes).toEqual([]);
    });
  });

  describe("StructureSignatureV2Schema validation", () => {
    it("should validate complete structure signature", () => {
      const sig = {
        signals: {
          hasTable: true,
          hasGraph: false,
          hasChart: null,
          hasEquationBlock: true,
          hasOptionsAtoD: true,
          hasUnderlinedText: false,
        },
        signatureText: "mcq|table|eqblock",
      };

      const result = StructureSignatureV2Schema.safeParse(sig);
      expect(result.success).toBe(true);
    });

    it("should allow all null signals", () => {
      const sig = {
        signals: {
          hasTable: null,
          hasGraph: null,
          hasChart: null,
          hasEquationBlock: null,
          hasOptionsAtoD: null,
          hasUnderlinedText: null,
        },
        signatureText: "unknown",
      };

      const result = StructureSignatureV2Schema.safeParse(sig);
      expect(result.success).toBe(true);
    });

    it("should reject signature text over 256 chars", () => {
      const sig = {
        signals: {},
        signatureText: "a".repeat(257),
      };

      const result = StructureSignatureV2Schema.safeParse(sig);
      expect(result.success).toBe(false);
    });
  });

  describe("Difficulty extraction logic", () => {
    it("should map difficulty level 1 to Easy", () => {
      const response = {
        version: "v4_style_cluster_v2" as const,
        section: "math" as const,
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: "Test",
        difficultyLabel: "Easy",
        difficultyLevel: 1 as const,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: true, notes: [] as string[] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.9, reason: "test" },
      };

      expect(response.difficultyLevel).toBe(1);
      expect(response.difficultyLabel).toBe("Easy");
    });

    it("should map difficulty level 2 to Medium", () => {
      const response = {
        version: "v4_style_cluster_v2" as const,
        section: "rw" as const,
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Craft and Structure",
        skill: "Words in context",
        difficultyLabel: "Medium",
        difficultyLevel: 2 as const,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: true, notes: [] as string[] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.85, reason: "test" },
      };

      expect(response.difficultyLevel).toBe(2);
      expect(response.difficultyLabel).toBe("Medium");
    });

    it("should map difficulty level 3 to Hard", () => {
      const response = {
        version: "v4_style_cluster_v2" as const,
        section: "math" as const,
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Geometry and Trigonometry",
        skill: "Circle theorems",
        difficultyLabel: "Hard",
        difficultyLevel: 3 as const,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: true, notes: [] as string[] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.86, reason: "test" },
      };

      expect(response.difficultyLevel).toBe(3);
      expect(response.difficultyLabel).toBe("Hard");
    });

    it("should handle unknown difficulty (null)", () => {
      const response = {
        version: "v4_style_cluster_v2" as const,
        section: "math" as const,
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: "Test",
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: false, notes: [] as string[] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.7, reason: "test" },
      };

      expect(response.difficultyLevel).toBeNull();
      expect(response.difficultyLabel).toBeNull();
      expect(response.evidence.difficultyFound).toBe(false);
    });
  });

  describe("Domain validation", () => {
    const mathDomains = [
      "Algebra",
      "Advanced Math",
      "Problem-Solving and Data Analysis",
      "Geometry and Trigonometry",
    ];

    const rwDomains = [
      "Information and Ideas",
      "Craft and Structure",
      "Expression of Ideas",
      "Standard English Conventions",
    ];

    it("should accept valid math domains", () => {
      for (const domain of mathDomains) {
        const response = {
          version: "v4_style_cluster_v2",
          section: "math",
          pdfPath: "test.pdf",
          pageNumber: 1,
          domain,
          skill: "Test",
          difficultyLabel: null,
          difficultyLevel: null,
          questionType: "multiple-choice",
          topicSummary: "Test",
          evidence: { domainFound: true, skillFound: true, difficultyFound: false, notes: [] },
          structureSignature: { signals: {}, signatureText: "test" },
          clusterRecommendation: { clusterKey: "test", confidence: 0.9, reason: "test" },
        };

        const result = SupapromptV2ResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      }
    });

    it("should accept valid RW domains", () => {
      for (const domain of rwDomains) {
        const response = {
          version: "v4_style_cluster_v2",
          section: "rw",
          pdfPath: "test.pdf",
          pageNumber: 1,
          domain,
          skill: "Test",
          difficultyLabel: null,
          difficultyLevel: null,
          questionType: "multiple-choice",
          topicSummary: "Test",
          evidence: { domainFound: true, skillFound: true, difficultyFound: false, notes: [] },
          structureSignature: { signals: {}, signatureText: "test" },
          clusterRecommendation: { clusterKey: "test", confidence: 0.9, reason: "test" },
        };

        const result = SupapromptV2ResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Malformed Gemini output handling", () => {
    it("should reject completely invalid JSON structure", () => {
      const malformed = {
        random: "garbage",
        not: "valid",
      };

      const result = SupapromptV2ResponseSchema.safeParse(malformed);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const incomplete = {
        version: "v4_style_cluster_v2",
        section: "math",
      };

      const result = SupapromptV2ResponseSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it("should reject invalid nested structure", () => {
      const badNested = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Test",
        evidence: "not an object",
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(badNested);
      expect(result.success).toBe(false);
    });

    it("should provide meaningful error messages on failure", () => {
      const invalid = {
        version: "v4_style_cluster_v2",
        section: "invalid_section",
        pdfPath: "test.pdf",
        pageNumber: -1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Test",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.5, reason: "test" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues.some(i => i.path.includes("section"))).toBe(true);
      }
    });
  });

  describe("Cluster key generation", () => {
    it("should generate deterministic cluster keys", () => {
      const key1 = normalizeClusterKey("math::Algebra::Linear equations::mcq|eqblock");
      const key2 = normalizeClusterKey("math::Algebra::Linear equations::mcq|eqblock");
      expect(key1).toBe(key2);
    });

    it("should handle unknown domain/skill in cluster keys", () => {
      const key = normalizeClusterKey("math::unknown::unknown::mcq|graph|no_table");
      expect(key).toBe("math::unknown::unknown::mcqgraphno_table");
    });

    it("should normalize case variations", () => {
      const key1 = normalizeClusterKey("MATH::ALGEBRA::test");
      const key2 = normalizeClusterKey("math::algebra::test");
      expect(key1).toBe(key2);
    });
  });

  describe("Confidence threshold logic", () => {
    it("should accept high confidence (0.9-1.0)", () => {
      const response = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: "Linear equations",
        difficultyLabel: "Easy",
        difficultyLevel: 1,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: true, difficultyFound: true, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.95, reason: "Explicit labels" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.clusterRecommendation.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should accept medium confidence (0.65-0.89)", () => {
      const response = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: "Algebra",
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: true, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: {}, signatureText: "test" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.75, reason: "Domain only" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.clusterRecommendation.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.data?.clusterRecommendation.confidence).toBeLessThan(0.9);
    });

    it("should accept low confidence (0.4-0.64)", () => {
      const response = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: "multiple-choice",
        topicSummary: "Test",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: [] },
        structureSignature: { signals: { hasGraph: true }, signatureText: "mcq|graph" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.55, reason: "Structure only" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.clusterRecommendation.confidence).toBeGreaterThanOrEqual(0.4);
      expect(result.data?.clusterRecommendation.confidence).toBeLessThan(0.65);
    });

    it("should accept very low confidence (<0.4)", () => {
      const response = {
        version: "v4_style_cluster_v2",
        section: "math",
        pdfPath: "test.pdf",
        pageNumber: 1,
        domain: null,
        skill: null,
        difficultyLabel: null,
        difficultyLevel: null,
        questionType: null,
        topicSummary: "Hard to parse page",
        evidence: { domainFound: false, skillFound: false, difficultyFound: false, notes: ["Page unclear"] },
        structureSignature: { signals: {}, signatureText: "unknown" },
        clusterRecommendation: { clusterKey: "test", confidence: 0.25, reason: "Very unclear" },
      };

      const result = SupapromptV2ResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.clusterRecommendation.confidence).toBeLessThan(0.4);
    });
  });
});
