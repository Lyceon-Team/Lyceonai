/**
 * CANONICAL MASTERY WRITE CHOKE POINT
 * 
 * Sprint 3 PR-1: This module is the ONLY place in the codebase that writes to:
 * - student_skill_mastery
 * - student_cluster_mastery
 * 
 * ALL mastery updates MUST flow through applyMasteryUpdate().
 * 
 * DO NOT:
 * - Add direct .insert/.update/.upsert calls to mastery tables elsewhere
 * - Create additional RPC calls for mastery writes
 * - Bypass this choke point
 * 
 * WHY: Single choke point ensures:
 * - Consistent mastery calculation logic
 * - Easier debugging and monitoring
 * - Prevention of race conditions
 * - Single source of truth for mastery algorithm
 * 
 * ENFORCEMENT: tests/mastery.writepaths.guard.test.ts validates this invariant.
 */

import { getSupabaseAdmin } from "../lib/supabase-admin";
import { 
  MasteryEventType, 
  EVENT_WEIGHTS, 
  DEFAULT_QUESTION_WEIGHT 
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

/**
 * applyMasteryUpdate - CANONICAL CHOKE POINT for all mastery writes
 * 
 * This function:
 * 1. Validates event type (must be in MasteryEventType enum)
 * 2. Logs the attempt to student_question_attempts
 * 3. Updates student_skill_mastery via RPC (if metadata available and event is scored)
 * 4. Updates student_cluster_mastery via RPC (if cluster ID available and event is scored)
 * 
 * CRITICAL: This is the ONLY function that should write to mastery tables.
 * All mastery updates in the application MUST call this function.
 * 
 * Mastery v1.0: Uses event-weighted delta formula with EMA-style updates.
 * - TUTOR_VIEW does not change mastery (no-op for mastery updates)
 * - All other event types trigger mastery updates with their respective weights
 * 
 * Sprint 3 PR-4: Enhanced with difficulty weights and deterministic rounding:
 * - Per-question difficulty weights (easy=1.0, medium=1.1, hard=1.2)
 * - Deterministic rounding for E/C, accuracy, and mastery_score
 * - Event type passed as TEXT to RPC for dynamic weight lookup
 * 
 * @param input - Attempt data including user, question, correctness, event type, and metadata
 * @returns AttemptResult with attemptId and status
 */
export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();
  
  // Validate event type (closed set enforcement)
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
  
  // Get event weight for this event type
  const eventWeight = EVENT_WEIGHTS[input.eventType];
  const questionWeight = input.questionWeight || DEFAULT_QUESTION_WEIGHT;
  
  // TUTOR_VIEW is a no-op for mastery - we still log the attempt but don't update mastery
  const shouldUpdateMastery = input.eventType !== MasteryEventType.TUTOR_VIEW;
  
  // Step 1: Log raw attempt (not a mastery table, but part of the write transaction)
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
      skill_code: input.metadata.skill_code,
      difficulty: input.metadata.difficulty,
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

  // Step 2: Update student_skill_mastery (CANONICAL WRITE #1)
  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_skill_mastery
  // Using True Half-Life formula with difficulty weights and deterministic rounding
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
        p_difficulty: input.metadata.difficulty || null,
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

  // Step 3: Update student_cluster_mastery (CANONICAL WRITE #2)
  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_cluster_mastery
  // Using True Half-Life formula with difficulty weights and deterministic rounding
  if (shouldUpdateMastery && input.metadata.structure_cluster_id) {
    try {
      const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
        p_user_id: input.userId,
        p_structure_cluster_id: input.metadata.structure_cluster_id,
        p_is_correct: input.isCorrect,
        p_event_weight: eventWeight,
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

/**
 * Legacy alias for backward compatibility.
 * 
 * @deprecated Use applyMasteryUpdate() instead for clarity.
 * This alias exists to minimize code changes during the Sprint 3 PR-1 refactor.
 */
export const logAttemptAndUpdateMastery = applyMasteryUpdate;





