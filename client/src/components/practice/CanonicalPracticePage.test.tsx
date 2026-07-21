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

function buildHookState(
  section: string | null,
  overrides?: Record<string, unknown>,
) {
  return {
    question: section
      ? {
          sessionItemId: "item-1",
          questionType: "multiple_choice" as const,
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
    correctAnswer: null,
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
    submitBlocked: null,
    ...overrides,
  };
}

function buildGridInHookState() {
  return buildHookState("M", {
    question: {
      sessionItemId: "item-gi-1",
      questionType: "grid_in" as const,
      itemType: "grid_in" as const,
      inputMode: "numeric_entry" as const,
      stem: "What is the value of x?",
      section: "M",
      options: [],
    },
  });
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
      />,
    );

    expect(screen.getByTestId("practice-calculator-toggle")).not.toBeNull();
    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain(
      "collapsed",
    );

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
      />,
    );

    expect(screen.queryByTestId("practice-calculator-toggle")).toBeNull();
  });
});

describe("CanonicalPracticePage grid-in rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders numeric entry input for a grid_in question", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildGridInHookState());

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getByText("What is the value of x?")).not.toBeNull();
    expect(screen.getByLabelText("Enter your answer")).not.toBeNull();
  });

  it("MCQ round-trip: select option, submit, correct option gets emerald highlight (non-regression)", () => {
    const setSelectedAnswer = vi.fn();
    const submitAnswer = vi.fn();
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("Math", {
        canSubmit: true,
        selectedAnswer: null,
        setSelectedAnswer,
        submitAnswer,
      }),
    );

    const { unmount } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
    expect(screen.getByText("3")).not.toBeNull();
    expect(screen.queryByLabelText("Enter your answer")).toBeNull();

    fireEvent.click(screen.getByText("2"));
    expect(setSelectedAnswer).toHaveBeenCalledWith("A");

    fireEvent.click(screen.getByText("Check Answer"));
    expect(submitAnswer).toHaveBeenCalledWith({ skipped: false });

    unmount();

    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("Math", {
        selectedAnswer: "A",
        showResult: true,
        isCorrect: true,
        correctOptionId: "A",
        explanation: "1 + 1 = 2.",
      }),
    );

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getAllByText("Correct").length).toBeGreaterThan(0);
    expect(screen.getByText("1 + 1 = 2.")).not.toBeNull();

    const correctBtn = screen
      .getAllByText("2")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-emerald-500");
    expect(correctBtn!.className).toContain("bg-emerald-50");

    const wrongBtn = screen
      .getAllByText("3")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(wrongBtn).not.toBeNull();
    expect(wrongBtn!.className).not.toContain("border-emerald-500");
    expect(wrongBtn!.className).not.toContain("border-rose-500");
  });

  it("MCQ incorrect: wrong selected option gets rose highlight, correct gets emerald (non-regression)", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("Math", {
        selectedAnswer: "B",
        showResult: true,
        isCorrect: false,
        correctOptionId: "A",
        explanation: "1 + 1 = 2.",
      }),
    );

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    const correctBtn = screen
      .getAllByText("2")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-emerald-500");

    const wrongBtn = screen
      .getAllByText("3")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(wrongBtn).not.toBeNull();
    expect(wrongBtn!.className).toContain("border-rose-500");
    expect(wrongBtn!.className).toContain("bg-rose-50");
  });

  it("does not auto-skip grid_in questions", () => {
    const state = buildGridInHookState();
    hookMock.useCanonicalPractice.mockReturnValue(state);

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(state.handleMissingMcChoices).not.toHaveBeenCalled();
  });

  it("shows post-submit feedback for grid_in with correct answer", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        question: {
          sessionItemId: "item-gi-2",
          questionType: "grid_in" as const,
          itemType: "grid_in" as const,
          inputMode: "numeric_entry" as const,
          stem: "Solve for x.",
          section: "M",
          options: [],
        },
        freeResponseAnswer: "0.3",
        showResult: true,
        isCorrect: false,
        correctAnswer: "0.2",
        explanation: "Divide 1 by 5.",
      }),
    );

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getByText("Incorrect")).not.toBeNull();
    expect(screen.getByText("Correct answer:")).not.toBeNull();
    expect(screen.getByText("Divide 1 by 5.")).not.toBeNull();
  });

  it("disables Check Answer for malformed grid-in input (format gate)", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildGridInHookState());

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    const checkBtn = screen.getByText("Check Answer");
    expect((checkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Check Answer when canSubmit is false for malformed values like 1/2/3", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        question: {
          sessionItemId: "item-gi-3",
          questionType: "grid_in" as const,
          itemType: "grid_in" as const,
          inputMode: "numeric_entry" as const,
          stem: "Find y.",
          section: "M",
          options: [],
        },
        freeResponseAnswer: "1/2/3",
        canSubmit: false,
      }),
    );

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    const checkBtn = screen.getByText("Check Answer");
    expect((checkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Check Answer when canSubmit is true for valid grid-in value", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        question: {
          sessionItemId: "item-gi-4",
          questionType: "grid_in" as const,
          itemType: "grid_in" as const,
          inputMode: "numeric_entry" as const,
          stem: "Find z.",
          section: "M",
          options: [],
        },
        freeResponseAnswer: "0.2",
        canSubmit: true,
      }),
    );

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    const checkBtn = screen.getByText("Check Answer");
    expect((checkBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
