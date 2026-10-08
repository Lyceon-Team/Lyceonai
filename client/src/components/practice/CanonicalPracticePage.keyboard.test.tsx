// @vitest-environment jsdom
/**
 * @spec [student-UI register §2 Keyboard (Practice and review row), UI-45; DESIGN.md §4
 *        Question runner keys] | @implemented [2026-10-03]
 *
 * plain English: the runner's keys driven through the real page (practice and review share
 * it): ↑/↓ move between options, Enter submits the selected option, Enter with nothing
 * selected does nothing, grid-in Enter submits the typed answer from its box, and after
 * feedback Enter and → go to the next question. Typing in a text field elsewhere on the
 * page (the LISA composer) does not trigger any of it. The practice hook is mocked: these
 * tests are about what the keys call, not what the session does with it.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderRunner } from "@/test-support/runner.harness";
import {
  PRACTICE_ENGINE_CONFIG,
  REVIEW_ENGINE_CONFIG,
} from "@/lib/engine-config";
import CanonicalPracticePage from "./CanonicalPracticePage";

const hookMock = vi.hoisted(() => ({ useCanonicalPractice: vi.fn() }));

vi.mock("@/hooks/useCanonicalPractice", () => ({
  useCanonicalPractice: hookMock.useCanonicalPractice,
}));

// A stand-in LISA panel with a real textarea: the "text field elsewhere" case.
vi.mock("@/components/tutor/ScopedTutorPanel", () => ({
  ScopedTutorPanel: () => (
    <textarea aria-label="Message" data-testid="lisa-composer" />
  ),
}));

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: () => <div data-testid="desmos-mock" />,
}));

type HookState = ReturnType<typeof hookState>;

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    question: {
      sessionItemId: "item-1",
      questionType: "multiple_choice" as const,
      stem: "Which choice completes the text?",
      section: "RW",
      options: [
        { id: "opt-1", text: "first" },
        { id: "opt-2", text: "second" },
        { id: "opt-3", text: "third" },
      ],
    },
    isLoading: false,
    error: null,
    selectedAnswer: null as string | null,
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
    persistCalculatorState: vi.fn(),
    submitBlocked: null,
    setForceTakeover: vi.fn(),
    sessionItemId: "item-1",
    ...overrides,
  };
}

function gridInState(overrides: Record<string, unknown> = {}) {
  return hookState({
    question: {
      sessionItemId: "item-gi",
      questionType: "grid_in" as const,
      itemType: "grid_in" as const,
      inputMode: "numeric_entry" as const,
      stem: "What is the value of x?",
      section: "RW",
      options: [],
    },
    ...overrides,
  });
}

function mountRunner(
  state: HookState,
  engine = PRACTICE_ENGINE_CONFIG,
): ReturnType<typeof renderRunner> {
  hookMock.useCanonicalPractice.mockReturnValue(state);
  return renderRunner(
    <CanonicalPracticePage title="Practice" section="RW" engine={engine} />,
  );
}

function press(
  key: string,
  target: Element | Window = window,
  init: Record<string, unknown> = {},
): void {
  fireEvent.keyDown(target, { key, ...init });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("practice/review runner keys (§2 row 1)", () => {
  it("↓ moves to the next option and ↑ to the previous one", () => {
    const state = hookState({ selectedAnswer: "opt-2", canSubmit: true });
    mountRunner(state);
    press("ArrowDown");
    expect(state.setSelectedAnswer).toHaveBeenLastCalledWith("opt-3");
    press("ArrowUp");
    expect(state.setSelectedAnswer).toHaveBeenLastCalledWith("opt-1");
    expect(state.submitAnswer).not.toHaveBeenCalled();
  });

  it("↓ with nothing selected selects the first option", () => {
    const state = hookState();
    mountRunner(state);
    press("ArrowDown");
    expect(state.setSelectedAnswer).toHaveBeenCalledWith("opt-1");
  });

  it("Enter submits the selected option — from the page and from the focused option", () => {
    const state = hookState({ selectedAnswer: "opt-2", canSubmit: true });
    mountRunner(state);
    press("Enter");
    expect(state.submitAnswer).toHaveBeenCalledTimes(1);
    expect(state.submitAnswer).toHaveBeenCalledWith({ skipped: false });

    const option = screen.getByRole("radio", { name: /second/ });
    press("Enter", option);
    expect(state.submitAnswer).toHaveBeenCalledTimes(2);
  });

  it("UI-53: ↑/↓ also move the selection when focus is on a choice (the choices are a radio group)", () => {
    const state = hookState({ selectedAnswer: "opt-2", canSubmit: true });
    mountRunner(state);
    const option = screen.getByRole("radio", { name: /second/ });
    press("ArrowDown", option);
    expect(state.setSelectedAnswer).toHaveBeenLastCalledWith("opt-3");
    press("ArrowUp", option);
    expect(state.setSelectedAnswer).toHaveBeenLastCalledWith("opt-1");
  });

  it("Enter with nothing selected does nothing", () => {
    const state = hookState({ selectedAnswer: null, canSubmit: false });
    mountRunner(state);
    press("Enter");
    expect(state.submitAnswer).not.toHaveBeenCalled();
    expect(state.nextQuestion).not.toHaveBeenCalled();
  });

  it("Enter on the Skip button is the button's, never a submit of the selection", () => {
    const state = hookState({ selectedAnswer: "opt-1", canSubmit: true });
    mountRunner(state);
    press("Enter", screen.getByRole("button", { name: "Skip" }));
    expect(state.submitAnswer).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter and a held-down Enter do not submit", () => {
    const state = hookState({ selectedAnswer: "opt-1", canSubmit: true });
    mountRunner(state);
    press("Enter", window, { ctrlKey: true });
    press("Enter", window, { repeat: true });
    expect(state.submitAnswer).not.toHaveBeenCalled();
  });

  it("nothing fires while a submit is in flight", () => {
    const state = hookState({
      selectedAnswer: "opt-1",
      canSubmit: true,
      isSubmitting: true,
    });
    mountRunner(state);
    press("Enter");
    press("ArrowDown");
    expect(state.submitAnswer).not.toHaveBeenCalled();
    expect(state.setSelectedAnswer).not.toHaveBeenCalled();
  });

  it("grid-in: Enter in the answer box submits the typed answer", () => {
    const state = gridInState({ freeResponseAnswer: "1/5", canSubmit: true });
    mountRunner(state);
    const box = screen.getByLabelText("Enter your answer");
    press("Enter", box);
    expect(state.submitAnswer).toHaveBeenCalledWith({ skipped: false });
  });

  it("grid-in: Enter with no valid typed answer does nothing", () => {
    const state = gridInState({ freeResponseAnswer: "", canSubmit: false });
    mountRunner(state);
    press("Enter", screen.getByLabelText("Enter your answer"));
    expect(state.submitAnswer).not.toHaveBeenCalled();
  });

  it("after feedback, Enter goes to the next question", () => {
    const state = hookState({
      selectedAnswer: "opt-1",
      showResult: true,
      isCorrect: true,
    });
    mountRunner(state);
    press("Enter");
    expect(state.nextQuestion).toHaveBeenCalledTimes(1);
    expect(state.submitAnswer).not.toHaveBeenCalled();
  });

  it("after feedback, → goes to the next question; before feedback it does nothing", () => {
    const answering = hookState({ selectedAnswer: "opt-1", canSubmit: true });
    const { unmount } = mountRunner(answering);
    press("ArrowRight");
    expect(answering.nextQuestion).not.toHaveBeenCalled();
    unmount();

    const feedback = hookState({ showResult: true, isCorrect: false });
    mountRunner(feedback);
    press("ArrowRight");
    expect(feedback.nextQuestion).toHaveBeenCalledTimes(1);
  });

  it("review runner: same keys; typing in the LISA composer triggers none of them", () => {
    const state = hookState({ selectedAnswer: "opt-1", canSubmit: true });
    mountRunner(state, REVIEW_ENGINE_CONFIG);
    // QA2-D: below 1024 LISA starts closed; the student opens it from the bar.
    fireEvent.click(screen.getByTestId("practice-tutor-toggle"));
    const composer = screen.getByTestId("lisa-composer");
    press("Enter", composer);
    press("ArrowDown", composer);
    press("ArrowRight", composer);
    expect(state.submitAnswer).not.toHaveBeenCalled();
    expect(state.setSelectedAnswer).not.toHaveBeenCalled();

    press("ArrowDown");
    expect(state.setSelectedAnswer).toHaveBeenCalledWith("opt-2");
  });

  it("shows no keystroke hint text (DESIGN.md §3, Karl's ruling)", () => {
    mountRunner(hookState({ selectedAnswer: "opt-1", canSubmit: true }));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/press enter|↑|↓|arrow keys|shortcut/i);
  });
});
