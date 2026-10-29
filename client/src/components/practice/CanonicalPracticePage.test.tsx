// @vitest-environment jsdom
import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderRunner as render } from "@/test-support/runner.harness";
import {
  PRACTICE_ENGINE_CONFIG,
  REVIEW_ENGINE_CONFIG,
} from "@/lib/engine-config";
import {
  CALC_MIN_PX,
  CALC_PANEL_PAD_PX,
  DESMOS_HOST_MIN_PX,
  QUESTION_MIN_PX,
  SPLIT_BREAKPOINT,
} from "@/components/math/calculator-layout";
import CanonicalPracticePage from "./CanonicalPracticePage";

/**
 * 2026-10-22 (owner brief "LISA chat dock"): the dock's widths, asserted as literals. 768 = the
 * phone line (PHONE_WIDTH_QUERY). 2026-10-23 (owner brief "LISA launcher", option D): the 132px
 * launcher replaces the 56px bubble, so 1040 = the width from which the 760px column clears it
 * (760 + 2 × (156 − 16)) and 156 = its clearance (16 + 132 + 8).
 */
const DOCK_FROM_PX = 768;
const DOCK_COLUMN_CLEAR_PX = 1040;
const DOCK_CLEARANCE_PX = 156;

/* ── MockResizeObserver: no-op stub (DesmosCalculator uses ResizeObserver) ── */
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

/* ── Stub getBoundingClientRect on all elements ── */
const originalBCR = Element.prototype.getBoundingClientRect;

/**
 * Override Element.prototype.getBoundingClientRect so every element reports the
 * given `width`. This lets handleGroupLayout / handleCalcPanelResize compute
 * real pixel values from the stubbed container measurement.
 * Returns a cleanup function that restores the original method.
 */
function stubAllBCR(width: number): () => void {
  Element.prototype.getBoundingClientRect = function () {
    return {
      width,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = originalBCR;
  };
}

// APP_HORIZONTAL_PADDING = 32 (the runner body's px-4 × 2 sides)
const APP_HORIZONTAL_PADDING = 32;
/** Container width at the split breakpoint (what the panel group sees). */
const TEST_CONTAINER_AT_BP = SPLIT_BREAKPOINT - APP_HORIZONTAL_PADDING; // 1030

beforeAll(() => {
  global.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;

  // Ensure pointer-capture methods exist (jsdom may have no-ops)
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi
    .fn()
    .mockReturnValue(true) as typeof HTMLElement.prototype.hasPointerCapture;
});

afterEach(() => {
  // Safety-net: always restore BCR in case a test throws before its own cleanup
  Element.prototype.getBoundingClientRect = originalBCR;
  // Clear localStorage (react-resizable-panels persists via autoSaveId)
  localStorage.clear();
});

/* ── Hook + module mocks ── */
const hookMock = vi.hoisted(() => ({
  useCanonicalPractice: vi.fn(),
}));

vi.mock("@/hooks/useCanonicalPractice", () => ({
  useCanonicalPractice: hookMock.useCanonicalPractice,
}));

// W4-1: the panel's own behaviour (scope, one conversation per item, the
// wire) is proven end to end in ScopedTutorPanel.contract.test.tsx; here only
// what the page hands it.
// The phone's LISA strip (owner ruling on #1349) reads the guided choices through the app's
// query client; its behaviour is CanonicalPracticePage.runner.test.tsx's.
vi.mock("@/components/tutor/GuidedChoicesBar", () => ({
  GuidedChoicesBar: () => null,
}));
vi.mock("@/components/tutor/ScopedTutorPanel", () => ({
  ScopedTutorPanel: (p: {
    sourceSurface: string;
    sessionItemId: string;
    questionLabel: string;
    onHide: () => void;
  }) => (
    <div
      data-testid="scoped-tutor-panel-mock"
      data-surface={p.sourceSurface}
      data-item={p.sessionItemId}
      data-label={p.questionLabel}
    >
      <button type="button" onClick={p.onHide}>
        Hide LISA
      </button>
    </div>
  ),
}));

// 2026-10-22: the dock's own behaviour (lock, open, Esc, scope on the wire, the shared thread)
// is proven in ChatDock.contract.test.tsx; here only what the runner hands it.
const dockMounts = vi.hoisted(() => ({
  count: 0,
  opens: 0,
  /** The runner's docked column contract (2026-10-26), as last handed to the dock. */
  docked: null as null | {
    slot: HTMLElement | null;
    defaultOpen: boolean;
    onOpenChange: (open: boolean) => void;
    suppressed?: boolean;
  },
}));
vi.mock("@/components/tutor/ChatDock", async () => {
  const React = await import("react");
  return {
    // The real constants and helpers; only the component is stubbed.
    ...(await vi.importActual<typeof import("@/components/tutor/ChatDock")>(
      "@/components/tutor/ChatDock",
    )),
    // A forwardRef stub with the real handle's shape: `open()` is counted, so "Still confused?
    // Ask LISA" is proven to open THIS dock (owner brief 2026-10-23).
    ChatDock: React.forwardRef(function ChatDockStub(
      p: {
        scope: {
          kind: string;
          sourceSurface?: string;
          sessionItemId?: string | null;
          questionLabel?: string;
          submitted?: boolean;
        };
        docked?: {
          slot: HTMLElement | null;
          defaultOpen: boolean;
          onOpenChange: (open: boolean) => void;
          suppressed?: boolean;
        };
      },
      ref: React.ForwardedRef<{ open: () => void }>,
    ) {
      dockMounts.docked = p.docked ?? null;
      React.useImperativeHandle(ref, () => ({
        open: () => {
          dockMounts.opens += 1;
        },
      }));
      React.useEffect(() => {
        dockMounts.count += 1;
      }, []);
      return (
        <div
          data-testid="chat-dock-mock"
          data-kind={p.scope.kind}
          data-surface={p.scope.sourceSurface}
          data-item={p.scope.sessionItemId ?? "none"}
          data-label={p.scope.questionLabel}
          data-submitted={String(p.scope.submitted)}
        />
      );
    }),
  };
});

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: ({
    expanded,
    onStateChange,
    initialState,
  }: {
    expanded: boolean;
    onStateChange?: (state: unknown) => void;
    initialState?: unknown;
  }) => (
    <div
      data-testid="desmos-mock"
      // 2026-10-26: the state a (re)mounted calculator starts from, for the take-turns tier.
      data-initial={JSON.stringify(initialState ?? null)}
    >
      {expanded ? "expanded" : "collapsed"}
      <button
        type="button"
        data-testid="desmos-emit-state"
        onClick={() => onStateChange?.({ expressions: [] })}
      />
    </div>
  ),
}));

/*
 * ── Mock @/components/ui/resizable ──
 *
 * react-resizable-panels v2.1.x does not process pointer/keyboard events in
 * jsdom: its internal panelGroupElement stays null in the React context until
 * a drag triggers setDragState → useMemo recompute, and its document-level
 * pointer listeners depend on recalculateIntersectingHandles matching pointer
 * coords against handle BCR, which doesn't fire correctly in jsdom's event
 * simulation.
 *
 * Instead of fighting the library, we mock the wrapper layer to:
 *   1. Reproduce the DOM attributes that existing tests rely on
 *   2. Fire onLayout on mount with the default panel percentages so OUR
 *      handleGroupLayout code path is exercised
 *   3. Expose imperative panel API (resize()) for handleCalcPanelResize tests
 *
 * Divider drag and arrow-key resize are provided and bound by the library.
 * The pixel MIN is enforced by our CSS minWidth (browser-enforced) + our
 * minSize percentage (library-enforced). jsdom cannot exercise the library's
 * pointer/keyboard state machine, so those interaction paths are verified by
 * (a) the library's own test suite and (b) our pixel-bound assertions below,
 * not by simulated drag in unit tests.
 */
const resizableMock = vi.hoisted(() => ({
  /** Last onLayout callback stored so tests can trigger additional layout calls */
  lastOnLayout: null as ((sizes: number[]) => void) | null,
  /** Mock resize fn exposed via calcPanelRef.current.resize() */
  calcResizeFn: vi.fn(),
}));

vi.mock("@/components/ui/resizable", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react");

  function ResizablePanelGroup(props: Record<string, unknown>) {
    const { children, onLayout, direction, className, ...rest } = props;
    resizableMock.lastOnLayout =
      (onLayout as (sizes: number[]) => void) ?? null;

    R.useEffect(() => {
      if (typeof onLayout === "function") {
        // The real library initializes layout from defaultSize props.
        // Fire onLayout with the default percentages (QUESTION=51, CALC=49)
        // to exercise OUR handleGroupLayout → ARIA pixel override path.
        window.setTimeout(
          () => (onLayout as (sizes: number[]) => void)([51, 49]),
          0,
        );
      }
    }, [onLayout]);

    return R.createElement(
      "div",
      {
        "data-panel-group-id": "mock-group",
        "data-panel-group-direction": direction,
        className,
        ...rest,
      },
      children,
    );
  }

  const ResizablePanel = R.forwardRef(function MockPanel(
    props: Record<string, unknown>,
    ref: unknown,
  ) {
    const { children, defaultSize, minSize, onResize, style, ...passThrough } =
      props;

    R.useImperativeHandle(ref, () => ({
      resize: resizableMock.calcResizeFn,
      collapse: () => undefined,
      expand: () => undefined,
      getSize: () => (defaultSize as number) ?? 50,
      isCollapsed: () => false,
      isExpanded: () => true,
    }));

    return R.createElement(
      "div",
      {
        "data-panel-id": `panel-${defaultSize}`,
        "data-min-size": String(minSize),
        style,
        ...passThrough,
      },
      children,
    );
  });

  function ResizableHandle(props: Record<string, unknown>) {
    const { withHandle, className, children, ...rest } = props;
    return R.createElement(
      "div",
      {
        role: "separator",
        tabIndex: 0,
        "data-resize-handle-state": "inactive",
        className,
        ...rest,
      },
      withHandle ? R.createElement("div", { className: "grip-handle" }) : null,
      children,
    );
  }

  return { ResizablePanelGroup, ResizablePanel, ResizableHandle };
});

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
    calculatorState: null,
    noteCalculatorChange: vi.fn(),
    commitCalculatorState: vi.fn(async () => undefined),
    calculatorFlushRef: { current: null },
    calculatorSaveFailed: false,
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
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

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

    render(<CanonicalPracticePage title="RW Practice" section="RW" />);

    expect(screen.queryByTestId("practice-calculator-toggle")).toBeNull();
  });

  it("uses resizable side panel above split breakpoint when calculator is expanded", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).not.toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
  });

  it("resizable handle has accessible aria-label", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = container.querySelector(
      '[aria-label="Resize question and calculator panels"]',
    );
    expect(handle).not.toBeNull();
  });

  it("falls back to stacked layout on narrow viewport even when expanded", () => {
    mockMatchMedia(false);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
  });

  /**
   * @spec [Coding Standards §12.1, §13; register UI-10] | @implemented [2026-09-29]
   * plain English: a failed calculator-state save used to be reported only through
   * `console.error`. It is now surfaced to the student as a notice, with nothing
   * logged; the next successful save clears the notice.
   */
  it("surfaces a failed calculator save as a notice and logs nothing", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", { calculatorSaveFailed: true }),
    );
    const { rerender } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );
    expect(
      screen.getByTestId("practice-calculator-save-failed").textContent,
    ).toContain("could not be saved");
    expect(consoleError).not.toHaveBeenCalled();

    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", { calculatorSaveFailed: false }),
    );
    rerender(<CanonicalPracticePage title="Math Practice" section="M" />);
    expect(screen.queryByTestId("practice-calculator-save-failed")).toBeNull();
    consoleError.mockRestore();
  });

  /**
   * @spec [register G-NEW-14; owner brief 2026-10-12] | @implemented [2026-10-12]
   * plain English: a calculator change is local — it tells the saver and makes no save; the
   * calculator's own save moments (`onCommit`) go to the hook's commit.
   */
  it("a calculator change is noted locally, never saved on its own", () => {
    const state = buildHookState("M");
    hookMock.useCanonicalPractice.mockReturnValue(state);
    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("desmos-emit-state"));
    fireEvent.click(screen.getByTestId("desmos-emit-state"));
    expect(state.noteCalculatorChange).toHaveBeenCalledTimes(2);
    expect(state.noteCalculatorChange).toHaveBeenCalledWith({
      expressions: [],
    });
    expect(state.commitCalculatorState).not.toHaveBeenCalled();
  });
});

/* ── FIX 3: Divider accessibility + ARIA coherence ── */
describe("CanonicalPracticePage divider accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handle has role=separator, aria-orientation=vertical, and is focusable", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.tabIndex).toBe(0);
  });

  it("handleGroupLayout sets ARIA pixel values on the separator after layout fires (stubbed BCR)", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    // The mock fires onLayout([51, 49]) on mount via setTimeout(0).
    // handleGroupLayout then reads stubbed BCR and sets ARIA pixel values
    // via another setTimeout(0). waitFor polls until both have flushed.
    await waitFor(() => {
      expect(handle.getAttribute("aria-valuenow")).not.toBeNull();
    });

    const valueNow = handle.getAttribute("aria-valuenow");
    const valueMin = handle.getAttribute("aria-valuemin");
    const valueMax = handle.getAttribute("aria-valuemax");

    expect(valueNow).not.toBeNull();
    expect(valueMin).not.toBeNull();
    expect(valueMax).not.toBeNull();

    // ARIA model: question panel width is the controlled value.
    // aria-valuemin = QUESTION_MIN_PX (smallest the question panel can be)
    expect(valueMin).toBe(String(QUESTION_MIN_PX));
    // aria-valuemax = containerWidth − CALC_MIN_PX (largest question panel
    // before calculator violates its pixel floor)
    expect(Number(valueMax)).toBe(
      Math.round(TEST_CONTAINER_AT_BP - CALC_MIN_PX),
    );
    // aria-valuenow within [min, max]
    const now = Number(valueNow);
    expect(now).toBeGreaterThanOrEqual(Number(valueMin));
    expect(now).toBeLessThanOrEqual(Number(valueMax));

    // Provable calculator pixel floor from ARIA max:
    // When question panel = valuemax, calc = container − valuemax = CALC_MIN_PX
    // → host = CALC_MIN_PX − pad = DESMOS_HOST_MIN_PX = 480 ≥ 450.
    const calcAtMax = TEST_CONTAINER_AT_BP - Number(valueMax);
    expect(calcAtMax).toBe(CALC_MIN_PX);

    restoreBCR();
  });
});

/* ── FIX 1 & 4: Pixel constraints and below-breakpoint fallback ── */
describe("CanonicalPracticePage pixel-floor constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculator panel has CSS min-width set to CALC_MIN_PX (true pixel floor)", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(calcPanel).not.toBeNull();
    expect(calcPanel.style.minWidth).toBe(`${CALC_MIN_PX}px`);
  });

  it("question panel has CSS min-width set to QUESTION_MIN_PX", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).not.toBeNull();
    const panels = panelGroup!.querySelectorAll("[data-panel-id]");
    expect(panels.length).toBeGreaterThanOrEqual(2);
    const questionPanel = panels[0] as HTMLElement;
    expect(questionPanel.style.minWidth).toBe(`${QUESTION_MIN_PX}px`);
  });

  it("below-breakpoint fallback renders calculator full-width, not in narrow sidebar", () => {
    mockMatchMedia(false);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const stackedContainer = screen.getByTestId("stacked-calculator-container");
    expect(stackedContainer).not.toBeNull();
    expect(stackedContainer.closest(".lg\\:col-span-4")).toBeNull();
  });

  it("SPLIT_BREAKPOINT is ≥ CALC_MIN_PX + QUESTION_MIN_PX + padding (arithmetic guard)", () => {
    expect(SPLIT_BREAKPOINT).toBeGreaterThanOrEqual(
      CALC_MIN_PX + QUESTION_MIN_PX + 32,
    );
  });

  it("DESMOS_HOST_MIN_PX + CALC_PANEL_PAD_PX = CALC_MIN_PX (arithmetic guard)", () => {
    expect(CALC_MIN_PX).toBe(DESMOS_HOST_MIN_PX + 16);
    expect(DESMOS_HOST_MIN_PX).toBe(480);
    expect(CALC_MIN_PX).toBe(496);
  });
});

/* ── FIX 4 (decisive): Resolved-pixel regression guard ──
 *
 * These tests measure RESOLVED PIXELS via stubbed getBoundingClientRect,
 * not just CSS min-width constants. The mock fires onLayout on mount, which
 * triggers our handleGroupLayout → ARIA pixel values path. We read the ARIA
 * values and compute the actual calculator/Desmos-host widths.
 */
describe("CanonicalPracticePage resolved pixel floor (stubbed getBoundingClientRect)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("initial layout at breakpoint (1062px): calculator resolved width ≥ 450px", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    // Wait for onLayout → handleGroupLayout → ARIA pixel values
    await waitFor(() => {
      expect(handle.getAttribute("aria-valuenow")).not.toBeNull();
    });

    const questionPx = Number(handle.getAttribute("aria-valuenow"));
    expect(questionPx).not.toBeNaN();
    expect(questionPx).toBeGreaterThan(0);

    // Calculator panel = container − question panel
    const calcPanelPx = TEST_CONTAINER_AT_BP - questionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX); // ≥ 496

    // Desmos host = panel − padding
    const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
    expect(desmosHostPx).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("at ARIA valuemax: calculator resolved width = CALC_MIN_PX ≥ 450px", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    await waitFor(() => {
      expect(handle.getAttribute("aria-valuemax")).not.toBeNull();
    });

    const maxQuestionPx = Number(handle.getAttribute("aria-valuemax"));
    expect(maxQuestionPx).not.toBeNaN();

    // At max question-panel width, calculator = container − maxQuestion = CALC_MIN_PX
    const calcPanelPxAtMax = TEST_CONTAINER_AT_BP - maxQuestionPx;
    expect(calcPanelPxAtMax).toBe(CALC_MIN_PX); // 496

    // Desmos host at max = CALC_MIN_PX − padding = DESMOS_HOST_MIN_PX
    const desmosHostPxAtMax = calcPanelPxAtMax - CALC_PANEL_PAD_PX;
    expect(desmosHostPxAtMax).toBe(DESMOS_HOST_MIN_PX); // 480
    expect(desmosHostPxAtMax).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("at wider viewport (1400px): pixel floor still holds", async () => {
    const widerWidth = 1400;
    const restoreBCR = stubAllBCR(widerWidth);
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    await waitFor(() => {
      expect(handle.getAttribute("aria-valuenow")).not.toBeNull();
    });

    // Default layout pixel check
    const questionPx = Number(handle.getAttribute("aria-valuenow"));
    const calcPanelPx = widerWidth - questionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);
    const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
    expect(desmosHostPx).toBeGreaterThanOrEqual(450);

    // Max-drag pixel check at wider viewport
    const maxQuestionPx = Number(handle.getAttribute("aria-valuemax"));
    const calcAtMax = widerWidth - maxQuestionPx;
    expect(calcAtMax).toBe(CALC_MIN_PX);
    expect(calcAtMax - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("after container resize: onLayout recomputes pixel values and floor holds", async () => {
    // Start at breakpoint width
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const handle = screen.getByTestId("practice-resize-handle");

    // Wait for initial ARIA values
    await waitFor(() => {
      expect(handle.getAttribute("aria-valuenow")).not.toBeNull();
    });

    const initialQuestionPx = Number(handle.getAttribute("aria-valuenow"));
    expect(initialQuestionPx).not.toBeNaN();

    // Simulate container resize to 1400px
    restoreBCR();
    const widerWidth = 1400;
    const restoreBCR2 = stubAllBCR(widerWidth);

    // Re-trigger onLayout at the new width — in a real browser the library
    // calls onLayout when layout reflows. We call it directly because our
    // mock doesn't respond to container resize. handleGroupLayout reads
    // the stubbed BCR and recomputes ARIA pixel values.
    expect(resizableMock.lastOnLayout).not.toBeNull();
    resizableMock.lastOnLayout!([51, 49]);

    // Wait for handleGroupLayout to update ARIA with new width
    await waitFor(() => {
      const nowStr = handle.getAttribute("aria-valuenow");
      const now = Number(nowStr);
      // At 1400px, question = round(51/100 * 1400) = 714, different from initial
      expect(now).not.toBe(initialQuestionPx);
    });

    const updatedQuestionPx = Number(handle.getAttribute("aria-valuenow"));
    const calcPanelPx = widerWidth - updatedQuestionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);
    expect(calcPanelPx - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);

    restoreBCR2();
  });

  it("below-breakpoint at 1024px: full-width stacked container ≥ 450px, sidebar would be insufficient", () => {
    const viewportWidth = 1024;
    const contentWidth = viewportWidth - APP_HORIZONTAL_PADDING; // 992
    const restoreBCR = stubAllBCR(contentWidth);
    mockMatchMedia(false);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(<CanonicalPracticePage title="Math Practice" section="M" />);
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // No side panel at this viewport
    expect(screen.queryByTestId("practice-resize-handle")).toBeNull();

    // Full-width stacked container exists and resolves ≥ 450px via stubbed BCR
    const stacked = screen.getByTestId("stacked-calculator-container");
    const stackedWidth = stacked.getBoundingClientRect().width;
    expect(stackedWidth).toBe(contentWidth); // 992
    expect(stackedWidth).toBeGreaterThanOrEqual(450);

    // Arithmetic guard: a col-span-4/12 sidebar at this viewport would be too narrow
    const hypotheticalSidebarWidth = Math.floor((contentWidth / 12) * 4); // ~330
    expect(hypotheticalSidebarWidth).toBeLessThan(DESMOS_HOST_MIN_PX);

    restoreBCR();
  });
});

/* ── FIX 2: CSS min-width is the single source of truth for the pixel floor ──
 *
 * The pixel floor is enforced by CSS `min-width` (browser-continuous). The
 * library's `minSize` percentage (CALC_MIN_PCT / QUESTION_MIN_PCT) is a soft
 * initial constraint that bounds the library's drag allocation at the smallest
 * supported container width — it is NOT the enforcement mechanism.
 *
 * Divider drag and arrow-key resize are provided and bound by
 * react-resizable-panels; the pixel MIN is enforced by our CSS min-width
 * (browser-enforced). jsdom cannot exercise the library's pointer/keyboard
 * state machine, so real interaction testing is a Playwright e2e follow-up.
 */
describe("CanonicalPracticePage CSS pixel floor (single source of truth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("both panels have CSS min-width set (browser-enforced, continuous pixel floor)", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // CSS min-width is the TRUE pixel floor — browser-enforced, cannot be
    // violated by any drag, keyboard resize, or window resize.
    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(calcPanel.style.minWidth).toBe(`${CALC_MIN_PX}px`);

    const panelGroup = container.querySelector("[data-panel-group-id]");
    const panels = panelGroup!.querySelectorAll("[data-panel-id]");
    const questionPanel = panels[0] as HTMLElement;
    expect(questionPanel.style.minWidth).toBe(`${QUESTION_MIN_PX}px`);

    // Desmos host pixel floor is provably derived from CSS min-width:
    // CSS min-width = CALC_MIN_PX = 496px
    // host = 496 − CALC_PANEL_PAD_PX = 480px ≥ 450 ✓
    expect(CALC_MIN_PX - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);
  });

  it("static minSize percentage at breakpoint container bounds both panels above pixel floor", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    // Static minSize% = CALC_MIN_PCT = QUESTION_MIN_PCT = 49
    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(calcPanel.getAttribute("data-min-size")).toBe("49");

    const panelGroup = container.querySelector("[data-panel-group-id]");
    const panels = panelGroup!.querySelectorAll("[data-panel-id]");
    const questionPanel = panels[0] as HTMLElement;
    expect(questionPanel.getAttribute("data-min-size")).toBe("49");

    // At the breakpoint container (1030px), 49% = floor(0.49 * 1030) = 504px
    // → both panels get ≥ their pixel minimums under the static percentage.
    const pxAt49Pct = Math.floor((49 / 100) * TEST_CONTAINER_AT_BP);
    expect(pxAt49Pct).toBeGreaterThanOrEqual(QUESTION_MIN_PX); // 504 ≥ 500
    expect(pxAt49Pct).toBeGreaterThanOrEqual(CALC_MIN_PX); // 504 ≥ 496
  });
});

/* ── FIX 3: Keyboard / aggressive resize pixel bound (arithmetic) ──
 *
 * The library's keyboard handler (ArrowLeft/Right) applies a 10% step
 * bounded by each panel's minSize percentage. Our CSS min-width is the
 * absolute browser-enforced floor. jsdom cannot exercise the library's
 * keyboard state machine (panelGroupElement is null in context), so we
 * prove the bound arithmetically rather than via simulated keystrokes.
 * Real keyboard interaction testing belongs in Playwright e2e.
 */
describe("CanonicalPracticePage keyboard/aggressive resize bound (arithmetic)", () => {
  it("CSS min-width provably prevents any keyboard or drag resize from violating the 450px host floor", () => {
    // The browser enforces CSS min-width regardless of what percentage the
    // library computes. Even if the library's minSize% constraint were
    // bypassed (it can't be via keyboard — the library clamps), CSS min-width
    // still holds.
    //
    // calc panel CSS min-width = CALC_MIN_PX = 496px
    // Desmos host = CALC_MIN_PX − CALC_PANEL_PAD_PX = 480px
    // 480 ≥ 450 ✓
    expect(CALC_MIN_PX - CALC_PANEL_PAD_PX).toBe(DESMOS_HOST_MIN_PX);
    expect(DESMOS_HOST_MIN_PX).toBe(480);
    expect(DESMOS_HOST_MIN_PX).toBeGreaterThanOrEqual(450);

    // question panel CSS min-width = QUESTION_MIN_PX = 500px
    expect(QUESTION_MIN_PX).toBe(500);
    expect(QUESTION_MIN_PX).toBeGreaterThanOrEqual(450);
  });

  it("minSize percentage at breakpoint container clamps both panels above pixel floor under 10% keyboard step", () => {
    // Library keyboard default: 10% step per arrow press.
    // At the breakpoint container (1030px), 10% = 103px.
    const containerWidth = TEST_CONTAINER_AT_BP; // 1030

    // Calculator minSize% at breakpoint = ceil(496/1030*100) = 49
    const calcMinPct = Math.ceil((CALC_MIN_PX / containerWidth) * 100);
    expect(calcMinPct).toBe(49);

    // At minSize=49%, calc panel = floor(0.49 * 1030) = 504px ≥ 496 ✓
    const calcPxAtMinPct = Math.floor((calcMinPct / 100) * containerWidth);
    expect(calcPxAtMinPct).toBeGreaterThanOrEqual(CALC_MIN_PX);

    // Desmos host at minSize = 504 − 16 = 488px ≥ 450 ✓
    expect(calcPxAtMinPct - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);

    // Question minSize% at breakpoint = ceil(500/1030*100) = 49
    const questionMinPct = Math.ceil((QUESTION_MIN_PX / containerWidth) * 100);
    expect(questionMinPct).toBe(49);

    // At minSize=49%, question panel = floor(0.49 * 1030) = 504px ≥ 500 ✓
    const questionPxAtMinPct = Math.floor(
      (questionMinPct / 100) * containerWidth,
    );
    expect(questionPxAtMinPct).toBeGreaterThanOrEqual(QUESTION_MIN_PX);

    // Combined minSize% must be ≤ 100 (both panels fit)
    expect(calcMinPct + questionMinPct).toBeLessThanOrEqual(100);
  });

  it("at wider viewport (1400px), reduced minSize% still yields pixel floor ≥ 450", () => {
    const containerWidth = 1400;

    // calcMinPct = ceil(496/1400*100) = 36
    const calcMinPct = Math.ceil((CALC_MIN_PX / containerWidth) * 100);
    expect(calcMinPct).toBe(36);

    // At 36% of 1400 = 504px ≥ 496 ✓
    const calcPxAtMinPct = Math.floor((calcMinPct / 100) * containerWidth);
    expect(calcPxAtMinPct).toBeGreaterThanOrEqual(CALC_MIN_PX);
    expect(calcPxAtMinPct - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);
  });
});

/* ── Grid-in rendering ── */
describe("CanonicalPracticePage grid-in rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders numeric entry input for a grid_in question", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildGridInHookState());

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    expect(screen.getByText("What is the value of x?")).not.toBeNull();
    expect(screen.getByLabelText("Enter your answer")).not.toBeNull();
  });

  it("MCQ round-trip: select option, submit, correct option gets the correct tone (non-regression)", () => {
    const setSelectedAnswer = vi.fn();
    const submitAnswer = vi.fn();
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        canSubmit: true,
        selectedAnswer: null,
        setSelectedAnswer,
        submitAnswer,
      }),
    );

    const { unmount } = render(
      <CanonicalPracticePage title="Math Practice" section="M" />,
    );

    expect(screen.getByText("What is 1 + 1?")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
    expect(screen.getByText("3")).not.toBeNull();
    expect(screen.queryByLabelText("Enter your answer")).toBeNull();

    fireEvent.click(screen.getByText("2"));
    expect(setSelectedAnswer).toHaveBeenCalledWith("A");

    fireEvent.click(screen.getByText("Submit"));
    expect(submitAnswer).toHaveBeenCalledWith({ skipped: false });

    unmount();

    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        selectedAnswer: "A",
        showResult: true,
        isCorrect: true,
        correctOptionId: "A",
        explanation: "1 + 1 = 2.",
      }),
    );

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    expect(screen.getAllByText("Correct").length).toBeGreaterThan(0);
    expect(screen.getByText("1 + 1 = 2.")).not.toBeNull();

    const correctBtn = screen
      .getAllByText("2")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-lyc-lv4-fill");
    expect(correctBtn!.className).toContain("bg-lyc-lv4-bg");

    const wrongBtn = screen
      .getAllByText("3")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(wrongBtn).not.toBeNull();
    expect(wrongBtn!.className).not.toContain("border-lyc-lv4-fill");
    expect(wrongBtn!.className).not.toContain("border-lyc-danger");
  });

  it("MCQ incorrect: wrong selected option gets the danger tone, correct gets the correct tone (non-regression)", () => {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        selectedAnswer: "B",
        showResult: true,
        isCorrect: false,
        correctOptionId: "A",
        explanation: "1 + 1 = 2.",
      }),
    );

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    const correctBtn = screen
      .getAllByText("2")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-lyc-lv4-fill");

    const wrongBtn = screen
      .getAllByText("3")
      .map((el) => el.closest("button"))
      .find((btn) => btn !== null)!;
    expect(wrongBtn).not.toBeNull();
    expect(wrongBtn!.className).toContain("border-lyc-danger");
    expect(wrongBtn!.className).toContain("bg-lyc-danger-bg");
  });

  it("does not auto-skip grid_in questions", () => {
    const state = buildGridInHookState();
    hookMock.useCanonicalPractice.mockReturnValue(state);

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

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

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    expect(screen.getByText("Not quite")).not.toBeNull();
    expect(screen.getByText("Correct answer:")).not.toBeNull();
    expect(screen.getByText("Divide 1 by 5.")).not.toBeNull();
  });

  it("disables Submit for malformed grid-in input (format gate)", () => {
    hookMock.useCanonicalPractice.mockReturnValue(buildGridInHookState());

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    const checkBtn = screen.getByRole("button", { name: "Submit" });
    expect((checkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Submit when canSubmit is false for malformed values like 1/2/3", () => {
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

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    const checkBtn = screen.getByRole("button", { name: "Submit" });
    expect((checkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Submit when canSubmit is true for valid grid-in value", () => {
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

    render(<CanonicalPracticePage title="Math Practice" section="M" />);

    const checkBtn = screen.getByRole("button", { name: "Submit" });
    expect((checkBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * matchMedia that answers `(min-width: Npx)` truthfully for a viewport width, and its
 * `not all and (...)` negation (the phone queries in hooks/use-mobile.tsx).
 */
function mockViewport(width: number): void {
  window.matchMedia = vi.fn((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const atLeast = m ? width >= Number(m[1]) : false;
    return {
      matches: query.startsWith("not all and") ? !atLeast : atLeast,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

function renderReview(overrides: Record<string, unknown> = {}) {
  hookMock.useCanonicalPractice.mockReturnValue(
    buildHookState("M", {
      sessionItemId: "rev-item-7",
      currentIndex: 2,
      totalQuestions: 10,
      ...overrides,
    }),
  );
  return render(
    <CanonicalPracticePage
      title="Review"
      section="M"
      engine={REVIEW_ENGINE_CONFIG}
    />,
  );
}

describe("LISA chat dock (owner brief, Karl, 2026-10-22): the dock replaces the runner's panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dockMounts.count = 0;
  });

  for (const width of [DOCK_FROM_PX, 1024, 1440]) {
    it(`${width}px: no side panel and no Show/Hide LISA; the dock, scoped to the served item and named by "Question N of M" (from 1338px) or "N of M" (the 300px column)`, () => {
      mockViewport(width);
      renderReview();
      const dock = screen.getByTestId("chat-dock-mock");
      expect(dock.getAttribute("data-kind")).toBe("question");
      expect(dock.getAttribute("data-surface")).toBe("review");
      expect(dock.getAttribute("data-item")).toBe("rev-item-7");
      // Owner ruling on #1322 (Karl, 2026-10-26): the compact form in the 300px column.
      expect(dock.getAttribute("data-label")).toBe(
        width >= 1338 ? "Question 3 of 10" : "3 of 10",
      );
      expect(screen.queryByTestId("scoped-tutor-panel-mock")).toBeNull();
      expect(screen.queryByTestId("practice-tutor-toggle")).toBeNull();
      expect(screen.queryByTestId("review-tutor-layout")).toBeNull();
      // The question is still the page's (presence before absence).
      expect(screen.getByText("What is 1 + 1?")).toBeTruthy();
    });
  }

  it("the dock follows the next question without remounting (its state lasts the visit)", () => {
    mockViewport(1440);
    const view = renderReview();
    expect(dockMounts.count).toBe(1);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        sessionItemId: "rev-item-8",
        currentIndex: 3,
        totalQuestions: 10,
      }),
    );
    view.rerender(
      <CanonicalPracticePage
        title="Review"
        section="M"
        engine={REVIEW_ENGINE_CONFIG}
      />,
    );
    const dock = screen.getByTestId("chat-dock-mock");
    expect(dock.getAttribute("data-item")).toBe("rev-item-8");
    expect(dock.getAttribute("data-label")).toBe("Question 4 of 10");
    expect(dockMounts.count).toBe(1);
  });

  it("between questions (no served item) the dock stays mounted, scoped to no item", () => {
    mockViewport(1440);
    renderReview({ sessionItemId: null });
    expect(screen.getByTestId("chat-dock-mock").getAttribute("data-item")).toBe(
      "none",
    );
    expect(screen.queryByTestId("practice-tutor-toggle")).toBeNull();
  });

  /** 2026-10-26: review starts with LISA docked; the launcher shows once it is minimized. */
  function minimizeDockedLisa(): void {
    act(() => dockMounts.docked?.onOpenChange(false));
  }

  it(`with LISA minimized to the launcher: below ${DOCK_COLUMN_CLEAR_PX}px the scroll area keeps the launcher's ${DOCK_CLEARANCE_PX}px clear on its right; from ${DOCK_COLUMN_CLEAR_PX}px the column clears it on its own`, () => {
    mockViewport(DOCK_FROM_PX);
    const narrow = renderReview();
    // Docked open (2026-10-26) there is no launcher, so nothing is kept clear for one.
    expect(screen.getByTestId("runner-scroll").style.paddingRight).toBe("");
    minimizeDockedLisa();
    expect(screen.getByTestId("runner-scroll").style.paddingRight).toBe(
      `${DOCK_CLEARANCE_PX}px`,
    );
    narrow.unmount();
    mockViewport(DOCK_COLUMN_CLEAR_PX - 1);
    const below = renderReview();
    minimizeDockedLisa();
    expect(screen.getByTestId("runner-scroll").style.paddingRight).toBe(
      `${DOCK_CLEARANCE_PX}px`,
    );
    below.unmount();
    mockViewport(DOCK_COLUMN_CLEAR_PX);
    renderReview();
    minimizeDockedLisa();
    expect(screen.getByTestId("runner-scroll").style.paddingRight).toBe("");
  });

  // Owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26).
  it("review: LISA starts docked open as the right column (372px), with no launcher clearance; minimized, the column is hidden", () => {
    mockViewport(1440);
    renderReview();
    const column = screen.getByTestId("runner-lisa-column");
    expect(dockMounts.docked?.defaultOpen).toBe(true);
    expect(dockMounts.docked?.slot).toBe(column);
    expect(column.getAttribute("data-open")).toBe("true");
    expect(column.style.width).toBe("372px");
    expect(column.className).not.toContain("hidden");
    expect(screen.getByTestId("runner-scroll").style.paddingRight).toBe("");
    minimizeDockedLisa();
    expect(column.getAttribute("data-open")).toBe("false");
    expect(column.className).toBe("hidden");
  });

  it("practice after submit: the column starts closed (the launcher), and opens as the column for the answered item", () => {
    mockViewport(1440);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        sessionItemId: "prac-item-1",
        currentIndex: 0,
        totalQuestions: 5,
        showResult: true,
      }),
    );
    render(
      <CanonicalPracticePage
        title="Math Practice"
        section="M"
        engine={PRACTICE_ENGINE_CONFIG}
      />,
    );
    const column = screen.getByTestId("runner-lisa-column");
    expect(dockMounts.docked?.defaultOpen).toBe(false);
    expect(column.getAttribute("data-open")).toBe("false");
    act(() => dockMounts.docked?.onOpenChange(true));
    expect(column.getAttribute("data-open")).toBe("true");
  });

  // Owner ruling 5 on #1300 (Karl, 2026-10-23): the bubble never covers the calculator. The bubble
  // reports its height as the `dock-bubble` layer; the side-panel calculator keeps it clear.
  it("the side-panel calculator keeps the drawn bubble's footprint clear at its bottom, and nothing when there is no bubble", async () => {
    const { useReportBottomChrome } = await import("@/lib/bottom-chrome");
    function FakeBubble(): JSX.Element {
      const ref = React.useRef<HTMLElement>(null);
      useReportBottomChrome(ref, "dock-bubble");
      return <span ref={ref} data-testid="fake-bubble" />;
    }
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      return (this as HTMLElement).dataset?.testid === "fake-bubble"
        ? ({ height: 56 } as DOMRect)
        : original.call(this);
    };
    try {
      mockViewport(1600);
      const view = renderReview();
      fireEvent.click(screen.getByTestId("practice-calculator-toggle"));
      // Presence first: the calculator is open beside the question.
      const panel = screen.getByTestId("side-panel-calculator");
      expect(within(panel).getByTestId("desmos-mock").textContent).toBe(
        "expanded",
      );
      expect(panel.style.paddingBottom).toBe("");
      const bubble = render(<FakeBubble />);
      await waitFor(() =>
        // 56 (the bubble) + 16 (its distance from the footer) + 8 (a gap).
        expect(
          screen.getByTestId("side-panel-calculator").style.paddingBottom,
        ).toBe("80px"),
      );
      bubble.unmount();
      await waitFor(() =>
        expect(
          screen.getByTestId("side-panel-calculator").style.paddingBottom,
        ).toBe(""),
      );
      view.unmount();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("review with the calculator from the split breakpoint: the standard side-by-side calculator, no LISA column", () => {
    mockViewport(1600);
    renderReview();
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));
    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(within(calcPanel).getByTestId("desmos-mock").textContent).toBe(
      "expanded",
    );
    expect(calcPanel.style.minWidth).toBe(`${CALC_MIN_PX}px`);
    expect(screen.queryByTestId("review-tutor-column")).toBeNull();
    expect(screen.getByTestId("chat-dock-mock")).toBeTruthy();
  });

  it(`phones (below ${DOCK_FROM_PX}px) are unchanged: no dock; Show LISA stacks question, then LISA, then the calculator`, () => {
    mockViewport(390);
    renderReview();
    expect(screen.queryByTestId("chat-dock-mock")).toBeNull();
    // QA2-D: LISA starts closed; the student opens it from the bar.
    expect(screen.queryByTestId("scoped-tutor-panel-mock")).toBeNull();
    fireEvent.click(screen.getByTestId("practice-tutor-toggle"));
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const layout = screen.getByTestId("review-tutor-layout");
    const question = within(layout).getByText("What is 1 + 1?");
    const lisa = within(layout).getByTestId("scoped-tutor-panel-mock");
    const calc = within(layout).getByTestId("stacked-calculator-container");
    expect(
      question.compareDocumentPosition(lisa) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      lisa.compareDocumentPosition(calc) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(calc).getByTestId("desmos-mock").textContent).toBe(
      "expanded",
    );
  });

  it("phones: the panel's Hide LISA closes it, and the bar brings it back", () => {
    mockViewport(390);
    renderReview();
    fireEvent.click(screen.getByTestId("practice-tutor-toggle"));
    fireEvent.click(
      within(screen.getByTestId("scoped-tutor-panel-mock")).getByRole(
        "button",
        { name: "Hide LISA" },
      ),
    );
    expect(screen.queryByTestId("scoped-tutor-panel-mock")).toBeNull();
    fireEvent.click(screen.getByTestId("practice-tutor-toggle"));
    expect(screen.getByTestId("scoped-tutor-panel-mock")).toBeTruthy();
  });

  it("practice BEFORE submit: no LISA, no dock, no entry point, its own layout", () => {
    mockViewport(1600);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", { sessionItemId: "prac-item-1" }),
    );
    render(
      <CanonicalPracticePage
        title="Math Practice"
        section="M"
        engine={PRACTICE_ENGINE_CONFIG}
      />,
    );
    // Presence first: the question is on screen, unanswered.
    expect(screen.getByText("What is 1 + 1?")).toBeTruthy();
    expect(screen.getByTestId("runner-submit")).toBeTruthy();
    expect(screen.queryByTestId("chat-dock-mock")).toBeNull();
    expect(screen.queryByTestId("practice-tutor-toggle")).toBeNull();
    expect(screen.queryByTestId("scoped-tutor-panel-mock")).toBeNull();
    expect(screen.queryByTestId("review-tutor-layout")).toBeNull();
    expect(screen.queryByText(/LISA/)).toBeNull();
  });

  // Owner ruling 2 on #1300 (Karl, 2026-10-23): practice gets the dock POST-SUBMIT only.
  for (const width of [DOCK_FROM_PX, 1024, 1440]) {
    it(`practice AFTER submit at ${width}px: the dock, scoped to the answered practice item; still no phone panel or toggle`, () => {
      mockViewport(width);
      hookMock.useCanonicalPractice.mockReturnValue(
        buildHookState("M", {
          sessionItemId: "prac-item-1",
          currentIndex: 0,
          totalQuestions: 5,
          showResult: true,
        }),
      );
      render(
        <CanonicalPracticePage
          title="Math Practice"
          section="M"
          engine={PRACTICE_ENGINE_CONFIG}
        />,
      );
      const dock = screen.getByTestId("chat-dock-mock");
      expect(dock.getAttribute("data-kind")).toBe("question");
      expect(dock.getAttribute("data-surface")).toBe("practice");
      expect(dock.getAttribute("data-item")).toBe("prac-item-1");
      expect(dock.getAttribute("data-label")).toBe(
        width >= 1338 ? "Question 1 of 5" : "1 of 5",
      );
      expect(screen.queryByTestId("practice-tutor-toggle")).toBeNull();
      expect(screen.queryByTestId("scoped-tutor-panel-mock")).toBeNull();
    });
  }

  it("practice after submit, but the diagnostic or a phone: no dock", () => {
    mockViewport(1440);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", { sessionItemId: "diag-item-1", showResult: true }),
    );
    const diagnostic = render(
      <CanonicalPracticePage
        title="Diagnostic Assessment"
        section="M"
        engine={PRACTICE_ENGINE_CONFIG}
        isDiagnostic
      />,
    );
    expect(screen.getByTestId("runner-next")).toBeTruthy();
    expect(screen.queryByTestId("chat-dock-mock")).toBeNull();
    diagnostic.unmount();

    mockViewport(390);
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", { sessionItemId: "prac-item-1", showResult: true }),
    );
    render(
      <CanonicalPracticePage
        title="Math Practice"
        section="M"
        engine={PRACTICE_ENGINE_CONFIG}
      />,
    );
    expect(screen.getByTestId("runner-next")).toBeTruthy();
    expect(screen.queryByTestId("chat-dock-mock")).toBeNull();
    expect(screen.queryByTestId("practice-tutor-toggle")).toBeNull();
  });
});

/**
 * Owner brief "LISA launcher" (Karl, 2026-10-23): after a WRONG answer (practice and review,
 * post-submit only) one muted text link under the explanation, "Still confused? Ask LISA", that
 * opens the dock already scoped to that question. Never after a correct answer, before submit, in
 * the diagnostic or on a phone (the full-length test is ChatDock.surfaces.guard.test.ts's). The
 * dock's opener follows the item's submit state (`scope.submitted`).
 */
describe("Still confused? Ask LISA (owner brief, Karl, 2026-10-23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dockMounts.count = 0;
    dockMounts.opens = 0;
  });

  function renderPracticeResult(isCorrect: boolean, isDiagnostic = false) {
    hookMock.useCanonicalPractice.mockReturnValue(
      buildHookState("M", {
        sessionItemId: "prac-item-1",
        currentIndex: 0,
        totalQuestions: 5,
        showResult: true,
        isCorrect,
      }),
    );
    return render(
      <CanonicalPracticePage
        title={isDiagnostic ? "Diagnostic Assessment" : "Math Practice"}
        section="M"
        engine={PRACTICE_ENGINE_CONFIG}
        isDiagnostic={isDiagnostic}
      />,
    );
  }

  for (const width of [1024, 1440]) {
    it(`practice, wrong answer at ${width}px: the link under the explanation opens the dock scoped to the answered item`, () => {
      mockViewport(width);
      renderPracticeResult(false);
      const feedback = screen.getByTestId("runner-feedback");
      const link = screen.getByTestId("runner-ask-lisa");
      expect(link.tagName).toBe("BUTTON");
      expect(link.textContent).toBe("Still confused? Ask LISA");
      // Under the explanation: after the feedback panel in the document.
      expect(
        feedback.compareDocumentPosition(link) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Muted text link, not a button-shaped control; tokens only.
      expect(link.className).toContain("text-lyc-muted");
      expect(link.className).toContain("underline");
      expect(link.className).not.toContain("bg-lyc-primary-bg");
      const dock = screen.getByTestId("chat-dock-mock");
      expect(dock.getAttribute("data-item")).toBe("prac-item-1");
      expect(dock.getAttribute("data-submitted")).toBe("true");
      expect(dockMounts.opens).toBe(0);
      fireEvent.click(link);
      expect(dockMounts.opens).toBe(1);
    });
  }

  it("practice, correct answer: the dock, but no link", () => {
    mockViewport(1440);
    renderPracticeResult(true);
    // Presence before absence: the result is on screen and the dock is drawn.
    expect(screen.getByTestId("runner-feedback")).toBeTruthy();
    expect(screen.getByTestId("chat-dock-mock")).toBeTruthy();
    expect(screen.queryByTestId("runner-ask-lisa")).toBeNull();
  });

  it("the diagnostic, wrong answer: no link (and no dock)", () => {
    mockViewport(1440);
    renderPracticeResult(false, true);
    expect(screen.getByTestId("runner-feedback")).toBeTruthy();
    expect(screen.queryByTestId("runner-ask-lisa")).toBeNull();
    expect(screen.queryByTestId("chat-dock-mock")).toBeNull();
  });

  it("a phone, wrong answer: no link", () => {
    mockViewport(390);
    renderPracticeResult(false);
    expect(screen.getByTestId("runner-feedback")).toBeTruthy();
    expect(screen.queryByTestId("runner-ask-lisa")).toBeNull();
  });

  it("review: before submit no link and the dock says not submitted; after a wrong answer the link, and the dock says submitted", () => {
    mockViewport(1440);
    const before = renderReview();
    // Presence before absence: the unanswered question and its Submit.
    expect(screen.getByTestId("runner-submit")).toBeTruthy();
    expect(screen.queryByTestId("runner-feedback")).toBeNull();
    expect(screen.queryByTestId("runner-ask-lisa")).toBeNull();
    expect(
      screen.getByTestId("chat-dock-mock").getAttribute("data-submitted"),
    ).toBe("false");
    before.unmount();

    renderReview({ showResult: true, isCorrect: false });
    const link = screen.getByTestId("runner-ask-lisa");
    expect(link.textContent).toBe("Still confused? Ask LISA");
    expect(
      screen.getByTestId("chat-dock-mock").getAttribute("data-submitted"),
    ).toBe("true");
    fireEvent.click(link);
    expect(dockMounts.opens).toBe(1);
  });

  it("review, correct answer: no link", () => {
    mockViewport(1440);
    renderReview({ showResult: true, isCorrect: true });
    expect(screen.getByTestId("runner-feedback")).toBeTruthy();
    expect(screen.queryByTestId("runner-ask-lisa")).toBeNull();
  });
});

/**
 * Owner ruling on #1322 (Karl, 2026-10-26): the width tiers of the docked runner. From 1338px
 * LISA's column is 360px (+12 inset); from W3 = 1278px to 1337px it is 300px and the calculator
 * still opens between the question and LISA; below W3 the two take turns, the last one opened
 * winning, and the automatic yield is not the student's own minimize.
 */
describe("docked LISA: the width tiers (owner ruling on #1322, Karl, 2026-10-26)", () => {
  const W3 = 1278;
  beforeEach(() => {
    vi.clearAllMocks();
    dockMounts.count = 0;
    dockMounts.docked = null;
  });

  function column(): HTMLElement {
    return screen.getByTestId("runner-lisa-column");
  }
  function calcToggle(): HTMLElement {
    return screen.getByTestId("practice-calculator-toggle");
  }

  it("from 1338px LISA's column is 360px (372 with its inset); from W3 to 1337px it is 300px (312)", () => {
    mockViewport(1338);
    const wide = renderReview();
    expect(column().style.width).toBe("372px");
    wide.unmount();
    mockViewport(1337);
    const narrow = renderReview();
    expect(column().style.width).toBe("312px");
    narrow.unmount();
    mockViewport(W3);
    renderReview();
    expect(column().style.width).toBe("312px");
  });

  it("at W3 (1278) and 1280 the calculator opens BETWEEN the question and LISA: both shown, nothing yields", () => {
    for (const width of [W3, 1280]) {
      mockViewport(width);
      const view = renderReview();
      fireEvent.click(calcToggle());
      expect(screen.getByTestId("side-panel-calculator")).toBeTruthy();
      expect(column().getAttribute("data-open")).toBe("true");
      expect(dockMounts.docked?.suppressed).toBe(false);
      view.unmount();
    }
  });

  for (const width of [W3 - 1, 1024]) {
    it(`below W3 (${width}px) they take turns, the last opened winning, twice over`, () => {
      mockViewport(width);
      renderReview();
      // Presence first: LISA docked open, the calculator closed.
      expect(column().getAttribute("data-open")).toBe("true");
      expect(calcToggle().getAttribute("aria-expanded")).toBe("false");
      for (let round = 0; round < 2; round += 1) {
        // The calculator opened: LISA yields to its launcher.
        fireEvent.click(calcToggle());
        expect(calcToggle().getAttribute("aria-expanded")).toBe("true");
        expect(column().getAttribute("data-open")).toBe("false");
        expect(dockMounts.docked?.suppressed).toBe(true);
        // LISA reopened (its launcher): the calculator closes.
        act(() => dockMounts.docked?.onOpenChange(true));
        expect(column().getAttribute("data-open")).toBe("true");
        expect(dockMounts.docked?.suppressed).toBe(false);
        expect(calcToggle().getAttribute("aria-expanded")).toBe("false");
      }
    });
  }

  it("below W3 the yield is not the student's minimize: closing the calculator gives LISA back on its own", () => {
    mockViewport(W3 - 1);
    renderReview();
    fireEvent.click(calcToggle());
    expect(column().getAttribute("data-open")).toBe("false");
    // The student's own choice is untouched: still "open".
    expect(dockMounts.docked?.defaultOpen).toBe(true);
    fireEvent.click(calcToggle());
    expect(column().getAttribute("data-open")).toBe("true");
    expect(dockMounts.docked?.suppressed).toBe(false);
  });

  it("below W3 the calculator's state survives the turn-taking: a reopened calculator starts from it", () => {
    mockViewport(W3 - 1);
    renderReview();
    fireEvent.click(calcToggle());
    // The student works in the calculator (its state reported up).
    fireEvent.click(screen.getAllByTestId("desmos-emit-state")[0]!);
    act(() => dockMounts.docked?.onOpenChange(true));
    expect(calcToggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(calcToggle());
    const desmos = screen.getAllByTestId("desmos-mock");
    expect(desmos.length).toBeGreaterThan(0);
    for (const d of desmos)
      expect(d.getAttribute("data-initial")).toBe('{"expressions":[]}');
  });
});
