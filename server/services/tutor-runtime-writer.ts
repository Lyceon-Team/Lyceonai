/**
 * @spec [Doc-03A_V1 §11, Doc-03A_V3 §18.4, Doc-03B_V4.1 §6.5 step 12, INV-03-11]
 * @implemented 2026-08-09
 * @updated 2026-08-12 — P0-1: typed policy_variant/emotional_register to schema
 *   CHECK values, return assignment id for step 18 exposure FK.
 *
 * plain English: Blocking write of the instructional assignment record to
 * tutor_instruction_assignments. Per Doc 03B §1.4, policy-assignment
 * persistence is blocking for every turn — if this write fails, the turn
 * is not treated as successful and the API does not return a response
 * claiming success while canonical logs are missing.
 *
 * expected outcome: one row inserted per tutor turn capturing the policy
 * family, variant, version, assignment mode, and reasoning snapshot.
 * Returns { ok: true, assignmentId } on success so step 18 can set the
 * exposure FK. On failure, returns { ok: false } so the caller can fail
 * the turn.
 *
 * trade-offs: this is a hard write gate — a DB outage blocks turns entirely.
 * This is the spec's explicit choice (§1.4): canonical logs missing = turn
 * not successful.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";

// Schema-valid values per Doc 03A §18.4, §11.4 V1 starter set.
// These match the CHECK constraints on tutor_instruction_assignments exactly.
type PolicyVariant = "concise" | "scaffolded" | "socratic" | "strategy_first";
type EmotionalRegister = "default" | "elite" | "recovery" | "sprint" | "calm";

export type InstructionAssignmentParams = {
  conversationId: string;
  studentId: string;
  relatedMessageId: string;
  sourceSessionId: string | null;
  sourceSessionItemId: string | null;
  sourceQuestionRowId: string | null;
  policyFamily: string;
  policyVariant: PolicyVariant;
  policyVersion: string;
  promptVersion: string | null;
  assignmentMode: "deterministic" | "explore" | "manual_override";
  assignmentKey: string;
  /** Pass undefined to accept the DB default ('default'). */
  emotionalRegister?: EmotionalRegister;
  reasonSnapshot: Record<string, unknown>;
};

type WriteResult =
  | { ok: true; assignmentId: string }
  | { ok: false; error: string };

export async function persistInstructionAssignment(
  params: InstructionAssignmentParams,
): Promise<WriteResult> {
  try {
    // Build the insert payload. When emotionalRegister is undefined, omit it
    // so the DB column DEFAULT ('default') applies — never pass null against
    // a NOT NULL column.
    const insertPayload: Record<string, unknown> = {
      conversation_id: params.conversationId,
      student_id: params.studentId,
      related_message_id: params.relatedMessageId,
      source_session_id: params.sourceSessionId,
      source_session_item_id: params.sourceSessionItemId,
      source_question_row_id: params.sourceQuestionRowId,
      policy_family: params.policyFamily,
      policy_variant: params.policyVariant,
      policy_version: params.policyVersion,
      prompt_version: params.promptVersion,
      assignment_mode: params.assignmentMode,
      assignment_key: params.assignmentKey,
      reason_snapshot: params.reasonSnapshot,
    };
    if (params.emotionalRegister !== undefined) {
      insertPayload.emotional_register = params.emotionalRegister;
    }

    const { data, error } = await supabaseServer
      .from("tutor_instruction_assignments")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error || !data) {
      logger.error(
        "TUTOR_RUNTIME_WRITER",
        "instruction_assignment_write_failed",
        "Failed to persist instructional assignment row; turn MUST fail (§1.4 blocking)",
        {
          conversationId: params.conversationId,
          studentId: params.studentId,
          dbError: error?.message ?? "no data returned",
          code: error?.code,
        },
      );
      return { ok: false, error: error?.message ?? "no data returned" };
    }

    return { ok: true, assignmentId: data.id as string };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "TUTOR_RUNTIME_WRITER",
      "instruction_assignment_write_error",
      "Unexpected error persisting instructional assignment row; turn MUST fail (§1.4 blocking)",
      {
        conversationId: params.conversationId,
        studentId: params.studentId,
        error: message,
      },
    );
    return { ok: false, error: message };
  }
}
