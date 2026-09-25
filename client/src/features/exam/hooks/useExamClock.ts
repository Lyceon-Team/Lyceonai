/**
 * The exam clock hook: a server anchor plus the monotonic clock.
 *
 * @spec [Doc-04A_V2.2 §8.2, §8.3; E7b decision log D2] | @implemented [2026-09-25]
 *
 * plain English: `resync(remaining_ms)` is called with every server value; the hook
 * re-renders four times a second from `performance.now()` and calls `onExpire` once
 * when the display reaches zero. Wall time (`Date`) is never read.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { anchorClock, remainingAt, type ClockAnchor } from "../lib/countdown";

export type ExamClock = {
  remainingMs: number;
  resync: (remainingMs: number) => void;
};

const TICK_MS = 250;

export function useExamClock(
  initialRemainingMs: number,
  onExpire: () => void,
  monotonicNow: () => number = () => performance.now(),
): ExamClock {
  const [anchor, setAnchor] = useState<ClockAnchor>(() =>
    anchorClock(initialRemainingMs, monotonicNow()),
  );
  const [now, setNow] = useState(() => monotonicNow());
  const expiredFor = useRef<ClockAnchor | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const nowRef = useRef(monotonicNow);
  nowRef.current = monotonicNow;

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowRef.current()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = remainingAt(anchor, now);

  // Expiry is an EVENT (tell the server), not derived state: fire once per anchor.
  useEffect(() => {
    if (remainingMs === 0 && expiredFor.current !== anchor) {
      expiredFor.current = anchor;
      onExpireRef.current();
    }
  }, [remainingMs, anchor]);

  const resync = useCallback((ms: number) => {
    const at = nowRef.current();
    setAnchor(anchorClock(ms, at));
    setNow(at);
  }, []);

  return { remainingMs, resync };
}
