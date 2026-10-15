/**
 * @spec [lyceon-coding-standards §3.6 Result types for expected failures] | @implemented [2026-09-03]
 *
 * plain English: the one Result shape for operations that can fail in expected ways.
 * `throw` stays reserved for programming errors and infrastructure faults. Defined once here
 * so no module forks its own `{ ok, value } | { ok, error }` union.
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * @spec [lyceon-coding-standards §3.6, §13; owner brief 2026-10-13 "first-run activation fixes"
 *       item 2 ("parallelize independent reads ... without changing behavior")]
 * | @implemented [2026-10-13]
 *
 * plain English: a promise's outcome as a `Result`, for a read STARTED early so it can run in
 * parallel with other work, and AWAITED later at the point the sequential code used to make it.
 * Without this, a read started early whose caller then returns on another branch would reject
 * with nobody listening (an unhandled rejection). The caller decides what a failure means where
 * it awaits: rethrow `error` to keep the sequential code's behaviour exactly. Not a catch-all —
 * nothing is swallowed here; the error is carried, not discarded.
 */
export function settle<T>(
  promise: PromiseLike<T>,
): Promise<Result<T, unknown>> {
  return Promise.resolve(promise).then(
    (value): Result<T, unknown> => ({ ok: true, value }),
    (error: unknown): Result<T, unknown> => ({ ok: false, error }),
  );
}
