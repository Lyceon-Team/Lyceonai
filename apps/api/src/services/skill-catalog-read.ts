import { getSupabaseAdmin } from "../lib/supabase-admin";
import { createTtlCache } from "../../../../server/lib/ttl-cache";
import {
  CANONICAL_DOMAINS_BY_SECTION,
  isCanonicalDomainForSection,
} from "../../../../shared/question-bank-contract";
import type { MasterySection } from "../../../../packages/shared/src/mastery-levels";

/**
 * @spec [Doc 05B §4.2 domain canonicality (BLOCKING); owner ruling 2026-08-20 RULE 5
 *   (drill-down: domain first, then its skills), build question 6 answer (hard gate AND
 *   an explicit empty state)] | @implemented [2026-08-20]
 *
 * plain English: reads `public.canonical_skill_catalog` — the distinct
 * (section, domain, skill) triples over published questions — so the drill-down can
 * show every skill in a domain BEFORE the student has answered anything in it.
 *
 * WHAT IT REPLACES.
 *   `SAT_TAXONOMY`, a hardcoded object that invented its own slugs (`math`,
 *   `advanced_math`, `linear_equations`) while the database stores `M`,
 *   `Advanced Math` and `Linear Equations in One Variable`. Nothing ever joined, so the
 *   skill tree resolved every node to NULL. Deriving the catalog from the question bank
 *   makes the join keys the same values on both sides by construction.
 *
 * expected outcome: eight canonical domains, each with its published skills, sorted
 * deterministically by name.
 * trade-offs: the catalog tracks the question bank — publishing the first question for
 * a skill adds it. Correct, because an unpublished skill has nothing to practise.
 * edge cases: a domain with no published questions yields an EMPTY array, and callers
 * must distinguish that from a failed read. This module never converts an error into an
 * empty array: query failures throw, and the route turns a throw into a 500.
 */

export type CatalogEntry = {
  section: MasterySection;
  domain: string;
  skill: string;
};

type CatalogRow = {
  section: unknown;
  domain: unknown;
  skill: unknown;
};

function parseRows(rows: CatalogRow[]): CatalogEntry[] {
  return rows.map((row) => {
    // The view derives from `questions`, whose (section, domain) pairing is
    // CHECK-constrained, so a non-canonical pair here means the floor has already been
    // breached upstream. Same posture as assertCanonicalDomain: raise rather than serve
    // a triple the mastery tables can never join against.
    if (!isCanonicalDomainForSection(row.section, row.domain)) {
      throw new Error(
        `skill_catalog_non_canonical_pair: (${String(row.section)}, ${String(row.domain)}) ` +
          "is not a canonical (section, domain) pair",
      );
    }
    if (typeof row.skill !== "string" || row.skill.trim().length === 0) {
      throw new Error(
        `skill_catalog_blank_skill: (${String(row.section)}, ${String(row.domain)}) carries a blank skill`,
      );
    }
    return {
      section: row.section as MasterySection,
      domain: row.domain as string,
      skill: row.skill,
    };
  });
}

/**
 * Every skill the question bank publishes for one canonical domain, sorted by name.
 *
 * Returns `[]` only when the catalog genuinely holds nothing for that domain. Errors
 * throw — a caller can therefore treat `[]` as a fact about the question bank rather
 * than as "something went wrong and we hid it."
 */
export async function fetchSkillsForDomain(
  section: MasterySection,
  domain: string,
): Promise<string[]> {
  if (!isCanonicalDomainForSection(section, domain)) {
    throw new Error(
      `skill_catalog_non_canonical_pair: (${section}, ${domain}) is not a canonical (section, domain) pair`,
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("canonical_skill_catalog")
    .select("section, domain, skill")
    .eq("section", section)
    .eq("domain", domain);

  if (error) {
    throw new Error(`skill_catalog_query_failed: ${error.message}`);
  }

  const entries = parseRows((data ?? []) as CatalogRow[]);
  // Deterministic order: the drill-down must render the same list in the same sequence
  // on every request (Coding Standards §4.1). The view's DISTINCT carries no ordering.
  return entries.map((e) => e.skill).sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * @spec [owner brief 2026-10-13 "first-run activation fixes" item 2 ("cache in process ... the
 *       canonical_skill_catalog read (~875 ms mean, 95 calls; 29 rows) ... the skill catalog
 *       changes only on deploy/migration — cache with a TTL and say what invalidates it");
 *       Doc-01A_V1.0 §21, §24, §25] | @implemented [2026-10-13]
 *
 * plain English: the view is a DISTINCT over every published question (an unnest of
 * `skill_codes` across the whole bank), which is why one read costs hundreds of milliseconds
 * for 29 rows. Its answer is the same for every student and changes only when a question for
 * a new (section, domain, skill) is published or the last one for a triple is retired —
 * which happens through the question pipeline's seed SQL and migrations; no mounted route
 * publishes a question (`server/services/question-publish.ts` is unmounted and unimported). So the parsed, sorted catalog is held in process for CATALOG_TTL_MS (10 min), with a
 * 1 h hard-staleness bound for serving the previous catalog through a failed refresh (Doc 01A
 * §24); a failed read with nothing usable cached still throws, as before.
 *
 * INVALIDATION: a deploy starts fresh instances (cleared); a question publish applied out of
 * band shows up within 10 minutes; `invalidateSkillCatalogCache()` clears it on demand. A
 * newly published skill appearing up to 10 minutes late in the picker is the accepted cost.
 * Per-student data never enters it: the catalog is a projection of the bank alone.
 *
 * trade-offs: callers receive a fresh copy of the cached rows, so no caller can mutate what
 * the next one reads.
 */
const CATALOG_TTL_MS = 10 * 60 * 1000;
const CATALOG_HARD_STALE_MS = 60 * 60 * 1000;
const SKILL_CATALOG_CACHE = createTtlCache<readonly CatalogEntry[]>({
  name: "catalog:canonical_skill_catalog",
  ttlMs: CATALOG_TTL_MS,
  hardStaleMs: CATALOG_HARD_STALE_MS,
  maxEntries: 1,
});

async function readSkillCatalogFromDb(): Promise<CatalogEntry[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("canonical_skill_catalog")
    .select("section, domain, skill");

  if (error) {
    throw new Error(`skill_catalog_query_failed: ${error.message}`);
  }

  return parseRows((data ?? []) as CatalogRow[]).sort(
    (a, b) =>
      a.section.localeCompare(b.section, "en") ||
      a.domain.localeCompare(b.domain, "en") ||
      a.skill.localeCompare(b.skill, "en"),
  );
}

/**
 * The full catalog, from the in-process cache above. Used by the practice topic picker, the
 * mastery skill view, and any caller that needs more than one domain at a time.
 */
export async function fetchSkillCatalog(): Promise<CatalogEntry[]> {
  const cached = await SKILL_CATALOG_CACHE.get("all", readSkillCatalogFromDb);
  return cached.map((entry) => ({ ...entry }));
}

/** Drops the cached catalog: for an operator after a publish that must show at once, and tests. */
export function invalidateSkillCatalogCache(): void {
  SKILL_CATALOG_CACHE.invalidate();
}

/** The eight canonical (section, domain) pairs, in a stable order. Not a database read. */
export function canonicalDomainPairs(): Array<{
  section: MasterySection;
  domain: string;
}> {
  const pairs: Array<{ section: MasterySection; domain: string }> = [];
  for (const section of ["M", "RW"] as const) {
    for (const domain of CANONICAL_DOMAINS_BY_SECTION[section]) {
      pairs.push({ section, domain });
    }
  }
  return pairs;
}
