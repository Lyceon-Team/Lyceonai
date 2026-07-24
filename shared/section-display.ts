/**
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 * Canonical section-display helpers shared across practice, full-length, and review surfaces.
 * Normalises all known DB/client section representations and fails closed:
 * isMath → false for unknown (no calculator on unknown — safe),
 * sectionDisplayLabel → null for unknown (never default to a named section).
 */

const MATH_TOKENS = new Set(["m", "m1", "m2", "math"]);
const RW_TOKENS = new Set(["rw", "reading_writing", "reading & writing"]);

export function isMathSection(section: string | null | undefined): boolean {
  if (!section) return false;
  return MATH_TOKENS.has(section.trim().toLowerCase());
}

export function isRwSection(section: string | null | undefined): boolean {
  if (!section) return false;
  return RW_TOKENS.has(section.trim().toLowerCase());
}

export function sectionDisplayLabel(
  section: string | null | undefined,
): "Math" | "R&W" | null {
  if (isMathSection(section)) return "Math";
  if (isRwSection(section)) return "R&W";
  return null;
}
