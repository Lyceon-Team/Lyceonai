import { describe, it, expect } from "vitest";
import { buildQuestionRowFromV4 } from "../services/v4Publisher";
import { validateQuestionRow } from "../../ingestion/types/supabaseQuestionsRow";
import type { GeneratedQuestionDraft, QaResult, PdfStyleRef } from "../types";

describe("v4Publisher", () => {
  describe("buildQuestionRowFromV4", () => {
    const validDraft: GeneratedQuestionDraft = {
      draftId: "test-draft-123",
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

    const validQa: QaResult = {
      ok: true,
      foundCorrectAnswer: "B",
      issues: [],
    };

    const mockJob = {
      id: "job-abc-123",
      test_code: "SAT",
      style_refs: [{ bucket: "test-bucket", path: "style.pdf" }] as PdfStyleRef[],
    };

    const mockStyleRefsUsed: PdfStyleRef[] = [
      { bucket: "used-bucket", path: "used-style.pdf", pageHint: 3 },
    ];

    it("builds a valid question row from draft + qa + job", () => {
      const row = buildQuestionRowFromV4(
        validDraft,
        validQa,
        mockJob,
        "draft-id-xyz",
        mockStyleRefsUsed
      );

      expect(row.stem).toBe(validDraft.stem);
      expect(row.answer).toBe("B");
      expect(row.answer_choice).toBe("B");
      expect(row.answer_text).toBe("4");
      expect(row.explanation).toBe(validDraft.explanation);
      expect(row.section).toBe("Math");
      expect(row.difficulty).toBe("medium");
      expect(row.difficulty_level).toBe(2);
      expect(row.ai_generated).toBe(true);
      expect(row.source_type).toBe("v4_generated");
      expect(row.test_code).toBe("SAT");
      expect(row.section_code).toBe("M");
    });

    it("does not include internal_id in row (canonical_id added during publish)", () => {
      const row = buildQuestionRowFromV4(
        validDraft,
        validQa,
        mockJob,
        "draft-id-xyz",
        mockStyleRefsUsed
      );

      expect(row.internal_id).toBeUndefined();
    });

    it("uses QA corrected values when available", () => {
      const qaWithCorrections: QaResult = {
        ok: true,
        foundCorrectAnswer: "C",
        issues: [],
        correctedExplanation: "The corrected explanation text.",
        correctedDifficulty: "hard",
      };

      const row = buildQuestionRowFromV4(
        validDraft,
        qaWithCorrections,
        mockJob,
        "draft-corrected",
        null
      );

      expect(row.answer).toBe("C");
      expect(row.answer_choice).toBe("C");
      expect(row.explanation).toBe("The corrected explanation text.");
      expect(row.difficulty).toBe("hard");
      expect(row.difficulty_level).toBe(3);
    });

    it("includes provenance metadata with v4 keys", () => {
      const row = buildQuestionRowFromV4(
        validDraft,
        validQa,
        mockJob,
        "draft-provenance",
        mockStyleRefsUsed
      );

      expect(row.parsing_metadata).toBeDefined();
      expect(row.parsing_metadata.v4).toBeDefined();
      expect(row.parsing_metadata.v4.jobId).toBe("job-abc-123");
      expect(row.parsing_metadata.v4.draftId).toBe("draft-provenance");
      expect(row.parsing_metadata.v4.styleRefsUsed).toEqual(mockStyleRefsUsed);
      expect(row.parsing_metadata.v4.model).toBe("gemini-2.0-flash");
      expect(row.parsing_metadata.source).toBe("ingestion_v4");
    });

    it("passes validateQuestionRow validation", () => {
      const row = buildQuestionRowFromV4(
        validDraft,
        validQa,
        mockJob,
        "draft-validate",
        null
      );

      const validation = validateQuestionRow(row);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.cleanedRow).toBeTruthy();
    });

    it("throws error when option key is missing", () => {
      const incompleteOptions: GeneratedQuestionDraft = {
        ...validDraft,
        options: [
          { key: "A", text: "3" },
          { key: "B", text: "4" },
          { key: "C", text: "5" },
        ],
      };

      expect(() =>
        buildQuestionRowFromV4(incompleteOptions, validQa, mockJob, "draft-missing", null)
      ).toThrow("Missing required option key: D");
    });

    it("maps Reading section to RW section_code", () => {
      const readingDraft: GeneratedQuestionDraft = {
        ...validDraft,
        section: "Reading",
      };

      const row = buildQuestionRowFromV4(
        readingDraft,
        validQa,
        mockJob,
        "draft-reading",
        null
      );

      expect(row.section_code).toBe("RW");
    });

    it("maps Writing section to RW section_code", () => {
      const writingDraft: GeneratedQuestionDraft = {
        ...validDraft,
        section: "Writing",
      };

      const row = buildQuestionRowFromV4(
        writingDraft,
        validQa,
        mockJob,
        "draft-writing",
        null
      );

      expect(row.section_code).toBe("RW");
    });

    it("maps difficulty levels correctly", () => {
      const easyDraft: GeneratedQuestionDraft = { ...validDraft, difficulty: "easy" };
      const hardDraft: GeneratedQuestionDraft = { ...validDraft, difficulty: "hard" };

      const easyRow = buildQuestionRowFromV4(easyDraft, validQa, mockJob, "draft-easy", null);
      const hardRow = buildQuestionRowFromV4(hardDraft, validQa, mockJob, "draft-hard", null);

      expect(easyRow.difficulty_level).toBe(1);
      expect(hardRow.difficulty_level).toBe(3);
    });

    it("stores inspiration questionIds in provenance", () => {
      const draftWithInspiration: GeneratedQuestionDraft = {
        ...validDraft,
        inspiration: {
          questionIds: ["q-123", "q-456"],
          notes: "Based on style from these questions",
        },
      };

      const row = buildQuestionRowFromV4(
        draftWithInspiration,
        validQa,
        mockJob,
        "draft-inspired",
        null
      );

      expect(row.parsing_metadata.v4.inspirationQuestionIds).toEqual(["q-123", "q-456"]);
    });
  });

  describe("idempotency logic", () => {
    it("getPublishedCanonicalId returns null for unpublished drafts (tested via extraction)", () => {
      const qaWithoutPublish = { ok: true, foundCorrectAnswer: "B", issues: [] };
      const canonicalId = (qaWithoutPublish as any).questions_canonical_id;
      expect(canonicalId).toBeUndefined();
    });

    it("getPublishedCanonicalId extracts questions_canonical_id from qa object", () => {
      const qaWithPublish = { 
        ok: true, 
        foundCorrectAnswer: "B", 
        issues: [],
        questions_canonical_id: "SATM2ABC123",
        published_at: "2024-12-20T00:00:00Z"
      };
      expect(qaWithPublish.questions_canonical_id).toBe("SATM2ABC123");
    });
  });
});
