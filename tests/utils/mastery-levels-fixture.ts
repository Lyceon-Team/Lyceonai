import type { MasteryLevelLabel } from "../../packages/shared/src/mastery-levels";

/**
 * @spec [owner ruling 2026-08-20 RULE 1 — the six level names] | @implemented [2026-08-20]
 *
 * plain English: the six rows that migration 20260820000000 seeds into
 * `public.mastery_levels`, as a test double. One copy, imported by every suite that
 * needs to stand in for `loadMasteryLevels()`.
 *
 * WHY ONE COPY.
 *   Four suites need these labels. Four inline copies is four places for "Foundations"
 *   to drift from the migration, and a test that asserts against its own drifted copy
 *   passes while production renders something else. If a name changes, it changes here
 *   and in the migration — and `scripts/ci/mastery-levels-gate.sh` is what proves the
 *   migration itself is right, so this file is never the authority, only the stand-in.
 */
export const MASTERY_LEVEL_FIXTURE: readonly MasteryLevelLabel[] = [
  {
    levelKey: "unmeasured",
    level: null,
    displayName: "Not enough answers yet",
  },
  { levelKey: "L0", level: 0, displayName: "Foundations" },
  { levelKey: "L1", level: 1, displayName: "Building" },
  { levelKey: "L2", level: 2, displayName: "Developing" },
  { levelKey: "L3", level: 3, displayName: "Proficient" },
  { levelKey: "L4", level: 4, displayName: "Strong" },
];

/**
 * The same lookup shape `loadMasteryLevels()` resolves to. Throws on an unlabelled
 * level exactly as the real service does — a suite that stubs a level out of the
 * fixture must see the failure, not a silent fallback.
 */
export function masteryLevelLabelsFixture(
  labels: readonly MasteryLevelLabel[] = MASTERY_LEVEL_FIXTURE,
) {
  const byLevel = new Map<number, MasteryLevelLabel>();
  let unmeasured: MasteryLevelLabel | null = null;
  for (const label of labels) {
    if (label.level === null) {
      unmeasured = label;
    } else {
      byLevel.set(label.level, label);
    }
  }
  return {
    forLevel(level: number | null): MasteryLevelLabel {
      if (level === null) {
        if (!unmeasured) {
          throw new Error("mastery_levels_missing_label: unmeasured");
        }
        return unmeasured;
      }
      const found = byLevel.get(level);
      if (!found) {
        throw new Error(
          `mastery_levels_unlabelled_level: no display name for mastery level ${level}`,
        );
      }
      return found;
    },
    all(): readonly MasteryLevelLabel[] {
      return labels;
    },
  };
}
