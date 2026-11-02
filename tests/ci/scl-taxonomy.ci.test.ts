/**
 * SCL taxonomy — structural and RLS denial tests.
 *
 * 1. Canonical JSON validation (structure, no duplicates, valid fields)
 * 2. File ↔ DB sync primitives (ID set-equality, loader pre-flight)
 * 3. RLS denial: anon and authenticated roles cannot read the five SCL tables
 *
 * No live taxonomy totals are pinned here: the sub-skill and cluster sets grow
 * over time (owner ruling 2026-10-29, Karl). Assertions are properties that
 * hold at any size; only fixtures this file constructs have pinned counts.
 *
 * @spec SPEC-CHANGE_SCL.md §5 (ruling #7: internal only), §9 (determinism)
 * @implemented 2026-10-28; count pins replaced by properties 2026-10-29
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { diffIds, loaderPreflight } from "../../scripts/scl-taxonomy-sync";

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
  evidence_ids: string[];
};

type Cluster = {
  id: string;
  display_name: string;
  family: string;
  definition: string;
  evidence_ids: string[];
  evidence_count: number;
  core: boolean;
  skills_seen_in: string[];
  method_in: Record<string, number> | never[];
  playbook_move?: string;
  aliases: string[];
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
      expect(typeof cl.display_name).toBe("string");
      expect(typeof cl.definition).toBe("string");
      expect(validFamilies).toContain(cl.family);
      expect(Array.isArray(cl.evidence_ids)).toBe(true);
      expect(typeof cl.evidence_count).toBe("number");
      expect(typeof cl.core).toBe("boolean");
      expect(Array.isArray(cl.skills_seen_in)).toBe(true);
      expect(Array.isArray(cl.aliases)).toBe(true);
    }
  });

  it("cluster ids match CL.NNNN format", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const cl of taxonomy.clusters) {
      expect(cl.id).toMatch(/^CL\.\d{4}$/);
    }
  });

  it("every sub_skill and cluster has a non-empty definition", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    expect(taxonomy.sub_skills.length).toBeGreaterThan(0);
    expect(taxonomy.clusters.length).toBeGreaterThan(0);
    for (const x of [...taxonomy.sub_skills, ...taxonomy.clusters]) {
      expect(x.definition.trim().length, x.id).toBeGreaterThan(0);
    }
  });

  it("every sub_skill has a non-empty inclusion_test", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const ss of taxonomy.sub_skills) {
      expect(ss.inclusion_test.trim().length, ss.id).toBeGreaterThan(0);
    }
  });

  it("every sub_skill and cluster has evidence (non-empty evidence_ids of non-empty strings)", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const x of [...taxonomy.sub_skills, ...taxonomy.clusters]) {
      expect(x.evidence_ids.length, x.id).toBeGreaterThan(0);
      for (const e of x.evidence_ids) {
        expect(typeof e).toBe("string");
        expect(e.trim().length, x.id).toBeGreaterThan(0);
      }
    }
  });

  it("single-evidence entries are documented exceptions (CB genuinely thin)", () => {
    // docs/questions_governance.md §A.5 "SCL single-evidence exceptions" lists each one
    // and why; a new single-evidence entry must be added there and here together.
    const SINGLE_EVIDENCE_EXCEPTIONS = new Set(["CL.0035", "EE.6"]);
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const single = [...taxonomy.sub_skills, ...taxonomy.clusters]
      .filter((x) => x.evidence_ids.length === 1)
      .map((x) => x.id);
    for (const id of single) {
      expect(SINGLE_EVIDENCE_EXCEPTIONS.has(id), id).toBe(true);
    }
  });

  it("evidence_count >= evidence_ids length (count is total tagged, ids are sample)", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const cl of taxonomy.clusters) {
      expect(cl.evidence_count).toBeGreaterThanOrEqual(cl.evidence_ids.length);
    }
  });

  it("playbook_move present only on desmos clusters", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    for (const cl of taxonomy.clusters) {
      if (cl.family === "desmos") {
        expect(typeof cl.playbook_move).toBe("string");
        expect((cl.playbook_move as string).length).toBeGreaterThan(0);
      } else {
        expect(cl.playbook_move).toBeUndefined();
      }
    }
  });

  it("skills_seen_in references skills in the parent taxonomy", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const parentRaw = readFileSync(PARENT_TAXONOMY_PATH, "utf-8");
    parentTaxonomy = JSON.parse(parentRaw) as ParentTaxonomy;
    const allSkills = new Set<string>();
    for (const skills of Object.values(parentTaxonomy.skills)) {
      for (const s of skills) allSkills.add(s);
    }
    for (const cl of taxonomy.clusters) {
      for (const skill of cl.skills_seen_in) {
        expect(allSkills.has(skill)).toBe(true);
      }
    }
  });

  it("method_in keys (if any) are valid skill names", () => {
    const raw = readFileSync(TAXONOMY_PATH, "utf-8");
    taxonomy = JSON.parse(raw) as SCLTaxonomy;
    const parentRaw = readFileSync(PARENT_TAXONOMY_PATH, "utf-8");
    parentTaxonomy = JSON.parse(parentRaw) as ParentTaxonomy;
    const allSkills = new Set<string>();
    for (const skills of Object.values(parentTaxonomy.skills)) {
      for (const s of skills) allSkills.add(s);
    }
    for (const cl of taxonomy.clusters) {
      if (
        cl.method_in &&
        typeof cl.method_in === "object" &&
        !Array.isArray(cl.method_in)
      ) {
        for (const skillName of Object.keys(cl.method_in)) {
          expect(allSkills.has(skillName)).toBe(true);
        }
      }
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

describe("SCL file ↔ DB sync (ID set-equality, loader pre-flight)", () => {
  // Fixtures are constructed here; their sizes are the fixture's, not the taxonomy's.
  const FILE = {
    sub_skills: ["EE.1", "EE.2", "EE.6"],
    clusters: ["CL.0001", "CL.9001"],
  };

  it("diffIds reports both directions, sorted, and is empty for equal sets", () => {
    expect(diffIds(["b", "a", "c"], ["c", "d", "a"])).toEqual({
      missingFromFile: ["d"],
      missingFromDb: ["b"],
    });
    expect(diffIds(["a", "b"], ["b", "a"])).toEqual({
      missingFromFile: [],
      missingFromDb: [],
    });
  });

  it("diffIds compares sets, not counts: equal sizes with different IDs are out of sync", () => {
    const d = diffIds(["EE.1", "EE.2"], ["EE.1", "EE.9"]);
    expect(d.missingFromFile).toEqual(["EE.9"]);
    expect(d.missingFromDb).toEqual(["EE.2"]);
  });

  it("pre-flight passes when the file holds every DB ID, and lists the inserts", () => {
    const r = loaderPreflight(FILE, {
      sub_skills: ["EE.1", "EE.2", "EE.6"],
      clusters: ["CL.0001"],
    });
    expect(r).toEqual({
      ok: true,
      toInsert: { sub_skills: [], clusters: ["CL.9001"] },
    });
  });

  it("pre-flight REFUSES when the file is missing a DB sub_skill (the EE.6 case)", () => {
    const r = loaderPreflight(
      { sub_skills: ["EE.1", "EE.2"], clusters: FILE.clusters },
      { sub_skills: ["EE.1", "EE.2", "EE.6"], clusters: ["CL.0001"] },
    );
    expect(r).toEqual({
      ok: false,
      missingFromFile: { sub_skills: ["EE.6"], clusters: [] },
    });
  });

  it("pre-flight REFUSES when the file is missing a DB cluster", () => {
    const r = loaderPreflight(FILE, {
      sub_skills: FILE.sub_skills,
      clusters: ["CL.0001", "CL.0099"],
    });
    expect(r).toEqual({
      ok: false,
      missingFromFile: { sub_skills: [], clusters: ["CL.0099"] },
    });
  });

  it("pre-flight passes against an empty DB (first load inserts everything)", () => {
    const r = loaderPreflight(FILE, { sub_skills: [], clusters: [] });
    expect(r).toEqual({
      ok: true,
      toInsert: { sub_skills: FILE.sub_skills, clusters: FILE.clusters },
    });
  });

  it("the loader has no delete path and calls the pre-flight before its first upsert", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "scripts", "scl-taxonomy-loader.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/\.delete\(/);
    const guard = src.indexOf("loaderPreflight(");
    const firstUpsert = src.indexOf(".upsert(");
    expect(guard).toBeGreaterThan(-1);
    expect(firstUpsert).toBeGreaterThan(guard);
  });

  it("the check script asserts ID set-equality, not counts or the version string", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "scripts", "scl-taxonomy-check.ts"),
      "utf-8",
    );
    expect(src).toContain("diffIds(");
    expect(src).not.toMatch(/count:\s*"exact"/);
    expect(src).not.toMatch(/\.neq\("taxonomy_version"/);
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
    "20261117000000_scl_consolidated.sql",
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
