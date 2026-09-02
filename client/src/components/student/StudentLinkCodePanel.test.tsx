// @vitest-environment jsdom
/**
 * @spec [SCL-080] | @implemented [2026-09-01]
 *
 * plain English: proves the panel shows the code the server sent, that regenerating replaces
 * it, and — the one that matters for consent — that the sentence naming what sharing grants
 * is on screen beside the code, not behind anything.
 *
 * MOCK BOUNDARY. `csrfFetch` is replaced; nothing else is. The Zod parse, the expiry
 * arithmetic and the rendering all run for real, so a renamed response field fails here.
 * This is a React component test, not a data-path test: it does not touch the guardian
 * schema-truth gate's RULE A, which governs guardian test files that mock the Supabase QUERY
 * layer with no Postgres behind it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const csrfFetchMock = vi.fn();
vi.mock("@/lib/csrf", () => ({ csrfFetch: (...a: unknown[]) => csrfFetchMock(...a) }));

import { StudentLinkCodePanel } from "./StudentLinkCodePanel";

const STUDENT = "11111111-1111-4111-8111-111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Twelve hours out, so the floor is unambiguous rather than sitting on a boundary. */
function expiryHoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentLinkCodePanel studentId={STUDENT} />
    </QueryClientProvider>,
  );
}

describe("student link code panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the code and the expiry the SERVER computed", async () => {
    csrfFetchMock.mockResolvedValue(
      jsonResponse({ data: { code: "ABC234", expiresAt: expiryHoursFromNow(12) } }),
    );
    renderPanel();

    expect(await screen.findByTestId("student-link-code-value")).toHaveTextContent("ABC234");
    // 12h, floored — derived from the server's timestamp, never from a client-held TTL.
    expect(screen.getByTestId("student-link-code-expiry")).toHaveTextContent(/Expires in 1[12]h/);
  });

  /**
   * The consent claim. Sharing the code IS the consent under SCL-080, so what it grants must
   * be legible at the moment of sharing — there is no later confirmation screen to carry it.
   */
  it("states what sharing the code grants, beside the code", async () => {
    csrfFetchMock.mockResolvedValue(
      jsonResponse({ data: { code: "ABC234", expiresAt: expiryHoursFromNow(12) } }),
    );
    renderPanel();

    const consequence = await screen.findByTestId("student-link-code-consequence");
    expect(consequence).toHaveTextContent(/becomes your guardian/i);
    expect(consequence).toHaveTextContent(/cannot see your tutor conversations/i);
    expect(consequence).toHaveTextContent(/remove them at any time/i);
    expect(consequence).toHaveTextContent(/stops working once it has been used/i);
  });

  it("replaces the code on regenerate", async () => {
    csrfFetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { code: "ABC234", expiresAt: expiryHoursFromNow(12) } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { code: "XYZ789", expiresAt: expiryHoursFromNow(24) } }),
      );
    renderPanel();

    expect(await screen.findByTestId("student-link-code-value")).toHaveTextContent("ABC234");
    fireEvent.click(screen.getByTestId("student-link-code-regenerate"));

    await waitFor(() =>
      expect(screen.getByTestId("student-link-code-value")).toHaveTextContent("XYZ789"),
    );
    // The second call is the regenerate POST, not a refetch of the same GET.
    expect(csrfFetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  /**
   * A malformed payload must fail loudly at the boundary. Rendering `undefined` into the one
   * string the student is about to read aloud is the failure this parse exists to stop.
   */
  it("surfaces an error rather than rendering a malformed code", async () => {
    csrfFetchMock.mockResolvedValue(
      jsonResponse({ data: { code: "lowercase!", expiresAt: null } }),
    );
    renderPanel();

    expect(await screen.findByTestId("student-link-code-error")).toBeInTheDocument();
    expect(screen.queryByTestId("student-link-code-value")).toBeNull();
  });
});
