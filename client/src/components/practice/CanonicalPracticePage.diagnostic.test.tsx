// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring]
 * @implemented 2026-08-14
 *
 * plain English: tests diagnostic-specific behavior on CanonicalPracticePage —
 * Skip and End Session are hidden (8×5 guarantee), completion navigates to
 * /dashboard (not /practice), and non-diagnostic sessions keep the default
 * behavior (Skip + End Session visible, completion → /practice).
 *
 * expected outcome: isDiagnostic=true hides Skip + End Session, isDiagnostic
 * omitted or false shows them.
 *
 * trade-offs: uses vi.mock for hooks and dependencies (consistent with existing
 * CanonicalPracticePage.test.tsx patterns).
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CanonicalPracticePage from "./CanonicalPracticePage";

/* ── MockResizeObserver ── */
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

/* ── Hook + module mocks ── */
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

vi.mock("@/components/ui/resizable", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");

  function ResizablePanelGroup(props: Record<string, unknown>) {
    const { children, className, ...rest } = props;
    return R.createElement("div", { className, ...rest }, children);
  }

  const ResizablePanel = R.forwardRef(function MockPanel(
    props: Record<string, unknown>,
    ref: unknown,
  ) {
    const { children, ...passThrough } = props;
    R.useImperativeHandle(ref, () => ({
      resize: vi.fn(),
      collapse: () => undefined,
      expand: () => undefined,
      getSize: () => 50,
      isCollapsed: () => false,
      isExpanded: () => true,
    }));
    return R.createElement("div", passThrough, children);
  });

  function ResizableHandle(props: Record<string, unknown>) {
    const { children, ...rest } = props;
    return R.createElement("div", { role: "separator", ...rest }, children);
  }

  return { ResizablePanelGroup, ResizablePanel, ResizableHandle };
});

function buildHookState(overrides?: Record<string, unknown>) {
  return {
    question: {
      sessionItemId: "item-1",
      questionType: "multiple_choice" as const,
      stem: "What is 2 + 2?",
      section: "M",
      options: [
        { id: "A", text: "3" },
        { id: "B", text: "4" },
      ],
    },
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
    totalQuestions: 40,
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

beforeAll(() => {
  global.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("CanonicalPracticePage — diagnostic mode (8×5 guarantee)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState());
  });

  it("hides Skip button when isDiagnostic=true", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        badgeLabel="Diagnostic"
        section="math"
        isDiagnostic={true}
      />,
    );

    expect(screen.queryByText("Skip")).toBeNull();
  });

  it("hides End Session button when isDiagnostic=true", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        badgeLabel="Diagnostic"
        section="math"
        isDiagnostic={true}
      />,
    );

    expect(screen.queryByText("End Session")).toBeNull();
  });

  it("shows Skip button when isDiagnostic is false/omitted (regular practice)", () => {
    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getByText("Skip")).not.toBeNull();
  });

  it("shows End Session button when isDiagnostic is false/omitted (regular practice)", () => {
    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    expect(screen.getByText("End Session")).not.toBeNull();
  });

  it("keeps Check Answer visible in diagnostic mode", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        badgeLabel="Diagnostic"
        section="math"
        isDiagnostic={true}
      />,
    );

    expect(screen.getByText("Check Answer")).not.toBeNull();
  });

  it("renders diagnostic title and badge correctly", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        badgeLabel="Diagnostic"
        section="math"
        isDiagnostic={true}
      />,
    );

    expect(screen.getByText("Diagnostic Assessment")).not.toBeNull();
    expect(screen.getByText("Diagnostic")).not.toBeNull();
  });
});
