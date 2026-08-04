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

/* ── Upgraded MockResizeObserver: tracks callbacks for external firing ── */
type ROCallback = (entries: ResizeObserverEntry[]) => void;

const roInstances: { cb: ROCallback; elements: Element[] }[] = [];

class MockResizeObserver {
  private cb: ROCallback;
  private elements: Element[] = [];

  constructor(cb: ROCallback) {
    this.cb = cb;
    roInstances.push({ cb: this.cb, elements: this.elements });
  }

  observe = vi.fn((el: Element) => {
    this.elements.push(el);
  });

  disconnect = vi.fn(() => {
    this.elements.length = 0;
    const idx = roInstances.findIndex((i) => i.cb === this.cb);
    if (idx >= 0) roInstances.splice(idx, 1);
  });

  unobserve = vi.fn((el: Element) => {
    const idx = this.elements.indexOf(el);
    if (idx >= 0) this.elements.splice(idx, 1);
  });
}

/* ── Stub getBoundingClientRect on all elements ── */
const originalBCR = Element.prototype.getBoundingClientRect;

/**
 * Override Element.prototype.getBoundingClientRect so every element reports the
 * given `width`. This lets react-resizable-panels measure its container and
 * lets handleGroupLayout / handleCalcPanelResize compute real pixel values.
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

  // Ensure pointer-capture methods exist for drag tests (jsdom may have no-ops)
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
  // Clear tracked ResizeObserver instances
  roInstances.length = 0;
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

/* ── Drag helper: triggers library's onLayout → ARIA pixel values ── */

/**
 * Perform a pointer drag on the resize handle to trigger the library's
 * layout change path. react-resizable-panels registers pointer event
 * listeners on document.body (down/move) and window (up). A drag causes
 * setLayout → onLayout → handleGroupLayout → ARIA pixel values written.
 *
 * Without a drag, the library's onLayout never fires on initial mount
 * (layout equals defaults so the equality check passes), and the library's
 * ARIA-setting useLayoutEffect depends on panelGroupElement which stays
 * null in the context until the first drag triggers setDragState and
 * forces the useMemo to recompute.
 */
async function performDrag(
  handle: HTMLElement,
  startX: number,
  endX: number,
): Promise<void> {
  // pointerdown on handle → bubbles to body → library's handlePointerDown
  fireEvent.pointerDown(handle, {
    clientX: startX,
    clientY: 300,
    pointerId: 1,
    button: 0,
    buttons: 1,
  });

  // pointermove → bubbles to body → library's handlePointerMove → resizeHandler
  fireEvent.pointerMove(handle, {
    clientX: endX,
    clientY: 300,
    pointerId: 1,
    button: 0,
    buttons: 1,
  });

  // pointerup on handle (bubbles to body) + on window (library listener)
  const upOpts = {
    clientX: endX,
    clientY: 300,
    pointerId: 1,
    button: 0,
    buttons: 0,
  };
  fireEvent.pointerUp(handle, upOpts);
  window.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, ...upOpts }),
  );

  // handleGroupLayout writes ARIA values via setTimeout(0).
  // Wait for the microtask + timer to flush.
  await waitFor(() => {
    expect(handle.getAttribute("aria-valuenow")).not.toBeNull();
  });
}

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

  it("handleGroupLayout sets ARIA pixel values on the separator after drag (stubbed BCR)", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
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

    // A minimal drag triggers onLayout → handleGroupLayout sets ARIA values.
    // The library's onLayout only fires when sizes change; a 1px drag
    // produces a ~0.1% delta which suffices to trigger the callback.
    await performDrag(handle, 515, 516);

    // Verify all three ARIA pixel values are present and coherent
    const valueNow = handle.getAttribute("aria-valuenow");
    const valueMin = handle.getAttribute("aria-valuemin");
    const valueMax = handle.getAttribute("aria-valuemax");

    expect(valueNow).not.toBeNull();
    expect(valueMin).not.toBeNull();
    expect(valueMax).not.toBeNull();

    // aria-valuemin = QUESTION_MIN_PX (smallest the question panel can be)
    expect(valueMin).toBe(String(QUESTION_MIN_PX));
    // aria-valuemax = containerWidth − CALC_MIN_PX
    expect(Number(valueMax)).toBe(
      Math.round(TEST_CONTAINER_AT_BP - CALC_MIN_PX),
    );
    // aria-valuenow is within [min, max]
    const now = Number(valueNow);
    expect(now).toBeGreaterThanOrEqual(Number(valueMin));
    expect(now).toBeLessThanOrEqual(Number(valueMax));

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

/* ── FIX 4 (decisive): Resolved-pixel regression guard ── */
describe("CanonicalPracticePage resolved pixel floor (stubbed getBoundingClientRect)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("initial layout at breakpoint (1062px): calculator resolved width ≥ 450px", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
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

    // A 1px drag triggers onLayout → ARIA pixel values are set from
    // the default layout. This is the smallest possible interaction
    // to measure the resolved pixel widths.
    await performDrag(handle, 515, 516);

    const questionPx = Number(handle.getAttribute("aria-valuenow"));
    expect(questionPx).not.toBeNaN();
    expect(questionPx).toBeGreaterThan(0);

    // Calculator panel width = container − question panel
    const calcPanelPx = TEST_CONTAINER_AT_BP - questionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX); // ≥ 496

    // Desmos host width = panel − padding
    const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
    expect(desmosHostPx).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("at maximum drag: calculator resolved width = CALC_MIN_PX ≥ 450px", async () => {
    const restoreBCR = stubAllBCR(TEST_CONTAINER_AT_BP); // 1030
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

    // A 1px drag seeds the ARIA values so we can read aria-valuemax.
    await performDrag(handle, 515, 516);

    const valueMax = handle.getAttribute("aria-valuemax");
    expect(valueMax).not.toBeNull();
    const maxQuestionPx = Number(valueMax);
    expect(maxQuestionPx).not.toBeNaN();

    // At max drag, calculator panel = container − maxQuestion = CALC_MIN_PX
    const calcPanelPxAtMax = TEST_CONTAINER_AT_BP - maxQuestionPx;
    expect(calcPanelPxAtMax).toBe(CALC_MIN_PX); // 496

    // Desmos host at max drag = CALC_MIN_PX − padding = DESMOS_HOST_MIN_PX
    const desmosHostPxAtMax = calcPanelPxAtMax - CALC_PANEL_PAD_PX;
    expect(desmosHostPxAtMax).toBe(DESMOS_HOST_MIN_PX); // 480
    expect(desmosHostPxAtMax).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("after container resize to wider viewport: pixel floor still holds", async () => {
    const widerWidth = 1400;
    const restoreBCR = stubAllBCR(widerWidth);
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

    // Drag to trigger onLayout at the wider viewport
    await performDrag(handle, 700, 701);

    const valueNow = handle.getAttribute("aria-valuenow");
    const valueMax = handle.getAttribute("aria-valuemax");
    expect(valueNow).not.toBeNull();
    expect(valueMax).not.toBeNull();

    // Default layout pixel check
    const questionPx = Number(valueNow);
    const calcPanelPx = widerWidth - questionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);
    const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
    expect(desmosHostPx).toBeGreaterThanOrEqual(450);

    // Max-drag pixel check at wider viewport
    const maxQuestionPx = Number(valueMax);
    const calcAtMax = widerWidth - maxQuestionPx;
    expect(calcAtMax).toBe(CALC_MIN_PX);
    expect(calcAtMax - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });

  it("below-breakpoint at 1024px: full-width stacked container ≥ 450px, sidebar would be insufficient", () => {
    const viewportWidth = 1024;
    const contentWidth = viewportWidth - APP_HORIZONTAL_PADDING; // 992
    const restoreBCR = stubAllBCR(contentWidth);
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

/* ── FIX 2: Divider drag interaction via pointer events ── */
describe("CanonicalPracticePage divider drag interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("pointer drag on handle exercises resize path and pixel floor holds", async () => {
    const containerWidth = 1400;
    const restoreBCR = stubAllBCR(containerWidth);
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

    // Drag 100px right → shrink calculator, grow question panel.
    // At 1400px wide, the library processes the drag through the full
    // resizeHandler → setLayout → onLayout path.
    await performDrag(handle, 700, 800);

    const postDragQuestionPx = Number(handle.getAttribute("aria-valuenow"));
    expect(postDragQuestionPx).not.toBeNaN();
    expect(postDragQuestionPx).toBeGreaterThan(0);

    // Calculator panel width after drag
    const calcPanelPx = containerWidth - postDragQuestionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);

    // Desmos host ≥ 450px
    const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
    expect(desmosHostPx).toBeGreaterThanOrEqual(450);

    // Handle retains accessible attributes after drag
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.tabIndex).toBe(0);

    restoreBCR();
  });

  it("aggressive drag toward max does not break pixel floor", async () => {
    const containerWidth = 1400;
    const restoreBCR = stubAllBCR(containerWidth);
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

    // Aggressive drag: attempt to push the calculator panel past its minimum.
    // The library's minSize constraint (and CSS min-width) must prevent
    // the calculator from going below its pixel floor.
    await performDrag(handle, 700, containerWidth - 50);

    const questionPx = Number(handle.getAttribute("aria-valuenow"));
    expect(questionPx).not.toBeNaN();

    const calcPanelPx = containerWidth - questionPx;
    expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);
    expect(calcPanelPx - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);

    restoreBCR();
  });
});

/* ── FIX 3: Keyboard resize pixel bound ── */
describe("CanonicalPracticePage keyboard resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("ArrowRight on focused handle: calculator pixel bound holds after aggressive resize", async () => {
    const containerWidth = 1400;
    const restoreBCR = stubAllBCR(containerWidth);
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

    // A minimal drag is required first: the library's keyboard handler
    // depends on panelGroupElement in the React context, which only
    // becomes non-null after the first drag triggers setDragState →
    // useMemo recompute (react-resizable-panels v2.1.x behavior).
    await performDrag(handle, 700, 701);

    // Focus the handle (keyboard nav requires focus)
    handle.focus();
    expect(document.activeElement).toBe(handle);

    // Press ArrowRight aggressively to shrink the calculator panel.
    // Each press moves the divider by 10% (library default step).
    // The library's minSize constraint must prevent the calculator
    // from going below its pixel floor.
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: "ArrowRight", code: "ArrowRight" });
    }

    // After aggressive keyboard resize, pixel floor must hold
    await waitFor(() => {
      const value = handle.getAttribute("aria-valuenow");
      expect(value).not.toBeNull();
      const questionPx = Number(value);
      expect(questionPx).not.toBeNaN();

      const calcPanelPx = containerWidth - questionPx;
      expect(calcPanelPx).toBeGreaterThanOrEqual(CALC_MIN_PX);

      const desmosHostPx = calcPanelPx - CALC_PANEL_PAD_PX;
      expect(desmosHostPx).toBeGreaterThanOrEqual(450);
    });

    restoreBCR();
  });

  it("ArrowLeft on focused handle: question panel floor holds after aggressive resize", async () => {
    const containerWidth = 1400;
    const restoreBCR = stubAllBCR(containerWidth);
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

    // Activate keyboard handler via initial drag
    await performDrag(handle, 700, 701);

    handle.focus();

    // Press ArrowLeft aggressively to shrink the question panel.
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: "ArrowLeft", code: "ArrowLeft" });
    }

    // After aggressive keyboard resize, question panel must still be ≥ QUESTION_MIN_PX.
    await waitFor(() => {
      const valueNow = handle.getAttribute("aria-valuenow");
      const valueMin = handle.getAttribute("aria-valuemin");
      expect(valueNow).not.toBeNull();
      expect(valueMin).not.toBeNull();

      const questionPx = Number(valueNow);
      expect(questionPx).toBeGreaterThanOrEqual(QUESTION_MIN_PX);

      // Calculator also ≥ 450 from the other direction
      const calcPanelPx = containerWidth - questionPx;
      expect(calcPanelPx - CALC_PANEL_PAD_PX).toBeGreaterThanOrEqual(450);
    });

    restoreBCR();
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
