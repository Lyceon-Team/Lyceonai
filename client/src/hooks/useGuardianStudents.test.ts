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
import { makeLinkedStudent } from "../../../packages/shared/src/__fixtures__/linked-student";

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

// G1-10 (audit G-AUD-15e): built by the shared, schema-parsed factory, not typed out by hand.
const STUDENT = makeLinkedStudent({ displayName: "Ada" });

describe("useGuardianStudents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * REWRITTEN (G1-10). This used to mock `{ students: [STUDENT] }` and assert the hook
   * returned `[STUDENT]` — the mock's own value, which a hook that skipped the parse
   * entirely would also return. Now the response is shaped like the route's real envelope
   * (`res.json({ students, requestId })`, server/routes/guardian-routes.ts) with an internal
   * column riding along, as it would if the route ever spread a wider row. The hook must
   * hand back the CONTRACT shape and nothing else.
   *
   * MUTATION THAT REDS IT: replace the `safeParse` in useGuardianStudents with a cast
   * (`return (await res.json()) as GuardianStudentsResponse`).
   */
  it("returns the contract shape: a column the contract does not name is dropped at the boundary", async () => {
    csrfFetchMock.mockResolvedValueOnce(
      jsonResponse({
        students: [{ ...STUDENT, mastery_score: 0.42 }],
        requestId: "req-1",
      }),
    );

    const { result } = renderHook(() => useGuardianStudents(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.students).toHaveLength(1);
    expect(result.current.data?.students[0]).toEqual(STUDENT);
    expect(result.current.data?.students[0]).not.toHaveProperty(
      "mastery_score",
    );
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
