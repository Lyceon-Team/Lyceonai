// @vitest-environment jsdom
/**
 * U7 (the client-side half of "abandoned sessions appear in no open list").
 *
 * @spec [ruling 17; brief R4 §2.5, U7] | @implemented [2026-09-22]
 *
 * PLANT: make `dropClosedSessions` in `useReview.ts` return its input unchanged and
 * the first test below goes red — the abandoned row reaches the parse, which rejects
 * the whole payload because R3 pins `status` to `created | active`.
 *
 * WHY A CLIENT FILTER AT ALL, when `review-canonical.ts:1443` already applies
 * `.in("status", [...OPEN_STATUSES])`. Pre-build check 3 found that practice's
 * equivalent surface (`practice.tsx:332` via `useActiveSessions.ts:55`) has NO client
 * backstop: it renders whatever the endpoint returns, so a single widened `.in(...)`
 * would put a live "Continue" button on an abandoned session. Ruling 17 is a product
 * invariant, not a query detail, and an invariant with one enforcement point is one
 * edit away from being gone. The cost here is one line.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ select }: { select?: (raw: unknown) => unknown }) => {
    const raw = queryMock.result.raw;
    return {
      data: raw === undefined ? undefined : select ? select(raw) : raw,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { id: "u-1" }, authLoading: false }),
}));
vi.mock("@/lib/csrf", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/client-instance", () => ({
  getClientInstanceId: () => "ci-test",
}));

import { useActiveReviewSessions, browserTimeZone } from "./useReview";

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "s-1",
    section: "M",
    mode: "queue",
    status: "active",
    created_at: "2026-09-18T02:30:00.000Z",
    target_question_count: 5,
    total_items: 5,
    answered_items: 1,
    ...over,
  };
}

describe("useActiveReviewSessions — ruling 17", () => {
  beforeEach(() => {
    queryMock.result = {};
  });

  it("U7: never surfaces an abandoned session, even if the endpoint returns one", () => {
    queryMock.result = {
      raw: {
        sessions: [
          row({ id: "open-created", status: "created" }),
          row({ id: "gone-abandoned", status: "abandoned" }),
          row({ id: "open-active", status: "active" }),
          row({ id: "done-completed", status: "completed" }),
        ],
        maxConcurrentSessions: 5,
      },
    };

    const { result } = renderHook(() => useActiveReviewSessions());

    // The two closed rows are dropped, and the two open ones survive in order.
    expect(result.current.sessions.map((s) => s.id)).toEqual([
      "open-created",
      "open-active",
    ]);
  });

  it("U7: dropping a closed row does not take the rest of the list with it", () => {
    // The whole reason the filter runs before the parse: R3's schema would otherwise
    // reject the entire payload over one abandoned row and the student would see
    // nothing rather than their open sessions.
    queryMock.result = {
      raw: {
        sessions: [row({ id: "gone", status: "abandoned" })],
        maxConcurrentSessions: 5,
      },
    };
    const { result } = renderHook(() => useActiveReviewSessions());
    expect(result.current.sessions).toEqual([]);
    expect(result.current.maxConcurrentSessions).toBe(5);
  });

  it("U7: reads created_at — the field the server actually sends", () => {
    queryMock.result = {
      raw: { sessions: [row({})], maxConcurrentSessions: 5 },
    };
    const { result } = renderHook(() => useActiveReviewSessions());
    // `started_at` is the field practice's hand-written type invented; review's schema
    // pins `created_at` (review-schema.ts:274), and parsing enforces it.
    expect(result.current.sessions[0]?.created_at).toBe(
      "2026-09-18T02:30:00.000Z",
    );
  });

  it("refuses a payload whose shape drifted, rather than rendering undefined", () => {
    queryMock.result = {
      raw: { sessions: [{ id: "s-1" }], maxConcurrentSessions: 5 },
    };
    expect(() => renderHook(() => useActiveReviewSessions())).toThrow();
  });

  it("is empty, not broken, before the first response arrives", () => {
    queryMock.result = {};
    const { result } = renderHook(() => useActiveReviewSessions());
    expect(result.current.sessions).toEqual([]);
    expect(result.current.maxConcurrentSessions).toBeNull();
  });
});

describe("browserTimeZone", () => {
  it("returns an IANA zone or null, never throws", () => {
    const tz = browserTimeZone();
    expect(tz === null || typeof tz === "string").toBe(true);
  });
});
