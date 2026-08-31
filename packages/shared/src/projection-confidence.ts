import { z } from "zod";

/**
 * @spec [Doc 05C §7.4 score projection; Coding Standards §10 (no "AI confidence" or
 *   vanity metrics on student surfaces); owner ruling 2026-08-20 RULE 9 — strip the
 *   confidence float server-side] | @implemented [2026-08-20]
 *
 * plain English: the projection carries a 0–1 confidence figure. The student never sees
 * that number; they see one of four words. This module owns the mapping, and it runs on
 * the SERVER so the float is banded before serialization rather than after.
 *
 * WHY THE FLOAT MUST NOT CROSS THE WIRE.
 *   It did until now: `/api/progress/projection` emitted `confidence: 0.65` and the
 *   client called `getConfidenceLabel(0.65)`. A number in the payload is a number a
 *   client can render, chart, or compare between students — a precision claim the model
 *   does not support and RULE 9 forbids. Banding server-side means the float is not in
 *   the response to be re-derived from, whatever the client does next.
 *
 * expected outcome: responses carry `confidenceBand: "High" | "Medium" | "Low" |
 * "Very Low"` and no `confidence` key at any depth.
 * trade-offs: the client can no longer sort or interpolate by confidence. That is the
 * point.
 * edge cases: the thresholds are carried over unchanged from the client function this
 * replaces, so no student's displayed band moves as a result of the relocation. A
 * non-finite input THROWS — an unbandable confidence is a broken computation upstream,
 * not a "Very Low" one, and rendering the weakest band would hide it.
 */

export const CONFIDENCE_BANDS = ["High", "Medium", "Low", "Very Low"] as const;

export const confidenceBandSchema = z.enum(CONFIDENCE_BANDS);
export type ConfidenceBand = z.infer<typeof confidenceBandSchema>;

/** Pure and deterministic. Boundaries are inclusive at the lower edge. */
export function confidenceBandFromScore(confidence: number): ConfidenceBand {
  if (!Number.isFinite(confidence)) {
    throw new Error(
      `projection_confidence_not_finite: cannot band confidence=${String(confidence)}`,
    );
  }
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.7) return "Medium";
  if (confidence >= 0.5) return "Low";
  return "Very Low";
}
