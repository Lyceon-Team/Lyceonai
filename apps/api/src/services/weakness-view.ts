import { getWeakestSkills } from "./studentMastery";
import { masteryTierFromLevel } from "../../../../packages/shared/src/mastery";

export interface BuildWeaknessSkillsViewInput {
  userId: string;
  section?: string;
  limit?: number;
}

/**
 * @spec [Doc 05A §7.4 + AC#20 — tier-only weakness view, mastery_score stripped at serialization]
 * | @implemented [2026-06-23]
 * plain English: returns weakest skills as tier-only DTOs. The service fetch keeps mastery_score
 * for server-side consumers (adaptiveSelector); this view strips it before client serialization.
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

  const safeSkills = skills.map((s) => ({
    section: s.section,
    domain: s.domain,
    skill: s.skill,
    tier: masteryTierFromLevel(s.mastery_level),
    masteryLevel: s.mastery_level,
  }));

  return {
    ok: true as const,
    count: safeSkills.length,
    skills: safeSkills,
  };
}
