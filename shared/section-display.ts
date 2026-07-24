/**
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 * Canonical section-display helpers shared across practice, full-length, and review surfaces.
 * Normalises all known DB/client section representations and fails closed
 * (unknown → R&W label, isMath → false) so unrecognised values never gate calculator access.
 */

const MATH_TOKENS = new Set(["m", "m1", "m2", "math"]);

export function isMathSection(section: string | null | undefined): boolean {
  if (!section) return false;
  return MATH_TOKENS.has(section.trim().toLowerCase());
}

export function sectionDisplayLabel(
  section: string | null | undefined,
): "Math" | "R&W" {
  return isMathSection(section) ? "Math" : "R&W";
}
