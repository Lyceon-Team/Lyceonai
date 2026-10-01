// @vitest-environment jsdom
/**
 * @spec [student-ui register UI-14; owner ruling 2026-10-01 (Brief 10, dashboard KPI polling)]
 *   | @implemented [2026-10-01] |
 * plain English: the KPI read no longer polls, so the answer that COMPLETES a practice or review
 * session (this hook runs both) must mark the KPIs stale; an answer mid-session must not. Drives
 * the real hook through start → next → answer against a scripted server and watches the app's
 * query client for the KPI invalidation.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/queryClient";
import { useCanonicalPractice } from "./useCanonicalPractice";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

let submitRef: ((opts: { skipped: boolean }) => Promise<unknown>) | null = null;
let selectRef: ((val: string | null) => void) | null = null;

function Harness() {
  const state = useCanonicalPractice("math");
  submitRef = state.submitAnswer as (opts: {
    skipped: boolean;
  }) => Promise<unknown>;
  selectRef = state.setSelectedAnswer as (val: string | null) => void;
  return <div data-testid="stem">{state.question?.stem ?? ""}</div>;
}

function scriptServer(answerState: "active" | "completed") {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = pathOf(input);
    if (url === "/api/csrf-token") return jsonResponse({ csrfToken: "t" });
    if (url === "/api/practice/sessions" && init?.method === "POST") {
      return jsonResponse({ sessionId: "s-1", totalQuestions: 1 }, 201);
    }
    if (url.includes("/next")) {
      return jsonResponse({
        sessionItemId: "i-1",
        state: "active",
        question: {
          questionType: "multiple_choice",
          stem: "What is 1+1?",
          options: [
            { id: "A", text: "2" },
            { id: "B", text: "3" },
          ],
          correct_answer: null,
          explanation: null,
        },
      });
    }
    if (url === "/api/practice/answer" && init?.method === "POST") {
      return jsonResponse({
        isCorrect: true,
        correctOptionId: "A",
        explanation: "Two.",
        state: answerState,
      });
    }
    return jsonResponse({ error: `unexpected ${url}` }, 500);
  });
}

const kpiInvalidations = (spy: ReturnType<typeof vi.spyOn>): number =>
  spy.mock.calls.filter(([filters]) => {
    const key = (filters as { queryKey?: unknown } | undefined)?.queryKey;
    return Array.isArray(key) && key[0] === "/api/progress/kpis";
  }).length;

async function answerOnce(): Promise<void> {
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByTestId("stem").textContent).toBe("What is 1+1?"),
  );
  await act(async () => {
    selectRef!("A");
  });
  await act(async () => {
    await submitRef!({ skipped: false });
  });
}

describe("useCanonicalPractice: session completion marks the KPIs stale", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the answer that completes the session invalidates /api/progress/kpis", async () => {
    scriptServer("completed");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await answerOnce();
    // Presence: the answer was submitted and the hook saw the server's state.
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.some(
          ([i, init]) =>
            pathOf(i) === "/api/practice/answer" && init?.method === "POST",
        ),
    ).toBe(true);
    expect(kpiInvalidations(invalidate)).toBe(1);
  });

  it("an answer mid-session does not", async () => {
    scriptServer("active");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await answerOnce();
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.some(
          ([i, init]) =>
            pathOf(i) === "/api/practice/answer" && init?.method === "POST",
        ),
    ).toBe(true);
    expect(kpiInvalidations(invalidate)).toBe(0);
  });
});
