import { describe, it, expect } from "vitest";

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



























// Removed: v4 ingestion tests (sprint-0 cleanup)
