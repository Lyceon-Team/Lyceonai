import { getSupabaseAdmin } from "../lib/supabase-admin";
import { fetchWeakestSkills } from "./mastery-read";
import { isValidCanonicalId } from "../../../../shared/question-bank-contract";

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
  pickedFrom: "skill" | "fallback";
  weaknessKey?: string;
  difficultyPicked?: DifficultyBucket;
  relaxStepUsed?: number;
  filterPath?: string[];
  candidateCount?: number;
  sourceWarnings?: string[];
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

function weightedDeterministicPick<T extends { accuracy: number }>(items: T[], seed: string): T {
  if (items.length === 0) throw new Error("Cannot pick from empty array");
  if (items.length === 1) return items[0];

  const weights = items.map((item) => Math.max(0.1, 1 - item.accuracy));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = weights.map((w) => w / totalWeight);
  const randomPoint = (simpleHash(seed) % 10000) / 10000;

  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += normalizedWeights[i];
    if (randomPoint <= cumulative) return items[i];
  }

  return items[items.length - 1];
}

function getDifficultyWeights(baseline: DifficultyBucket): { easy: number; medium: number; hard: number } {
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

function pickDifficultyWithWeights(baseline: DifficultyBucket, seed: string): DifficultyBucket {
  const weights = getDifficultyWeights(baseline);
  const randomPoint = (simpleHash(seed + ":difficulty") % 10000) / 10000;

  let cumulative = 0;
  cumulative += weights.easy;
  if (randomPoint <= cumulative) return "easy";

  cumulative += weights.medium;
  if (randomPoint <= cumulative) return "medium";

  return "hard";
}

function normalizeDifficulty(difficulty: string | null | undefined): DifficultyBucket {
  if (!difficulty) return "medium";
  const lower = difficulty.toLowerCase();
  if (lower === "easy") return "easy";
  if (lower === "hard") return "hard";
  return "medium";
}

async function computeBaselineDifficulty(userId: string, section: SectionFilter): Promise<DifficultyBucket> {
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

  const { data, error } = await query.order("occurred_at", { ascending: false }).limit(20);

  if (error || !data || data.length < 5) return "medium";

  const accuracy = data.filter((a: any) => a.is_correct).length / data.length;
  if (accuracy < 0.5) return "easy";
  if (accuracy < 0.75) return "medium";
  return "hard";
}

async function getRecentlyAttemptedCanonicalIds(userId: string, section: SectionFilter, dayLimit = 14): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - dayLimit);

  const sectionFilter = section === "math" ? "math" : ["reading", "writing", "rw"];

  let query: any = supabase
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
  if (error || !data) return [];

  return data.map((r: any) => r.question_canonical_id).filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
}

interface CandidateQuery {
  section: SectionFilter;
  difficultyBucket?: DifficultyBucket;
  domain?: string;
  skill?: string;
  excludeCanonicalIds: string[];
  limit?: number;
}

function parseOptions(raw: unknown): Array<{ key: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => {
    return item && typeof item === "object" && typeof (item as any).key === "string" && typeof (item as any).text === "string";
  }) as Array<{ key: string; text: string }>;
}

function getCanonicalIdOrNull(q: any): string | null {
  const value = typeof q?.canonical_id === 'string' ? q.canonical_id.trim() : '';
  if (!value || !isValidCanonicalId(value)) {
    return null;
  }
  return value;
}
async function queryCandidateQuestions(params: CandidateQuery): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  const limit = params.limit || 60;

  let query: any = supabase
    .from("questions")
    .select(`
      id,
      canonical_id,
      stem,
      section_code,
      question_type,
      options,
      difficulty,
      explanation,
      domain,
      skill,
      subskill,
      skill_code,
      correct_answer,
      answer_text,
      test_code,
      source_type,
      tags,
      diagram_present
    `)
    .eq("question_type", "multiple_choice")
    .limit(limit * 2);

  if (params.section === "math") {
    query = query.eq("section_code", "MATH");
  } else {
    query = query.eq("section_code", "RW");
  }

  if (params.domain) {
    query = query.eq("domain", params.domain);
  }

  if (params.skill) {
    query = query.eq("skill", params.skill);
  }

  if (params.difficultyBucket && params.difficultyBucket !== "unknown") {
    query = query.ilike("difficulty", params.difficultyBucket);
  }

  const { data, error } = await query;
  if (error) return [];

  const excludeSet = new Set(params.excludeCanonicalIds);

  return (data || [])
    .filter((q: any) => {
      const cid = getCanonicalIdOrNull(q);
      return !!cid && !excludeSet.has(cid);
    })
    .map((q: any) => ({
      ...q,
      canonical_id: getCanonicalIdOrNull(q)!,
      options: parseOptions(q.options),
    }))
    .slice(0, limit);
}

export async function selectNextQuestionForStudent(params: SelectNextParams): Promise<SelectNextResult> {
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

  let pickedFrom: "skill" | "fallback" = "fallback";
  let weaknessKey: string | undefined;
  let targetDomain: string | undefined = target?.domain;
  let targetSkill: string | undefined = target?.skill;
  const sourceWarnings: string[] = [];

  if ((mode === "skill" || mode === "balanced") && !targetSkill) {
    const sectionMap = section === "math" ? "math" : "reading";
    let weakSkills: Array<{ domain: string | null; skill: string; accuracy: number }> = [];
    try {
      weakSkills = await fetchWeakestSkills({
        userId,
        section: sectionMap,
        minAttempts: 1,
        limit: 10,
        failOnError: true,
      });
    } catch {
      sourceWarnings.push("weak_skills_source_failed");
      filterPath.push("weakest-skills-source-failed");
    }

    if (weakSkills.length > 0) {
      const picked = weightedDeterministicPick(weakSkills, determineSeed + ":skill");
      targetDomain = picked.domain || undefined;
      targetSkill = picked.skill;
      weaknessKey = `skill:${targetDomain}/${targetSkill}`;
      pickedFrom = "skill";
      filterPath.push(`weighted-skill=${targetDomain}/${targetSkill}(acc=${picked.accuracy.toFixed(2)})`);
    }
  }

  const relaxationSteps: Array<{ difficulty?: DifficultyBucket; skill?: string; domain?: string; label: string }> = [
    { difficulty: targetDifficulty, skill: targetSkill, domain: targetDomain, label: "full-filter" },
    { difficulty: "unknown", skill: targetSkill, domain: targetDomain, label: "relax-difficulty" },
    { difficulty: "unknown", skill: undefined, domain: targetDomain, label: "drop-skill" },
    { difficulty: "unknown", skill: undefined, domain: undefined, label: "section-only" },
  ];

  for (let stepIndex = 0; stepIndex < relaxationSteps.length; stepIndex++) {
    const step = relaxationSteps[stepIndex];
    const candidates = await queryCandidateQuestions({
      section,
      difficultyBucket: step.difficulty,
      domain: step.domain,
      skill: step.skill,
      excludeCanonicalIds: allExcluded,
      limit: 60,
    });

    if (candidates.length > 0) {
      const question = deterministicPick(candidates, determineSeed + ":question:" + stepIndex);
      filterPath.push(`found-at=${step.label}(${candidates.length})`);

      return {
        question: mapToStudentQuestion(question),
        rationale: {
          mode,
          pickedFrom,
          weaknessKey: pickedFrom !== "fallback" ? weaknessKey : undefined,
          difficultyPicked: targetDifficulty,
          relaxStepUsed: stepIndex,
          filterPath,
          candidateCount: candidates.length,
          sourceWarnings: sourceWarnings.length > 0 ? sourceWarnings : undefined,
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
        relaxStepUsed: 4,
        filterPath,
        candidateCount: lastResort.length,
        sourceWarnings: sourceWarnings.length > 0 ? sourceWarnings : undefined,
      },
    };
  }

  throw new Error(`No questions available for section: ${section}`);
}

function mapToStudentQuestion(q: any): any {
  const canonicalId = getCanonicalIdOrNull(q);
  if (!canonicalId) {
    throw new Error("question_missing_canonical_id");
  }
  const sectionCode = q.section_code;
  return {
    id: q.id,
    canonical_id: canonicalId,
    stem: q.stem,
    section_code: sectionCode,
    question_type: "multiple_choice",
    options: q.options,
    explanation: q.explanation ?? null,
    tags: q.tags ?? [],
    domain: q.domain ?? null,
    skill: q.skill ?? null,
    subskill: q.subskill ?? null,
    skill_code: q.skill_code ?? null,
    difficulty: q.difficulty ?? null,
  };
}
