import { fetchWeakestSkills } from "./mastery-read";

export interface BuildWeaknessSkillsViewInput {
  userId: string;
  section?: string;
  limit?: number;
  minAttempts?: number;
}

export async function buildWeaknessSkillsView(input: BuildWeaknessSkillsViewInput) {
  const skills = await fetchWeakestSkills({
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
