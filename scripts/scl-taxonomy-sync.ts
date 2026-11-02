/**
 * SCL taxonomy file ↔ DB sync primitives, shared by the loader and the check.
 *
 * "In sync" is SET-EQUALITY of IDs per table — never a row count and never
 * the taxonomy_version string. The taxonomy grows over time, so nothing here
 * knows how many sub-skills or clusters there are.
 *
 * @spec [SPEC-CHANGE_SCL.md §3 (canonical source), §7.2 (mirror), §9 (determinism)]
 * | @implemented [2026-10-29]
 * | plain English: diffIds() compares two ID sets both ways; loaderPreflight()
 *   refuses a load when the canonical file is missing any ID the DB already
 *   holds (the file is updated file-first, so a DB-only ID means the file is
 *   stale, and loading it would orphan or delete live taxonomy);
 *   fetchAllIds() reads every ID of a table page by page, because a bare
 *   select("id") stops at the PostgREST row cap and would hide rows.
 *   Owner rulings 2026-10-29 (Karl): no fixed taxonomy counts anywhere; the
 *   canonical file is the source of truth and is updated file-first.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type SclTable = "sub_skills" | "clusters";

export const SCL_TABLES: readonly SclTable[] = ["sub_skills", "clusters"];

export type IdSetDiff = {
  /** IDs present in the DB but absent from the canonical file. */
  missingFromFile: string[];
  /** IDs present in the canonical file but absent from the DB. */
  missingFromDb: string[];
};

export type TableIds = Record<SclTable, readonly string[]>;

/** Both-direction set difference, sorted for stable output. */
export function diffIds(
  fileIds: readonly string[],
  dbIds: readonly string[],
): IdSetDiff {
  const file = new Set(fileIds);
  const db = new Set(dbIds);
  return {
    missingFromFile: [...db].filter((id) => !file.has(id)).sort(),
    missingFromDb: [...file].filter((id) => !db.has(id)).sort(),
  };
}

export type PreflightResult =
  | { ok: true; toInsert: Record<SclTable, string[]> }
  | { ok: false; missingFromFile: Record<SclTable, string[]> };

/**
 * Loader pre-flight: the canonical file must contain every ID the DB holds.
 * On success, reports which file IDs are new to the DB (they will be inserted).
 */
export function loaderPreflight(file: TableIds, db: TableIds): PreflightResult {
  const subSkills = diffIds(file.sub_skills, db.sub_skills);
  const clusters = diffIds(file.clusters, db.clusters);
  if (
    subSkills.missingFromFile.length > 0 ||
    clusters.missingFromFile.length > 0
  ) {
    return {
      ok: false,
      missingFromFile: {
        sub_skills: subSkills.missingFromFile,
        clusters: clusters.missingFromFile,
      },
    };
  }
  return {
    ok: true,
    toInsert: {
      sub_skills: subSkills.missingFromDb,
      clusters: clusters.missingFromDb,
    },
  };
}

/** Rows per request when paging IDs. A transport page size, not a taxonomy size. */
const ID_PAGE_SIZE = 1000;

const idRowsSchema = z.array(z.object({ id: z.string() }));

/** Every ID in the table, read page by page in id order until a short page. */
export async function fetchAllIds(
  supabase: SupabaseClient,
  table: SclTable,
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += ID_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + ID_PAGE_SIZE - 1);
    if (error) throw new Error(`${table} id query failed: ${error.message}`);
    const rows = idRowsSchema.parse(data ?? []);
    for (const r of rows) ids.push(r.id);
    if (rows.length < ID_PAGE_SIZE) return ids;
  }
}

export async function fetchDbIds(supabase: SupabaseClient): Promise<TableIds> {
  const [subSkills, clusters] = await Promise.all([
    fetchAllIds(supabase, "sub_skills"),
    fetchAllIds(supabase, "clusters"),
  ]);
  return { sub_skills: subSkills, clusters };
}
