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
