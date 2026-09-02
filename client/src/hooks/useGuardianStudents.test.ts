// @vitest-environment jsdom
/**
 * @spec [Doc-01_V8, §35; Coding Standards §7.1 parse at every boundary]
 * @implemented [2026-08-31]
 *
 * plain English: the hook is the single client-side reader of
 * `GET /api/guardian/students`, so it is the boundary. These prove it PARSES
 * rather than asserts — a malformed row is refused here, not rendered.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuardianStudents } from "./useGuardianStudents";

const csrfFetchMock = vi.fn();

vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  );
}

const STUDENT = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@test.com",
  display_name: "Ada",
  created_at: "2026-03-20T12:00:00.000Z",
  has_active_entitlement: false,
};

describe("useGuardianStudents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the parsed students on a well-formed response", async () => {
    csrfFetchMock.mockResolvedValueOnce(jsonResponse({ students: [STUDENT] }));

    const { result } = renderHook(() => useGuardianStudents(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.students).toEqual([STUDENT]);
  });

  /**
   * The defect the parse closes: a renamed column previously reached the
   * dropdown as `undefined`, producing an option with no value that would have
   * been submitted as the chosen student.
   */
  it("REFUSES a response whose id column has been renamed, instead of rendering undefined", async () => {
    const { id: _dropped, ...withoutId } = STUDENT;
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({
        students: [{ ...withoutId, student_user_id: STUDENT.id }],
      }),
    );

    const { result } = renderHook(() => useGuardianStudents(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "Linked students response did not match the contract",
    );
    // The state half: nothing usable is handed to the caller.
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch at all when disabled", () => {
    renderHook(() => useGuardianStudents({ enabled: false }), { wrapper });
    expect(csrfFetchMock).not.toHaveBeenCalled();
  });
});
