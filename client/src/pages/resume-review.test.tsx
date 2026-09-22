// @vitest-environment jsdom
/**
 * U2 and U3 — the review loop, driven through the review shell.
 *
 * @spec [Doc-02B_V4 §16; Coding Standards §5.2/§5.3; ruling 17; brief R4 §2.1/§2.2, U2/U3]
 * @implemented [2026-09-22]
 *
 * U2 — ANTI-LEAK, INHERITED AND PROVEN FOR REVIEW. The loop must render no correct
 * answer and no explanation before submit, and both after. Practice's pre-submit DTO
 * pins `correct_answer: null` and `explanation: null` in the schema itself
 * (`practice-response-schema.ts`), and R3 re-exports that schema unchanged
 * (`review-schema.ts:263`), but a schema proves the WIRE and this proves the SCREEN.
 *   PLANT: render the explanation pre-submit (in CanonicalPracticePage, alongside the
 *   post-submit block) and watch the pre-submit assertion go red.
 *
 * U3 — the id lives in the URL, so a reload resumes the same item.
 *   PLANT: keep the id in component state only (drop the `useRoute` read in
 *   resume-review.tsx and hold the id in `useState`) and the second mount serves a new
 *   session instead of resuming.
 *
 * These drive the REAL loop, not a mock of it: the whole point of R4 is that review
 * runs practice's component, so a test against a stub would prove nothing.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const routeMock = vi.hoisted(() => ({ sessionId: "rev-sess-001" }));
vi.mock("wouter", () => ({
  useRoute: () => [true, { sessionId: routeMock.sessionId }],
  useLocation: () => ["/review/session/rev-sess-001", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const stateMock = vi.hoisted(() => ({
  value: {
    data: null as Record<string, unknown> | null,
    isLoading: false,
    error: null as unknown,
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => stateMock.value,
}));

vi.mock("@/lib/client-instance", () => ({
  getClientInstanceId: () => "ci-review-test",
}));
vi.mock("@/lib/api-error", () => ({ isApiError: () => false }));

import ResumeReviewPage from "./resume-review";

const SESSION_ID = "rev-sess-001";
/**
 * A create must hand back a DIFFERENT id from the one in the URL. With both the same,
 * "resumed the URL's session" and "created a fresh one" produce identical request
 * URLs, and U3's plant cannot be seen — which is why it was a no-op in CI on 4d5187f.
 */
const CREATED_SESSION_ID = "rev-sess-CREATED";
const ITEM_ID = "rev-item-001";

const CORRECT_EXPLANATION =
  "Subtract 3 from both sides, then divide by 2 to isolate x.";

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

type Calls = { urls: string[]; createCount: number };

/**
 * When true, `/next` returns a payload that CARRIES the reveal — a server that has
 * leaked. R3 does not do this (its DTO pins both fields to `null`, and the A-tests
 * prove it), but the loop must not display them even so: that is the difference
 * between an anti-leak contract and an anti-leak UI, and it is what makes the U2
 * plant ("render the explanation pre-submit") observable.
 */
const LEAK = { enabled: false };

function installFetchMock(): Calls {
  const calls: Calls = { urls: [], createCount: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = asUrl(input);
    calls.urls.push(`${init?.method ?? "GET"} ${url}`);

    if (url === "/api/csrf-token") {
      return jsonResponse({ csrfToken: "csrf-test-token" });
    }
    if (url === "/api/review/sessions" && init?.method === "POST") {
      calls.createCount += 1;
      return jsonResponse({ sessionId: CREATED_SESSION_ID }, 201);
    }
    if (url.includes("/api/review/sessions/") && url.includes("/resume")) {
      return jsonResponse({ sessionId: SESSION_ID, sessionItemId: ITEM_ID });
    }
    if (url.includes("/api/review/sessions/") && url.includes("/next")) {
      // Exactly what R3 serves pre-submit: both reveal fields are null.
      return jsonResponse({
        sessionId: SESSION_ID,
        sessionItemId: ITEM_ID,
        ordinal: 1,
        totalQuestions: 3,
        question: {
          sessionItemId: ITEM_ID,
          questionType: "multiple_choice",
          stem: "Solve 2x + 3 = 7.",
          options: [
            { id: "tok-a", text: "x = 2" },
            { id: "tok-b", text: "x = 5" },
          ],
          correct_answer: LEAK.enabled ? "tok-a" : null,
          explanation: LEAK.enabled ? CORRECT_EXPLANATION : null,
        },
      });
    }
    if (url === "/api/review/answer" && init?.method === "POST") {
      return jsonResponse({
        sessionId: SESSION_ID,
        sessionItemId: ITEM_ID,
        isCorrect: true,
        mode: "multiple_choice",
        correctOptionId: "tok-a",
        explanation: CORRECT_EXPLANATION,
        feedback: "Correct",
        stats: { correct: 1, incorrect: 0, skipped: 0, total: 1, streak: 1 },
      });
    }
    return jsonResponse({ error: `Unexpected URL ${url}` }, 500);
  });
  return calls;
}

function activeSession(): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    section: null,
    mode: "queue",
    state: "active",
    currentOrdinal: 1,
    answeredCount: 0,
    targetQuestionCount: 3,
    readOnly: false,
  };
}

function findOptionButton(text: string): HTMLButtonElement | null {
  for (const el of screen.getAllByText(text)) {
    const btn = el.closest("button");
    if (btn) return btn as HTMLButtonElement;
  }
  return null;
}

describe("review loop — U2 anti-leak, U3 URL resume", () => {
  beforeEach(() => {
    LEAK.enabled = false;
    routeMock.sessionId = SESSION_ID;
    stateMock.value = { data: activeSession(), isLoading: false, error: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("U2: renders no verdict and no explanation before submit (clean payload)", async () => {
    installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    expect(document.body.textContent).not.toContain(CORRECT_EXPLANATION);
    // No verdict before an answer exists, and the pre-submit affordance is still the
    // one that asks for an answer rather than the one that moves on.
    expect(screen.queryByText("Correct")).toBeNull();
    expect(screen.queryByText("Incorrect")).toBeNull();
    expect(screen.getByText("Check Answer")).not.toBeNull();
  });

  it("U2: even a LEAKING /next payload is not displayed before submit", async () => {
    LEAK.enabled = true;
    installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    // The server handed the loop the answer and the explanation. Neither reaches
    // the screen, because the reveal is driven by the ANSWER response alone.
    expect(document.body.textContent).not.toContain(CORRECT_EXPLANATION);
    expect(screen.queryByText("Correct")).toBeNull();
    expect(screen.getByText("Check Answer")).not.toBeNull();
  });

  it("U2: shows the correct answer and explanation after submit", async () => {
    installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    const option = findOptionButton("x = 2");
    expect(option, "option button not found").not.toBeNull();
    await act(async () => {
      option!.click();
    });

    const checkBtn = screen.getByText("Check Answer");
    await act(async () => {
      checkBtn.click();
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain(CORRECT_EXPLANATION);
    });
    expect(screen.getByText("Correct")).not.toBeNull();
  });

  it("U2: the loop only ever calls review endpoints, never practice's", async () => {
    const calls = installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    const practiceCalls = calls.urls.filter((u) => u.includes("/api/practice"));
    expect(
      practiceCalls,
      `leaked to practice: ${practiceCalls.join(", ")}`,
    ).toEqual([]);
    expect(calls.urls.some((u) => u.includes("/api/review/sessions/"))).toBe(
      true,
    );
  });

  it("U3: a reload resumes the same session from the URL and creates no new one", async () => {
    const calls = installFetchMock();

    const first = render(<ResumeReviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });
    first.unmount();

    // A reload is a fresh mount with the same URL and no carried-over state.
    render(<ResumeReviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    /**
     * THE LOAD-BEARING ASSERTION, and why it is phrased this way.
     *
     * `createCount === 0` alone is NOT enough. `useCanonicalPractice` de-duplicates
     * concurrent creates through a MODULE-GLOBAL map (`inflightEnsureSession`,
     * useCanonicalPractice.ts:326) that survives between tests in this file and is
     * cleared 100ms after resolution. With the id removed from the URL, an earlier
     * test's in-flight entry can satisfy this mount without a second POST, so the
     * counter stays 0 and the plant looks harmless. That is a race, and it is what
     * made U3 pass under its own plant in CI on 4d5187f while going red locally.
     *
     * Which session `/next` was asked for cannot be laundered that way: whether the
     * loop creates a session here or reuses a cached promise, the id it gets back is
     * CREATED_SESSION_ID, never the one in the URL.
     */
    const nextCalls = calls.urls.filter((u) => u.includes("/next"));
    expect(nextCalls.length).toBeGreaterThan(0);
    for (const call of nextCalls) {
      expect(
        call,
        "the loop asked for an item on a session the URL did not name",
      ).toContain(`/api/review/sessions/${SESSION_ID}/next`);
      expect(call).not.toContain(CREATED_SESSION_ID);
    }
    expect(
      calls.createCount,
      "a reload must resume, not create a second session",
    ).toBe(0);
  });

  it("U2b: no user-visible 'practice' copy survives on a review session", async () => {
    installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    // Found only by looking at a screenshot: the loop's CHROME said "practice" in
    // three places neither CanonicalPracticePage.tsx nor useCanonicalPractice.ts
    // contains — the shell eyebrow (PracticeShell.tsx:50), the session-guidance card,
    // and a full-length tagging hint sitting beside the word "Review". Pre-build
    // check 1 item 7 missed them by scoping the search to the two files the brief
    // named. They are engine config now, and this keeps them that way.
    const body = document.body.textContent ?? "";
    expect(body).toContain("Review Runner");
    expect(body).not.toContain("Academic Practice Runner");
    expect(body).not.toContain("canonical practice endpoints");
    expect(body).not.toContain("full-length exam mode");
    expect(body.toLowerCase()).not.toContain("practice");
  });

  it("R4.1: the guidance panel states the real rule, verbatim, with no jargon", async () => {
    installFetchMock();
    render(<ResumeReviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Solve 2x + 3 = 7.")).not.toBeNull();
    });

    // Owner copy, R4.1. Asserted EXACTLY rather than by keyword: the previous
    // wording was a plausible-sounding paraphrase that happened to state the rule
    // wrongly, so "contains the word queue" would not have caught it.
    expect(document.body.textContent).toContain(
      "These are questions you missed or skipped. Get one right and it leaves your queue. Miss or skip it and it goes to the back of the line. You can leave anytime; your place is saved.",
    );

    // The two specific defects the production walk found, forbidden by name.
    // ONE correct review answer graduates a question —
    // 20260921000000_review_queue_runtime.sql:392, "ruling 4: one correct review
    // answer graduates" — so any "twice" claim on this screen is false.
    expect(document.body.textContent).not.toContain("twice");
    expect(document.body.textContent).not.toContain("runtime session truth");
    expect(document.body.textContent).not.toContain("unresolved state");
  });

  it("U7 (review half): an abandoned session is never playable", async () => {
    installFetchMock();
    stateMock.value = {
      data: { ...activeSession(), state: "abandoned", readOnly: true },
      isLoading: false,
      error: null,
    };

    render(<ResumeReviewPage />);

    expect(screen.getByTestId("review-session-closed")).not.toBeNull();
    expect(screen.getByText("This session has ended")).not.toBeNull();
    expect(screen.queryByText("Solve 2x + 3 = 7.")).toBeNull();
  });
});
