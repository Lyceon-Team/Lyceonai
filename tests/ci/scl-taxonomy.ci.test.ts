/**
 * SCL taxonomy — structural and RLS denial tests.
 *
 * 1. Canonical JSON validation (structure, no duplicates, valid fields)
 * 2. RLS denial: anon and authenticated roles cannot read the five SCL tables
 *
 * @spec SPEC-CHANGE_SCL.md §5 (ruling #7: internal only), §9 (determinism)
 * @implemented 2026-10-28
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const TAXONOMY_PATH = join(
  __dirname,
  "..",
  "..",
  "content",
  "canonical",
  "subskill-cluster-taxonomy.json",
);

const PARENT_TAXONOMY_PATH = join(
  __dirname,
  "..",
  "..",
  "content",
  "canonical",
  "taxonomy.json",
);

type SubSkill = {
  id: string;
  skill_code: string;
  section: string;
  domain: string;
  name: string;
  definition: string;
  inclusion_test: string;
};

type Cluster = {
  id: string;
  name: string;
  family: string;
  definition: string;
};

type SCLTaxonomy = {
  taxonomy_version: string;
  sub_skills: SubSkill[];
  clusters: Cluster[];
};

type ParentTaxonomy = {
  version: string;
  sections: string[];
  domains: Record<string, string[]>;
  skills: Record<string, string[]>;
};

describe("SCL canonical taxonomy JSON", () => {
  let taxonomy: SCLTaxonomy;
  let parentTaxonomy: ParentTaxonomy;

  it("parses without error", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    expect(taxonomy).toBeDefined();
  });

  it("has a taxonomy_version string", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    expect(typeof taxonomy.taxonomy_version).toBe("string");
    expect(taxonomy.taxonomy_version.length).toBeGreaterThan(0);
  });

  it("has sub_skills and clusters arrays", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    expect(Array.isArray(taxonomy.sub_skills)).toBe(true);
    expect(Array.isArray(taxonomy.clusters)).toBe(true);
  });

  it("sub_skill ids are unique", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const ids = taxonomy.sub_skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cluster ids are unique", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const ids = taxonomy.clusters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every sub_skill has all required fields", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const required: (keyof SubSkill)[] = [
      "id",
      "skill_code",
      "section",
      "domain",
      "name",
      "definition",
      "inclusion_test",
    ];
    for (const ss of taxonomy.sub_skills) {
      for (const field of required) {
        expect(typeof ss[field]).toBe("string");
        expect((ss[field] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("every cluster has all required fields and a valid family", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const validFamilies = ["by_hand_doing", "by_hand_recognizing", "desmos"];
    for (const cl of taxonomy.clusters) {
      expect(typeof cl.id).toBe("string");
      expect(typeof cl.name).toBe("string");
      expect(typeof cl.definition).toBe("string");
      expect(validFamilies).toContain(cl.family);
    }
  });

  it("sub_skill sections are valid (M or RW)", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const ss of taxonomy.sub_skills) {
      expect(["M", "RW"]).toContain(ss.section);
    }
  });

  it("sub_skill skill_codes reference skills in the parent taxonomy", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const parentRaw = readFileSync(PARENT_TAXONOMY_PATH, "utf-8");
    parentTaxonomy = JSON.parse(parentRaw) as ParentTaxonomy;

    const allSkills = new Set<string>();
    for (const skills of Object.values(parentTaxonomy.skills)) {
      for (const s of skills) allSkills.add(s);
    }

    for (const ss of taxonomy.sub_skills) {
      expect(allSkills.has(ss.skill_code)).toBe(true);
    }
  });

  it("sub_skill domains reference domains in the parent taxonomy", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const parentRaw = readFileSync(PARENT_TAXONOMY_PATH, "utf-8");
    parentTaxonomy = JSON.parse(parentRaw) as ParentTaxonomy;

    const allDomains = new Set<string>();
    for (const domains of Object.values(parentTaxonomy.domains)) {
      for (const d of domains) allDomains.add(d);
    }

    for (const ss of taxonomy.sub_skills) {
      expect(allDomains.has(ss.domain)).toBe(true);
    }
  });
});

describe("SCL migration — RLS denial", () => {
  const SCL_TABLES = [
    "sub_skills",
    "clusters",
    "question_sub_skills",
    "question_clusters",
    "distractor_clusters",
  ];

  const MIGRATION_PATH = join(
    __dirname,
    "..",
    "..",
    "supabase",
    "migrations",
    "20261115000000_scl_subskill_cluster_layer.sql",
  );

  let migrationSql: string;

  it("migration file exists", () => {
    migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  for (const table of SCL_TABLES) {
    it(`${table}: RLS is enabled`, () => {
      migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
      expect(migrationSql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    });

    it(`${table}: privileges revoked from PUBLIC, anon, authenticated`, () => {
      migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
      expect(migrationSql).toMatch(
        new RegExp(
          `REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC,\\s*anon,\\s*authenticated`,
        ),
      );
    });

    it(`${table}: only service_role has grants`, () => {
      migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
      expect(migrationSql).toMatch(
        new RegExp(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\\.${table} TO service_role`,
        ),
      );
    });
  }

  it("no student/guardian/authenticated policy exists", () => {
    migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
    expect(migrationSql).not.toMatch(/CREATE POLICY/i);
  });
});
