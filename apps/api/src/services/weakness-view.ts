import { getWeakestSkills } from "./studentMastery";
import { loadMasteryLevels } from "./mastery-levels-read";

export interface BuildWeaknessSkillsViewInput {
  userId: string;
  section?: string;
  limit?: number;
}

/**
 * @spec [Doc 05A §7.4 + AC#20 — mastery_score stripped at serialization; owner ruling
 *   2026-08-20 RULE 1 (the six level names)] | @implemented [2026-08-21]
 * plain English: returns weakest skills as level-only DTOs — the level and its display
 * name, nothing about how the level was reached. The service fetch keeps mastery_score for
 * server-side consumers (adaptiveSelector); this view strips it before client serialization.
 *
 * `tier` is gone with the rest of the four-tier vocabulary; the names come from the
 * `mastery_levels` table rather than from a switch statement here.
 */
export async function buildWeaknessSkillsView(
  input: BuildWeaknessSkillsViewInput,
) {
  // No minAttempts, no failOnError: the evidence bar is the formula's (a non-NULL
  // mastery_score) and query errors always throw. See fetchWeakestSkills.
  const skills = await getWeakestSkills({
    userId: input.userId,
    section: input.section,
    limit: input.limit,
  });

  const labels = await loadMasteryLevels();
  const safeSkills = skills.map((s) => {
    const label = labels.forLevel(s.mastery_level);
    return {
      section: s.section,
      domain: s.domain,
      skill: s.skill,
      levelKey: label.levelKey,
      level: label.level,
      displayName: label.displayName,
    };
  });

  return {
    ok: true as const,
    count: safeSkills.length,
    skills: safeSkills,
  };
}
