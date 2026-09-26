// @vitest-environment jsdom
/**
 * E10 — the calculator and the reference sheet in the exam's module page.
 *
 * @spec [Doc-02B_v4 §28 (Desmos + formula sheet on Math, hidden on R&W; "open Desmos on one
 *        question, remains opened on advance"); Doc-04A_V2.2 §15.1 (resume); E10 decision log]
 * @implemented [2026-09-26]
 *
 * plain English: the real module page against an in-memory fake of the exam API, with
 * `DesmosCalculator` replaced by a probe that counts mounts and records `expanded` — the
 * real component needs desmos.com, which this proves nothing about (G-EX-08 is a deployed
 * check). What this pins is the WIRING the exam owns: Math-only; mounted once for the module
 * and collapsed when closed, as practice keeps it (so closing does not destroy the graph);
 * still open after Next; the reference sheet opens; a reload lands on the same question with
 * the calculator closed (the calculator's own state is not persisted — decision log).
 */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type {
  ExamQuestionPayload,
  ExamSessionResponse,
} from "@lyceon/shared/exam-runtime-schema";

const SID = "5e551011-0000-4000-8000-0000000e1001";
const FORM = "f0f00000-0000-4000-8000-0000000e1001";

type Fake = { section: "RW" | "M"; currentOrdinal: number | null };
let fake: Fake;

const probe = { mounts: 0, unmounts: 0, expanded: [] as boolean[] };

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: function DesmosProbe({
    expanded,
  }: {
    expanded: boolean;
  }): React.ReactElement {
    React.useEffect(() => {
      probe.mounts += 1;
      return () => {
        probe.unmounts += 1;
      };
    }, []);
    probe.expanded.push(expanded);
    return <div data-testid="desmos-probe" data-expanded={String(expanded)} />;
  },
}));

function items(): ExamQuestionPayload[] {
  return [0, 1].map((ordinal) => ({
    question_id: `SAT${fake.section}1Q${ordinal}`,
    ordinal,
    question_type: "multiple_choice" as const,
    stem: `Question ${ordinal + 1}?`,
    passage: null,
    options: ["a", "b", "c", "d"].map((id) => ({
      id: `tok_${id}_${ordinal}`,
      text: `Option ${id}`,
    })),
    assets: null,
    current_answer: null,
    correct_answer: null,
    explanation: null,
  }));
}

function sectionState() {
  return {
    section: fake.section,
    state: "module1_active" as const,
    remaining_ms: 2_100_000,
  };
}

function session(): ExamSessionResponse {
  const live = {
    state: "module1_active" as const,
    remaining_ms: 2_100_000,
    module2_path_locked: false,
    current_ordinal: fake.currentOrdinal,
  };
  const other = {
    state:
      fake.section === "M" ? ("completed" as const) : ("not_started" as const),
    remaining_ms: null,
    module2_path_locked: fake.section === "M",
    current_ordinal: null,
  };
  return {
    session_id: SID,
    test_form_id: FORM,
    state: "active",
    mode: "strict",
    active_section: fake.section,
    grace_expires_at: "2026-09-26T00:00:00Z",
    attempt_number_for_form: 1,
    is_first_seen_form_attempt: true,
    break_remaining_ms: null,
    sections: [
      { section: "RW", ...(fake.section === "RW" ? live : other) },
      {
        section: "M",
        ...(fake.section === "M"
          ? live
          : {
              ...other,
              state: "not_started" as const,
              module2_path_locked: false,
            }),
      },
    ],
  };
}

vi.mock("../api/exam-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api/exam-api")>();
  return {
    ...real,
    fetchExamSession: vi.fn(async () => session()),
    fetchModuleItems: vi.fn(async () => ({
      section_state: sectionState(),
      items: items(),
    })),
    fetchModuleWorkspace: vi.fn(async () => ({
      section_state: sectionState(),
      items: [],
    })),
    submitExamAnswer: vi.fn(),
    saveItemWorkspace: vi.fn(),
    sendExamHeartbeat: vi.fn(
      async (_s: string, _sec: string, ordinal: number | null) => {
        if (ordinal !== null) fake.currentOrdinal = ordinal;
        return { section_state: sectionState() };
      },
    ),
    submitExamModule: vi.fn(),
    startExamModule: vi.fn(),
  };
});

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { display_name: "Test Student" } }),
}));

import ExamModulePage from "./ExamModulePage";
import {
  CALC_COLUMN_HEIGHT_PX,
  CALC_DEFAULT_PCT,
  CALC_MIN_PX,
} from "@/components/math/calculator-layout";
import { CALC_MIN_PX as PRACTICE_CALC_MIN_PX } from "@/components/practice/CanonicalPracticePage";

function mount(path: string): (to: string) => void {
  const { hook, navigate } = memoryLocation({ path, record: true });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Switch>
          <Route
            path="/tests/:sessionId/:section/:module"
            component={ExamModulePage}
          />
          <Route path="/tests/:sessionId">
            <p>session hub</p>
          </Route>
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  // A module change as the page sees it: the server's position moves first (cache dropped,
  // so the next read is fresh), then the URL follows.
  return (to: string) =>
    act(() => {
      client.clear();
      navigate(to);
    });
}

const M1 = `/tests/${SID}/M/1`;
const RW1 = `/tests/${SID}/RW/1`;

function panel(): HTMLElement {
  const el = document.getElementById("exam-calculator-panel");
  if (el === null) throw new Error("calculator panel not mounted");
  return el;
}

beforeEach(() => {
  fake = { section: "M", currentOrdinal: null };
  probe.mounts = 0;
  probe.unmounts = 0;
  probe.expanded = [];
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("E10 exam calculator wiring", () => {
  it("Math: mounted collapsed; opening expands it; closing collapses the SAME instance (practice's pattern)", async () => {
    mount(M1);
    await screen.findByTestId("exam-module");
    expect(probe.mounts).toBe(1);
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("false");
    expect(panel().style.display).toBe("none");

    const toggle = screen.getByRole("button", { name: "Calculator" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("true");
    expect(panel().style.display).toBe("flex");

    fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("false");
    expect(panel().style.display).toBe("none");
    // Not destroyed: one mount, no unmount — reopening shows the same graph.
    expect(probe.mounts).toBe(1);
    expect(probe.unmounts).toBe(0);
  });

  it("§28: an open calculator stays open on Next, without re-mounting", async () => {
    mount(M1);
    await screen.findByTestId("exam-module");
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    await screen.findByText("Question 1?");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2?");
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("true");
    expect(probe.mounts).toBe(1);
    expect(probe.unmounts).toBe(0);
  });

  it("the reference sheet opens from the header tools row in Math", async () => {
    mount(M1);
    await screen.findByTestId("exam-module");
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Math Reference Sheet")).toBeTruthy();
  });

  it("Reading and Writing: no calculator, no reference, nothing mounted", async () => {
    fake.section = "RW";
    mount(RW1);
    await screen.findByTestId("exam-module");
    expect(screen.queryByRole("button", { name: "Calculator" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reference" })).toBeNull();
    expect(document.getElementById("exam-calculator-panel")).toBeNull();
    expect(probe.mounts).toBe(0);
  });

  it("resume: a reload mid-module lands on the same question; the calculator re-mounts, closed", async () => {
    mount(M1);
    await screen.findByTestId("exam-module");
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Question 2?");
    await waitFor(() => expect(fake.currentOrdinal).toBe(1));

    cleanup();
    mount(M1);
    await screen.findByText("Question 2?");
    expect(probe.mounts).toBe(2);
    expect(probe.unmounts).toBe(1);
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("true");
  });
});

describe("E10b floating calculator", () => {
  // jsdom has no pointer capture; the panel only needs the calls to exist.
  beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
  });

  async function openCalculator(): Promise<HTMLElement> {
    await screen.findByTestId("exam-module");
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    return panel();
  }

  function drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    const bar = screen.getByTestId("floating-panel-drag-bar");
    fireEvent.pointerDown(bar, {
      pointerId: 1,
      button: 0,
      clientX: from.x,
      clientY: from.y,
    });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: to.x, clientY: to.y });
  }

  it("is practice/review's size: CALC_MIN_PX x CALC_COLUMN_HEIGHT_PX, read from the shared module", async () => {
    mount(M1);
    const p = await openCalculator();
    expect(CALC_MIN_PX).toBe(PRACTICE_CALC_MIN_PX);
    expect(p.style.width).toBe(`${CALC_MIN_PX}px`);
    expect(p.style.height).toBe(`${CALC_COLUMN_HEIGHT_PX}px`);
    expect([CALC_MIN_PX, CALC_COLUMN_HEIGHT_PX]).toEqual([496, 640]);
  });

  it("drags by its header bar, stays inside the viewport, and keeps its place across close/reopen", async () => {
    mount(M1);
    const p = await openCalculator();
    const start = { x: parseFloat(p.style.left), y: parseFloat(p.style.top) };
    drag(
      { x: start.x + 10, y: start.y + 10 },
      { x: start.x + 210, y: start.y + 60 },
    );
    expect([parseFloat(p.style.left), parseFloat(p.style.top)]).toEqual([
      start.x + 200,
      start.y + 50,
    ]);

    // Far past the right/bottom edges: clamped to the viewport.
    drag({ x: 300, y: 100 }, { x: 5000, y: 5000 });
    expect(parseFloat(p.style.left)).toBe(window.innerWidth - CALC_MIN_PX);
    expect(parseFloat(p.style.top)).toBe(
      window.innerHeight - CALC_COLUMN_HEIGHT_PX,
    );
    const moved = [p.style.left, p.style.top];

    fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    expect([panel().style.left, panel().style.top]).toEqual(moved);
  });

  it("never crosses the header, so the timer stays visible", async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        top: 0,
        left: 0,
        right: 1024,
        bottom: 74,
        width: 1024,
        height: 74,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    mount(M1);
    const p = await openCalculator();
    drag({ x: 100, y: 120 }, { x: 100, y: -400 });
    expect(parseFloat(p.style.top)).toBe(74);
    // A viewport too short for 640px shrinks the panel below the header; it never overlaps it.
    expect(parseFloat(p.style.height)).toBeLessThanOrEqual(
      window.innerHeight - 74,
    );
    rect.mockRestore();
  });

  it("starting a drag moves no focus and reaches nothing underneath", async () => {
    mount(M1);
    await openCalculator();
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    const bar = screen.getByTestId("floating-panel-drag-bar");
    // false = default prevented: no focus change (a half-typed grid-in keeps focus), no text selection.
    expect(fireEvent.mouseDown(bar, { button: 0 })).toBe(false);
    expect(
      fireEvent.pointerDown(bar, {
        pointerId: 2,
        button: 0,
        clientX: 50,
        clientY: 120,
      }),
    ).toBe(false);
    expect(document.activeElement).toBe(next);
    fireEvent.pointerUp(bar, { pointerId: 2 });
  });

  it("Expand widens it to practice's split default and the full height below the header", async () => {
    mount(M1);
    const p = await openCalculator();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(p.getAttribute("data-expanded")).toBe("true");
    expect(p.style.width).toBe(
      `${Math.max(CALC_MIN_PX, Math.round((window.innerWidth * CALC_DEFAULT_PCT) / 100))}px`,
    );
    expect(p.style.height).toBe(`${window.innerHeight - 16}px`);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(p.style.width).toBe(`${CALC_MIN_PX}px`);
  });

  it("keyboard: opening focuses the panel; Escape closes it and focus returns to Calculator", async () => {
    mount(M1);
    const p = await openCalculator();
    expect(document.activeElement).toBe(p);
    fireEvent.keyDown(p, { key: "Escape" });
    expect(p.style.display).toBe("none");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Calculator" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Calculator" }));
    screen.getByRole("button", { name: "Close calculator" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Calculator" }),
    );
  });

  it("does not outlive the Math module: leaving it for Reading and Writing unmounts the panel", async () => {
    const go = mount(M1);
    await openCalculator();
    expect(probe.mounts).toBe(1);
    fake.section = "RW";
    go(RW1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reference" })).toBeNull(),
    );
    await screen.findByTestId("exam-module");
    expect(document.getElementById("exam-calculator-panel")).toBeNull();
    expect(screen.queryByTestId("desmos-probe")).toBeNull();
    expect(probe.unmounts).toBe(1);
  });
});
