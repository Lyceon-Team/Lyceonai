// @vitest-environment jsdom
/**
 * /practice/diagnostic starts (or resumes) the diagnostic and hands over to the session.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 3; Doc-05C §7.4] |
 * @implemented [2026-10-10]
 *
 * plain English: the real page and the real `useDiagnosticStart` hook, with only the network
 * scripted (csrfFetch answers as POST /api/practice/diagnostic/sessions does). Proved: a fresh
 * start and a resume both REPLACE the page with /practice/session/:id after exactly one POST;
 * an already-completed diagnostic goes Home; any other refusal shows the curated copy, never
 * the server's string.
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const csrfFetchMock = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  useLocation: () => ["/practice/diagnostic", navigateMock],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
}));
vi.mock("@/lib/csrf", () => ({ csrfFetch: csrfFetchMock }));

const { default: DiagnosticStart } = await import("./diagnostic-start");

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("DiagnosticStart", () => {
  it("a fresh start replaces the page with the new session after one POST", async () => {
    csrfFetchMock.mockResolvedValue(answer(201, { sessionId: "sess-new" }));
    render(<DiagnosticStart />);
    expect(screen.getByTestId("diagnostic-start-loading")).toBeInTheDocument();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/practice/session/sess-new", {
        replace: true,
      }),
    );
    expect(csrfFetchMock).toHaveBeenCalledTimes(1);
    expect(csrfFetchMock.mock.calls[0]?.[0]).toBe(
      "/api/practice/diagnostic/sessions",
    );
  });

  it("a diagnostic in progress is resumed, not duplicated", async () => {
    csrfFetchMock.mockResolvedValue(
      answer(409, {
        error: "diagnostic_session_active",
        existingSessionId: "sess-open",
      }),
    );
    render(<DiagnosticStart />);
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/practice/session/sess-open", {
        replace: true,
      }),
    );
    expect(csrfFetchMock).toHaveBeenCalledTimes(1);
  });

  it("a completed diagnostic goes Home", async () => {
    csrfFetchMock.mockResolvedValue(
      answer(409, { error: "diagnostic_already_completed" }),
    );
    render(<DiagnosticStart />);
    const redirect = await screen.findByTestId("redirect");
    expect(redirect.getAttribute("data-to")).toBe("/dashboard");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("any other refusal shows curated copy and a way Home, never the server string", async () => {
    csrfFetchMock.mockResolvedValue(
      answer(500, { error: "internal", message: "relation does not exist" }),
    );
    render(<DiagnosticStart />);
    const notice = await screen.findByTestId("diagnostic-start-error");
    expect(notice.textContent).toContain(
      "Something went wrong starting the diagnostic.",
    );
    expect(notice.textContent).not.toContain("relation does not exist");
    screen.getByRole("button", { name: "Go to Home" }).click();
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });
});
