/**
 * @spec [Doc-03D_V1.2 §7.1 — ordinal mastery bands]
 * @implemented 2026-08-17
 *
 * plain English: Converts a numeric mastery score (0-1 scale) to an ordinal
 * band label. The model receives ONLY the ordinal band — never the numeric
 * score. This is the single chokepoint for the ordinal-only rule.
 *
 * expected outcome: masteryScoreToBand(0.3) → "needs_work";
 * masteryScoreToBand(null) → null (no mastery data = no band).
 *
 * trade-offs: Band thresholds are hardcoded per the mastery tier definitions
 * in the spec. If those change, this is the one place to update. The function
 * is deterministic, pure, and testable in isolation.
 */

import type { MasteryBand } from "./types.js";

/**
 * Maps a numeric mastery_level (0-4 integer from the DB / wire schema)
 * to the ordinal band the model is allowed to see.
 *
 * mastery_level values per the spec:
 *   0 = not started → needs_work
 *   1 = needs_work   → needs_work
 *   2 = developing   → developing
 *   3 = proficient   → proficient
 *   4 = strong       → strong
 *
 * Returns null if the input is null (no mastery data available).
 *
 * @spec [Doc-03D_V1.2 §7.1]
 */
export function masteryLevelToBand(
  masteryLevel: number | null,
): MasteryBand | null {
  if (masteryLevel === null) {
    return null;
  }
  switch (masteryLevel) {
    case 0:
    case 1:
      return "needs_work";
    case 2:
      return "developing";
    case 3:
      return "proficient";
    case 4:
      return "strong";
    default:
      // Defensive: unknown level treated as needs_work. This should not
      // happen if the wire schema validates correctly.
      return "needs_work";
  }
}
