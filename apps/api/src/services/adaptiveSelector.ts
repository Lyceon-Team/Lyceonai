import { getSupabaseAdmin } from "../lib/supabase-admin";
<<<<<<< HEAD
=======
import { getWeakestSkills } from "./studentMastery";
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

export type SectionFilter = "math" | "rw";
export type SelectionMode = "balanced" | "skill" | "cluster";
export type DifficultyPolicy = "auto" | 1 | 2 | 3;

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
    skillCode?: string;
  };
  difficultyPolicy?: DifficultyPolicy;
  excludeCanonicalIds?: string[];
}

export interface SelectionRationale {
  mode: SelectionMode;
  pickedFrom: "skill" | "fallback";
  weaknessKey?: string;
  difficultyPicked?: 1 | 2 | 3;
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
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function deterministicPick<T>(items: T[], seed: string): T {
  if (!items.length) throw new Error("Cannot pick from an empty list");
  const index = simpleHash(seed) % items.length;
  return items[index];
}

<<<<<<< HEAD
function normalizeDifficulty(value: unknown): 1 | 2 | 3 {
  const numeric = Number(value);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  return 2;
}

async function queryCandidateQuestions(params: {
  section: SectionFilter;
  difficulty?: 1 | 2 | 3;
  domain?: string;
  skill?: string;
  skillCode?: string;
  excludeCanonicalIds: string[];
  limit?: number;
}): Promise<any[]> {
=======
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

async function queryCandidateQuestions(params: CandidateQuery): Promise<any[]> {
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  const supabase = getSupabaseAdmin();
  const limit = params.limit || 60;

  let query: any = supabase
    .from("questions")
<<<<<<< HEAD
    .select("id, canonical_id, section, section_code, question_type, stem, options, difficulty, domain, skill, subskill, skill_code, tags, competencies, explanation")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .eq("section_code", params.section === "math" ? "MATH" : "RW");

  if (params.difficulty) query = query.eq("difficulty", params.difficulty);
  if (params.domain) query = query.eq("domain", params.domain);
  if (params.skill) query = query.eq("skill", params.skill);
  if (params.skillCode) query = query.eq("skill_code", params.skillCode);
  query = query.limit(limit * 2);
=======
    .select(`
      id,
      canonical_id,
      stem,
      section,
      section_code,
      question_type,
      options,
      difficulty,
      explanation,
      tags,
      competencies,
      domain,
      skill,
      subskill,
      skill_code,
      correct_answer,
      answer_text,
      status
    `)
    .eq("question_type", "multiple_choice")
    .eq("status", "reviewed")
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
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

  const { data, error } = await query;
  if (error) return [];

<<<<<<< HEAD
  const excluded = new Set(params.excludeCanonicalIds);
  return (data || []).filter((row: any) => {
    const cid = row.canonical_id || row.id;
    return !excluded.has(cid);
  });
}

function toStudentQuestion(row: any) {
  return {
    id: row.id,
    canonicalId: row.canonical_id || row.id,
    section: row.section,
    section_code: row.section_code,
    question_type: "multiple_choice" as const,
    stem: row.stem,
    options: Array.isArray(row.options) ? row.options : [],
    difficulty: normalizeDifficulty(row.difficulty),
    domain: row.domain ?? null,
    skill: row.skill ?? null,
    subskill: row.subskill ?? null,
    skill_code: row.skill_code ?? null,
    tags: row.tags ?? null,
    competencies: row.competencies ?? null,
    explanation: row.explanation ?? null,
  };
=======
  const excludeSet = new Set(params.excludeCanonicalIds);

  return (data || [])
    .filter((q: any) => {
      const cid = q.canonical_id || q.id;
      return !excludeSet.has(cid);
    })
    .map((q: any) => ({
      ...q,
      canonical_id: q.canonical_id || q.id,
      options: parseOptions(q.options),
    }))
    .slice(0, limit);
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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

<<<<<<< HEAD
  const pickedDifficulty: 1 | 2 | 3 = difficultyPolicy === "auto" ? 2 : difficultyPolicy;
  filterPath.push(`difficulty=${pickedDifficulty}`);

  const candidates = await queryCandidateQuestions({
=======
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

  if ((mode === "skill" || mode === "balanced") && !targetSkill) {
    const sectionMap = section === "math" ? "math" : "reading";
    const weakSkills = await getWeakestSkills({ userId, section: sectionMap, minAttempts: 1, limit: 10 });

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
        },
      };
    }
  }

  const lastResort = await queryCandidateQuestions({
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
    section,
    difficulty: pickedDifficulty,
    domain: target?.domain,
    skill: target?.skill,
    skillCode: target?.skillCode,
    excludeCanonicalIds,
    limit: 60,
  });

<<<<<<< HEAD
  if (candidates.length > 0) {
    const seed = `${userId}:${sessionId || "nosession"}:${section}:${attemptIndex}`;
    const question = deterministicPick(candidates, seed);
=======
  if (lastResort.length > 0) {
    const question = deterministicPick(lastResort, determineSeed + ":lastresort");
    filterPath.push("last-resort-no-exclusions");
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f

    return {
      question: toStudentQuestion(question),
      rationale: {
        mode,
<<<<<<< HEAD
        pickedFrom: target?.skill || target?.skillCode ? "skill" : "fallback",
        weaknessKey: target?.skillCode || target?.skill || undefined,
        difficultyPicked: pickedDifficulty,
        relaxStepUsed: 0,
=======
        pickedFrom: "fallback",
        difficultyPicked: targetDifficulty,
        relaxStepUsed: 4,
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
        filterPath,
        candidateCount: candidates.length,
      },
    };
  }
<<<<<<< HEAD

  const fallback = await queryCandidateQuestions({
    section,
    excludeCanonicalIds,
    limit: 60,
  });

  if (!fallback.length) {
    throw new Error(`No questions available for section: ${section}`);
  }

  const seed = `${userId}:${sessionId || "nosession"}:${section}:${attemptIndex}:fallback`;
  const question = deterministicPick(fallback, seed);

  return {
    question: toStudentQuestion(question),
    rationale: {
      mode,
      pickedFrom: "fallback",
      difficultyPicked: pickedDifficulty,
      relaxStepUsed: 1,
      filterPath: [...filterPath, "fallback"],
      candidateCount: fallback.length,
    },
=======

  throw new Error(`No questions available for section: ${section}`);
}

function mapToStudentQuestion(q: any): any {
  return {
    id: q.id,
    canonicalId: q.canonical_id || q.id,
    stem: q.stem,
    section: q.section,
    sectionCode: q.section_code,
    questionType: 'multiple_choice',
    options: q.options,
    explanation: q.explanation ?? null,
    tags: Array.isArray(q.tags) ? q.tags : [],
    competencies: Array.isArray(q.competencies) ? q.competencies : [],
    domain: q.domain ?? null,
    skill: q.skill ?? null,
    subskill: q.subskill ?? null,
    skillCode: q.skill_code ?? null,
    difficulty: q.difficulty ?? null,
    correctAnswer: q.correct_answer ?? null,
    answerText: q.answer_text ?? null,
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  };
}
