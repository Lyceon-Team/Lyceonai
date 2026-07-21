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

const SESSION_ID = "sess-grid-guard";
const SESSION_ITEM_ID = "item-grid-guard";

let submitRef: ((opts: { skipped: boolean }) => Promise<void>) | null = null;
let freeResponseRef: ((val: string) => void) | null = null;

function Harness() {
  const state = useCanonicalPractice("math");

  submitRef = state.submitAnswer as (opts: {
    skipped: boolean;
  }) => Promise<void>;
  freeResponseRef = state.setFreeResponseAnswer;

  return (
    <div>
      <div data-testid="question-stem">{state.question?.stem ?? ""}</div>
      <div data-testid="can-submit">{state.canSubmit ? "yes" : "no"}</div>
      <div data-testid="free-response">{state.freeResponseAnswer}</div>
    </div>
  );
}

function buildFetchMock(): ReturnType<typeof vi.fn> {
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
            questionType: "grid_in",
            itemType: "grid_in",
            inputMode: "numeric_entry",
            stem: "Find x.",
            options: [],
            correct_answer: null,
            explanation: null,
          },
        });
      }

      if (url === "/api/practice/answer" && init?.method === "POST") {
        return jsonResponse({
          isCorrect: false,
          correctAnswer: "42",
          explanation: "The answer is 42.",
        });
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });
}

describe("useCanonicalPractice grid-in submit guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    submitRef = null;
    freeResponseRef = null;
  });

  it("blocks malformed grid-in values from reaching /api/practice/answer", async () => {
    const fetchMock = buildFetchMock();

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

      const answerCalls = fetchMock.mock.calls.filter(
        ([input, init]) =>
          asUrl(input) === "/api/practice/answer" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(answerCalls).toHaveLength(0);
    }
  });

  it("allows valid grid-in values to reach /api/practice/answer", async () => {
    const fetchMock = buildFetchMock();

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

      const answerCalls = fetchMock.mock.calls.filter(
        ([input, init]) =>
          asUrl(input) === "/api/practice/answer" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(answerCalls.length).toBeGreaterThanOrEqual(1);
    }
  });
});
