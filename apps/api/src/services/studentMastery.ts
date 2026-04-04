import { getSupabaseAdmin } from "../lib/supabase-admin";
import type { AttemptInput, AttemptResult, QuestionMetadataSnapshot } from "./mastery-write";
import type { WeaknessQuery, SkillWeakness, ClusterWeakness, MasterySummary } from "./mastery-read";
import { buildMasterySummaryFromRows, fetchSkillMasteryRows, fetchWeakestClusters, fetchWeakestSkills } from "./mastery-read";

export type { QuestionMetadataSnapshot, AttemptInput, AttemptResult };
export type { WeaknessQuery, SkillWeakness, ClusterWeakness, MasterySummary };

export {
  applyMasteryUpdate,
  logAttemptAndUpdateMastery,
} from "./mastery-write";

// Compatibility wrappers: canonical mastery reads live in mastery-read.
export async function getWeakestSkills(query: WeaknessQuery): Promise<SkillWeakness[]> {
  return fetchWeakestSkills(query);
}

export async function getWeakestClusters(query: WeaknessQuery): Promise<ClusterWeakness[]> {
  return fetchWeakestClusters(query);
}

export async function getMasterySummary(userId: string, section?: string): Promise<MasterySummary[]> {
  const rows = await fetchSkillMasteryRows({ userId, section });
  return buildMasterySummaryFromRows(rows);
}

export async function getQuestionMetadataForAttempt(
  questionId: string
): Promise<QuestionMetadataSnapshot & { canonicalId: string | null }> {
  const supabase = getSupabaseAdmin();

  const queryColumns = `
      canonical_id,
      exam,
      section,
      domain,
      skill,
      subskill,
      difficulty,
      structure_cluster_id,
      skill_code
    `;

  const byCanonical = await supabase
    .from("questions")
    .select(queryColumns)
    .eq("canonical_id", questionId)
    .maybeSingle();

  let data = byCanonical.data;
  let error = byCanonical.error;

  if (!data) {
    const byId = await supabase
      .from("questions")
      .select(queryColumns)
      .eq("id", questionId)
      .maybeSingle();

    data = byId.data;
    error = byId.error;
  }

  if (error || !data) {
    return {
      canonicalId: null,
      exam: null,
      section: null,
      domain: null,
      skill: null,
      subskill: null,
      skill_code: null,
      difficulty: null,
      structure_cluster_id: null,
    };
  }

  return {
    canonicalId: data.canonical_id || null,
    exam: data.exam || null,
    section: data.section || null,
    domain: data.domain || null,
    skill: data.skill || null,
    subskill: data.subskill || null,
    skill_code: data.skill_code || null,
    difficulty: (data.difficulty === 1 || data.difficulty === 2 || data.difficulty === 3) ? data.difficulty : null,
    structure_cluster_id: data.structure_cluster_id || null,
  };
}




