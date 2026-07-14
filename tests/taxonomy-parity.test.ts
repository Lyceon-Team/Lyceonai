/**
 * Parity test: asserts content/canonical/taxonomy.json agrees with the frozen
 * lists in docs/questions_governance.md §A. Fail the build on divergence.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function loadTaxonomy(): {
  sections: string[];
  domains: Record<string, string[]>;
  skills: Record<string, string[]>;
  distractor_taxonomy: Record<string, string[]>;
} {
  return JSON.parse(
    readFileSync(resolve(ROOT, "content/canonical/taxonomy.json"), "utf-8"),
  );
}

function parseGovernanceDoc(): {
  domains: { section: string; domain: string }[];
  skills: { domain: string; skill: string }[];
  mathDistractors: string[];
  rwDistractors: string[];
} {
  const raw = readFileSync(
    resolve(ROOT, "docs/questions_governance.md"),
    "utf-8",
  );

  const domains: { section: string; domain: string }[] = [];
  const skills: { domain: string; skill: string }[] = [];
  const mathDistractors: string[] = [];
  const rwDistractors: string[] = [];

  const lines = raw.split("\n");

  let currentSection: string | null = null;
  let currentDomain: string | null = null;
  let inMathDistractors = false;
  let inRwDistractors = false;
  let inDomainTable = false;
  let inSkillList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes("**Math (`section = 'M'`):**")) {
      currentSection = "M";
      inDomainTable = true;
      continue;
    }
    if (line.includes("**Reading & Writing (`section = 'RW'`):**")) {
      currentSection = "RW";
      inDomainTable = true;
      continue;
    }

    if (inDomainTable) {
      const dm = /\|\s*\d+\s*\|\s*`([^`]+)`\s*\|/.exec(line);
      if (dm && currentSection) {
        domains.push({ section: currentSection, domain: dm[1] });
      }
      if (
        line.startsWith("**") &&
        !line.includes("Math") &&
        !line.includes("Reading")
      ) {
        inDomainTable = false;
      }
    }

    const skillHeader = /^\*\*([^(]+)\s*\(\d+ skills?\):\*\*/.exec(line);
    if (skillHeader) {
      currentDomain = skillHeader[1].trim();
      inSkillList = true;
      continue;
    }

    if (inSkillList) {
      const skillMatch = /^\d+\.\s*`([^`]+)`/.exec(line);
      if (skillMatch && currentDomain) {
        skills.push({ domain: currentDomain, skill: skillMatch[1] });
      }
      if (line.trim() === "" && skills.length > 0) {
        inSkillList = false;
      }
    }

    if (line.includes("**Math distractor labels:**")) {
      inMathDistractors = true;
      inRwDistractors = false;
      continue;
    }
    if (line.includes("**RW distractor labels:**")) {
      inRwDistractors = true;
      inMathDistractors = false;
      continue;
    }

    if (inMathDistractors || inRwDistractors) {
      const dm = /\|\s*`([^`]+)`\s*\|/.exec(line);
      if (dm) {
        if (inMathDistractors) mathDistractors.push(dm[1]);
        else rwDistractors.push(dm[1]);
      }
      if (line.startsWith("**") && !line.includes("distractor")) {
        inMathDistractors = false;
        inRwDistractors = false;
      }
    }
  }

  return { domains, skills, mathDistractors, rwDistractors };
}

describe("taxonomy.json ↔ governance parity", () => {
  const taxonomy = loadTaxonomy();
  const gov = parseGovernanceDoc();

  it("has exactly 2 sections", () => {
    expect(taxonomy.sections).toEqual(["M", "RW"]);
  });

  it("Math domains match governance §A.4", () => {
    const govMath = gov.domains
      .filter((d) => d.section === "M")
      .map((d) => d.domain);
    expect(taxonomy.domains["M"]).toEqual(govMath);
  });

  it("RW domains match governance §A.4", () => {
    const govRW = gov.domains
      .filter((d) => d.section === "RW")
      .map((d) => d.domain);
    expect(taxonomy.domains["RW"]).toEqual(govRW);
  });

  it("all 29 skills match governance §A.4 with correct domain mapping", () => {
    for (const { domain, skill } of gov.skills) {
      const taxonomySkills = taxonomy.skills[domain];
      expect(
        taxonomySkills,
        `domain "${domain}" missing from taxonomy.json`,
      ).toBeDefined();
      expect(
        taxonomySkills,
        `skill "${skill}" missing from domain "${domain}" in taxonomy.json`,
      ).toContain(skill);
    }

    const totalTaxonomy = Object.values(taxonomy.skills).flat().length;
    expect(totalTaxonomy).toBe(gov.skills.length);
    expect(totalTaxonomy).toBe(29);
  });

  it("Math distractor taxonomy matches governance §A.6", () => {
    expect(taxonomy.distractor_taxonomy["M"].sort()).toEqual(
      gov.mathDistractors.sort(),
    );
  });

  it("RW distractor taxonomy matches governance §A.6", () => {
    expect(taxonomy.distractor_taxonomy["RW"].sort()).toEqual(
      gov.rwDistractors.sort(),
    );
  });
});
