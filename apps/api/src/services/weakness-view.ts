import { getWeakestSkills } from "./studentMastery";

export interface BuildWeaknessSkillsViewInput {
  userId: string;
  section?: string;
  limit?: number;
  minAttempts?: number;
}

export async function buildWeaknessSkillsView(input: BuildWeaknessSkillsViewInput) {
  const skills = await getWeakestSkills({
    userId: input.userId,
    section: input.section,
    limit: input.limit,
    minAttempts: input.minAttempts,
    failOnError: true,
  });

  return {
    ok: true as const,
    count: skills.length,
    skills,
  };
}
