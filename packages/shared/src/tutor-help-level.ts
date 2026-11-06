/**
 * @spec [owner brief "Help-level engine", Karl 2026-11-05 (rules 1–5; rulings of 2026-11-05: a
 *       new prompt v7 composing v3, "a correct typed step" is a typed message that states the
 *       item's keyed answer, and the wire also carries the worked step's position); Doc-03D_V1.2
 *       §3.1 (the tutor acts `hint`, `worked_step`, `full_solution`); SCL-275] | @implemented [2026-11-05]
 *
 * plain English: THE one definition of how much help LISA gives on a turn, decided by the server
 * with no model call and passed to the worker. Students were looping on "Got it, next step"
 * (one tapped 21 times on one problem and never reached the answer): each tap now moves them up a
 * fixed ladder, and a walkthrough reaches its last allowed step within three taps.
 *
 *  - Levels: `ask` (1), `hint` (2), `worked_step` (3), `full_solution` (4).
 *  - The ladder has five rungs: ask, hint, worked step 1, worked step 2, and the final rung. The
 *    final rung is worked step 3 (marked final) before submission, and the full solution after.
 *    So the ceiling is level 3 before submission (practice, and a review re-attempt before its
 *    answer) and level 4 after.
 *  - Signals, one per turn:
 *    - `walkthrough` ("Walk me through it") → the hint rung (level 2);
 *    - `step_understood` → up one rung;
 *    - `stuck` ("idk", "I'm stuck", typed or the `step_stuck` tap) and `skipped` (the item was
 *      skipped) → up one, or up two when the previous turn was also stuck or skipped;
 *    - `solve_it` ("just solve it", "show me") → the final rung;
 *    - `correct_step` (after submission, a typed message stating the keyed answer) → down one
 *      level; before submission it is never computed (an answer oracle, see `helpSignalFor`);
 *    - `none` (anything else) → no move.
 *  - `detectHelpSignal`: typed text → `stuck`, `solve_it` or null, from the versioned keyword map
 *    in runtime config (`tutor_help_keywords`), by the shared phrase matcher (keyword-match.ts).
 *  - `isCorrectTypedAnswer`: whether a typed message states the keyed answer. The key never leaves
 *    the server; only the resulting signal is recorded.
 *
 * Edge cases: a conversation with no recorded level starts at `ask`. A stored rung above the
 * ceiling (never written: the ceiling only rises) is clamped. Pure throughout: the same previous
 * state, signal and submit state always give the same next state.
 */
import { z } from "zod";
import { detectKeyword, keywordPhraseSchema } from "./keyword-match";
import type { ReviewIntent } from "./tutor-guided-choices";

export const HELP_LEVELS = [
  "ask",
  "hint",
  "worked_step",
  "full_solution",
] as const;
export const helpLevelSchema = z.enum(HELP_LEVELS);
export type HelpLevel = z.infer<typeof helpLevelSchema>;

/** The brief's numbering: ask 1 … full_solution 4. */
export const HELP_LEVEL_NUMBER: Readonly<Record<HelpLevel, 1 | 2 | 3 | 4>> = {
  ask: 1,
  hint: 2,
  worked_step: 3,
  full_solution: 4,
};

export const SUBMIT_STATES = ["pre_submit", "post_submit"] as const;
export const submitStateSchema = z.enum(SUBMIT_STATES);
export type SubmitState = z.infer<typeof submitStateSchema>;

/** The most worked steps a walkthrough has; the last is the final one before submission. */
export const MAX_WORKED_STEPS = 3;

export const HELP_SIGNALS = [
  "walkthrough",
  "step_understood",
  "stuck",
  "skipped",
  "solve_it",
  "correct_step",
  "none",
] as const;
export const helpSignalSchema = z.enum(HELP_SIGNALS);
export type HelpSignal = z.infer<typeof helpSignalSchema>;

/** The position LISA works at on a turn: the level and, at level 3, which worked step. */
export const workedStepSchema = z
  .object({
    index: z.number().int().min(1).max(MAX_WORKED_STEPS),
    final: z.boolean(),
  })
  .strict();
export type WorkedStep = z.infer<typeof workedStepSchema>;

/** What a turn records (tutor_turn_metrics) and the next turn starts from. */
export const helpStateSchema = z
  .object({
    level: helpLevelSchema,
    workedStep: z.number().int().min(1).max(MAX_WORKED_STEPS).nullable(),
    signal: helpSignalSchema,
  })
  .strict();
export type HelpState = z.infer<typeof helpStateSchema>;

/** The help the worker is asked to give on this turn. */
export type HelpDirective = {
  helpLevel: HelpLevel;
  submitState: SubmitState;
  workedStep: WorkedStep | null;
};

const FINAL_RUNG = 4;

/** The ceiling for a submit state, as a level number (brief rule 3). */
export function helpCeiling(submitState: SubmitState): 3 | 4 {
  return submitState === "post_submit" ? 4 : 3;
}

/** Rung 0..4 of a stored state. Worked step 3 and the full solution are both the final rung. */
function rungOf(state: Pick<HelpState, "level" | "workedStep">): number {
  switch (state.level) {
    case "ask":
      return 0;
    case "hint":
      return 1;
    case "worked_step":
      return 1 + Math.min(Math.max(state.workedStep ?? 1, 1), MAX_WORKED_STEPS);
    case "full_solution":
      return FINAL_RUNG;
  }
}

/** The level and step at a rung, under the submit state's ceiling. */
function atRung(
  rung: number,
  submitState: SubmitState,
): Pick<HelpState, "level" | "workedStep"> {
  const r = Math.min(Math.max(rung, 0), FINAL_RUNG);
  if (r === 0) return { level: "ask", workedStep: null };
  if (r === 1) return { level: "hint", workedStep: null };
  if (r === FINAL_RUNG && submitState === "post_submit") {
    return { level: "full_solution", workedStep: null };
  }
  return { level: "worked_step", workedStep: r - 1 };
}

/** The rung one level below a state: full solution → worked step 1, worked step → hint, hint → ask. */
function oneLevelDown(state: Pick<HelpState, "level" | "workedStep">): number {
  switch (state.level) {
    case "full_solution":
      return 2;
    case "worked_step":
      return 1;
    case "hint":
    case "ask":
      return 0;
  }
}

function isStuckClass(signal: HelpSignal): boolean {
  return signal === "stuck" || signal === "skipped";
}

/**
 * Pure. The next state from the previous one (null: none recorded yet), the turn's signal and the
 * item's submit state.
 */
export function nextHelpState(
  previous: HelpState | null,
  signal: HelpSignal,
  submitState: SubmitState,
): HelpState {
  const from = previous ?? { level: "ask", workedStep: null, signal: "none" };
  const rung = rungOf(from);
  let to: number;
  switch (signal) {
    case "walkthrough":
      to = 1;
      break;
    case "step_understood":
      to = rung + 1;
      break;
    case "stuck":
    case "skipped":
      to = rung + (previous !== null && isStuckClass(previous.signal) ? 2 : 1);
      break;
    case "solve_it":
      to = FINAL_RUNG;
      break;
    case "correct_step":
      to = oneLevelDown(from);
      break;
    case "none":
      to = rung;
      break;
  }
  return { ...atRung(to, submitState), signal };
}

/**
 * Pure. The signal a turn carries: a tap's own (walkthrough openers, the two quick replies), else
 * the typed message's (the keyword map, then the keyed answer), else none. A video tap, or a typed
 * message the input scan blocked, carries none.
 *
 * The keyed answer is checked AFTER submission only. Before it, a level that moved because a typed
 * guess matched the key would tell the student the guess was right (less help is observable): an
 * answer oracle, which the anti-leak invariant forbids (CLAUDE.md; Coding Standards §5.2). So
 * before submission a correct typed step is `none`.
 */
export function helpSignalFor(input: {
  intent: ReviewIntent | null;
  message: string;
  keywordMap: HelpKeywordMap | null;
  answerKey: AnswerKey | null;
  submitState: SubmitState;
}): HelpSignal {
  if (input.intent !== null) {
    switch (input.intent) {
      case "walkthrough":
      case "desmos_walkthrough":
        return "walkthrough";
      case "step_understood":
        return "step_understood";
      case "step_stuck":
        return "stuck";
      case "explain_rule":
      case "video_desmos":
      case "video_explanation":
        return "none";
    }
  }
  const typed =
    input.keywordMap === null
      ? null
      : detectHelpSignal(input.message, input.keywordMap);
  if (typed !== null) return typed;
  if (
    input.submitState === "post_submit" &&
    input.answerKey !== null &&
    isCorrectTypedAnswer(input.message, input.answerKey)
  ) {
    return "correct_step";
  }
  return "none";
}

/**
 * Pure. A turn's state. On the conversation's first turn about a skipped item the skip counts
 * first (up one), so an "idk" right after it is the second stuck signal in a row (up two).
 */
export function helpForTurn(
  previous: HelpState | null,
  signal: HelpSignal,
  submitState: SubmitState,
  itemSkipped: boolean,
): HelpState {
  if (previous === null && itemSkipped) {
    const afterSkip = nextHelpState(null, "skipped", submitState);
    return signal === "none"
      ? afterSkip
      : nextHelpState(afterSkip, signal, submitState);
  }
  return nextHelpState(previous, signal, submitState);
}

/** Pure. What the worker is told for a state. */
export function helpDirective(
  state: HelpState,
  submitState: SubmitState,
): HelpDirective {
  const placed = atRung(rungOf(state), submitState);
  return {
    helpLevel: placed.level,
    submitState,
    workedStep:
      placed.workedStep === null
        ? null
        : {
            index: placed.workedStep,
            final:
              placed.workedStep === MAX_WORKED_STEPS &&
              submitState === "pre_submit",
          },
  };
}

// ── Detection: the keyword map (tutor_context_runtime_config.tutor_help_keywords) ──

export const HELP_KEYWORD_SIGNALS = ["stuck", "solve_it"] as const;
export type HelpKeywordSignal = (typeof HELP_KEYWORD_SIGNALS)[number];

export const helpKeywordMapSchema = z
  .object({
    version: z.number().int().positive(),
    signals: z
      .object({
        stuck: z.array(keywordPhraseSchema).min(1).max(60),
        solve_it: z.array(keywordPhraseSchema).min(1).max(60),
      })
      .strict(),
  })
  .strict();
export type HelpKeywordMap = z.infer<typeof helpKeywordMapSchema>;

/** Pure. The help a typed message asks for, or null: whole-word phrases, longest wins, a tie is none. */
export function detectHelpSignal(
  message: string,
  map: HelpKeywordMap,
): HelpKeywordSignal | null {
  return detectKeyword(message, HELP_KEYWORD_SIGNALS, map.signals);
}

// ── A correct typed step: the message states the keyed answer ────────────────────

export type AnswerKey = {
  itemType: "mcq" | "grid_in";
  correctAnswer: string;
};

const MCQ_COMMIT =
  /^(?:(?:i think |i m pretty sure |so )?(?:(?:the )?(?:answer|choice|option) (?:is )?|it s |its |it is |i got |i picked |i chose |i choose )?)([a-d])$/;

/** "3/4" → 0.75, ".75" → 0.75, "-2" → -2; anything else → null. */
function parseNumber(token: string): number | null {
  const t = token.trim();
  const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (fraction !== null) {
    const den = Number(fraction[2]);
    return den === 0 ? null : Number(fraction[1]) / den;
  }
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
}

/**
 * Pure. Whether a typed message states the item's keyed answer: for a multiple-choice item, the
 * message is the keyed letter, alone or in a short commitment ("it's B", "the answer is b"); for
 * a grid-in, any number in the message equals the key. A
 * question ("is it B?") is not a commitment and does not count.
 */
export function isCorrectTypedAnswer(message: string, key: AnswerKey): boolean {
  if (key.itemType === "mcq") {
    if (/\?\s*$/.test(message)) return false;
    const letter = key.correctAnswer.trim().toLowerCase();
    if (!/^[a-d]$/.test(letter)) return false;
    const words = message
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    const m = MCQ_COMMIT.exec(words);
    return m !== null && m[1] === letter;
  }
  const accepted = parseNumber(key.correctAnswer);
  if (accepted === null) return false;
  const tokens =
    message
      .normalize("NFKC")
      .match(/-?(?:\d+(?:\.\d+)?|\.\d+)(?:\/\d+(?:\.\d+)?)?/g) ?? [];
  return tokens.some((tok) => {
    const n = parseNumber(tok);
    return n !== null && Math.abs(accepted - n) < 1e-9;
  });
}
