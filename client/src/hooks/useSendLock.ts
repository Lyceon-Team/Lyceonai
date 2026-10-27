/**
 * @spec [owner brief "P2 Revised Again" (Karl, 2026-10-26) §3.1 and its rulings ("Client: a
 *        synchronous in-flight lock in the shared send path, refusing a second send before React
 *        re-renders. Covers /chat, every dock and the runner panel"); Doc 03B §20.5 (one
 *        client_turn_id per LISA message)] | @implemented [2026-10-26]
 *
 * plain English: one send at a time, decided synchronously. React state cannot do it: a burst of
 * send events delivered in one task (three Enter keydowns within 3 ms reproduced it in Chromium,
 * on a production build, before and after H1) all run before React re-renders, so each copy reads
 * the same draft and the same idle turn state and becomes its own turn with its own
 * client_turn_id. A ref is read and written in the same tick, so the second and later calls see
 * the lock and are refused.
 *
 * `acquire()` returns a release function, or `null` when a send is already in flight. Releasing
 * is idempotent and only releases its own acquisition, so a late release from an earlier send
 * (one the caller already gave up on, e.g. after the client timeout) can never unlock a newer one.
 * `releaseAll()` drops any hold, for a caller that resets (navigating to another thread).
 *
 * trade-offs: a refused call does nothing at all: no state change, no request, no error. The
 * composer is already showing the turn in flight, which is the only thing the student needs.
 */
import { useCallback, useMemo, useRef } from "react";

export type SendLock = {
  acquire: () => (() => void) | null;
  releaseAll: () => void;
};

export function useSendLock(): SendLock {
  const holder = useRef<symbol | null>(null);

  const acquire = useCallback((): (() => void) | null => {
    if (holder.current !== null) return null;
    const token = Symbol("send");
    holder.current = token;
    return () => {
      if (holder.current === token) holder.current = null;
    };
  }, []);

  const releaseAll = useCallback((): void => {
    holder.current = null;
  }, []);

  // Stable across renders, so callers' callbacks that list it keep their identity.
  return useMemo(() => ({ acquire, releaseAll }), [acquire, releaseAll]);
}
