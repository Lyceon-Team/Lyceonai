// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CanonicalPracticePage from "./CanonicalPracticePage";

const hookMock = vi.hoisted(() => ({
  useCanonicalPractice: vi.fn(),
}));

vi.mock("@/hooks/useCanonicalPractice", () => ({
  useCanonicalPractice: hookMock.useCanonicalPractice,
}));

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: ({ expanded }: { expanded: boolean }) => (
    <div data-testid="desmos-mock">{expanded ? "expanded" : "collapsed"}</div>
  ),
}));

function buildHookState(section: string | null) {
  return {
    question: section
      ? {
          sessionItemId: "item-1",
          questionType: "multiple_choice",
          stem: "What is 1 + 1?",
          section,
          options: [
            { id: "A", text: "2" },
            { id: "B", text: "3" },
          ],
        }
      : null,
    isLoading: false,
    error: null,
    selectedAnswer: null,
    setSelectedAnswer: vi.fn(),
    freeResponseAnswer: "",
    setFreeResponseAnswer: vi.fn(),
    isSubmitting: false,
    showResult: false,
    isCorrect: null,
    correctOptionId: null,
    explanation: null,
    score: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
    currentIndex: 0,
    totalQuestions: 5,
    canSubmit: false,
    fetchNextQuestion: vi.fn(),
    submitAnswer: vi.fn(),
    nextQuestion: vi.fn(),
    handleMissingMcChoices: vi.fn(),
    terminateSession: vi.fn(),
    calculatorState: null,
    persistCalculatorState: vi.fn(),
  };
}

describe("CanonicalPracticePage calculator UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows calculator toggle on math practice question and keeps question UI usable when toggled", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />
    );

    expect(screen.getByTestId("practice-calculator-toggle")).not.toBeNull();
    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("collapsed");

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
  });

  it("hides calculator toggle on non-math practice question", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("RW"));

    render(
      <CanonicalPracticePage
        title="RW Practice"
        badgeLabel="RW"
        section="reading_writing"
      />
    );

    expect(screen.queryByTestId("practice-calculator-toggle")).toBeNull();
  });
});
