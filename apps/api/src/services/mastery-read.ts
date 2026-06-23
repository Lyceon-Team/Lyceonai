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

export interface ClusterMasteryRow {
  structure_cluster_id: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
}

export interface WeaknessQuery {
  userId: string;
  section?: string;
  limit?: number;
  minAttempts?: number;
  failOnError?: boolean;
}

export interface SkillWeakness {
  section: string;
  domain: string | null;
  skill: string;
  mastery_score: number;
  mastery_level: number | null;
  accuracy: number;
}

export interface ClusterWeakness {
  structure_cluster_id: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
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

/**
 * @spec [Doc 05 mastery_level via mastery_constants level boundaries 0.19/0.39/0.59/0.79] | @implemented [2026-06-23]
 * plain English: maps the canonical mastery_level (0-4, DB-computed from the
 * mastery_constants level boundaries) to a UI status label. The weak/improving/proficient
 * labels are a presentation grouping of those canonical levels (no separate locked-spec
 * owner). mastery_score is NOT consulted — the prior 40/70 score fallback (divergent from
 * the level grouping) is removed (MA-06). Returns not_started when there is no canonical level.
 */
export function mapMasteryStatusFromLevel(
  masteryLevel: unknown,
  attempts: number,
): "not_started" | "weak" | "improving" | "proficient" {
  if (!Number.isFinite(attempts) || attempts < 0.01) {
    return "not_started";
  }

  if (masteryLevel === 4 || masteryLevel === 3) return "proficient";
  if (masteryLevel === 2) return "improving";
  if (masteryLevel === 1 || masteryLevel === 0) return "weak";

  return "not_started";
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
 * @spec [Doc 05A §7.4 — mastery_score is admin-only; used server-side by adaptiveSelector for
 *   deterministic practice-engine selection] | @implemented [2026-06-23]
 * ANTI-LEAK BOUNDARY: mastery_score is DUAL-USE. This fetch keeps it for server-side consumers
 * (adaptiveSelector, planner). The /weakest route strips it at serialization — the score
 * never crosses to the client. `accuracy` is mapped from `mastery_score` for backward compat
 * with the adaptiveSelector's `weightedDeterministicPick` interface.
 */
export async function fetchWeakestSkills(
  query: WeaknessQuery,
): Promise<SkillWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;
  const minAttempts = query.minAttempts || 3;

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, mastery_level")
    .eq("student_id", query.userId)
    .gte("event_count_total", minAttempts)
    .order("mastery_score", { ascending: true })
    .limit(limit);

  if (query.section) {
    q = q.eq("section", query.section);
  }

  const { data, error } = await q;
  if (error) {
    if (query.failOnError) {
      throw new Error(`weakest_skills_query_failed: ${error.message}`);
    }
    return [];
  }

  return (data || []).map((row) => ({
    section: row.section as string,
    domain: (row.domain as string | null) ?? null,
    skill: row.skill as string,
    mastery_score: Number(row.mastery_score) || 0,
    mastery_level: row.mastery_level as number | null,
    accuracy: Number(row.mastery_score) || 0,
  }));
}

export async function fetchWeakestClusters(
  query: WeaknessQuery,
): Promise<ClusterWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;
  const minAttempts = query.minAttempts || 3;

  const { data, error } = await supabase
    .from("student_cluster_mastery")
    .select("structure_cluster_id, attempts, correct, accuracy, mastery_score")
    .eq("user_id", query.userId)
    .gte("attempts", minAttempts)
    .order("accuracy", { ascending: true })
    .limit(limit);

  if (error) {
    if (query.failOnError) {
      throw new Error(`weakest_clusters_query_failed: ${error.message}`);
    }
    return [];
  }

  return (data || []) as ClusterWeakness[];
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
