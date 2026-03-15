import { supabaseServer } from "../lib/supabase-server";
import { getSupabaseAdmin } from "../lib/supabase-admin";

<<<<<<< HEAD
export type { QuestionMetadataSnapshot, AttemptInput, AttemptResult };

export {
  applyMasteryUpdate,
  logAttemptAndUpdateMastery,
} from "./mastery-write";
=======
export interface QuestionMetadataSnapshot {
  exam: string | null;
  section: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  difficulty_bucket: string | null;
  structure_cluster_id: string | null;
}

export interface AttemptInput {
  userId: string;
  questionCanonicalId: string;
  sessionId?: string | null;
  isCorrect: boolean;
  selectedChoice?: string | null;
  timeSpentMs?: number | null;
  metadata: QuestionMetadataSnapshot;
}

export interface AttemptResult {
  attemptId: string;
  rollupUpdated: boolean;
  error?: string;
}

export async function logAttemptAndUpdateMastery(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();
  
  const attemptId = crypto.randomUUID();
  let rollupUpdated = true;
  let rollupError: string | undefined;
  
  const { error: insertError } = await supabase
    .from("student_question_attempts")
    .insert({
      id: attemptId,
      user_id: input.userId,
      question_canonical_id: input.questionCanonicalId,
      session_id: input.sessionId || null,
      is_correct: input.isCorrect,
      selected_choice: input.selectedChoice || null,
      time_spent_ms: input.timeSpentMs || null,
      exam: input.metadata.exam,
      section: input.metadata.section,
      domain: input.metadata.domain,
      skill: input.metadata.skill,
      subskill: input.metadata.subskill,
      difficulty_bucket: input.metadata.difficulty_bucket,
      structure_cluster_id: input.metadata.structure_cluster_id,
    });

  if (insertError) {
    console.error("[Mastery] Failed to log attempt:", insertError.message);
    return {
      attemptId,
      rollupUpdated: false,
      error: `Failed to log attempt: ${insertError.message}`,
    };
  }

  if (input.metadata.section && input.metadata.skill) {
    try {
      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
        p_user_id: input.userId,
        p_section: input.metadata.section,
        p_domain: input.metadata.domain || "unknown",
        p_skill: input.metadata.skill,
        p_is_correct: input.isCorrect,
      });
      
      if (skillError) {
        console.warn("[Mastery] Skill rollup failed:", skillError.message);
        rollupUpdated = false;
        rollupError = skillError.message;
      }
    } catch (err: any) {
      console.warn("[Mastery] Skill rollup error:", err.message);
      rollupUpdated = false;
      rollupError = err.message;
    }
  }

  if (input.metadata.structure_cluster_id) {
    try {
      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
        p_user_id: input.userId,
        p_structure_cluster_id: input.metadata.structure_cluster_id,
        p_is_correct: input.isCorrect,
      });
      
      if (clusterError) {
        console.warn("[Mastery] Cluster rollup failed:", clusterError.message);
        rollupUpdated = false;
        rollupError = clusterError.message;
      }
    } catch (err: any) {
      console.warn("[Mastery] Cluster rollup error:", err.message);
      rollupUpdated = false;
      rollupError = err.message;
    }
  }

  return {
    attemptId,
    rollupUpdated,
    error: rollupError,
  };
}
>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b

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
    return [];
  }

  return data || [];
}

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







