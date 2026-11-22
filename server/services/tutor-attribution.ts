/**
 * @spec [Doc-03A_V3 §11 (every policy decision recorded with enough detail to replay it), §18.4
 *       (tutor_instruction_assignments), §18.6 (tutor_instruction_exposures), §21.1 (write
 *       order: exposures written after the tutor reply); Doc-03D_V1.2 §8.1 ("Without
 *       `prompt_version` and `context_hash`, no outcome can be attributed to any change"); LISA
 *       closure plan W4-12, W4-13, W4-14; owner brief "attribution", Karl 2026-11-22]
 *       | @implemented [2026-11-22]
 *
 * plain English: the per-turn attribution the route records, in one place.
 *  - `readTurnOrdinal`: which turn of the conversation this is, 0-based: the number of earlier
 *    student turns, as stored. Every student row counts, whatever became of its turn (a failed
 *    reply, a crisis bypass, a video tap), so the ordinal is "the Nth time the student sent
 *    something here". Rows removed by the retention sweeps are no longer counted. A retried turn (same client_turn_id) keeps the ordinal it was first given,
 *    counted from its own stored row. Null when the count cannot be read: unknown, never a guessed
 *    0 (the column became nullable for exactly this).
 *  - `contextHash`: sha256 of the request the BFF sends the worker, as canonical JSON (keys sorted
 *    at every level). The same assembled envelope always gives the same hash (W4-14).
 *  - `exposuresForTurn`: what the student saw on a delivered turn, as §18.6 rows: one row for the
 *    reply (a hint at help levels 1 and 2, an explanation otherwise), and one for an offer the
 *    reply carried (a similar question / practice, or broader coaching). Codes only, never text.
 *  - `TURN_OUTCOMES`: how a turn ended, its own column now (W4-12), so `model_name` holds only a
 *    provider model.
 *
 * Edge cases: two different turns sent at the same moment in one conversation can read the same
 * count (no lock); the ordinal is attribution, not a key, and nothing is unique on it. Nothing
 * here logs or stores message text.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type { HelpState } from "../../packages/shared/src/tutor-help-level";
import type { ReviewIntent } from "../../packages/shared/src/tutor-guided-choices";
import type {
  OrchestrateResponse,
  instructionExposureSchema,
} from "../../shared/tutor-orchestrator-wire";
import { logger } from "../logger";

type InstructionExposure = z.infer<typeof instructionExposureSchema>;

/**
 * How a turn ended (tutor_turn_metrics.turn_outcome; the CHECK in
 * 20261208000000_lisa_turn_attribution.sql lists exactly these). `completed` is a delivered reply,
 * from the model or Model Armor's substitution (`model_armor_input_blocked`).
 */
export const TURN_OUTCOMES = [
  "completed",
  "model_armor_input_blocked",
  "crisis_bypass",
  "guided_choice_video",
  "idempotency_replay",
  "idempotency_conflict",
  "idempotency_lookup_error",
  "error:student_message_write_failed",
  "error:crisis_message_write_failed",
  "error:tutor_message_write_failed",
  "error:instruction_assignment_failed",
  "error:orchestration_failed",
  "error:unexpected",
] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/**
 * The 0-based ordinal of this turn in its conversation, or null when it cannot be read.
 * `ownStudentRowCreatedAt`: the created_at of this turn's own student row when it already exists
 * (a retried turn), so the count stops at it; null for a new turn, whose row is not written yet.
 */
export async function readTurnOrdinal(
  conversationId: string,
  ownStudentRowCreatedAt: string | null,
): Promise<number | null> {
  try {
    return await countEarlierTurns(conversationId, ownStudentRowCreatedAt);
  } catch (err: unknown) {
    // Started before it is awaited, so it must never reject: unknown, logged.
    logger.error(
      "TUTOR_RUNTIME",
      "turn_ordinal_read_failed",
      "Could not count the conversation's earlier turns; the turn is recorded with no ordinal",
      { code: err instanceof Error ? err.name : "unknown" },
      { conversationId },
    );
    return null;
  }
}

async function countEarlierTurns(
  conversationId: string,
  ownStudentRowCreatedAt: string | null,
): Promise<number | null> {
  const base = supabaseServer
    .from("tutor_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "student");
  const { count, error } = await (ownStudentRowCreatedAt === null
    ? base
    : base.lt("created_at", ownStudentRowCreatedAt));
  if (error || typeof count !== "number") {
    logger.error(
      "TUTOR_RUNTIME",
      "turn_ordinal_read_failed",
      "Could not count the conversation's earlier turns; the turn is recorded with no ordinal",
      { code: error?.code ?? null },
      { conversationId },
    );
    return null;
  }
  return count;
}

/** Canonical JSON: object keys sorted at every level, arrays in order, undefined dropped. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/** Pure. sha256 (hex) of the request's canonical JSON. */
export function contextHash(request: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

/** One tutor_instruction_exposures row, as the table holds it (§18.6). */
export type ExposureRow = {
  assignment_id: string;
  conversation_id: string;
  student_id: string;
  exposure_type: InstructionExposure["exposure_type"];
  content_variant_key: string | null;
  content_version: string | null;
  rendered_difficulty: number | null;
  hint_depth: number | null;
  tone_style: string | null;
  sequence_ordinal: number;
};

const OFFER_EXPOSURE: Partial<
  Record<
    OrchestrateResponse["response"]["suggested_action"]["type"],
    InstructionExposure["exposure_type"]
  >
> = {
  offer_similar_question: "similar_question_offer",
  start_practice: "similar_question_offer",
  offer_broader_coaching: "broader_coaching_offer",
};

const HELP_DEPTH = {
  ask: 1,
  hint: 2,
  worked_step: 3,
  full_solution: 4,
} as const;

/**
 * Pure. The §18.6 rows for a delivered turn. The reply's row carries the help level as its depth
 * and a code key (`help:worked_step:2`, or `typed` / `pick:<intent>` when no level was set), the
 * prompt version as its content version, and the policy variant as its tone. The worker's own
 * exposures (none today) follow, then the offer, each with the next sequence number.
 */
export function exposuresForTurn(input: {
  assignmentId: string;
  conversationId: string;
  studentId: string;
  promptVersion: string | null;
  policyVariant: string;
  intent: ReviewIntent | null;
  help: HelpState | null;
  suggestedAction: OrchestrateResponse["response"]["suggested_action"]["type"];
  workerExposures: readonly InstructionExposure[];
}): ExposureRow[] {
  const ids = {
    assignment_id: input.assignmentId,
    conversation_id: input.conversationId,
    student_id: input.studentId,
  };
  const help = input.help;
  const level = help?.level ?? null;
  const reply: ExposureRow = {
    ...ids,
    exposure_type: level === "ask" || level === "hint" ? "hint" : "explanation",
    content_variant_key:
      help !== null
        ? `help:${help.level}${help.workedStep === null ? "" : `:${help.workedStep}`}`
        : input.intent !== null
          ? `pick:${input.intent}`
          : "typed",
    content_version: input.promptVersion,
    rendered_difficulty: null,
    hint_depth: level === null ? null : HELP_DEPTH[level],
    tone_style: input.policyVariant,
    sequence_ordinal: 0,
  };
  const rows: ExposureRow[] = [reply];
  for (const e of input.workerExposures) {
    rows.push({ ...ids, ...e, sequence_ordinal: rows.length });
  }
  const offer = OFFER_EXPOSURE[input.suggestedAction];
  if (offer !== undefined) {
    rows.push({
      ...ids,
      exposure_type: offer,
      content_variant_key: input.suggestedAction,
      content_version: input.promptVersion,
      rendered_difficulty: null,
      hint_depth: null,
      tone_style: input.policyVariant,
      sequence_ordinal: rows.length,
    });
  }
  return rows;
}
