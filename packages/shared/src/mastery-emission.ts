/**
 * @spec [Doc-05A_V1.0 §4.1 mastery seam; Doc-01A_V1.0 §10–§13 structured logging,
 *        §19.1 migration path steps (1) and (5)]
 * | @implemented [2026-08-16]
 *
 * plain English: the single vocabulary for mastery-emission failures. Every call site
 * that can fail to emit a mastery event reports one of these codes, so one log filter
 * covers the whole system rather than one filter per call site.
 *
 * Why this exists: mastery emission failed 100% of the time for seven weeks and nobody
 * saw it. Two reasons, both addressed here. Full-length and review reported through
 * `console.warn`, which bypasses redaction and the Cloud Logging severity mapping
 * entirely. And the practice/diagnostic sites that DID use the structured logger called
 * it with the wrong arity — `logger.error(message, data)` against a
 * `(component, operation, message, error?, data?)` signature — so the data object landed
 * in the `event` field. An `event` holding an object cannot be matched by any
 * log-based filter, which is precisely what an alert would need to key on.
 *
 * expected outcome: `event` is always one of MASTERY_EMISSION_EVENT's string values;
 * `data.code` is always one of MasteryEmissionFailureCode. Both are stable across
 * releases and safe to key alerts on.
 *
 * trade-offs: codes are additive-only. Renaming one silently breaks any alert keyed on
 * it, so treat this list the way a wire contract is treated — add, never rename.
 *
 * edge cases: MASTERY_EMIT_NO_ROW and MASTERY_EMIT_STUDENT_MISMATCH are not
 * hypothetical. apply_mastery_event returns a student_skill_mastery composite, so a
 * successful call always yields a row for the requested student; anything else means
 * the RPC did not do what the caller believes it did, and must not be reported as
 * success.
 */

/** Stable `operation` values for the structured logger's `event` field. */
export const MASTERY_EMISSION_EVENT = {
  /** Emission was attempted and did not succeed. */
  FAILED: "mastery_emission_failed",
  /** Emission was not attempted because required inputs were absent or invalid. */
  SKIPPED: "mastery_emission_skipped",
} as const;

export type MasteryEmissionEvent =
  (typeof MASTERY_EMISSION_EVENT)[keyof typeof MASTERY_EMISSION_EVENT];

/** Stable machine-readable failure codes, emitted as `data.code`. */
export const MASTERY_EMISSION_FAILURE_CODE = {
  /** The RPC returned a PostgREST/Postgres error. `data.dbError` carries the message. */
  RPC_ERROR: "MASTERY_EMIT_RPC_ERROR",
  /** The RPC reported no error but returned no row — success cannot be inferred. */
  NO_ROW: "MASTERY_EMIT_NO_ROW",
  /** The RPC returned a row belonging to a different student. */
  STUDENT_MISMATCH: "MASTERY_EMIT_STUDENT_MISMATCH",
  /** The call threw rather than returning a result. */
  THREW: "MASTERY_EMIT_THREW",
  /** Bridge-level input validation rejected the event before the RPC. */
  INPUT_INVALID: "MASTERY_EMIT_INPUT_INVALID",
  /** section / domain / skill absent on the source row — nothing to attribute. */
  MISSING_METADATA: "MASTERY_EMIT_MISSING_METADATA",
  /** difficulty could not be resolved to the 1|2|3 bucket the RPC requires. */
  INVALID_DIFFICULTY: "MASTERY_EMIT_INVALID_DIFFICULTY",
} as const;

export type MasteryEmissionFailureCode =
  (typeof MASTERY_EMISSION_FAILURE_CODE)[keyof typeof MASTERY_EMISSION_FAILURE_CODE];

/** Logger `component` for every mastery-emission log line. */
export const MASTERY_EMISSION_COMPONENT = "MASTERY_EMISSION";
