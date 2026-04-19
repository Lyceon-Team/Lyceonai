import { getSupabaseAdmin } from "../lib/supabase-admin";

export interface SkillMasteryRow {
  section: string;
  domain: string | null;
  skill: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  mastery_level?: number | null;
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
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  mastery_level?: number | null;
}

export interface ClusterWeakness {
  structure_cluster_id: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
}

export interface MasterySummary {
  section: string;
  totalAttempts: number;
  totalCorrect: number;
  overallAccuracy: number;
  domainBreakdown: {
    domain: string;
    attempts: number;
    correct: number;
    accuracy: number;
  }[];
}

export interface SkillNode {
  id: string;
  label: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

export interface DomainNode {
  id: string;
  label: string;
  skills: SkillNode[];
  avgMastery: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

export interface SectionNode {
  id: string;
  label: string;
  domains: DomainNode[];
  avgMastery: number;
}

function toLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function mapMasteryStatusFromLevel(
  masteryLevel: unknown,
  attempts: number,
  masteryScore?: number
): "not_started" | "weak" | "improving" | "proficient" {
  if (!Number.isFinite(attempts) || attempts < 0.01) {
    return "not_started";
  }

  if (masteryLevel === 4 || masteryLevel === 3) return "proficient";
  if (masteryLevel === 2) return "improving";
  if (masteryLevel === 1 || masteryLevel === 0) return "weak";

  const fallbackScore = Number.isFinite(masteryScore as number) ? Number(masteryScore) : 0;
  if (fallbackScore < 40) return "weak";
  if (fallbackScore < 70) return "improving";
  return "proficient";
}

export async function fetchSkillMasteryRows(args: {
  userId: string;
  section?: string;
}): Promise<SkillMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, attempts, correct, accuracy, mastery_score, mastery_level")
    .eq("user_id", args.userId);

  if (args.section) {
    q = q.eq("section", args.section);
  }

  const { data, error } = await q;
  if (error || !data) {
    return [];
  }
  return data as SkillMasteryRow[];
}

export async function fetchWeakestSkills(query: WeaknessQuery): Promise<SkillWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;
  const minAttempts = query.minAttempts || 3;

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, attempts, correct, accuracy, mastery_score, mastery_level")
    .eq("user_id", query.userId)
    .gte("attempts", minAttempts)
    .order("accuracy", { ascending: true })
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

  return (data || []) as SkillWeakness[];
}

export async function fetchWeakestClusters(query: WeaknessQuery): Promise<ClusterWeakness[]> {
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

export function buildMasterySummaryFromRows(rows: SkillMasteryRow[]): MasterySummary[] {
  const sectionMap = new Map<string, {
    totalAttempts: number;
    totalCorrect: number;
    domains: Map<string, { attempts: number; correct: number }>;
  }>();

  for (const row of rows) {
    const sec = row.section;
    const dom = row.domain || "unknown";

    if (!sectionMap.has(sec)) {
      sectionMap.set(sec, { totalAttempts: 0, totalCorrect: 0, domains: new Map() });
    }

    const entry = sectionMap.get(sec)!;
    entry.totalAttempts += row.attempts;
    entry.totalCorrect += row.correct;

    if (!entry.domains.has(dom)) {
      entry.domains.set(dom, { attempts: 0, correct: 0 });
    }

    const domEntry = entry.domains.get(dom)!;
    domEntry.attempts += row.attempts;
    domEntry.correct += row.correct;
  }

  const result: MasterySummary[] = [];
  for (const [sec, entry] of sectionMap) {
    const domainBreakdown = Array.from(entry.domains.entries()).map(([dom, stats]) => ({
      domain: dom,
      attempts: stats.attempts,
      correct: stats.correct,
      accuracy: stats.attempts > 0 ? stats.correct / stats.attempts : 0,
    }));

    result.push({
      section: sec,
      totalAttempts: entry.totalAttempts,
      totalCorrect: entry.totalCorrect,
      overallAccuracy: entry.totalAttempts > 0 ? entry.totalCorrect / entry.totalAttempts : 0,
      domainBreakdown,
    });
  }

  return result;
}

export function buildMasterySkillTreeFromRows(
  rows: SkillMasteryRow[],
  taxonomy: Record<string, { label: string; domains: Record<string, { label: string; skills: string[] }> }>
): SectionNode[] {
  const masteryMap = new Map<string, SkillMasteryRow>();
  for (const row of rows) {
    const key = `${row.section}:${row.domain || "unknown"}:${row.skill}`;
    masteryMap.set(key, row);
  }

  const result: SectionNode[] = [];

  for (const [sectionId, sectionDef] of Object.entries(taxonomy)) {
    const domains: DomainNode[] = [];
    let sectionTotalMastery = 0;
    let sectionDomainCount = 0;

    for (const [domainId, domainDef] of Object.entries(sectionDef.domains)) {
      const skills: SkillNode[] = [];
      let domainTotalMastery = 0;

      for (const skillId of domainDef.skills) {
        const key = `${sectionId}:${domainId}:${skillId}`;
        const row = masteryMap.get(key);

        const attempts = row?.attempts ?? 0;
        const correct = row?.correct ?? 0;
        const accuracy = row?.accuracy ?? 0;
        const mastery_score = row?.mastery_score ?? 0;

        skills.push({
          id: skillId,
          label: toLabel(skillId),
          attempts,
          correct,
          accuracy: Math.round(accuracy * 100),
          mastery_score: Math.round(mastery_score),
          status: mapMasteryStatusFromLevel(row?.mastery_level, attempts, mastery_score),
        });

        domainTotalMastery += mastery_score;
      }

      const avgDomainMastery = domainDef.skills.length > 0
        ? domainTotalMastery / domainDef.skills.length
        : 0;

      domains.push({
        id: domainId,
        label: domainDef.label,
        skills,
        avgMastery: Math.round(avgDomainMastery),
        status: mapMasteryStatusFromLevel(null, skills.reduce((a, s) => a + s.attempts, 0), avgDomainMastery),
      });

      sectionTotalMastery += avgDomainMastery;
      sectionDomainCount++;
    }

    result.push({
      id: sectionId,
      label: sectionDef.label,
      domains,
      avgMastery: sectionDomainCount > 0
        ? Math.round(sectionTotalMastery / sectionDomainCount)
        : 0,
    });
  }

  return result;
}
