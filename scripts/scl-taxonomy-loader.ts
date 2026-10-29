/**
 * SCL taxonomy loader — mirrors content/canonical/subskill-cluster-taxonomy.json
 * into the public.sub_skills and public.clusters tables.
 *
 * Re-runnable and idempotent: upserts by id, stamps taxonomy_version,
 * deletes rows whose id no longer appears in the canonical file.
 *
 * DRY-RUN by default. Pass --apply to write.
 *
 * Usage:
 *   pnpm exec tsx scripts/scl-taxonomy-loader.ts [--apply]
 *
 * @spec SPEC-CHANGE_SCL.md §3 (canonical source), §6 (versioning), §7.2 (mirror)
 * @implemented 2026-10-28
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAXONOMY_PATH = join(
  __dirname,
  "..",
  "content",
  "canonical",
  "subskill-cluster-taxonomy.json",
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
  family: "by_hand_doing" | "by_hand_recognizing" | "desmos";
  definition: string;
  evidence_ids: string[];
  evidence_count: number;
  core: boolean;
  skills_seen_in: string[];
  method_in: Record<string, number>;
  playbook_move?: string;
  aliases: string[];
};

type Taxonomy = {
  taxonomy_version: string;
  sub_skills: SubSkill[];
  clusters: Cluster[];
};

function loadTaxonomy(): Taxonomy {
  const raw = readFileSync(TAXONOMY_PATH, "utf-8");
  const parsed: Taxonomy = JSON.parse(raw);

  if (!parsed.taxonomy_version) {
    throw new Error("taxonomy_version is required in the canonical file");
  }
  if (!Array.isArray(parsed.sub_skills)) {
    throw new Error("sub_skills must be an array");
  }
  if (!Array.isArray(parsed.clusters)) {
    throw new Error("clusters must be an array");
  }

  const subSkillIds = new Set<string>();
  for (const ss of parsed.sub_skills) {
    if (
      !ss.id ||
      !ss.skill_code ||
      !ss.section ||
      !ss.domain ||
      !ss.name ||
      !ss.definition ||
      !ss.inclusion_test
    ) {
      throw new Error(
        `sub_skill ${ss.id ?? "(missing id)"} has missing required fields`,
      );
    }
    if (!Array.isArray(ss.evidence_ids)) {
      throw new Error(`sub_skill ${ss.id} has non-array evidence_ids`);
    }
    if (subSkillIds.has(ss.id)) {
      throw new Error(`duplicate sub_skill id: ${ss.id}`);
    }
    subSkillIds.add(ss.id);
  }

  const clusterIds = new Set<string>();
  for (const cl of parsed.clusters) {
    if (!cl.id || !cl.display_name || !cl.family || !cl.definition) {
      throw new Error(
        `cluster ${cl.id ?? "(missing id)"} has missing required fields`,
      );
    }
    if (!Array.isArray(cl.evidence_ids)) {
      throw new Error(`cluster ${cl.id} has non-array evidence_ids`);
    }
    if (typeof cl.evidence_count !== "number") {
      throw new Error(`cluster ${cl.id} has non-number evidence_count`);
    }
    if (typeof cl.core !== "boolean") {
      throw new Error(`cluster ${cl.id} has non-boolean core`);
    }
    if (!Array.isArray(cl.skills_seen_in)) {
      throw new Error(`cluster ${cl.id} has non-array skills_seen_in`);
    }
    if (!Array.isArray(cl.aliases)) {
      throw new Error(`cluster ${cl.id} has non-array aliases`);
    }
    if (
      !["by_hand_doing", "by_hand_recognizing", "desmos"].includes(cl.family)
    ) {
      throw new Error(`cluster ${cl.id} has invalid family: ${cl.family}`);
    }
    if (clusterIds.has(cl.id)) {
      throw new Error(`duplicate cluster id: ${cl.id}`);
    }
    clusterIds.add(cl.id);
  }

  return parsed;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--apply");
  const taxonomy = loadTaxonomy();

  console.log(`Taxonomy version: ${taxonomy.taxonomy_version}`);
  console.log(`Sub-skills: ${taxonomy.sub_skills.length}`);
  console.log(`Clusters: ${taxonomy.clusters.length}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "APPLY"}`);

  if (taxonomy.sub_skills.length === 0 && taxonomy.clusters.length === 0) {
    console.log("Nothing to load (both arrays empty). Exiting.");
    return;
  }

  if (dryRun) {
    console.log("\nDry-run complete. Pass --apply to write to the database.");
    return;
  }

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const version = taxonomy.taxonomy_version;

  // --- Upsert sub_skills ---
  if (taxonomy.sub_skills.length > 0) {
    const rows = taxonomy.sub_skills.map((ss) => ({
      id: ss.id,
      skill_code: ss.skill_code,
      section: ss.section,
      domain: ss.domain,
      name: ss.name,
      definition: ss.definition,
      inclusion_test: ss.inclusion_test,
      evidence_ids: ss.evidence_ids,
      taxonomy_version: version,
    }));

    const { error: upsertErr } = await supabase
      .from("sub_skills")
      .upsert(rows, { onConflict: "id" });
    if (upsertErr)
      throw new Error(`sub_skills upsert failed: ${upsertErr.message}`);

    // Delete rows not in the canonical file
    const canonicalIds = taxonomy.sub_skills.map((ss) => ss.id);
    const { data: existing } = await supabase.from("sub_skills").select("id");
    const stale = (existing ?? []).filter((r) => !canonicalIds.includes(r.id));
    if (stale.length > 0) {
      const { error: delErr } = await supabase
        .from("sub_skills")
        .delete()
        .in(
          "id",
          stale.map((r) => r.id),
        );
      if (delErr)
        throw new Error(`sub_skills stale delete failed: ${delErr.message}`);
      console.log(`Deleted ${stale.length} stale sub_skill rows.`);
    }

    console.log(`Upserted ${rows.length} sub_skills.`);
  }

  // --- Upsert clusters ---
  if (taxonomy.clusters.length > 0) {
    const rows = taxonomy.clusters.map((cl) => ({
      id: cl.id,
      display_name: cl.display_name,
      family: cl.family,
      definition: cl.definition,
      evidence_ids: cl.evidence_ids,
      evidence_count: cl.evidence_count,
      core: cl.core,
      skills_seen_in: cl.skills_seen_in,
      method_in: cl.method_in ?? {},
      playbook_move: cl.playbook_move ?? null,
      aliases: cl.aliases,
      taxonomy_version: version,
    }));

    const { error: upsertErr } = await supabase
      .from("clusters")
      .upsert(rows, { onConflict: "id" });
    if (upsertErr)
      throw new Error(`clusters upsert failed: ${upsertErr.message}`);

    const canonicalIds = taxonomy.clusters.map((cl) => cl.id);
    const { data: existing } = await supabase.from("clusters").select("id");
    const stale = (existing ?? []).filter((r) => !canonicalIds.includes(r.id));
    if (stale.length > 0) {
      const { error: delErr } = await supabase
        .from("clusters")
        .delete()
        .in(
          "id",
          stale.map((r) => r.id),
        );
      if (delErr)
        throw new Error(`clusters stale delete failed: ${delErr.message}`);
      console.log(`Deleted ${stale.length} stale cluster rows.`);
    }

    console.log(`Upserted ${rows.length} clusters.`);
  }

  console.log("Loader complete.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
