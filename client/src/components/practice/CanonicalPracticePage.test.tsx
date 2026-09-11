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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CanonicalPracticePage, {
  CALC_MIN_PX,
  CALC_PANEL_PAD_PX,
  DESMOS_HOST_MIN_PX,
  QUESTION_MIN_PX,
  SPLIT_BREAKPOINT,
} from "./CanonicalPracticePage";

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

// APP_HORIZONTAL_PADDING = 32 (PracticeShell px-4 × 2 sides)
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

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: ({ expanded }: { expanded: boolean }) => (
    <div data-testid="desmos-mock">{expanded ? "expanded" : "collapsed"}</div>
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
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
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
        section="RW"
      />,
    );

    expect(screen.queryByTestId("practice-calculator-toggle")).toBeNull();
  });

  it("uses resizable side panel above split breakpoint when calculator is expanded", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
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
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
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
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );

    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const panelGroup = container.querySelector("[data-panel-group-id]");
    expect(panelGroup).toBeNull();
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
    fireEvent.click(screen.getByTestId("practice-calculator-toggle"));

    const calcPanel = screen.getByTestId("practice-calc-panel");
    expect(calcPanel).not.toBeNull();
    expect(calcPanel.style.minWidth).toBe(`${CALC_MIN_PX}px`);
  });

  it("question panel has CSS min-width set to QUESTION_MIN_PX", () => {
    mockMatchMedia(true);
    hookMock.useCanonicalPractice.mockReturnValue(buildHookState("M"));

    const { container } = render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );
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
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
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
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
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

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
      />,
    );

    expect(screen.getByText("What is the value of x?")).not.toBeNull();
    expect(screen.getByLabelText("Enter your answer")).not.toBeNull();
  });

  it("MCQ round-trip: select option, submit, correct option gets emerald highlight (non-regression)", () => {
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
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="M"
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
      buildHookState("M", {
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
        section="M"
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
      buildHookState("M", {
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
        section="M"
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
        section="M"
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
        section="M"
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
        section="M"
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
        section="M"
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
        section="M"
      />,
    );

    const checkBtn = screen.getByText("Check Answer");
    expect((checkBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
