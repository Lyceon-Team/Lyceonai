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

function mount(path: string): void {
  const { hook } = memoryLocation({ path, record: true });
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
    expect(panel().className).toMatch(/\bhidden\b/);

    const toggle = screen.getByRole("button", { name: "Calculator" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("true");
    expect(panel().className).not.toMatch(/\bhidden\b/);

    fireEvent.click(screen.getByRole("button", { name: "Close calculator" }));
    expect(
      screen.getByTestId("desmos-probe").getAttribute("data-expanded"),
    ).toBe("false");
    expect(panel().className).toMatch(/\bhidden\b/);
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
