import { getSupabaseAdmin } from "../lib/supabase-admin";

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
  const supabase = getSupabaseAdmin();
  const limit = params.limit || 60;

  let query: any = supabase
    .from("questions")
    .select("id, canonical_id, section, section_code, question_type, stem, options, difficulty, domain, skill, subskill, skill_code, tags, competencies, explanation")
    .eq("status", "published")
    .eq("question_type", "multiple_choice")
    .eq("section_code", params.section === "math" ? "MATH" : "RW");

  if (params.difficulty) query = query.eq("difficulty", params.difficulty);
  if (params.domain) query = query.eq("domain", params.domain);
  if (params.skill) query = query.eq("skill", params.skill);
  if (params.skillCode) query = query.eq("skill_code", params.skillCode);
  query = query.limit(limit * 2);

  const { data, error } = await query;
  if (error) return [];

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

  const pickedDifficulty: 1 | 2 | 3 = difficultyPolicy === "auto" ? 2 : difficultyPolicy;
  filterPath.push(`difficulty=${pickedDifficulty}`);

  const candidates = await queryCandidateQuestions({
    section,
    difficulty: pickedDifficulty,
    domain: target?.domain,
    skill: target?.skill,
    skillCode: target?.skillCode,
    excludeCanonicalIds,
    limit: 60,
  });

  if (candidates.length > 0) {
    const seed = `${userId}:${sessionId || "nosession"}:${section}:${attemptIndex}`;
    const question = deterministicPick(candidates, seed);

    return {
      question: toStudentQuestion(question),
      rationale: {
        mode,
        pickedFrom: target?.skill || target?.skillCode ? "skill" : "fallback",
        weaknessKey: target?.skillCode || target?.skill || undefined,
        difficultyPicked: pickedDifficulty,
        relaxStepUsed: 0,
        filterPath,
        candidateCount: candidates.length,
      },
    };
  }

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
  };
}
