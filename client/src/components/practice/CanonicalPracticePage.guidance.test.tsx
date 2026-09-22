// @vitest-environment jsdom
/**
 * R4.2 — practice's session-guidance card speaks to a student, not to us.
 *
 * @spec [Doc-02B_V4 §16; R4.1 guidance-copy fix, extended to practice by owner
 *        ruling 2026-09-22] | @implemented [2026-09-22]
 *
 * plain English: the aside card beside every practice question used to read
 * "Responses submit directly to canonical practice endpoints. If you leave and
 * return, Lyceon restores your unresolved state from runtime session truth." —
 * the same "runtime session truth" jargon R4.1 struck from review, on a screen
 * built for a 13-to-18-year-old. This pins the replacement.
 *
 * Plant (scripts/ci/review-ui-gate.mutations.sh, R4.2): put the old sentence back
 * in PRACTICE_ENGINE_CONFIG and this file goes red.
 *
 * Asserted EXACTLY, not by keyword. The old copy was fluent and confident; a
 * "mentions leaving and returning" assertion would have passed on it.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/math/DesmosCalculator", () => ({
  default: () => <div data-testid="desmos-mock" />,
}));

vi.mock("@/components/math/MathReferenceSheet", () => ({
  default: () => null,
}));

vi.mock("@/components/MathRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <span data-testid="math-rendered">{content}</span>
  ),
  MathRenderer: ({ content }: { content: string }) => (
    <span data-testid="math-rendered">{content}</span>
  ),
}));

import CanonicalPracticePage from "./CanonicalPracticePage";

const SESSION_ID = "sess-guidance-copy";
const STEM = "What is 1+1?";

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

function installFetchMock(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = asUrl(input);
    if (url === "/api/csrf-token") {
      return jsonResponse({ csrfToken: "csrf-test-token" });
    }
    if (url === "/api/practice/sessions" && init?.method === "POST") {
      return jsonResponse({ sessionId: SESSION_ID, totalQuestions: 5 }, 201);
    }
    if (url.includes("/next")) {
      return jsonResponse({
        sessionItemId: "item-guidance-copy",
        question: {
          questionType: "multiple_choice",
          stem: STEM,
          section: "M",
          options: [
            { id: "A", text: "2" },
            { id: "B", text: "3" },
          ],
          correct_answer: null,
          explanation: null,
        },
      });
    }
    return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
  });
}

describe("practice session guidance copy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("R4.2: states the plain-English guidance, verbatim", async () => {
    installFetchMock();
    render(
      <CanonicalPracticePage title="Math Practice" badgeLabel="M" section="m" />,
    );

    await waitFor(() => {
      expect(screen.getByText(STEM)).not.toBeNull();
    });

    expect(document.body.textContent).toContain(
      "Your answers are submitted as you go. You can leave anytime; your place is saved.",
    );
  });

  it("R4.2: the old engineering language is gone from the screen", async () => {
    installFetchMock();
    render(
      <CanonicalPracticePage title="Math Practice" badgeLabel="M" section="m" />,
    );

    await waitFor(() => {
      expect(screen.getByText(STEM)).not.toBeNull();
    });

    // Each phrase named by the owner, forbidden individually so a partial
    // rewrite that keeps one of them still fails.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("runtime session truth");
    expect(body).not.toContain("unresolved state");
    expect(body).not.toContain("canonical practice endpoints");
  });
});
