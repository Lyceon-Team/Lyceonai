/**
 * LISA sees the choices the way the student sees them: in on-screen order, lettered A–D.
 *
 * @spec [Brief 13 Step 0b rulings 1-2 (owner, Karl, 2026-10-02): runner choices are lettered A–D
 *        by on-screen position, display labels only; LISA's context presents the choices in
 *        displayed order with display letters, the student's answer as a display letter, and the
 *        correct answer as a display letter after submit only; the worker and its wire contract
 *        are unchanged; DESIGN.md §4 "Question runner"; Doc 02B §20 (reveal matrix); INV-03-04]
 *        | @implemented [2026-10-02]
 *
 * plain English: a session item stores `option_order`, the canonical keys in the order the
 * student was shown them (written once by `hydrateSessionItemOptionTokens`). This module turns
 * that into a canonical-key → display-letter map and applies it to the three things LISA reads:
 * the choices, the student's answer and the correct answer. "B" then means the second option on
 * screen to both the student and LISA.
 *
 * Everything here runs server-side. The client never receives a canonical key or the map.
 *
 * expected outcome: for option_order ["C","A","D","B"], canonical C is "A", A is "B", D is "C",
 * B is "D", and the choices come back in that order with those letters.
 * trade-offs: when `option_order` is null or absent (an item never served), the canonical order
 * is used: nothing was shown in any other order, so there is no displayed order to disagree with.
 * When it is present but is not a permutation of the item's option keys (a malformed row), the
 * order the student saw cannot be known, so the result is UNRESOLVED: callers fail closed
 * rather than letter the choices in an order the student may never have seen.
 * edge cases: grid-in items have no options and their answers are values, not letters; values
 * pass through untouched. A key with no display letter maps to null, never to itself.
 */
import {
  normalizeAnswerKey,
  resolveSelectedCanonicalKey,
} from "../../shared/question-bank-contract";

export const DISPLAY_LETTERS = ["A", "B", "C", "D"] as const;

export type DisplayOption = { key: string; text: string };

export type DisplayOrder = {
  /** False when a stored `option_order` is malformed; every caller then fails closed. */
  resolved: boolean;
  /** The choices in on-screen order, each keyed by its display letter. */
  options: DisplayOption[];
  /** The display letter for a canonical key, or null when the key is not one of the options. */
  letterFor: (canonicalKey: string) => string | null;
};

function parseOptions(raw: unknown): DisplayOption[] {
  if (!Array.isArray(raw)) return [];
  const out: DisplayOption[] = [];
  for (const o of raw) {
    if (
      typeof o === "object" &&
      o !== null &&
      typeof (o as Record<string, unknown>)["key"] === "string" &&
      typeof (o as Record<string, unknown>)["text"] === "string"
    ) {
      const rec = o as Record<string, string>;
      out.push({ key: rec["key"] ?? "", text: rec["text"] ?? "" });
    }
  }
  return out;
}

/** True when `order` is exactly a reordering of the option keys. */
function isPermutationOf(
  order: unknown,
  keys: readonly string[],
): order is string[] {
  if (!Array.isArray(order) || order.length !== keys.length) return false;
  if (!order.every((k): k is string => typeof k === "string")) return false;
  const want = [...keys].sort();
  const got = [...order].sort();
  return want.every((k, i) => k === got[i]);
}

export function displayOrderFor(
  questionOptions: unknown,
  optionOrder: unknown,
): DisplayOrder {
  const canonical = parseOptions(questionOptions);
  const keys = canonical.map((o) => o.key);
  if (
    optionOrder !== null &&
    optionOrder !== undefined &&
    !isPermutationOf(optionOrder, keys)
  ) {
    return { resolved: false, options: [], letterFor: () => null };
  }
  const order = isPermutationOf(optionOrder, keys) ? optionOrder : keys;
  const byKey = new Map(canonical.map((o) => [o.key, o.text]));

  const letters = new Map<string, string>();
  const options: DisplayOption[] = [];
  order.forEach((key, i) => {
    const letter = DISPLAY_LETTERS[i];
    if (letter === undefined) return;
    letters.set(key, letter);
    options.push({ key: letter, text: byKey.get(key) ?? "" });
  });

  return {
    resolved: true,
    options,
    letterFor: (canonicalKey: string) =>
      letters.get(normalizeAnswerKey(canonicalKey) ?? canonicalKey) ?? null,
  };
}

/**
 * The student's stored answer as LISA should see it. MCQ: the stored value is a canonical key
 * (practice) or a served `opt_…` token (review, register §8 F-49); both resolve to the display
 * letter. Grid-in: the typed value, unchanged.
 */
export function studentAnswerForDisplay(
  selectedAnswer: string | null,
  itemType: "mcq" | "grid_in",
  optionTokenMap: unknown,
  display: DisplayOrder,
): string | null {
  if (selectedAnswer === null || selectedAnswer === "") return null;
  if (itemType === "grid_in") return selectedAnswer;
  const map =
    typeof optionTokenMap === "object" &&
    optionTokenMap !== null &&
    !Array.isArray(optionTokenMap)
      ? (optionTokenMap as Record<string, string>)
      : {};
  const canonical = resolveSelectedCanonicalKey(selectedAnswer, map);
  return canonical === null ? null : display.letterFor(canonical);
}

/**
 * The correct answer as LISA should see it (post-submit) and as the leak scan should look for it
 * (always). An MCQ letter becomes the display letter; a grid-in value passes through. Returns
 * null when an MCQ key has no display letter, and the caller treats that as a failed resolution
 * (fail closed: pre-submit + failed blocks the reply).
 */
export function correctAnswerForDisplay(
  correctAnswer: string,
  display: DisplayOrder,
): string | null {
  if (!display.resolved) return null;
  if (display.options.length === 0) return correctAnswer;
  const key = normalizeAnswerKey(correctAnswer);
  if (key === null) return correctAnswer;
  return display.letterFor(key);
}
