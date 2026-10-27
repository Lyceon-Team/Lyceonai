// @vitest-environment jsdom
/**
 * @spec [owner brief "P2 Revised Again" (Karl, 2026-10-26) §3.1 and rulings (a synchronous
 *        in-flight lock in the shared send path)] | @implemented [2026-10-26]
 *
 * plain English: the lock itself (one holder; a release frees only its own hold; releaseAll), and
 * the one release no contract test reaches: when the 35 s client timeout fails a turn whose
 * request never answers, the lock is let go, so "Try again" sends again with the same
 * client_turn_id, as it did before the lock.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSendLock } from "./useSendLock";

const mutateAsync = vi.fn();
vi.mock("@/hooks/tutor-client", () => ({
  useSendMessage: () => ({ mutateAsync, reset: vi.fn(), error: null }),
  useResumeConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useTurnTimingReport: () => ({ mutate: vi.fn() }),
}));

import { CLIENT_TIMEOUT_MS, useTutorTurn } from "./useTutorTurn";

describe("useSendLock", () => {
  it("one holder at a time; a second acquire is refused until the first releases", () => {
    const { result } = renderHook(() => useSendLock());
    const release = result.current.acquire();
    expect(release).not.toBeNull();
    expect(result.current.acquire()).toBeNull();
    release?.();
    expect(result.current.acquire()).not.toBeNull();
  });

  it("a stale release cannot free a newer hold; releaseAll frees any", () => {
    const { result } = renderHook(() => useSendLock());
    const first = result.current.acquire();
    result.current.releaseAll();
    const second = result.current.acquire();
    expect(second).not.toBeNull();
    first?.();
    expect(result.current.acquire()).toBeNull();
    second?.();
    expect(result.current.acquire()).not.toBeNull();
  });

  it("is the same object across renders", () => {
    const { result, rerender } = renderHook(() => useSendLock());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});

describe("useTutorTurn: the client timeout lets go of the lock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mutateAsync.mockReset();
    // The request never answers.
    mutateAsync.mockImplementation(() => new Promise(() => undefined));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("after the timeout, Try again sends again with the same client_turn_id", async () => {
    const { result } = renderHook(() =>
      useTutorTurn("00000000-0000-4000-8000-000000000001", [], undefined),
    );
    await act(async () => {
      void result.current.send("hello");
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // Still in flight: a second send is refused.
    await act(async () => {
      void result.current.send("hello again");
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(CLIENT_TIMEOUT_MS);
    });
    expect(result.current.turnState.kind).toBe("failed");

    await act(async () => {
      result.current.retry();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    const first = mutateAsync.mock.calls[0]?.[0] as { client_turn_id: string };
    const second = mutateAsync.mock.calls[1]?.[0] as { client_turn_id: string };
    expect(second.client_turn_id).toBe(first.client_turn_id);
  });
});
