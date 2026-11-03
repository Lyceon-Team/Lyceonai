/**
 * @spec [owner brief H4 "database cheap wins" (Karl, 2026-11-02): "the repeated `questions`
 *        reads"] | @implemented [2026-11-02]
 *
 * plain English: a per-request memo for one LISA turn. POST /api/tutor/messages runs inside
 * `withTurnMemo`, and reads that are identical within a turn keep their in-flight promise here so
 * every site shares one round trip (today: a question's metadata, `readQuestionMeta` in
 * server/services/tutor-context.ts, read up to eight times a turn before H4).
 *
 * expected outcome: the memo lives and dies with the request (AsyncLocalStorage), so nothing is
 * shared across turns or students; outside a turn `turnMemo()` is undefined and callers read
 * directly.
 *
 * trade-offs: kept apart from tutor-context.ts so the route's wrapper does not depend on a
 * module many tests replace wholesale; it holds no data access of its own.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { QuestionMetaRead } from "../services/tutor-context";

export type TurnMemo = {
  /** question row id → its metadata read (successful reads only; a failure is dropped). */
  questionMeta: Map<string, Promise<QuestionMetaRead>>;
};

const store = new AsyncLocalStorage<TurnMemo>();

export function withTurnMemo<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ questionMeta: new Map() }, fn);
}

export function turnMemo(): TurnMemo | undefined {
  return store.getStore();
}
