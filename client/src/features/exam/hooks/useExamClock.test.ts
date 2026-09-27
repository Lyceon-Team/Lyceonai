// @vitest-environment jsdom
/**
 * @spec [Doc-04A_V2.2 §8.2-§8.4; E7b decision log D2] | @implemented [2026-09-25]
 * plain English: expiry is an event — it fires once per server anchor, and a resync
 * (a new server value) re-arms it. The display reads only the injected monotonic clock.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExamClock } from "./useExamClock";

afterEach(() => {
  vi.useRealTimers();
});

describe("useExamClock", () => {
  it("fires onExpire once per anchor, and again only after a resync", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = 0;
    const onExpire = vi.fn();
    const { result } = renderHook(() => useExamClock(1_000, onExpire, () => now));
    expect(result.current.remainingMs).toBe(1_000);
    now = 1_500;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current.remainingMs).toBe(0);
    now = 3_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => result.current.resync(500));
    expect(result.current.remainingMs).toBe(500);
    now = 4_000;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
