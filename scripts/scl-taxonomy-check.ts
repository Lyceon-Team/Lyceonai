/**
 * SCL taxonomy CI consistency check — verifies the canonical JSON and the DB
 * mirror hold the same IDs: for sub_skills and for clusters, the set of IDs in
 * the file equals the set of IDs in the DB, checked in both directions.
 *
 * No row counts and no taxonomy_version comparison: the taxonomy grows over
 * time and the version string is not evidence of sync (owner ruling
 * 2026-10-29, Karl). IDs are read page by page, so table size is unbounded.
 *
 * Exits 0 on pass, 1 on mismatch. Intended for CI gates.
 *
 * Usage:
 *   pnpm exec tsx scripts/scl-taxonomy-check.ts
 *
 * @spec SPEC-CHANGE_SCL.md §9 (determinism / testing)
 * @implemented 2026-10-28; ID set-equality replaced count + version checks 2026-10-29
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { SCL_TABLES, diffIds, fetchDbIds } from "./scl-taxonomy-sync";

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

  const fileIds = {
    sub_skills: taxonomy.sub_skills.map((s) => s.id),
    clusters: taxonomy.clusters.map((c) => c.id),
  };
  const dbIds = await fetchDbIds(supabase);

  const failures: string[] = [];
  for (const table of SCL_TABLES) {
    const { missingFromFile, missingFromDb } = diffIds(
      fileIds[table],
      dbIds[table],
    );
    if (missingFromFile.length > 0) {
      failures.push(
        `${table} in DB but not in file: ${missingFromFile.join(", ")}`,
      );
    }
    if (missingFromDb.length > 0) {
      failures.push(
        `${table} in file but not in DB: ${missingFromDb.join(", ")}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("SCL consistency check FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    "SCL consistency check PASSED: sub_skills and clusters ID sets are equal in the file and the DB.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
