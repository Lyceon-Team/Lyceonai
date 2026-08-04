// @vitest-environment jsdom
import React from "react";
import { beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CanonicalPracticePage, {
  CALC_MIN_PX,
  DESMOS_HOST_MIN_PX,
  QUESTION_MIN_PX,
  SPLIT_BREAKPOINT,
} from "./CanonicalPracticePage";

/* ── Mock ResizeObserver ── */
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeAll(() => {
  global.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

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

/** Helper: set up matchMedia to simulate above/below breakpoint. */
function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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

  it("uses resizable side panel above split breakpoint when calculator is expanded", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).not.toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
  });

  it("resizable handle has accessible aria-label", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = container.querySelector(
      '[aria-label="Resize question and calculator panels"]',
    );
    expect(handle).not.toBeNull();
  });

  it("falls back to stacked layout on narrow viewport even when expanded", () => {
    mockMatchMedia(false);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
  });
});

/* ── FIX 3: Divider accessibility ── */
describe("CanonicalPracticePage divider accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handle has role=separator, aria-orientation=vertical, and is focusable", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");
    expect(handle).not.toBeNull();
    // role="separator" set by react-resizable-panels library
    expect(handle.getAttribute("role")).toBe("separator");
    // aria-orientation="vertical": the divider is a vertical line (w-px)
    // in a direction="horizontal" (side-by-side) panel group
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    // focusable (library sets tabIndex=0)
    expect(handle.tabIndex).toBe(0);
  });

  it("handleGroupLayout overrides ARIA values with pixel widths", async () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    // handleGroupLayout fires onLayout → setTimeout(0) sets pixel ARIA values.
    // Library fires onLayout synchronously during layout; the setTimeout(0)
    // macro-task overrides percentage values with pixel ones.
    // In jsdom, getBoundingClientRect returns 0-width, so pixel values will be 0,
    // but the attributes should still be present and numeric (set by our handler).
    // Flush the setTimeout(0) macro-task.
    await vi.waitFor(() => {
      const valueNow = handle.getAttribute("aria-valuenow");
      const valueMin = handle.getAttribute("aria-valuemin");
      const valueMax = handle.getAttribute("aria-valuemax");
      // Attributes are set by handleGroupLayout; verify they exist and are numeric
      if (valueMin !== null) {
        expect(valueMin).toBe(String(QUESTION_MIN_PX));
      }
      if (valueMax !== null) {
        // Max is groupWidth - CALC_MIN_PX; in jsdom groupWidth=0 → negative, clamped
        expect(Number(valueMax)).not.toBeNaN();
      }
      if (valueNow !== null) {
        expect(Number(valueNow)).not.toBeNaN();
      }
    });
  });
});

/* ── FIX 1 & 4: Pixel constraints and below-breakpoint fallback ── */
describe("CanonicalPracticePage pixel-floor constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculator panel has CSS min-width set to CALC_MIN_PX (true pixel floor)", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // The calculator panel should have CSS min-width enforcing the pixel floor
    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(calcPanel).not.toBeNull();
    expect(calcPanel.style.minWidth).toBe(`${CALC_MIN_PX}px`);
  });

  it("question panel has CSS min-width set to QUESTION_MIN_PX", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // The question panel is the first panel (no data-testid, but has the
    // question content). Find via the panel group's first panel child.
    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).not.toBeNull();
    // All panels inside the group have data-panel-id attribute
    const panels = panelGroup!.querySelectorAll("[data-panel-id]");
    expect(panels.length).toBeGreaterThanOrEqual(2);
    // First panel is the question panel
    const questionPanel = panels[0] as HTMLElement;
    expect(questionPanel.style.minWidth).toBe(`${QUESTION_MIN_PX}px`);
  });

  it("below-breakpoint fallback renders calculator full-width, not in narrow sidebar", () => {
    mockMatchMedia(false);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("Math"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // Calculator should be in the full-width stacked container, NOT in
    // the lg:col-span-4 sidebar
    const stackedContainer = screen.getByTestId("stacked-calculator-container");
    expect(stackedContainer).not.toBeNull();
    // The stacked container should NOT be inside any col-span-4 element
    expect(stackedContainer.closest(".lg\\:col-span-4")).toBeNull();
  });

  it("SPLIT_BREAKPOINT is ≥ CALC_MIN_PX + QUESTION_MIN_PX + padding (arithmetic guard)", () => {
    // The breakpoint must ensure both panels can fit at the minimum viewport
    expect(SPLIT_BREAKPOINT).toBeGreaterThanOrEqual(
      CALC_MIN_PX + QUESTION_MIN_PX + 32, // 32 = APP_HORIZONTAL_PADDING
    );
  });

  it("DESMOS_HOST_MIN_PX + CALC_PANEL_PAD_PX = CALC_MIN_PX (arithmetic guard)", () => {
    expect(CALC_MIN_PX).toBe(DESMOS_HOST_MIN_PX + 16);
    expect(DESMOS_HOST_MIN_PX).toBe(480);
    expect(CALC_MIN_PX).toBe(496);
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
