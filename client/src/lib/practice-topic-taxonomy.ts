export interface RawPracticeTopicDomainObject {
  domain?: string | null;
  skills?: string[] | null;
}

export type RawPracticeTopicDomain = string | RawPracticeTopicDomainObject;

export interface PracticeTopicDomain {
  domain: string;
  skills: string[];
}

export function normalizePracticeTopicDomains(rawDomains: RawPracticeTopicDomain[] | undefined): PracticeTopicDomain[] {
  if (!Array.isArray(rawDomains)) {
    return [];
  }

  return rawDomains
    .map((entry): PracticeTopicDomain | null => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed ? { domain: trimmed, skills: [] } : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const domain = typeof entry.domain === "string" ? entry.domain.trim() : "";
      if (!domain) {
        return null;
      }

      const skills = Array.isArray(entry.skills)
        ? entry.skills
            .filter((skill): skill is string => typeof skill === "string")
            .map((skill) => skill.trim())
            .filter((skill) => skill.length > 0)
        : [];

      return { domain, skills };
    })
    .filter((entry): entry is PracticeTopicDomain => entry !== null);
}
