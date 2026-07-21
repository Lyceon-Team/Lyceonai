// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: () => <div data-testid="desmos-mock" />,
}));

vi.mock("@/components/math/MathReferenceSheet", () => ({
  default: () => null,
}));

vi.mock("@/components/MathRenderer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
  MathRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

import CanonicalPracticePage from "./CanonicalPracticePage";

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

const SESSION_ID = "sess-mcq-integrated";
const SESSION_ITEM_ID = "item-mcq-integrated";

function buildFetchMock(answerResponse: Record<string, unknown>) {
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
        return jsonResponse(answerResponse);
      }

      return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
    });
}

function findOptionButton(optionText: string): HTMLButtonElement | null {
  const matches = screen.getAllByText(optionText);
  for (const el of matches) {
    const btn = el.closest("button");
    if (btn) return btn;
  }
  return null;
}

describe("CanonicalPracticePage integrated MCQ round-trip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("incorrect MCQ: selects wrong option, submits through real pipeline, correct gets emerald + wrong gets rose", async () => {
    buildFetchMock({
      isCorrect: false,
      correctOptionId: "A",
      explanation: "1 + 1 = 2.",
    });

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("What is 1+1?")).not.toBeNull();
    });

    const optionB = findOptionButton("3");
    expect(optionB).not.toBeNull();
    await act(async () => {
      optionB!.click();
    });

    const checkBtn = screen.getByText("Check Answer");
    await act(async () => {
      checkBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByText("Incorrect")).not.toBeNull();
    });

    expect(screen.getByText("1 + 1 = 2.")).not.toBeNull();

    const correctBtn = findOptionButton("2");
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-emerald-500");
    expect(correctBtn!.className).toContain("bg-emerald-50");

    const wrongBtn = findOptionButton("3");
    expect(wrongBtn).not.toBeNull();
    expect(wrongBtn!.className).toContain("border-rose-500");
    expect(wrongBtn!.className).toContain("bg-rose-50");
  });

  it("correct MCQ: selects correct option, submits through real pipeline, correct gets emerald", async () => {
    buildFetchMock({
      isCorrect: true,
      correctOptionId: "A",
      explanation: "1 + 1 = 2.",
    });

    render(
      <CanonicalPracticePage
        title="Math Practice"
        badgeLabel="Math"
        section="math"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("What is 1+1?")).not.toBeNull();
    });

    const optionA = findOptionButton("2");
    expect(optionA).not.toBeNull();
    await act(async () => {
      optionA!.click();
    });

    const checkBtn = screen.getByText("Check Answer");
    await act(async () => {
      checkBtn.click();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Correct").length).toBeGreaterThan(0);
    });

    const correctBtn = findOptionButton("2");
    expect(correctBtn).not.toBeNull();
    expect(correctBtn!.className).toContain("border-emerald-500");
    expect(correctBtn!.className).toContain("bg-emerald-50");

    const otherBtn = findOptionButton("3");
    expect(otherBtn).not.toBeNull();
    expect(otherBtn!.className).not.toContain("border-emerald-500");
    expect(otherBtn!.className).not.toContain("border-rose-500");
  });
});
