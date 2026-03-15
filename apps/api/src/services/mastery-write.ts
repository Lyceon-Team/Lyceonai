/**
 * CANONICAL MASTERY WRITE CHOKE POINT
 *
 * All runtime mastery-affecting flows must call applyMasteryUpdate().
 * Canonical rollup tables mutated by this choke point: student_skill_mastery, student_cluster_mastery.
 * No other runtime path may directly mutate canonical mastery tables.
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  MasteryEventType,
  EVENT_WEIGHTS,
  DEFAULT_QUESTION_WEIGHT,
} from "./mastery-constants";

export interface QuestionMetadataSnapshot {
  exam: string | null;
  section: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  difficulty: 1 | 2 | 3 | null;
  structure_cluster_id: string | null;
}

export interface AttemptInput {
  userId: string;
  questionCanonicalId: string;
  sessionId?: string | null;
  isCorrect: boolean;
  selectedChoice?: string | null;
  timeSpentMs?: number | null;
  eventType: MasteryEventType;
  questionWeight?: number;
  metadata: QuestionMetadataSnapshot;
}

export interface AttemptResult {
  attemptId: string;
  rollupUpdated: boolean;
  error?: string;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();

  if (!(input.eventType in EVENT_WEIGHTS)) {
    return {
      attemptId: "",
      rollupUpdated: false,
      error: `Invalid event type: ${input.eventType}. Must be one of: ${Object.keys(EVENT_WEIGHTS).join(", ")}`,
    };
  }

  const canonicalQuestionId = normalizeText(input.questionCanonicalId);
  const section = normalizeText(input.metadata.section);
  const domain = normalizeText(input.metadata.domain) || "unknown";
  const skill = normalizeText(input.metadata.skill);
  const skillCode = normalizeText(input.metadata.skill_code);
  const eventWeight = EVENT_WEIGHTS[input.eventType];
  const questionWeight = input.questionWeight || DEFAULT_QUESTION_WEIGHT;

  if (!canonicalQuestionId) {
    return {
      attemptId: "",
      rollupUpdated: false,
      error: "Missing canonical question id for mastery update",
    };
  }

  if (!section) {
    return {
      attemptId: "",
      rollupUpdated: false,
      error: "Missing section for mastery update",
    };
  }

  if (!skill && !skillCode) {
    return {
      attemptId: "",
      rollupUpdated: false,
      error: "Missing skill mapping for mastery update",
    };
  }

  const attemptId = crypto.randomUUID();
  let rollupUpdated = true;
  let rollupError: string | undefined;

  const { error: insertError } = await supabase
    .from("student_question_attempts")
    .insert({
      id: attemptId,
      user_id: input.userId,
      question_canonical_id: canonicalQuestionId,
      session_id: input.sessionId || null,
      is_correct: input.isCorrect,
      selected_choice: input.selectedChoice || null,
      time_spent_ms: input.timeSpentMs || null,
      event_type: input.eventType,
      exam: normalizeText(input.metadata.exam),
      section,
      domain,
      skill: skill || skillCode,
      subskill: normalizeText(input.metadata.subskill),
      skill_code: skillCode,
      difficulty: input.metadata.difficulty,
      structure_cluster_id: normalizeText(input.metadata.structure_cluster_id),
    });

  if (insertError) {
    return {
      attemptId,
      rollupUpdated: false,
      error: `Failed to log attempt: ${insertError.message}`,
    };
  }

  try {
    const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
      p_user_id: input.userId,
      p_section: section,
      p_domain: domain,
      p_skill: skill || skillCode,
      p_is_correct: input.isCorrect,
      p_event_weight: eventWeight * questionWeight,
      p_event_type: input.eventType,
      p_difficulty: input.metadata.difficulty || null,
    });

    if (skillError) {
      rollupUpdated = false;
      rollupError = skillError.message;
    }
  } catch (err: any) {
    console.warn("[Mastery] Skill rollup error:", err.message);
    rollupUpdated = false;
    rollupError = err.message;
  }

  if (input.metadata.structure_cluster_id) {
    try {
      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
        p_user_id: input.userId,
        p_structure_cluster_id: input.metadata.structure_cluster_id,
        p_is_correct: input.isCorrect,
        p_event_weight: eventWeight * questionWeight,
        p_event_type: input.eventType,
        p_difficulty: input.metadata.difficulty || null,
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

export const logAttemptAndUpdateMastery = applyMasteryUpdate;
