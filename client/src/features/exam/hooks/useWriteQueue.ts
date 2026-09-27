/**
 * One ordered write queue per module.
 *
 * @spec [Doc-04A_V2.2 §11.2 (answers are idempotent, last write wins); SCL-145
 *        (a workspace PUT replaces the item's whole workspace)]
 *       [E7b decision log D4] | @implemented [2026-09-25]
 *
 * plain English: answers and workspace saves go out ONE AT A TIME, in the order the
 * student made them. Both are last-write-wins on the server, so two in flight could
 * land in the wrong order and store the older choice. `drain()` resolves when every
 * queued write has settled — module submit waits on it.
 */
import { useCallback, useRef } from "react";

export type WriteQueue = {
  enqueue: <T>(write: () => Promise<T>) => Promise<T>;
  drain: () => Promise<void>;
};

export function useWriteQueue(): WriteQueue {
  const tail = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T>(write: () => Promise<T>): Promise<T> => {
    const run = tail.current.then(write, write);
    // The chain continues whatever this write did; the caller sees its own result.
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const drain = useCallback(async (): Promise<void> => {
    // Writes queued while waiting extend the tail; wait until it stops moving.
    let seen: Promise<unknown>;
    do {
      seen = tail.current;
      await seen;
    } while (seen !== tail.current);
  }, []);

  return { enqueue, drain };
}
