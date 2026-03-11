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
  difficulty: string | null;
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

export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();

  if (!(input.eventType in EVENT_WEIGHTS)) {
    return {
      attemptId: '',
      rollupUpdated: false,
      error: `Invalid event type: ${input.eventType}. Must be one of: ${Object.keys(EVENT_WEIGHTS).join(', ')}`,
    };
  }

  const attemptId = crypto.randomUUID();
  let rollupUpdated = true;
  let rollupError: string | undefined;

  const eventWeight = EVENT_WEIGHTS[input.eventType];
  const questionWeight = input.questionWeight || DEFAULT_QUESTION_WEIGHT;
  const shouldUpdateMastery = input.eventType !== MasteryEventType.TUTOR_VIEW;

  const difficultyBucket = input.metadata.difficulty?.toLowerCase() || null;

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
      difficulty_bucket: difficultyBucket,
    });

  if (insertError) {
    return {
      attemptId,
      rollupUpdated: false,
      error: `Failed to log attempt: ${insertError.message}`,
    };
  }

  if (shouldUpdateMastery && input.metadata.section && input.metadata.skill) {
    try {
      const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
        p_user_id: input.userId,
        p_section: input.metadata.section,
        p_domain: input.metadata.domain || "unknown",
        p_skill: input.metadata.skill,
        p_is_correct: input.isCorrect,
        p_event_weight: eventWeight,
        p_event_type: input.eventType,
        p_difficulty_bucket: difficultyBucket,
      });

      if (skillError) {
        rollupUpdated = false;
        rollupError = skillError.message;
      }
    } catch (err: any) {
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
