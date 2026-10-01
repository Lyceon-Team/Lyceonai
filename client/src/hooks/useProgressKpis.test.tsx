// @vitest-environment jsdom
/**
 * @spec [student-ui register UI-14; owner ruling 2026-10-01 (Brief 10, dashboard KPI polling)]
 *   | @implemented [2026-10-01] |
 * plain English: the KPI read does not poll. Idle, it is fetched once and never again; when the
 * window regains focus after the freshness window it refetches; when a session completes
 * (`invalidateProgressKpis`) it refetches at once. The client here carries the app's own
 * defaults (`staleTime: Infinity`, no focus refetch, no interval) and the app's real query
 * function, so what is proven is the per-query freshness `useProgressKpis` applies on top.
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQueryFn } from "@/lib/queryClient";
import { QUERY_FRESHNESS } from "@/lib/query-freshness";
import {
  invalidateProgressKpis,
  PROGRESS_KPIS_QUERY_KEY,
  useProgressKpis,
} from "./useProgressKpis";

let kpiFetches = 0;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        refetchInterval: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        retry: false,
      },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  kpiFetches = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("/api/progress/kpis")) {
      kpiFetches += 1;
      return new Response(
        JSON.stringify({ week: { questionsSolved: kpiFetches } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response("{}", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

describe("useProgressKpis: no polling (owner ruling 2026-10-01)", () => {
  it("fetches once and not again while idle for five minutes", async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => useProgressKpis<{ week: { questionsSolved: number } }>(true),
      {
        wrapper: wrapperFor(client),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(kpiFetches).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(kpiFetches).toBe(1);
  });

  it("refetches when the window regains focus after the freshness window", async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => useProgressKpis<{ week: { questionsSolved: number } }>(true),
      {
        wrapper: wrapperFor(client),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(kpiFetches).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUERY_FRESHNESS.kpis.staleTime + 1_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      // React Query schedules the refetch and its notification on a 0 ms timer.
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(kpiFetches).toBe(2);
    // The refetched body is what the cache now holds (the hook's next render reads it).
    expect(client.getQueryData(PROGRESS_KPIS_QUERY_KEY)).toEqual({
      week: { questionsSolved: 2 },
    });
  });

  it("refetches at once when a session completes (invalidateProgressKpis)", async () => {
    const client = makeClient();
    const { result } = renderHook(
      () => useProgressKpis<{ week: { questionsSolved: number } }>(true),
      {
        wrapper: wrapperFor(client),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(kpiFetches).toBe(1);

    await act(async () => {
      await invalidateProgressKpis(client);
    });
    expect(kpiFetches).toBe(2);
  });
});
