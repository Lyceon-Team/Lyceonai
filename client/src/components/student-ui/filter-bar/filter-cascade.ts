import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import {
  normalizePracticeDifficulties,
  type PracticeDifficulty,
} from "@/lib/practice-filters";

/**
 * @spec [student-UI register §2 "Filters", §6 UI-43; DESIGN.md §3 "Filter bar", §4 Practice;
 *       register §2 "Content and data rules" (students never see bank counts); OQ-22 owner
 *       ruling (Karl) 2026-10-02: sessions named by `criteria {sections, domains, skills,
 *       difficulties}`] | @implemented [2026-10-03]
 *
 * plain English: the cascade rules of the shared Practice/Review filter bar, as pure functions
 * with no React and no IO. The taxonomy is the canonical `GET /api/practice/topics` body
 * (`PracticeTopicsResponse`, built from `canonical_skill_catalog`), passed in as data. Every
 * operation returns a NEW value that is already normalised, so the bar can never hold a choice
 * that no longer applies.
 *
 * The rules, each with its source:
 *   1. Domain options depend on Section (register §2 "Domain options depend on Section").
 *      No section chosen (`sections: []`) means "no constraint" (OQ-22: an empty criterion is
 *      an empty array), so every domain is offered.
 *   2. Skill options depend on the chosen domains (register §2 "Skill options depend on the
 *      chosen domains"). With NO domain chosen, every skill of the offered domains is offered:
 *      prototype Practice.dc.html builds the skill pool from all of the section's domains until
 *      one is picked ("All skills in this section. Pick a domain first to shorten the list."),
 *      and the shipped practice.tsx `visibleSkills` does the same.
 *   3. Changing Section drops domains and skills that no longer apply (register §2 "Changing
 *      Section clears choices that no longer apply").
 *   4. Removing a domain drops that domain's skills (UI-43 brief), then re-applies rule 2, so
 *      a skill chosen before any domain was picked is dropped once the chosen domains no
 *      longer contain it (prototype `setDomains`: skills are filtered to the allowed pool).
 *   5. "Clear all" empties domains, skills and difficulties and keeps the Section (prototype
 *      `clearAll`; the Section chip is not removable, the switch always has a choice).
 *   6. Difficulty is independent of Section, domains and skills.
 *
 * expected outcome: deterministic option and value order (taxonomy order for sections, domains
 * and skills; easy, medium, hard for difficulty), so the same choices always serialise the same
 * way; every op is idempotent where its name says it is (select, remove, clear, normalise).
 * trade-offs: the value type is the four OQ-22 keys with plain string arrays. It must converge
 * on `sessionCriteriaSchema` (packages/shared/src/session-criteria.ts, PR #1064) when that
 * lands; it is not copied here. Labels are the taxonomy's own names (the catalog stores display
 * names, e.g. "Linear Equations in One Variable", not codes), so no label map is needed.
 * edge cases: values the taxonomy does not know (a stale URL, a renamed skill) are dropped by
 * normalisation; a skill name listed under two domains is offered once, at its first position.
 * Nothing here produces or reads a count.
 */

type FilterSectionCode = PracticeTopicsResponse["sections"][number]["section"];

export type FilterBarValue = {
  sections: FilterSectionCode[];
  domains: string[];
  skills: string[];
  difficulties: PracticeDifficulty[];
};

export type FilterOption<T extends string = string> = {
  value: T;
  label: string;
};

type FilterChipKind = "domain" | "skill" | "difficulty";

export type FilterChip = {
  kind: FilterChipKind;
  value: string;
  label: string;
};

export const EMPTY_FILTER: FilterBarValue = {
  sections: [],
  domains: [],
  skills: [],
  difficulties: [],
};

const DIFFICULTY_OPTIONS: ReadonlyArray<FilterOption<PracticeDifficulty>> = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

type TopicSection = PracticeTopicsResponse["sections"][number];

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (!out.includes(v)) out.push(v);
  return out;
}

/** The taxonomy's sections that `sections` selects; empty selection selects all of them. */
function selectedSections(
  taxonomy: PracticeTopicsResponse,
  sections: readonly FilterSectionCode[],
): TopicSection[] {
  if (sections.length === 0) return taxonomy.sections;
  return taxonomy.sections.filter((s) => sections.includes(s.section));
}

/** Section options in taxonomy order, labelled by the taxonomy's `label`. */
export function sectionOptions(
  taxonomy: PracticeTopicsResponse,
): Array<FilterOption<FilterSectionCode>> {
  return taxonomy.sections.map((s) => ({ value: s.section, label: s.label }));
}

/** Rule 1: domains of the chosen section(s), in taxonomy order. */
export function domainOptions(
  taxonomy: PracticeTopicsResponse,
  sections: readonly FilterSectionCode[],
): FilterOption[] {
  const names = unique(
    selectedSections(taxonomy, sections).flatMap((s) =>
      s.domains.map((d) => d.domain),
    ),
  );
  return names.map((name) => ({ value: name, label: name }));
}

/** Rule 2: skills of the chosen domains, or of every offered domain when none is chosen. */
export function skillOptions(
  taxonomy: PracticeTopicsResponse,
  value: Pick<FilterBarValue, "sections" | "domains">,
): FilterOption[] {
  const offered = selectedSections(taxonomy, value.sections).flatMap(
    (s) => s.domains,
  );
  const source =
    value.domains.length === 0
      ? offered
      : offered.filter((d) => value.domains.includes(d.domain));
  const names = unique(source.flatMap((d) => d.skills));
  return names.map((name) => ({ value: name, label: name }));
}

/** Rule 6: difficulty options, independent of everything else. */
export function difficultyOptions(): Array<FilterOption<PracticeDifficulty>> {
  return DIFFICULTY_OPTIONS.map((o) => ({ ...o }));
}

/** Keeps only `chosen` values that appear in `options`, in option order. */
function keepOffered(
  chosen: readonly string[],
  options: FilterOption[],
): string[] {
  return options.map((o) => o.value).filter((v) => chosen.includes(v));
}

/**
 * Drops every choice that does not apply and puts each list in canonical order. Every other
 * operation ends here, so the bar's value is always normalised. Idempotent.
 */
export function normalizeFilter(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
): FilterBarValue {
  const sections = taxonomy.sections
    .map((s) => s.section)
    .filter((code) => value.sections.includes(code));
  const domains = keepOffered(value.domains, domainOptions(taxonomy, sections));
  const skills = keepOffered(
    value.skills,
    skillOptions(taxonomy, { sections, domains }),
  );
  const difficulties = normalizePracticeDifficulties(value.difficulties);
  return { sections, domains, skills, difficulties };
}

/** Rule 3: the Section switch picks one section; inapplicable domains and skills go. */
export function selectSection(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  section: FilterSectionCode,
): FilterBarValue {
  return normalizeFilter(taxonomy, { ...value, sections: [section] });
}

/** Rule 4: removes a domain and that domain's skills. Idempotent. */
export function removeDomain(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  domain: string,
): FilterBarValue {
  const itsSkills = selectedSections(taxonomy, value.sections)
    .flatMap((s) => s.domains)
    .filter((d) => d.domain === domain)
    .flatMap((d) => d.skills);
  return normalizeFilter(taxonomy, {
    ...value,
    domains: value.domains.filter((d) => d !== domain),
    skills: value.skills.filter((s) => !itsSkills.includes(s)),
  });
}

/** Adds a domain if it is not chosen, removes it (rule 4) if it is. */
export function toggleDomain(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  domain: string,
): FilterBarValue {
  if (value.domains.includes(domain))
    return removeDomain(taxonomy, value, domain);
  return normalizeFilter(taxonomy, {
    ...value,
    domains: [...value.domains, domain],
  });
}

/** Removes a skill. Idempotent. */
export function removeSkill(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  skill: string,
): FilterBarValue {
  return normalizeFilter(taxonomy, {
    ...value,
    skills: value.skills.filter((s) => s !== skill),
  });
}

/** Adds a skill if it is not chosen, removes it if it is. */
export function toggleSkill(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  skill: string,
): FilterBarValue {
  if (value.skills.includes(skill)) return removeSkill(taxonomy, value, skill);
  return normalizeFilter(taxonomy, {
    ...value,
    skills: [...value.skills, skill],
  });
}

/** Removes a difficulty. Idempotent. */
function removeDifficulty(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  difficulty: PracticeDifficulty,
): FilterBarValue {
  return normalizeFilter(taxonomy, {
    ...value,
    difficulties: value.difficulties.filter((d) => d !== difficulty),
  });
}

/** Adds a difficulty if it is not chosen, removes it if it is. */
export function toggleDifficulty(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  difficulty: PracticeDifficulty,
): FilterBarValue {
  if (value.difficulties.includes(difficulty))
    return removeDifficulty(taxonomy, value, difficulty);
  return normalizeFilter(taxonomy, {
    ...value,
    difficulties: [...value.difficulties, difficulty],
  });
}

/** Rule 5: clears every removable choice and keeps the Section. Idempotent. */
export function clearAll(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
): FilterBarValue {
  return normalizeFilter(taxonomy, {
    ...EMPTY_FILTER,
    sections: value.sections,
  });
}

/** Removes the choice a chip stands for. */
export function removeChip(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
  chip: FilterChip,
): FilterBarValue {
  if (chip.kind === "domain") return removeDomain(taxonomy, value, chip.value);
  if (chip.kind === "skill") return removeSkill(taxonomy, value, chip.value);
  const difficulty = DIFFICULTY_OPTIONS.find((o) => o.value === chip.value);
  return difficulty
    ? removeDifficulty(taxonomy, value, difficulty.value)
    : normalizeFilter(taxonomy, value);
}

/**
 * One chip per chosen domain, skill and difficulty, in that order, labelled by display name.
 * The value is normalised first, so a chip is never shown for a choice that does not apply.
 */
export function filterChips(
  taxonomy: PracticeTopicsResponse,
  value: FilterBarValue,
): FilterChip[] {
  const v = normalizeFilter(taxonomy, value);
  const label = (chosen: string, options: FilterOption[]): string =>
    options.find((o) => o.value === chosen)?.label ?? chosen;
  const diffs = difficultyOptions();
  return [
    ...v.domains.map((d) => ({
      kind: "domain" as const,
      value: d,
      label: label(d, domainOptions(taxonomy, v.sections)),
    })),
    ...v.skills.map((s) => ({
      kind: "skill" as const,
      value: s,
      label: label(s, skillOptions(taxonomy, v)),
    })),
    ...v.difficulties.map((d) => ({
      kind: "difficulty" as const,
      value: d,
      label: label(d, diffs),
    })),
  ];
}
