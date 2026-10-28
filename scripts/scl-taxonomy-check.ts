/**
 * SCL taxonomy CI consistency check — verifies the canonical JSON
 * matches the DB mirror (row counts + version match).
 *
 * Exits 0 on pass, 1 on mismatch. Intended for CI gates.
 *
 * Usage:
 *   pnpm exec tsx scripts/scl-taxonomy-check.ts
 *
 * @spec SPEC-CHANGE_SCL.md §9 (determinism / testing)
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

type Taxonomy = {
  taxonomy_version: string;
  sub_skills: Array<{ id: string }>;
  clusters: Array<{ id: string }>;
};

async function main(): Promise<void> {
  const raw = readFileSync(TAXONOMY_PATH, "utf-8");
  const taxonomy: Taxonomy = JSON.parse(raw);

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const failures: string[] = [];

  // Check sub_skills count
  const { count: subSkillCount, error: ssErr } = await supabase
    .from("sub_skills")
    .select("*", { count: "exact", head: true });
  if (ssErr) throw new Error(`sub_skills count query failed: ${ssErr.message}`);
  if (subSkillCount !== taxonomy.sub_skills.length) {
    failures.push(
      `sub_skills count: DB=${subSkillCount}, JSON=${taxonomy.sub_skills.length}`,
    );
  }

  // Check clusters count
  const { count: clusterCount, error: clErr } = await supabase
    .from("clusters")
    .select("*", { count: "exact", head: true });
  if (clErr) throw new Error(`clusters count query failed: ${clErr.message}`);
  if (clusterCount !== taxonomy.clusters.length) {
    failures.push(
      `clusters count: DB=${clusterCount}, JSON=${taxonomy.clusters.length}`,
    );
  }

  // Check taxonomy_version on sub_skills
  if (taxonomy.sub_skills.length > 0) {
    const { data: ssVersions, error: ssVErr } = await supabase
      .from("sub_skills")
      .select("taxonomy_version")
      .neq("taxonomy_version", taxonomy.taxonomy_version)
      .limit(1);
    if (ssVErr)
      throw new Error(`sub_skills version query failed: ${ssVErr.message}`);
    if (ssVersions && ssVersions.length > 0) {
      failures.push(
        `sub_skills version mismatch: found rows with version != "${taxonomy.taxonomy_version}"`,
      );
    }
  }

  // Check taxonomy_version on clusters
  if (taxonomy.clusters.length > 0) {
    const { data: clVersions, error: clVErr } = await supabase
      .from("clusters")
      .select("taxonomy_version")
      .neq("taxonomy_version", taxonomy.taxonomy_version)
      .limit(1);
    if (clVErr)
      throw new Error(`clusters version query failed: ${clVErr.message}`);
    if (clVersions && clVersions.length > 0) {
      failures.push(
        `clusters version mismatch: found rows with version != "${taxonomy.taxonomy_version}"`,
      );
    }
  }

  // Check no DB ids missing from JSON
  if (taxonomy.sub_skills.length > 0) {
    const canonicalIds = new Set(taxonomy.sub_skills.map((s) => s.id));
    const { data: dbIds, error: dbErr } = await supabase
      .from("sub_skills")
      .select("id");
    if (dbErr) throw new Error(`sub_skills id query failed: ${dbErr.message}`);
    const stale = (dbIds ?? []).filter((r) => !canonicalIds.has(r.id));
    if (stale.length > 0) {
      failures.push(
        `sub_skills has ${stale.length} DB rows not in JSON: ${stale.map((r) => r.id).join(", ")}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("SCL consistency check FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("SCL consistency check PASSED.");
  console.log(
    `  sub_skills: ${taxonomy.sub_skills.length} (JSON) = ${subSkillCount} (DB)`,
  );
  console.log(
    `  clusters: ${taxonomy.clusters.length} (JSON) = ${clusterCount} (DB)`,
  );
  console.log(`  taxonomy_version: ${taxonomy.taxonomy_version}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
