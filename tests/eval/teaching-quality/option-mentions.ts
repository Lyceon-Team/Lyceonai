/**
 * @spec [owner brief "Reading & Writing worked step", Karl 2026-11-22: "before submission, a
 *       worked step on an RW item must never name, rank or rule out an answer option … rubric
 *       rule 'no option named before submission'"] | @implemented [2026-11-22]
 *
 * plain English: the deterministic half of that rubric rule. It finds an answer choice named in
 * a reply, by letter ("Option B", "choice (C)", "rule out D", "(A)") or by its own words (six
 * words in a row from a choice's text that are not also in the passage or the stem, so a reply
 * quoting the passage is not counted), or by a word only it uses (five letters or more, in
 * exactly one choice and not in the passage or the stem: "pivot" points at SATRW23GOZ2P's key as
 * surely as "Option A"). A `word` mention is advisory: a generic word can belong to one choice
 * ("framework" in a sentence about structure matched choice D, 2026-11-22). The replay decides
 * on `letter` and `text`, and the judge scores the rest (a choice described in other words, a
 * ranking without a letter).
 *
 * The production reply that prompted it, "Let's look at Option B", is caught; `hasAnswerLeak`
 * does not catch it, because it looks only for the KEY's letter (A), and naming a wrong choice
 * is the same move.
 *
 * Pure. Nothing here is logged.
 */

export type OptionMention = {
  kind: "letter" | "text" | "word";
  option: string;
};

const LETTER_PATTERNS: readonly ((l: string) => RegExp)[] = [
  // "Option B", "choice (B)", "answer B", "letter B", "options B and C"
  (l) =>
    new RegExp(
      `\\b(?:options?|choices?|answers?|letters?)\\s*\\(?${l}\\)?(?![\\w'’])`,
      "i",
    ),
  // "(B)" standing alone
  (l) => new RegExp(`\\(${l}\\)`),
  // "B)" or "B." or "B:" opening a line or list item
  (l) => new RegExp(`(?:^|\\n)\\s*[-*•]?\\s*${l}[).:]\\s`),
  // "rule out B", "eliminate B", "cross off B", "B is wrong/out/incorrect/better/best"
  (l) =>
    new RegExp(
      `\\b(?:rule\\s+out|eliminat\\w*|cross(?:\\s+off|\\s+out)?|skip|drop)\\s+(?:option\\s+|choice\\s+)?\\(?${l}\\)?(?![\\w'’])`,
      "i",
    ),
  (l) =>
    new RegExp(
      `(?<![\\w'’])${l}\\s+(?:is|seems|looks)\\s+(?:wrong|out|incorrect|better|best|stronger|weaker|right|correct)\\b`,
    ),
  // "and B", "or B", "vs. B" next to another letter: "A or B", "B and C"
  (l) =>
    new RegExp(
      `(?<![\\w'’])(?:[A-D]\\s*(?:,|and|or|vs\\.?|versus)\\s*${l}|${l}\\s*(?:,|and|or|vs\\.?|versus)\\s*[A-D])(?![\\w'’])`,
    ),
];

function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "");
}

/** Function words long enough to pass the length test; never distinctive of one choice. */
const COMMON = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "among",
  "because",
  "before",
  "being",
  "below",
  "between",
  "could",
  "every",
  "other",
  "rather",
  "should",
  "since",
  "still",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "until",
  "where",
  "which",
  "while",
  "within",
  "without",
  "would",
]);

/** A light stem, so "proverbs" in the passage covers "proverb" in a choice. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  return w;
}

const RUN = 6;

function runsOf(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + RUN <= w.length; i += 1)
    out.add(w.slice(i, i + RUN).join(" "));
  return out;
}

/** Pure. Every answer choice the reply names, by letter or by its own words. */
export function optionMentions(
  reply: string,
  item: {
    options: ReadonlyArray<{ key: string; text: string }>;
    passage: string | null;
    stem: string;
  },
): OptionMention[] {
  const found: OptionMention[] = [];
  const shared = new Set([...runsOf(item.passage ?? ""), ...runsOf(item.stem)]);
  const replyRuns = runsOf(reply);
  const stems = (t: string): Set<string> => new Set(words(t).map(stem));
  const replyWords = stems(reply);
  const context = new Set([...stems(item.passage ?? ""), ...stems(item.stem)]);
  const optionWords = item.options.map((o) => stems(o.text));
  const distinctive = (i: number): string[] =>
    [...(optionWords[i] ?? [])].filter(
      (w) =>
        w.length >= 5 &&
        !COMMON.has(w) &&
        !context.has(w) &&
        optionWords.every((other, j) => j === i || !other.has(w)),
    );
  for (const [i, o] of item.options.entries()) {
    const l = o.key.trim().toUpperCase();
    if (!/^[A-D]$/.test(l)) continue;
    if (LETTER_PATTERNS.some((p) => p(l).test(reply)))
      found.push({ kind: "letter", option: l });
    else if (
      [...runsOf(o.text)].some((r) => !shared.has(r) && replyRuns.has(r))
    )
      found.push({ kind: "text", option: l });
    else if (distinctive(i).some((w) => replyWords.has(w)))
      found.push({ kind: "word", option: l });
  }
  return found;
}
