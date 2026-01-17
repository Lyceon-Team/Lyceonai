import { getSupabaseAdmin } from "../lib/supabase-admin";
import { getWeakestSkills, getWeakestClusters, SkillWeakness, ClusterWeakness } from "./studentMastery";

export type SectionFilter = "math" | "rw";
export type SelectionMode = "balanced" | "skill" | "cluster";
export type DifficultyPolicy = "auto" | "easy" | "medium" | "hard";
export type DifficultyBucket = "easy" | "medium" | "hard" | "unknown";

export interface SelectNextParams {
  userId: string;
  section: SectionFilter;
  sessionId?: string;
  attemptIndex?: number;
  target?: {
    mode?: SelectionMode;
    domain?: string;
    skill?: string;
    clusterId?: string;
  };
  difficultyPolicy?: DifficultyPolicy;
  excludeCanonicalIds?: string[];
}

export interface SelectionRationale {
  mode: SelectionMode;
  pickedFrom: "cluster" | "skill" | "fallback";
  weaknessKey?: string;
  difficultyPicked?: DifficultyBucket;
  relaxStepUsed?: number;
  filterPath?: string[];
  candidateCount?: number;
}

export interface SelectNextResult {
  question: any;
  rationale: SelectionRationale;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function deterministicPick<T>(items: T[], seed: string): T {
  if (items.length === 0) throw new Error("Cannot pick from empty array");
  const idx = simpleHash(seed) % items.length;
  return items[idx];
}

function weightedDeterministicPick<T extends { accuracy: number }>(
  items: T[],
  seed: string
): T {
  if (items.length === 0) throw new Error("Cannot pick from empty array");
  if (items.length === 1) return items[0];
  
  const weights = items.map((item) => {
    const weakness = 1 - item.accuracy;
    return Math.max(0.1, weakness);
  });
  
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = weights.map((w) => w / totalWeight);
  
  const hashValue = simpleHash(seed);
  const randomPoint = (hashValue % 10000) / 10000;
  
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += normalizedWeights[i];
    if (randomPoint <= cumulative) {
      return items[i];
    }
  }
  
  return items[items.length - 1];
}

interface DifficultyWeights {
  easy: number;
  medium: number;
  hard: number;
}

function getDifficultyWeights(baseline: DifficultyBucket): DifficultyWeights {
  switch (baseline) {
    case "easy":
      return { easy: 0.75, medium: 0.25, hard: 0 };
    case "medium":
      return { easy: 0.2, medium: 0.6, hard: 0.2 };
    case "hard":
      return { easy: 0, medium: 0.25, hard: 0.75 };
    default:
      return { easy: 0.25, medium: 0.5, hard: 0.25 };
  }
}

function pickDifficultyWithWeights(
  baseline: DifficultyBucket,
  seed: string
): DifficultyBucket {
  const weights = getDifficultyWeights(baseline);
  const hashValue = simpleHash(seed + ":difficulty");
  const randomPoint = (hashValue % 10000) / 10000;
  
  let cumulative = 0;
  if (weights.easy > 0) {
    cumulative += weights.easy;
    if (randomPoint <= cumulative) return "easy";
  }
  if (weights.medium > 0) {
    cumulative += weights.medium;
    if (randomPoint <= cumulative) return "medium";
  }
  return "hard";
}

async function computeBaselineDifficulty(
  userId: string,
  section: SectionFilter
): Promise<DifficultyBucket> {
  const supabase = getSupabaseAdmin();
  
  const sectionFilter = section === "math" ? "math" : ["reading", "writing", "rw"];
  
  let query: any = supabase
    .from("student_question_attempts")
    .select("is_correct")
    .eq("user_id", userId);
  
  if (Array.isArray(sectionFilter)) {
    query = query.in("section", sectionFilter);
  } else {
    query = query.ilike("section", `%${sectionFilter}%`);
  }
  
  query = query.order("occurred_at", { ascending: false }).limit(20);
  
  const { data, error } = await query;
  
  if (error || !data || data.length < 5) {
    return "medium";
  }
  
  const correctCount = data.filter((a: any) => a.is_correct).length;
  const accuracy = correctCount / data.length;
  
  if (accuracy < 0.5) return "easy";
  if (accuracy < 0.75) return "medium";
  return "hard";
}

async function getRecentlyAttemptedCanonicalIds(
  userId: string,
  section: SectionFilter,
  dayLimit: number = 14
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - dayLimit);
  
  const sectionFilter = section === "math" ? "math" : ["reading", "writing", "rw"];
  
  let query = supabase
    .from("student_question_attempts")
    .select("question_canonical_id")
    .eq("user_id", userId)
    .gte("occurred_at", cutoffDate.toISOString());
  
  if (Array.isArray(sectionFilter)) {
    query = query.in("section", sectionFilter);
  } else {
    query = query.ilike("section", `%${sectionFilter}%`);
  }
  
  const { data, error } = await query;
  
  if (error || !data) {
    return [];
  }
  
  return data
    .map((r) => r.question_canonical_id)
    .filter((id): id is string => !!id);
}

function buildSectionFilter(section: SectionFilter): { sectionCodes: string[]; sectionPatterns: string[] } {
  if (section === "math") {
    return {
      sectionCodes: ["M"],
      sectionPatterns: ["math", "Math"],
    };
  }
  return {
    sectionCodes: ["R", "W"],
    sectionPatterns: ["reading", "Reading", "writing", "Writing", "rw", "RW"],
  };
}

interface CandidateQuery {
  section: SectionFilter;
  difficultyBucket?: DifficultyBucket;
  domain?: string;
  skill?: string;
  clusterId?: string;
  excludeCanonicalIds: string[];
  limit?: number;
}

function normalizeDifficulty(difficulty: string | null | undefined): DifficultyBucket {
  if (!difficulty) return "medium";
  const lower = difficulty.toLowerCase();
  if (lower === "easy") return "easy";
  if (lower === "hard") return "hard";
  return "medium";
}

async function queryCandidateQuestions(params: CandidateQuery): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  const limit = params.limit || 60;
  
  console.log("[AdaptiveSelector] queryCandidateQuestions called with:", {
    section: params.section,
    difficultyBucket: params.difficultyBucket,
    excludeCount: params.excludeCanonicalIds.length,
    limit
  });
  
  const { sectionPatterns } = buildSectionFilter(params.section);
  
  let query: any = supabase
    .from("questions")
    .select(`
      id,
      stem,
      options,
      section,
      difficulty,
      difficulty_level,
      explanation,
      source_mapping,
      page_number,
      tags,
      type,
      question_type,
      answer_choice,
      answer_text,
      needs_review,
      ai_generated,
      classification
    `)
    .not("needs_review", "is", true);
  
  if (params.section === "math") {
    query = query.ilike("section", "%math%");
  } else {
    query = query.or("section.ilike.%reading%,section.ilike.%writing%,section.ilike.%rw%");
  }
  
  console.log("[AdaptiveSelector] Executing query for section:", params.section);
  
  if (params.difficultyBucket && params.difficultyBucket !== "unknown") {
    query = query.ilike("difficulty", `%${params.difficultyBucket}%`);
  }
  
  query = query.limit(limit * 2);
  
  const { data, error } = await query;
  
  console.log("[AdaptiveSelector] Query result:", {
    hasError: !!error,
    errorMessage: error?.message,
    dataCount: data?.length || 0
  });
  
  if (error) {
    console.warn("[AdaptiveSelector] Query error:", error.message);
    return [];
  }
  
  let candidates = data || [];
  
  candidates = candidates.filter((q: any) => {
    const sec = (q.section || "").toLowerCase();
    
    if (params.section === "math") {
      return sec.includes("math");
    } else {
      return sec.includes("reading") || 
             sec.includes("writing") ||
             sec.includes("rw");
    }
  });
  
  if (params.excludeCanonicalIds.length > 0) {
    const excludeSet = new Set(params.excludeCanonicalIds);
    candidates = candidates.filter((q: any) => {
      const canonicalId = q.id;
      return !excludeSet.has(canonicalId);
    });
  }
  
  candidates = candidates.map((q: any) => ({
    ...q,
    canonical_id: q.id,
    difficulty_bucket: normalizeDifficulty(q.difficulty),
  }));
  
  return candidates.slice(0, limit);
}

export async function selectNextQuestionForStudent(
  params: SelectNextParams
): Promise<SelectNextResult> {
  const {
    userId,
    section,
    sessionId,
    attemptIndex = 0,
    target,
    difficultyPolicy = "auto",
    excludeCanonicalIds = [],
  } = params;
  
  const mode: SelectionMode = target?.mode || "balanced";
  const filterPath: string[] = [];
  
  const recentlyAttempted = await getRecentlyAttemptedCanonicalIds(userId, section);
  const allExcluded = [...new Set([...excludeCanonicalIds, ...recentlyAttempted])];
  
  const excludeHash = simpleHash(allExcluded.sort().join(","));
  const determineSeed = `${userId}:${sessionId || "nosession"}:${section}:${attemptIndex}:${excludeHash}`;
  
  let baselineDifficulty: DifficultyBucket;
  let targetDifficulty: DifficultyBucket;
  
  if (difficultyPolicy === "auto") {
    baselineDifficulty = await computeBaselineDifficulty(userId, section);
    targetDifficulty = pickDifficultyWithWeights(baselineDifficulty, determineSeed);
    filterPath.push(`baseline=${baselineDifficulty},picked=${targetDifficulty}`);
  } else {
    baselineDifficulty = difficultyPolicy as DifficultyBucket;
    targetDifficulty = difficultyPolicy as DifficultyBucket;
    filterPath.push(`fixed-difficulty=${targetDifficulty}`);
  }
  
  let pickedFrom: "cluster" | "skill" | "fallback" = "fallback";
  let weaknessKey: string | undefined;
  let targetClusterId: string | undefined = target?.clusterId;
  let targetDomain: string | undefined = target?.domain;
  let targetSkill: string | undefined = target?.skill;
  
  if (mode === "balanced" || mode === "cluster") {
    if (!targetClusterId) {
      const weakClusters = await getWeakestClusters({ userId, minAttempts: 1, limit: 10 });
      if (weakClusters.length > 0) {
        const picked = weightedDeterministicPick(weakClusters, determineSeed + ":cluster");
        targetClusterId = picked.structure_cluster_id;
        weaknessKey = `cluster:${targetClusterId}`;
        pickedFrom = "cluster";
        filterPath.push(`weighted-cluster=${targetClusterId}(acc=${picked.accuracy.toFixed(2)})`);
      }
    } else {
      pickedFrom = "cluster";
      weaknessKey = `cluster:${targetClusterId}`;
    }
  }
  
  if ((mode === "skill" || (mode === "balanced" && pickedFrom === "fallback")) && !targetSkill) {
    const sectionMap = section === "math" ? "math" : "reading";
    const weakSkills = await getWeakestSkills({ 
      userId, 
      section: sectionMap, 
      minAttempts: 1, 
      limit: 10 
    });
    if (weakSkills.length > 0) {
      const picked = weightedDeterministicPick(weakSkills, determineSeed + ":skill");
      targetDomain = picked.domain || undefined;
      targetSkill = picked.skill;
      weaknessKey = `skill:${targetDomain}/${targetSkill}`;
      pickedFrom = "skill";
      filterPath.push(`weighted-skill=${targetDomain}/${targetSkill}(acc=${picked.accuracy.toFixed(2)})`);
    }
  }
  
  const relaxationSteps: Array<{ 
    difficulty?: DifficultyBucket; 
    skill?: string; 
    domain?: string; 
    clusterId?: string;
    label: string;
  }> = [
    { 
      difficulty: targetDifficulty, 
      skill: targetSkill, 
      domain: targetDomain, 
      clusterId: targetClusterId,
      label: "full-filter"
    },
    { 
      difficulty: "unknown", 
      skill: targetSkill, 
      domain: targetDomain, 
      clusterId: targetClusterId,
      label: "relax-difficulty"
    },
    { 
      difficulty: "unknown", 
      skill: undefined, 
      domain: targetDomain, 
      clusterId: targetClusterId,
      label: "drop-skill"
    },
    { 
      difficulty: "unknown", 
      skill: undefined, 
      domain: undefined, 
      clusterId: targetClusterId,
      label: "drop-domain"
    },
    { 
      difficulty: "unknown", 
      skill: undefined, 
      domain: undefined, 
      clusterId: undefined,
      label: "section-only"
    },
  ];
  
  for (let stepIndex = 0; stepIndex < relaxationSteps.length; stepIndex++) {
    const step = relaxationSteps[stepIndex];
    const candidates = await queryCandidateQuestions({
      section,
      difficultyBucket: step.difficulty,
      domain: step.domain,
      skill: step.skill,
      clusterId: step.clusterId,
      excludeCanonicalIds: allExcluded,
      limit: 60,
    });
    
    if (candidates.length > 0) {
      const question = deterministicPick(candidates, determineSeed + ":question:" + stepIndex);
      filterPath.push(`found-at=${step.label}(${candidates.length})`);
      
      const finalPickedFrom = stepIndex >= 4 ? "fallback" : pickedFrom;
      
      return {
        question: mapToStudentQuestion(question),
        rationale: {
          mode,
          pickedFrom: finalPickedFrom,
          weaknessKey: finalPickedFrom !== "fallback" ? weaknessKey : undefined,
          difficultyPicked: targetDifficulty,
          relaxStepUsed: stepIndex,
          filterPath,
          candidateCount: candidates.length,
        },
      };
    }
  }
  
  const lastResort = await queryCandidateQuestions({
    section,
    excludeCanonicalIds: [],
    limit: 60,
  });
  
  if (lastResort.length > 0) {
    const question = deterministicPick(lastResort, determineSeed + ":lastresort");
    filterPath.push("last-resort-no-exclusions");
    
    return {
      question: mapToStudentQuestion(question),
      rationale: {
        mode,
        pickedFrom: "fallback",
        difficultyPicked: targetDifficulty,
        relaxStepUsed: 5,
        filterPath,
        candidateCount: lastResort.length,
      },
    };
  }
  
  throw new Error(`No questions available for section: ${section}`);
}

function mapToStudentQuestion(q: any): any {
  const type = q.type || q.question_type || (q.options ? "mc" : "fr");
  
  let options: any[] = [];
  if (Array.isArray(q.options)) {
    options = q.options;
  } else if (typeof q.options === "string") {
    try {
      options = JSON.parse(q.options);
    } catch {
      options = [];
    }
  }
  
  const classification = q.classification || {};
  
  return {
    id: q.id,
    canonicalId: q.canonical_id || q.id,
    stem: q.stem,
    section: q.section,
    type,
    options: type === "mc" ? options : undefined,
    explanation: q.explanation ?? null,
    source: {
      mapping: q.source_mapping ?? null,
      page: q.page_number ?? null,
    },
    tags: Array.isArray(q.tags) ? q.tags : [],
    domain: classification.domain || null,
    skill: classification.skill || null,
    subskill: classification.subskill || null,
    difficultyBucket: q.difficulty_bucket || normalizeDifficulty(q.difficulty),
    structureClusterId: null,
    answerChoice: q.answer_choice || null,
    answerText: q.answer_text || null,
  };
}
