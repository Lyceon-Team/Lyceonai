import { describe, it, expect } from "vitest";
import { 
  GeneratedQuestionDraftSchema, 
  QaResultSchema,
  CreateJobRequestSchema,
  CreateStyleLibraryEntrySchema,
  BatchRunRequestSchema,
  QueueBatchRequestSchema,
  QueueRenderPagesRequestSchema,
  QueueItemPayloadSchema,
  MathDomainSchema,
  DifficultyLevelSchema,
  CopyRiskSchema,
  StyleMatchSchema,
  DifficultyMatchSchema,
  StylePageSchema,
  StylePackProvenanceSchema
} from "../types/schemas";

describe("ingestion_v4 schemas", () => {
  describe("GeneratedQuestionDraftSchema", () => {
    it("accepts a valid draft", () => {
      const draft = {
        draftId: "draft-1",
        section: "Math",
        skill: "Linear equations",
        difficulty: "medium",
        stem: "If 3x + 2 = 14, what is the value of x?",
        options: [
          { key: "A", text: "3" },
          { key: "B", text: "4" },
          { key: "C", text: "5" },
          { key: "D", text: "6" },
        ],
        correctAnswer: "B",
        explanation: "Subtract 2 from both sides to get 3x = 12, then divide by 3 to get x = 4.",
        inspiration: null,
        assets: [],
      };
      expect(GeneratedQuestionDraftSchema.parse(draft)).toBeTruthy();
    });

    it("rejects draft with duplicate option keys", () => {
      const invalidDraft = {
        draftId: "draft-2",
        section: "Math",
        skill: "Algebra",
        difficulty: "easy",
        stem: "What is 2 + 2?",
        options: [
          { key: "A", text: "3" },
          { key: "A", text: "4" },
          { key: "B", text: "5" },
          { key: "C", text: "6" },
        ],
        correctAnswer: "A",
        explanation: "The answer is 4 because 2 + 2 = 4.",
        inspiration: null,
        assets: [],
      };
      expect(() => GeneratedQuestionDraftSchema.parse(invalidDraft)).toThrow();
    });
  });

  describe("QaResultSchema", () => {
    it("accepts a valid QA result with defaults", () => {
      const qa = { ok: true, foundCorrectAnswer: "B", issues: [] };
      const parsed = QaResultSchema.parse(qa);
      expect(parsed).toBeTruthy();
      expect(parsed.copyRisk).toBe("low");
      expect(parsed.styleMatch).toBe("good");
      expect(parsed.difficultyMatch).toBe("unknown");
    });

    it("accepts QA result with explicit policy fields", () => {
      const qa = { 
        ok: false, 
        foundCorrectAnswer: "C", 
        issues: ["Answer mismatch"],
        copyRisk: "high",
        styleMatch: "poor",
        difficultyMatch: "mismatch"
      };
      const parsed = QaResultSchema.parse(qa);
      expect(parsed.copyRisk).toBe("high");
      expect(parsed.styleMatch).toBe("poor");
      expect(parsed.difficultyMatch).toBe("mismatch");
    });

    it("rejects invalid copyRisk value", () => {
      const qa = { ok: true, foundCorrectAnswer: "B", issues: [], copyRisk: "very-high" };
      expect(() => QaResultSchema.parse(qa)).toThrow();
    });
  });

  describe("MathDomainSchema", () => {
    it("accepts valid math domains", () => {
      expect(MathDomainSchema.parse("Algebra")).toBe("Algebra");
      expect(MathDomainSchema.parse("Advanced Math")).toBe("Advanced Math");
      expect(MathDomainSchema.parse("Problem Solving & Data Analysis")).toBe("Problem Solving & Data Analysis");
      expect(MathDomainSchema.parse("Geometry & Trigonometry")).toBe("Geometry & Trigonometry");
    });

    it("rejects invalid domain", () => {
      expect(() => MathDomainSchema.parse("Calculus")).toThrow();
    });
  });

  describe("DifficultyLevelSchema", () => {
    it("accepts valid difficulty levels", () => {
      expect(DifficultyLevelSchema.parse("easy")).toBe("easy");
      expect(DifficultyLevelSchema.parse("medium")).toBe("medium");
      expect(DifficultyLevelSchema.parse("hard")).toBe("hard");
      expect(DifficultyLevelSchema.parse("unknown")).toBe("unknown");
    });

    it("rejects invalid difficulty", () => {
      expect(() => DifficultyLevelSchema.parse("extreme")).toThrow();
    });
  });

  describe("CopyRiskSchema", () => {
    it("accepts valid copy risk levels", () => {
      expect(CopyRiskSchema.parse("low")).toBe("low");
      expect(CopyRiskSchema.parse("medium")).toBe("medium");
      expect(CopyRiskSchema.parse("high")).toBe("high");
    });
  });

  describe("StylePackProvenanceSchema", () => {
    it("accepts valid provenance object", () => {
      const provenance = {
        style_page_ids: ["550e8400-e29b-41d4-a716-446655440000"],
        style_domain_mix_score: 0,
        style_tag_confidence_avg: 0.85
      };
      expect(StylePackProvenanceSchema.parse(provenance)).toBeTruthy();
    });

    it("accepts null confidence avg", () => {
      const provenance = {
        style_page_ids: [],
        style_domain_mix_score: 0,
        style_tag_confidence_avg: null
      };
      expect(StylePackProvenanceSchema.parse(provenance)).toBeTruthy();
    });
  });

  describe("CreateJobRequestSchema", () => {
    it("accepts a valid job request", () => {
      const request = {
        testCode: "SAT",
        targetCount: 100,
        styleRefs: [
          { bucket: "MVP Bucket1", path: "v4-style-library/example.pdf", pageHint: 3 }
        ]
      };
      expect(CreateJobRequestSchema.parse(request)).toBeTruthy();
    });

    it("accepts job request without testCode (uses default)", () => {
      const request = {
        targetCount: 50,
        styleRefs: [
          { bucket: "bucket", path: "path.pdf" }
        ]
      };
      const parsed = CreateJobRequestSchema.parse(request);
      expect(parsed.testCode).toBe("SAT");
    });

    it("rejects job request with targetCount=0", () => {
      const request = {
        testCode: "SAT",
        targetCount: 0,
        styleRefs: [
          { bucket: "bucket", path: "path.pdf" }
        ]
      };
      expect(() => CreateJobRequestSchema.parse(request)).toThrow();
    });

    it("rejects job request with targetCount > 5000", () => {
      const request = {
        testCode: "SAT",
        targetCount: 5001,
        styleRefs: [
          { bucket: "bucket", path: "path.pdf" }
        ]
      };
      expect(() => CreateJobRequestSchema.parse(request)).toThrow();
    });

    it("rejects job request with empty styleRefs", () => {
      const request = {
        testCode: "SAT",
        targetCount: 100,
        styleRefs: []
      };
      expect(() => CreateJobRequestSchema.parse(request)).toThrow();
    });
  });

  describe("CreateStyleLibraryEntrySchema", () => {
    it("accepts a valid style library entry", () => {
      const entry = {
        label: "Bluebook SAT Form A",
        bucket: "MVP Bucket1",
        path: "v4-style-library/form-a.pdf",
        pageHint: 1,
        notes: "Primary style anchor"
      };
      expect(CreateStyleLibraryEntrySchema.parse(entry)).toBeTruthy();
    });

    it("accepts style library entry without optional fields", () => {
      const entry = {
        label: "Test Form",
        bucket: "bucket",
        path: "test.pdf"
      };
      const parsed = CreateStyleLibraryEntrySchema.parse(entry);
      expect(parsed.pageHint).toBeUndefined();
      expect(parsed.notes).toBeUndefined();
    });

    it("rejects style library entry with empty label", () => {
      const entry = {
        label: "",
        bucket: "bucket",
        path: "test.pdf"
      };
      expect(() => CreateStyleLibraryEntrySchema.parse(entry)).toThrow();
    });
  });

  describe("BatchRunRequestSchema", () => {
    it("accepts a valid batch request", () => {
      const request = {
        count: 10,
        sleepMs: 2000,
        stopOnQaFail: true,
        maxQaFails: 5
      };
      const parsed = BatchRunRequestSchema.parse(request);
      expect(parsed.count).toBe(10);
      expect(parsed.sleepMs).toBe(2000);
      expect(parsed.stopOnQaFail).toBe(true);
      expect(parsed.maxQaFails).toBe(5);
    });

    it("applies default values when fields are missing", () => {
      const request = {};
      const parsed = BatchRunRequestSchema.parse(request);
      expect(parsed.count).toBe(1);
      expect(parsed.sleepMs).toBeGreaterThanOrEqual(0);
      expect(parsed.stopOnQaFail).toBe(false);
      expect(parsed.maxQaFails).toBeGreaterThanOrEqual(1);
    });

    it("rejects count=0", () => {
      const request = { count: 0 };
      expect(() => BatchRunRequestSchema.parse(request)).toThrow();
    });

    it("rejects count > 25 (default max)", () => {
      const request = { count: 26 };
      expect(() => BatchRunRequestSchema.parse(request)).toThrow();
    });

    it("rejects sleepMs > 10000", () => {
      const request = { sleepMs: 10001 };
      expect(() => BatchRunRequestSchema.parse(request)).toThrow();
    });

    it("rejects maxQaFails > 10", () => {
      const request = { maxQaFails: 11 };
      expect(() => BatchRunRequestSchema.parse(request)).toThrow();
    });

    it("rejects negative sleepMs", () => {
      const request = { sleepMs: -1 };
      expect(() => BatchRunRequestSchema.parse(request)).toThrow();
    });
  });

  describe("QueueBatchRequestSchema", () => {
    it("accepts a valid queue batch request", () => {
      const request = {
        count: 10,
        sleepMs: 2000,
        stopOnQaFail: true,
        maxQaFails: 5,
        enqueueIfLocked: true,
        deferSecondsOnLock: 60
      };
      const parsed = QueueBatchRequestSchema.parse(request);
      expect(parsed.count).toBe(10);
      expect(parsed.enqueueIfLocked).toBe(true);
      expect(parsed.deferSecondsOnLock).toBe(60);
    });

    it("applies default values for queue fields", () => {
      const request = {};
      const parsed = QueueBatchRequestSchema.parse(request);
      expect(parsed.enqueueIfLocked).toBe(true);
      expect(parsed.deferSecondsOnLock).toBe(30);
    });

    it("rejects deferSecondsOnLock < 5", () => {
      const request = { deferSecondsOnLock: 4 };
      expect(() => QueueBatchRequestSchema.parse(request)).toThrow();
    });

    it("rejects deferSecondsOnLock > 600", () => {
      const request = { deferSecondsOnLock: 601 };
      expect(() => QueueBatchRequestSchema.parse(request)).toThrow();
    });

    it("accepts deferSecondsOnLock at boundaries", () => {
      const request1 = { deferSecondsOnLock: 5 };
      const parsed1 = QueueBatchRequestSchema.parse(request1);
      expect(parsed1.deferSecondsOnLock).toBe(5);

      const request2 = { deferSecondsOnLock: 600 };
      const parsed2 = QueueBatchRequestSchema.parse(request2);
      expect(parsed2.deferSecondsOnLock).toBe(600);
    });

    it("allows enqueueIfLocked=false", () => {
      const request = { enqueueIfLocked: false };
      const parsed = QueueBatchRequestSchema.parse(request);
      expect(parsed.enqueueIfLocked).toBe(false);
    });
  });

  describe("QueueRenderPagesRequestSchema", () => {
    it("accepts a valid render pages request", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "sat/math/pdf/test.pdf",
        section: "math",
        dpi: 150,
        maxPages: 60,
        overwrite: false
      };
      const parsed = QueueRenderPagesRequestSchema.parse(request);
      expect(parsed.type).toBe("render_pages");
      expect(parsed.bucket).toBe("lyceon-style-bank");
      expect(parsed.section).toBe("math");
    });

    it("applies default values", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "sat/rw/pdf/test.pdf",
        section: "rw"
      };
      const parsed = QueueRenderPagesRequestSchema.parse(request);
      expect(parsed.dpi).toBe(150);
      expect(parsed.maxPages).toBe(60);
      expect(parsed.overwrite).toBe(false);
      expect(parsed.exam).toBe("sat");
    });

    it("rejects dpi below 72", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "math",
        dpi: 50
      };
      expect(() => QueueRenderPagesRequestSchema.parse(request)).toThrow();
    });

    it("rejects dpi above 300", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "math",
        dpi: 400
      };
      expect(() => QueueRenderPagesRequestSchema.parse(request)).toThrow();
    });

    it("rejects maxPages above 200", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "rw",
        maxPages: 250
      };
      expect(() => QueueRenderPagesRequestSchema.parse(request)).toThrow();
    });

    it("accepts boundary values for dpi", () => {
      const request72 = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "math",
        dpi: 72
      };
      expect(QueueRenderPagesRequestSchema.parse(request72).dpi).toBe(72);

      const request300 = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "math",
        dpi: 300
      };
      expect(QueueRenderPagesRequestSchema.parse(request300).dpi).toBe(300);
    });

    it("rejects invalid section", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "test.pdf",
        section: "reading"
      };
      expect(() => QueueRenderPagesRequestSchema.parse(request)).toThrow();
    });
  });

  describe("QueueItemPayloadSchema", () => {
    it("discriminates render_pages type", () => {
      const request = {
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath: "sat/math/pdf/test.pdf",
        section: "math"
      };
      const parsed = QueueItemPayloadSchema.parse(request);
      expect(parsed.type).toBe("render_pages");
    });

    it("discriminates batch_generate type", () => {
      const request = {
        type: "batch_generate",
        count: 5
      };
      const parsed = QueueItemPayloadSchema.parse(request);
      expect(parsed.type).toBe("batch_generate");
    });
  });
});
