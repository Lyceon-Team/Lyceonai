// @vitest-environment jsdom
/**
 * @spec [Doc-05C §7.4, Doc-01_V8 §20–24 diagnostic client wiring]
 * @implemented 2026-08-14
 *
 * plain English: tests diagnostic-specific behavior on CanonicalPracticePage —
 * Skip is hidden (8×5 guarantee), and when the server closes the session the runner goes to
 * /dashboard (diagnostic) or /practice (regular practice).
 *
 * UI-53 (2026-10-03): "End Session" is gone from the runner (DESIGN.md §4 footer: Skip and
 * Submit, then Next question), and so is the client's terminate call: "Done" asks `/next`
 * once more, the server completes the session (409 session_closed), and the hook reports
 * `sessionClosed: true`. Nothing in the runner can abandon a session, the diagnostic
 * included, so the old no-terminate guard holds by construction.
 *
 * trade-offs: uses vi.mock for hooks and dependencies (consistent with existing
 * CanonicalPracticePage.test.tsx patterns).
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderRunner as render } from "@/test-support/runner.harness";
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
        section="M"
        isDiagnostic
      />,
    );
    expect(screen.queryByText("Skip")).toBeNull();
  });

  it("shows Skip button when isDiagnostic is false/omitted (regular practice)", () => {
    render(<CanonicalPracticePage title="Math" section="M" />);
    expect(screen.getByText("Skip")).not.toBeNull();
  });

  it("no runner offers End Session (UI-53: DESIGN.md §4 footer)", () => {
    render(<CanonicalPracticePage title="Math" section="M" />);
    expect(screen.queryByText("End Session")).toBeNull();
  });

  it("keeps Submit visible in diagnostic mode", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        isDiagnostic
      />,
    );
    expect(screen.getByRole("button", { name: "Submit" })).not.toBeNull();
  });

  it("names the diagnostic in the bar", () => {
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        isDiagnostic
      />,
    );
    expect(screen.getByTestId("runner-session-name").textContent).toBe(
      "Diagnostic Assessment",
    );
  });
});

describe("CanonicalPracticePage — completion (F-53, UI-53)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/practice/session/s-1");
  });

  it("Done on the last question asks for the next item (the server then closes the session)", () => {
    const nextQuestion = vi.fn();
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState({
        currentIndex: 39,
        totalQuestions: 40,
        showResult: true,
        isCorrect: true,
        correctOptionId: "B",
        selectedAnswer: "B",
        nextQuestion,
      }),
    );
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        isDiagnostic
        completionHref="/dashboard"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(nextQuestion).toHaveBeenCalledTimes(1);
  });

  it("diagnostic: a closed session goes to /dashboard", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState({ question: null, sessionClosed: true }),
    );
    render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        isDiagnostic
        completionHref="/dashboard"
      />,
    );
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("regular practice: a closed session goes to /practice", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState({ question: null, sessionClosed: true }),
    );
    render(
      <CanonicalPracticePage
        title="Math"
        section="M"
        completionHref="/practice"
      />,
    );
    expect(window.location.pathname).toBe("/practice");
  });

  it("an open session stays put", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState({ sessionClosed: false }),
    );
    render(<CanonicalPracticePage title="Math" section="M" />);
    expect(window.location.pathname).toBe("/practice/session/s-1");
  });
});
