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

/** What one turn contributes to the ladder: its tap or typed text, and the item's state then. */
export type HelpTurnInput = {
  intent: ReviewIntent | null;
  message: string;
  isPostSubmit: boolean;
  itemSkipped: boolean;
  correctAnswer: string | null;
  itemType: "mcq" | "grid_in" | null;
};

/**
 * Pure apart from the runtime keyword map. THE per-turn step: from the previous state (null: none
 * recorded), this turn's signal and its submit state, the state to record and what the worker is
 * told. The live route (`decideHelpTurn`) and the eval import (`helpTurnForWindow`) both call it,
 * so a replayed case gets the level production computes.
 */
export function helpTurnFrom(
  previous: HelpState | null,
  input: HelpTurnInput,
): HelpTurn {
  const submitState: SubmitState = input.isPostSubmit
    ? "post_submit"
    : "pre_submit";
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
  const state = helpForTurn(previous, signal, submitState, input.itemSkipped);
  return { state, directive: helpDirective(state, submitState) };
}

/** One turn's help: the state to record and what the worker is told; null when unreadable. */
export async function decideHelpTurn(
  input: HelpTurnInput & { conversationId: string },
): Promise<HelpTurn | null> {
  const previous = await readPreviousHelpState(input.conversationId);
  if (!previous.ok) return null;
  return helpTurnFrom(previous.state, input);
}

/**
 * @spec [owner brief 2026-11-11: "Fix the replay so it computes help_level and submit_state from
 *       the case's own message window, using the same deterministic engine as the live route";
 *       SCL-275] | @implemented [2026-11-11]
 * The help at the last of a message window's student turns, oldest first: `helpTurnFrom` applied
 * turn by turn from no recorded level, exactly as the route would have recorded and read it back.
 * Null for a window with no student turn.
 *
 * trade-off: the route reads the level recorded on the conversation's previous turn, which can
 * reach back before the window; the fold starts at the window's first student turn. A window
 * that has dropped earlier taps can only under-count, never over-count, and the ladder reaches
 * its ceiling within three taps, so a loop long enough to be cut is long enough to reach it.
 * An input-blocked turn (which does not move the level live) cannot be told apart in the window
 * and is folded like any other typed message.
 */
export function helpTurnForWindow(
  turns: readonly HelpTurnInput[],
): HelpTurn | null {
  let turn: HelpTurn | null = null;
  for (const t of turns) turn = helpTurnFrom(turn?.state ?? null, t);
  return turn;
}
