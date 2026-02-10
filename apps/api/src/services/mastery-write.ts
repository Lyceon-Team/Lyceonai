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

/**
 * applyMasteryUpdate - CANONICAL CHOKE POINT for all mastery writes
 * 
 * This function:
 * 1. Logs the attempt to student_question_attempts
 * 2. Updates student_skill_mastery via RPC (if metadata available)
 * 3. Updates student_cluster_mastery via RPC (if cluster ID available)
 * 
 * CRITICAL: This is the ONLY function that should write to mastery tables.
 * All mastery updates in the application MUST call this function.
 * 
 * @param input - Attempt data including user, question, correctness, and metadata
 * @returns AttemptResult with attemptId and status
 */
export async function applyMasteryUpdate(input: AttemptInput): Promise<AttemptResult> {
  const supabase = getSupabaseAdmin();
  
  const attemptId = crypto.randomUUID();
  let rollupUpdated = true;
  let rollupError: string | undefined;
  
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

  // Step 2: Update student_skill_mastery (CANONICAL WRITE #1)
  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_skill_mastery
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

  // Step 3: Update student_cluster_mastery (CANONICAL WRITE #2)
  // This RPC performs INSERT...ON CONFLICT DO UPDATE on student_cluster_mastery
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

/**
 * Legacy alias for backward compatibility.
 * 
 * @deprecated Use applyMasteryUpdate() instead for clarity.
 * This alias exists to minimize code changes during the Sprint 3 PR-1 refactor.
 */
export const logAttemptAndUpdateMastery = applyMasteryUpdate;
