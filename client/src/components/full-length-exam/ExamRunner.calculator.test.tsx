// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExamRunner from "./ExamRunner";

const queryMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

const desmosMocks = vi.hoisted(() => ({
  renders: [] as Array<{
    expanded: boolean;
    initialState: unknown;
    onStateChange?: (state: unknown) => void;
  }>,
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: queryMocks.apiRequest,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMocks.toast }),
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/question-renderer", () => ({
  __esModule: true,
  default: ({
    question,
    selectedAnswer,
    onSelectAnswer,
  }: {
    question: { stem: string; options: Array<{ key: string }> };
    selectedAnswer: string | null;
    onSelectAnswer: (value: string) => void;
  }) => (
    <div>
      <div data-testid="question-stem">{question.stem}</div>
      <button data-testid="pick-answer" onClick={() => onSelectAnswer(question.options[0]?.key ?? "A")}>
        Pick
      </button>
      <div data-testid="selected-answer">{selectedAnswer ?? ""}</div>
    </div>
  ),
}));

vi.mock("@/components/math/DesmosCalculator", () => ({
  __esModule: true,
  default: ({
    expanded,
    initialState,
    onStateChange,
  }: {
    expanded: boolean;
    initialState?: unknown;
    onStateChange?: (state: unknown) => void;
  }) => {
    desmosMocks.renders.push({ expanded, initialState, onStateChange });
    return <div data-testid="desmos-mock">{expanded ? "expanded" : "collapsed"}</div>;
  },
}));

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function stateFixture(params: {
  section: "math" | "rw";
  moduleIndex: number;
  moduleId: string;
  questionId: string;
  stem: string;
  answeredCount: number;
  totalCount: number;
}) {
  const { section, moduleIndex, moduleId, questionId, stem, answeredCount, totalCount } = params;
  return {
    session: {
      id: "session-1",
      status: "in_progress",
      current_section: section,
      current_module: moduleIndex,
      started_at: "2026-03-18T10:00:00.000Z",
      completed_at: null,
    },
    currentModule: {
      id: moduleId,
      section,
      module_index: moduleIndex,
      status: "in_progress",
      started_at: "2026-03-18T10:00:00.000Z",
      ends_at: "2026-03-18T11:00:00.000Z",
      submitted_at: null,
      calculator_state: null,
    },
    currentQuestion: {
      id: questionId,
      stem,
      section,
      question_type: "multiple_choice",
      options: [
        { key: "A", text: "1" },
        { key: "B", text: "2" },
      ],
      difficulty: 2,
      orderIndex: answeredCount,
      moduleQuestionCount: totalCount,
      answeredCount,
    },
    timeRemaining: 20 * 60 * 1000,
    breakTimeRemaining: null,
  };
}

describe("ExamRunner calculator behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desmosMocks.renders = [];
    queryMocks.apiRequest.mockImplementation(async () => response({ success: true }));
  });

  it("shows calculator toggle on math module and supports clean collapse/expand", async () => {
    queryMocks.apiRequest.mockResolvedValueOnce(
      response(
        stateFixture({
          section: "math",
          moduleIndex: 1,
          moduleId: "math-1",
          questionId: "q1",
          stem: "Math question",
          answeredCount: 0,
          totalCount: 2,
        }),
      ),
    );

    render(<ExamRunner sessionId="session-1" />);

    await waitFor(() => expect(screen.getByTestId("full-length-calculator-toggle")).not.toBeNull());
    expect(screen.getByTestId("question-stem").textContent).toContain("Math question");
    expect(screen.getByTestId("desmos-mock").textContent).toContain("collapsed");

    fireEvent.click(screen.getByTestId("full-length-calculator-toggle"));
    expect(screen.getByTestId("desmos-mock").textContent).toContain("expanded");
    expect(screen.getByTestId("question-stem").textContent).toContain("Math question");
  });

  it("hides calculator toggle on non-math module", async () => {
    queryMocks.apiRequest.mockResolvedValueOnce(
      response(
        stateFixture({
          section: "rw",
          moduleIndex: 1,
          moduleId: "rw-1",
          questionId: "q1",
          stem: "RW question",
          answeredCount: 0,
          totalCount: 2,
        }),
      ),
    );

    render(<ExamRunner sessionId="session-1" />);

    await waitFor(() => expect(screen.getByTestId("question-stem")).not.toBeNull());
    expect(screen.queryByTestId("full-length-calculator-toggle")).toBeNull();
  });

  it("preserves in-memory calculator state per module across navigation within loaded session", async () => {
    const sessionSnapshots = [
      stateFixture({
        section: "math",
        moduleIndex: 1,
        moduleId: "math-1",
        questionId: "m1-q1",
        stem: "Math Q1",
        answeredCount: 0,
        totalCount: 3,
      }),
      stateFixture({
        section: "math",
        moduleIndex: 1,
        moduleId: "math-1",
        questionId: "m1-q2",
        stem: "Math Q2",
        answeredCount: 1,
        totalCount: 3,
      }),
      stateFixture({
        section: "rw",
        moduleIndex: 1,
        moduleId: "rw-1",
        questionId: "rw-q1",
        stem: "RW Q1",
        answeredCount: 0,
        totalCount: 2,
      }),
      stateFixture({
        section: "math",
        moduleIndex: 1,
        moduleId: "math-1",
        questionId: "m1-q3",
        stem: "Math Q3",
        answeredCount: 2,
        totalCount: 3,
      }),
    ];

    queryMocks.apiRequest.mockImplementation(async (url: unknown) => {
      const endpoint = String(url);
      if (endpoint.includes("/api/full-length/sessions/current")) {
        const snapshot = sessionSnapshots.shift() ?? sessionSnapshots[sessionSnapshots.length - 1];
        return response(snapshot);
      }
      if (
        endpoint.includes("/api/full-length/sessions/session-1/answer") ||
        endpoint.includes("/api/full-length/sessions/session-1/modules/math-1/calculator-state")
      ) {
        return response({ ok: true });
      }
      return response({ success: true });
    });

    render(<ExamRunner sessionId="session-1" />);

    await waitFor(() => expect(screen.getByTestId("full-length-calculator-toggle")).not.toBeNull());
    const persistedState = { expressions: [{ id: "1", latex: "y=x^2" }] };
    act(() => {
      desmosMocks.renders[desmosMocks.renders.length - 1]?.onStateChange?.(persistedState);
    });

    fireEvent.click(screen.getByTestId("pick-answer"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("question-stem").textContent).toContain("Math Q2"));

    const lastMathRender = desmosMocks.renders[desmosMocks.renders.length - 1];
    expect(lastMathRender.initialState).toEqual(persistedState);

    fireEvent.click(screen.getByTestId("pick-answer"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("question-stem").textContent).toContain("RW Q1"));
    expect(screen.queryByTestId("full-length-calculator-toggle")).toBeNull();

    fireEvent.click(screen.getByTestId("pick-answer"));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByTestId("question-stem").textContent).toContain("Math Q3"));

    const lastRenderAfterReturn = desmosMocks.renders[desmosMocks.renders.length - 1];
    expect(lastRenderAfterReturn.initialState).toEqual(persistedState);
  });

  it("restores calculator state from full-length current-session payload and persists math-only updates", async () => {
    const serverState = { expressions: [{ id: "e1", latex: "y=2x" }] };
    queryMocks.apiRequest.mockResolvedValueOnce(
      response({
        ...stateFixture({
          section: "math",
          moduleIndex: 1,
          moduleId: "math-1",
          questionId: "m1-q1",
          stem: "Math persisted",
          answeredCount: 0,
          totalCount: 2,
        }),
        currentModule: {
          id: "math-1",
          section: "math",
          module_index: 1,
          status: "in_progress",
          started_at: "2026-03-18T10:00:00.000Z",
          ends_at: "2026-03-18T11:00:00.000Z",
          submitted_at: null,
          calculator_state: serverState,
        },
      }),
    );

    render(<ExamRunner sessionId="session-1" />);
    await waitFor(() => expect(screen.getByTestId("full-length-calculator-toggle")).not.toBeNull());

    const latestRender = desmosMocks.renders[desmosMocks.renders.length - 1];
    expect(latestRender.initialState).toEqual(serverState);

    const nextState = { expressions: [{ id: "e2", latex: "y=x^2" }] };
    latestRender.onStateChange?.(nextState);

    await waitFor(() => {
      const persistCall = queryMocks.apiRequest.mock.calls.find((args) =>
        String(args[0]).includes("/api/full-length/sessions/session-1/modules/math-1/calculator-state")
      );
      expect(persistCall).toBeTruthy();
    });

    const persistCall = queryMocks.apiRequest.mock.calls.find((args) =>
      String(args[0]).includes("/api/full-length/sessions/session-1/modules/math-1/calculator-state")
    );
    expect(persistCall).toBeTruthy();
    expect(persistCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(persistCall?.[1]?.body))).toEqual({
      calculator_state: nextState,
    });
  });

  it("does not persist calculator state for non-math module", async () => {
    queryMocks.apiRequest.mockResolvedValueOnce(
      response(
        stateFixture({
          section: "rw",
          moduleIndex: 1,
          moduleId: "rw-1",
          questionId: "rw-q1",
          stem: "RW no calc persist",
          answeredCount: 0,
          totalCount: 2,
        }),
      ),
    );

    render(<ExamRunner sessionId="session-1" />);
    await waitFor(() => expect(screen.getByTestId("question-stem").textContent).toContain("RW no calc persist"));
    expect(
      queryMocks.apiRequest.mock.calls.some((args) => String(args[0]).includes("/calculator-state"))
    ).toBe(false);
  });
});
