import { getSupabaseAdmin } from "../lib/supabase-admin";
import type { AttemptInput, AttemptResult, QuestionMetadataSnapshot } from "./mastery-write";

/**
 * MASTERY WRITE FUNCTIONS MOVED TO mastery-write.ts
 * 
 * Sprint 3 PR-1: All mastery write operations have been moved to the canonical
 * choke point module: apps/api/src/services/mastery-write.ts
 * 
 * This file now only contains:
 * - Read operations (getWeakestSkills, getWeakestClusters, getMasterySummary)
 * - Helper functions (getQuestionMetadataForAttempt)
 * - Re-exports for backward compatibility
 * 
 * DO NOT add mastery write logic here. Use mastery-write.ts instead.
 */

// Re-export write types and functions from canonical choke point
export type { QuestionMetadataSnapshot, AttemptInput, AttemptResult };

export {
  applyMasteryUpdate,
  logAttemptAndUpdateMastery, // Legacy alias
} from "./mastery-write";

/**
 * getQuestionMetadataForAttempt - READ-ONLY helper for fetching question metadata
 * 
 * READ ONLY: This function fetches question metadata for logging attempts.
 * It does NOT write to mastery tables or mutate any mastery state.
 */
export async function getQuestionMetadataForAttempt(
  questionId: string
): Promise<QuestionMetadataSnapshot & { canonicalId: string | null }> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("questions")
    .select(`
      canonical_id,
      exam,
      section,
      domain,
      skill,
      subskill,
      difficulty_bucket,
      structure_cluster_id,
      unit_tag
    `)
    .eq("id", questionId)
    .single();

  if (error || !data) {
    console.warn("[Mastery] Question not found for attempt:", questionId);
    return {
      canonicalId: null,
      exam: null,
      section: null,
      domain: null,
      skill: null,
      subskill: null,
      difficulty_bucket: null,
      structure_cluster_id: null,
    };
  }

  return {
    canonicalId: data.canonical_id || null,
    exam: data.exam || null,
    section: data.section || null,
    domain: data.domain || null,
    skill: data.skill || data.unit_tag || null,
    subskill: data.subskill || null,
    difficulty_bucket: data.difficulty_bucket || null,
    structure_cluster_id: data.structure_cluster_id || null,
  };
}

export interface WeaknessQuery {
  userId: string;
  section?: string;
  limit?: number;
  minAttempts?: number;
}

export interface SkillWeakness {
  section: string;
  domain: string | null;
  skill: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
}

export interface ClusterWeakness {
  structure_cluster_id: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
}

/**
 * getWeakestSkills - READ-ONLY query for student_skill_mastery
 * 
 * READ ONLY: This function performs SELECT operations only.
 * It does NOT:
 * - Recalculate mastery scores
 * - Apply decay or weighting
 * - Mutate any state
 * 
 * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
 */
export async function getWeakestSkills(query: WeaknessQuery): Promise<SkillWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;
  const minAttempts = query.minAttempts || 3;

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
    .eq("user_id", query.userId)
    .gte("attempts", minAttempts)
    .order("accuracy", { ascending: true })
    .limit(limit);

  if (query.section) {
    q = q.eq("section", query.section);
  }

  const { data, error } = await q;

  if (error) {
    console.error("[Mastery] Failed to get weakest skills:", error.message);
    return [];
  }

  return data || [];
}

/**
 * getWeakestClusters - READ-ONLY query for student_cluster_mastery
 * 
 * READ ONLY: This function performs SELECT operations only.
 * It does NOT:
 * - Recalculate mastery scores
 * - Apply decay or weighting
 * - Mutate any state
 * 
 * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
 */
export async function getWeakestClusters(query: WeaknessQuery): Promise<ClusterWeakness[]> {
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
    console.error("[Mastery] Failed to get weakest clusters:", error.message);
    return [];
  }

  return data || [];
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

/**
 * getMasterySummary - READ-ONLY query for student_skill_mastery
 * 
 * READ ONLY: This function performs SELECT operations only.
 * It does NOT:
 * - Recalculate mastery scores
 * - Apply decay or weighting
 * - Mutate any state
 * 
 * Aggregates stored mastery data by section and domain.
 * For mastery WRITES, use applyMasteryUpdate() from mastery-write.ts
 */
export async function getMasterySummary(
  userId: string,
  section?: string
): Promise<MasterySummary[]> {
  const supabase = getSupabaseAdmin();

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, attempts, correct, accuracy")
    .eq("user_id", userId);

  if (section) {
    q = q.eq("section", section);
  }

  const { data, error } = await q;

  if (error || !data) {
    console.error("[Mastery] Failed to get mastery summary:", error?.message);
    return [];
  }

  const sectionMap = new Map<string, {
    totalAttempts: number;
    totalCorrect: number;
    domains: Map<string, { attempts: number; correct: number }>;
  }>();

  for (const row of data) {
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
