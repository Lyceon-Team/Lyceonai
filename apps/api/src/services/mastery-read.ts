import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  masteryTierFromLevel,
  type MasteryTier,
} from "../../../../packages/shared/src/mastery";

// ---------------------------------------------------------------------------
// Row types — match actual student_skill_mastery / student_domain_mastery columns
// ---------------------------------------------------------------------------

export interface SkillMasteryRow {
  section: string;
  domain: string | null;
  skill: string;
  mastery_level: number | null;
  event_count_total: number;
  computed_at: string | null;
}

export interface WeaknessQuery {
  userId: string;
  section?: string;
  limit?: number;
}

export interface SkillWeakness {
  section: string;
  domain: string | null;
  skill: string;
  /** Non-null by construction: the query selects only measured rows (see fetchWeakestSkills). */
  mastery_score: number;
  /** Non-null by construction: the formula sets score and level together. */
  mastery_level: number;
}

// ---------------------------------------------------------------------------
// Tier-only summary (rebuilt — the old MasterySummary used non-existent columns)
// ---------------------------------------------------------------------------

export interface MasterySummary {
  section: string;
  domains: Array<{
    domain: string;
    tier: MasteryTier;
    masteryLevel: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Tier-only tree nodes (AC#20 / INV-05A-12: no mastery_score, no mastery_pct,
// no percent on any student/guardian surface)
// ---------------------------------------------------------------------------

export interface SkillNode {
  skill: string;
  label: string;
  masteryLevel: number | null;
  tier: MasteryTier;
  computedAt: string | null;
}

export interface DomainNode {
  domain: string;
  label: string;
  masteryLevel: number | null;
  tier: MasteryTier;
  computedAt: string | null;
  skills: SkillNode[];
}

export interface SectionNode {
  section: string;
  label: string;
  domains: DomainNode[];
}

function toLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Fetchers — select only columns that exist on the actual tables
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery student-readable grant: section, domain, skill,
 *   mastery_level, computed_at; event_count_total is service_role only (§7.2)] | @implemented [2026-06-23]
 * plain English: reads per-skill mastery rows for the tree builder. Query runs as service_role
 * (getSupabaseAdmin) so event_count_total is accessible; it is used only server-side and never
 * serialised to the client response. The prior select included `attempts, correct, accuracy` which
 * do NOT exist on the table (column name was `user_id` → `student_id`), causing every query to
 * error → return [].
 */
export async function fetchSkillMasteryRows(args: {
  userId: string;
  section?: string;
}): Promise<SkillMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("student_skill_mastery")
    .select(
      "section, domain, skill, mastery_level, event_count_total, computed_at",
    )
    .eq("student_id", args.userId);

  if (args.section) {
    q = q.eq("section", args.section);
  }

  const { data, error } = await q;
  if (error || !data) {
    return [];
  }
  return data as SkillMasteryRow[];
}

export interface DomainMasteryRow {
  section: string;
  domain: string;
  mastery_level: number | null;
}

/**
 * @spec [Doc 05B §5.4 — student_domain_mastery (section, domain, mastery_level) student-readable] | @implemented [2026-06-23]
 * plain English: reads the per-domain canonical rollup level so the domain status badge can
 * use the same level→status logic as skills (MA-06), instead of a synthesized score bucket.
 * Selects ONLY student-grantable columns — never the admin-only mastery_score / mastery_pct /
 * event_count_total (Doc 05B §5.2/§6.5).
 */
export async function fetchDomainMasteryRows(args: {
  userId: string;
  section?: string;
}): Promise<DomainMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("student_domain_mastery")
    .select("section, domain, mastery_level")
    .eq("student_id", args.userId);

  if (args.section) {
    q = q.eq("section", args.section);
  }

  const { data, error } = await q;
  if (error || !data) {
    return [];
  }
  return data as DomainMasteryRow[];
}

/**
 * @spec [Doc 05A §7.4 — mastery_score is the canonical DB-computed weakness signal, admin-only;
 *   Doc 05A §6.2 / Doc 05 Parent §6.6 — NULL score IS the insufficient-evidence signal]
 * | @implemented [2026-08-20]
 *
 * plain English: returns the student's measured weakest skills, ascending by the canonical
 * mastery_score. "Measured" is not a count this function decides — it is whatever the formula
 * decided when it wrote the row.
 *
 * WHY THE FILTER IS `mastery_score IS NOT NULL` AND NOT AN EVENT COUNT.
 *   The previous version filtered `event_count_total >= minAttempts` with minAttempts defaulting
 *   to 2 or 3, while MIN_EVENTS_FOR_MASTERY is 5. Rows with 2-4 events clear that filter but are
 *   deliberately unscored (Doc 05A §6.2: below the threshold the row is written with
 *   mastery_score = NULL, mastery_pct = NULL, mastery_level = NULL). `Number(null) || 0` then
 *   turned each one into 0.0 and ascending order floated them to the top — so the surface told a
 *   student their LEAST-PRACTICED skills were their WORST skills. In production that was 18 of
 *   46 skill rows.
 *
 *   Re-deriving the threshold in TypeScript is what created the drift, so this does not read
 *   MIN_EVENTS_FOR_MASTERY either. It filters on the formula's own output: a non-NULL score
 *   exists if and only if the formula judged the evidence sufficient. One decision, one place,
 *   no second copy to fall out of step. `minAttempts` is gone from the query contract entirely
 *   — a caller (including a client query string) can no longer choose the evidence bar.
 *
 * ANTI-LEAK BOUNDARY: mastery_score is DUAL-USE. This fetch reads the ALREADY-COMPUTED
 * mastery_score column directly (thin-read-surface — no recomputation from raw counts) and keeps
 * it for server-side consumers (adaptiveSelector, planner). The /weakest and /skills routes strip
 * it at serialization — the score never crosses to the client.
 *
 * Errors THROW. There is no failOnError opt-out: a query failure returning [] renders as "this
 * student has no weaknesses," which is the same fail-open shape as the NULL-to-zero coercion
 * above — an error collapsing into a legitimate-looking empty value.
 */
export async function fetchWeakestSkills(
  query: WeaknessQuery,
): Promise<SkillWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, mastery_level")
    .eq("student_id", query.userId)
    .not("mastery_score", "is", null)
    .order("mastery_score", { ascending: true })
    .limit(limit);

  if (query.section) {
    q = q.eq("section", query.section);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`weakest_skills_query_failed: ${error.message}`);
  }

  return (data || []).map((row) => {
    const score = Number(row.mastery_score);
    const level = row.mastery_level;
    // Belt-and-braces on the contract the filter above establishes. If either value is
    // absent here the row is not what the formula promises, and that is a defect to
    // surface — never a zero to render.
    if (!Number.isFinite(score) || level === null || level === undefined) {
      throw new Error(
        `weakest_skills_unmeasured_row: ${row.section}/${row.domain ?? "unknown"}/${row.skill} ` +
          `passed the measured filter but carries score=${String(row.mastery_score)} ` +
          `level=${String(row.mastery_level)}`,
      );
    }
    return {
      section: row.section as string,
      domain: (row.domain as string | null) ?? null,
      skill: row.skill as string,
      mastery_score: score,
      mastery_level: Number(level),
    };
  });
}

// ---------------------------------------------------------------------------
// Tier-only summary builder
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05B §5.4 — domain mastery_level is the canonical tier source] | @implemented [2026-06-23]
 * plain English: builds a section→domain tier summary from the domain mastery rows. The
 * prior version aggregated non-existent `attempts/correct/accuracy` columns from skill rows
 * (never worked). This version reads the domain's own canonical mastery_level.
 */
export function buildMasterySummaryFromRows(
  domainRows: DomainMasteryRow[],
): MasterySummary[] {
  const sectionMap = new Map<
    string,
    Array<{ domain: string; tier: MasteryTier; masteryLevel: number | null }>
  >();

  for (const row of domainRows) {
    if (!sectionMap.has(row.section)) {
      sectionMap.set(row.section, []);
    }
    sectionMap.get(row.section)!.push({
      domain: row.domain,
      tier: masteryTierFromLevel(row.mastery_level),
      masteryLevel: row.mastery_level,
    });
  }

  const result: MasterySummary[] = [];
  for (const [sec, domains] of sectionMap) {
    result.push({ section: sec, domains });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tier-only tree builder
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05A §7.4 + Doc 05B §5.4 + Parent §4.7 independent computation + AC#20] | @implemented [2026-06-23]
 * plain English: builds a section → domain → skill tree with tier-only data. Skill tier from
 * skill mastery_level; domain tier from the domain's OWN student_domain_mastery.mastery_level
 * (independent canonical row — NOT a skill-rollup average); section = pure container (no tier,
 * no band, no percent). No mastery_score, no mastery_pct, no percent on any field.
 * The prior version computed avgMastery from skill mastery_scores (leaked admin data + used
 * non-existent columns). This version is tier-only, matching the shared schema.
 */
export function buildMasterySkillTreeFromRows(
  rows: SkillMasteryRow[],
  taxonomy: Record<
    string,
    {
      label: string;
      domains: Record<string, { label: string; skills: string[] }>;
    }
  >,
  domainRows: DomainMasteryRow[] = [],
): SectionNode[] {
  const masteryMap = new Map<string, SkillMasteryRow>();
  for (const row of rows) {
    const key = `${row.section}:${row.domain || "unknown"}:${row.skill}`;
    masteryMap.set(key, row);
  }

  const domainMasteryMap = new Map<string, DomainMasteryRow>();
  for (const dr of domainRows) {
    domainMasteryMap.set(`${dr.section}:${dr.domain}`, dr);
  }

  const result: SectionNode[] = [];

  for (const [sectionId, sectionDef] of Object.entries(taxonomy)) {
    const domains: DomainNode[] = [];

    for (const [domainId, domainDef] of Object.entries(sectionDef.domains)) {
      const skills: SkillNode[] = [];

      for (const skillId of domainDef.skills) {
        const key = `${sectionId}:${domainId}:${skillId}`;
        const row = masteryMap.get(key);

        skills.push({
          skill: skillId,
          label: toLabel(skillId),
          masteryLevel: row?.mastery_level ?? null,
          tier: masteryTierFromLevel(row?.mastery_level ?? null),
          computedAt: row?.computed_at ?? null,
        });
      }

      const domainMastery = domainMasteryMap.get(`${sectionId}:${domainId}`);
      const domainLevel = domainMastery?.mastery_level ?? null;
      domains.push({
        domain: domainId,
        label: domainDef.label,
        masteryLevel: domainLevel,
        tier: masteryTierFromLevel(domainLevel),
        computedAt: null,
        skills,
      });
    }

    result.push({
      section: sectionId,
      label: sectionDef.label,
      domains,
    });
  }

  return result;
}
