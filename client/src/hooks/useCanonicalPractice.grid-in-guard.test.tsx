// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanonicalPractice } from "./useCanonicalPractice";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

const SESSION_ID = "sess-submit-guard";
const SESSION_ITEM_ID = "item-submit-guard";

let submitRef: ((opts: { skipped: boolean }) => Promise<void>) | null = null;
let freeResponseRef: ((val: string) => void) | null = null;
let selectAnswerRef: ((val: string | null) => void) | null = null;
let submitBlockedRef: string | null = null;

function Harness() {
  const state = useCanonicalPractice("math");

  submitRef = state.submitAnswer as (opts: {
    skipped: boolean;
  }) => Promise<void>;
  freeResponseRef = state.setFreeResponseAnswer;
  selectAnswerRef = state.setSelectedAnswer as (val: string | null) => void;
  submitBlockedRef = state.submitBlocked;

  return (
    <div>
      <div data-testid="question-stem">{state.question?.stem ?? ""}</div>
      <div data-testid="question-type">
        {state.question?.questionType ?? ""}
      </div>
      <div data-testid="can-submit">{state.canSubmit ? "yes" : "no"}</div>
      <div data-testid="submit-blocked">{state.submitBlocked ?? ""}</div>
    </div>
  );
}

type QuestionShape = {
  questionType: "grid_in" | "multiple_choice";
  itemType?: string;
  inputMode?: string;
  stem: string;
  options: Array<{ id: string; text: string }>;
};

function buildFetchMock(question: QuestionShape): ReturnType<typeof vi.fn> {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = asUrl(input);

      if (url === "/api/csrf-token") {
        return jsonResponse({ csrfToken: "csrf-test-token" });
      }

      if (url === "/api/practice/sessions" && init?.method === "POST") {
        return jsonResponse({ sessionId: SESSION_ID, totalQuestions: 5 }, 201);
      }

      if (url.includes("/next")) {
        return jsonResponse({
          sessionItemId: SESSION_ITEM_ID,
          question: {
            ...question,
            correct_answer: null,
            explanation: null,
          },
        });
      }

      if (url === "/api/practice/answer" && init?.method === "POST") {
        return jsonResponse({
          isCorrect: false,
          correctAnswer: "42",
          correctOptionId: "A",
          explanation: "The answer is 42.",
        });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });
}

const GRID_IN_QUESTION: QuestionShape = {
  questionType: "grid_in",
  itemType: "grid_in",
  inputMode: "numeric_entry",
  stem: "Find x.",
  options: [],
};

const MCQ_QUESTION: QuestionShape = {
  questionType: "multiple_choice",
  stem: "What is 1+1?",
  options: [
    { id: "A", text: "2" },
    { id: "B", text: "3" },
  ],
};

function countAnswerCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([input, init]: [RequestInfo | URL, RequestInit | undefined]) =>
      asUrl(input) === "/api/practice/answer" && init?.method === "POST",
  ).length;
}

describe("useCanonicalPractice unified submit guard (isSubmittableAnswer)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    submitRef = null;
    freeResponseRef = null;
    selectAnswerRef = null;
    submitBlockedRef = null;
  });

  describe("grid-in: action boundary blocks malformed values", () => {
    it("blocks malformed grid-in values from reaching /api/practice/answer", async () => {
      const fetchMock = buildFetchMock(GRID_IN_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe("Find x.");
      });

      for (const malformed of ["1/2/3", "1..2", ".", "/", "-"]) {
        fetchMock.mockClear();

        await act(async () => {
          freeResponseRef!(malformed);
        });

        await act(async () => {
          await submitRef!({ skipped: false });
        });

        expect(countAnswerCalls(fetchMock)).toBe(0);
      }
    });

    it("allows valid grid-in values to reach /api/practice/answer", async () => {
      const fetchMock = buildFetchMock(GRID_IN_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe("Find x.");
      });

      for (const valid of ["0.2", "1/5", "-4", "7/2", "3.5"]) {
        fetchMock.mockClear();

        await act(async () => {
          freeResponseRef!(valid);
        });

        await act(async () => {
          await submitRef!({ skipped: false });
        });

        expect(countAnswerCalls(fetchMock)).toBeGreaterThanOrEqual(1);
      }
    });

    it("sets submitBlocked message for malformed grid-in", async () => {
      buildFetchMock(GRID_IN_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe("Find x.");
      });

      await act(async () => {
        freeResponseRef!("1/2/3");
      });

      await act(async () => {
        await submitRef!({ skipped: false });
      });

      expect(screen.getByTestId("submit-blocked").textContent).toContain(
        "number",
      );
    });
  });

  describe("MCQ: action boundary blocks null/empty selection", () => {
    it("blocks submit when no option is selected", async () => {
      const fetchMock = buildFetchMock(MCQ_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe(
          "What is 1+1?",
        );
      });

      fetchMock.mockClear();

      await act(async () => {
        await submitRef!({ skipped: false });
      });

      expect(countAnswerCalls(fetchMock)).toBe(0);
    });

    it("sets submitBlocked message for MCQ with no selection", async () => {
      buildFetchMock(MCQ_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe(
          "What is 1+1?",
        );
      });

      await act(async () => {
        await submitRef!({ skipped: false });
      });

      expect(screen.getByTestId("submit-blocked").textContent).toContain(
        "option",
      );
    });

    it("allows submit when a valid option is selected", async () => {
      const fetchMock = buildFetchMock(MCQ_QUESTION);

      render(<Harness />);

      await waitFor(() => {
        expect(screen.getByTestId("question-stem").textContent).toBe(
          "What is 1+1?",
        );
      });

      fetchMock.mockClear();

      await act(async () => {
        selectAnswerRef!("A");
      });

      await act(async () => {
        await submitRef!({ skipped: false });
      });

      expect(countAnswerCalls(fetchMock)).toBeGreaterThanOrEqual(1);
    });
  });
});
