/**
 * @spec [owner brief "Help-level engine", Karl 2026-11-05 (rules 1–5); SCL-275] | @implemented [2026-11-05]
 *
 * plain English: the BFF half of the help-level engine. Reads the conversation's last recorded
 * level, works out this turn's signal and state with the pure functions in
 * packages/shared/src/tutor-help-level.ts, and gives the route the three wire fields. The state is
 * recorded on the turn's `tutor_turn_metrics` row, which is where the next turn reads it from: no
 * other table holds it.
 *
 * Edge cases:
 *  - The previous level unreadable (a query error, or a stored row that fails the schema): the
 *    turn gets NO help level (the worker then renders exactly as v3) and records none, so the
 *    ladder's memory is not overwritten with a level guessed from nothing. Logged at ERROR with
 *    the conversation id only.
 *  - The answer key is built here, and only after submission: before it, a typed guess is never
 *    compared with the key (an answer oracle; see `helpSignalFor`).
 *  - Nothing from the student's message, and never the key, is logged or recorded: only the
 *    level, the step and the signal code.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import type { ReviewIntent } from "../../packages/shared/src/tutor-guided-choices";
import {
  helpDirective,
  helpForTurn,
  helpSignalFor,
  helpStateSchema,
  type AnswerKey,
  type HelpDirective,
  type HelpState,
  type SubmitState,
} from "../../packages/shared/src/tutor-help-level";
import { logger } from "../logger";
import { TutorConfig } from "./tutor-config";

type PreviousHelp = { ok: true; state: HelpState | null } | { ok: false };

/** The conversation's most recent recorded state: null when none yet; not ok when unreadable. */
export async function readPreviousHelpState(
  conversationId: string,
): Promise<PreviousHelp> {
  const { data, error } = await supabaseServer
    .from("tutor_turn_metrics")
    .select("help_level, help_worked_step, help_signal, recorded_at")
    .eq("conversation_id", conversationId)
    .not("help_level", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error(
      "TUTOR_RUNTIME",
      "help_level_read_failed",
      "previous help level unreadable; this turn is sent and recorded with no help level",
      undefined,
      { conversationId },
    );
    return { ok: false };
  }
  if (data === null) return { ok: true, state: null };
  const parsed = helpStateSchema.safeParse({
    level: data.help_level,
    workedStep: data.help_worked_step ?? null,
    signal: data.help_signal,
  });
  if (!parsed.success) {
    logger.error(
      "TUTOR_RUNTIME",
      "help_level_row_invalid",
      "stored help level fails its schema; this turn is sent and recorded with no help level",
      undefined,
      { conversationId },
    );
    return { ok: false };
  }
  return { ok: true, state: parsed.data };
}

/**
 * The key a typed message is compared with, after submission only. The item type comes from the
 * question content when it resolved, else from the key's own shape (a lone letter A–D is a
 * multiple-choice key; anything else is a grid-in value).
 */
export function answerKeyFor(
  correctAnswer: string | null,
  itemType: "mcq" | "grid_in" | null,
  isPostSubmit: boolean,
): AnswerKey | null {
  if (!isPostSubmit || correctAnswer === null) return null;
  return {
    itemType:
      itemType ?? (/^[A-D]$/i.test(correctAnswer.trim()) ? "mcq" : "grid_in"),
    correctAnswer,
  };
}

export type HelpTurn = { state: HelpState; directive: HelpDirective };

/** One turn's help: the state to record and what the worker is told; null when unreadable. */
export async function decideHelpTurn(input: {
  conversationId: string;
  intent: ReviewIntent | null;
  message: string;
  isPostSubmit: boolean;
  itemSkipped: boolean;
  correctAnswer: string | null;
  itemType: "mcq" | "grid_in" | null;
}): Promise<HelpTurn | null> {
  const submitState: SubmitState = input.isPostSubmit
    ? "post_submit"
    : "pre_submit";
  const previous = await readPreviousHelpState(input.conversationId);
  if (!previous.ok) return null;
  const signal = helpSignalFor({
    intent: input.intent,
    message: input.message,
    keywordMap: TutorConfig.get("tutor_help_keywords"),
    answerKey: answerKeyFor(
      input.correctAnswer,
      input.itemType,
      input.isPostSubmit,
    ),
    submitState,
  });
  const state = helpForTurn(
    previous.state,
    signal,
    submitState,
    input.itemSkipped,
  );
  return { state, directive: helpDirective(state, submitState) };
}
