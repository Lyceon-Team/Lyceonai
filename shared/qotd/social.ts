/**
 * Question of the Day social assets: the input, the caption and alt text, and the leak checks.
 *
 * @spec [Doc 10A §7 (no answer before submitting; nothing published about how the question is
 *       chosen), §11 (the QOTD is the first social stream); Public Disclosure Doctrine §0.1-0.2,
 *       §0.8; owner decisions 2026-10-07 on the QOTD social assets (delivery as GitHub run
 *       downloads; portrait 1080x1350 + story 1080x1920; choice order fixed per day; hashtags and
 *       call to action approved as drafted; a dedicated socialAssetLeaks check, because the
 *       banned-phrase and outcome guards passed a caption carrying the answer)]
 *       | @implemented [2026-10-07]
 *
 * plain English:
 *   * socialInputFromToday / socialInputFromArchive turn the public payloads into the strict
 *     no-answer input (qotdSocialInputSchema). Today's options arrive shuffled per request, so
 *     they are put in token order: the same order every run of the same day. A past day keeps
 *     its canonical order. The archive's answer and explanation are dropped here, before anything
 *     is built.
 *   * buildSocialCopy writes the approved caption and an alt text that reads the question out in
 *     full. Maths is spoken through a short fixed table; anything outside it (or an alt text over
 *     1000 characters, X's limit) falls back to a generic description, never to garbled LaTeX.
 *   * socialCopyProblems runs the shared banned-phrase and outcome guards and an answer-reveal
 *     wording check over the caption and alt text. It needs no answer, so it runs every day.
 *   * socialAssetLeaks compares the caption, alt text and the card's visible text with a day's
 *     REVEALED answer (the archive). Tests run it on fixtures; the generator runs it whenever it
 *     builds a past day. Today's answer is not public, so today relies on the input never
 *     carrying it (the strict schema) plus socialCopyProblems.
 *
 * trade-off: a grid-in answer that also appears in the question itself (answer 2, stem "2x")
 * cannot be told apart from the question, so it is not counted; the strict input is what keeps
 * it out.
 */
import {
  qotdSocialCopySchema,
  qotdSocialInputSchema,
  type QotdArchiveResponse,
  type QotdSocialCopy,
  type QotdSocialInput,
  type QotdTodayResponse,
} from "../../packages/shared/src/qotd-schema";
import { tokenizeMathContent } from "../math/tokenize";
import {
  firstBannedPhrase,
  firstUnapprovedOutcome,
} from "../seo/banned-phrases";

export const QOTD_SOCIAL_URL = "lyceon.ai/sat-question-of-the-day";

/** The two delivered sizes (owner decision 2026-10-07: portrait + story, no square). */
export const QOTD_SOCIAL_FORMATS = {
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export type QotdSocialFormat = keyof typeof QOTD_SOCIAL_FORMATS;

export const QOTD_SECTION_NAME: Record<"M" | "RW", string> = {
  M: "Math",
  RW: "Reading and Writing",
};

const HASHTAGS: Record<"M" | "RW", string> = {
  M: "#SAT #DigitalSAT #SATPrep #SATMath #QuestionOfTheDay",
  RW: "#SAT #DigitalSAT #SATPrep #SATReading #QuestionOfTheDay",
};

/** X's alt-text limit, the tightest of the platforms the QOTD is posted to. */
export const QOTD_ALT_TEXT_MAX = 1000;

/** Today's public payload -> the social input. Options in token order: fixed for the day. */
export function socialInputFromToday(
  today: QotdTodayResponse,
): QotdSocialInput {
  const q = today.question;
  const options = [...q.options]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((o) => ({ text: o.text }));
  return qotdSocialInputSchema.parse({
    qotd_date: today.qotd_date,
    section_code: q.section_code,
    domain: q.domain,
    item_type: q.item_type,
    stem: q.stem,
    passage: q.passage,
    options,
    correct_answer: null,
    explanation: null,
  });
}

/** A past day's archive payload -> the social input. The answer and explanation stop here. */
export function socialInputFromArchive(
  day: QotdArchiveResponse,
): QotdSocialInput {
  const q = day.question;
  return qotdSocialInputSchema.parse({
    qotd_date: day.qotd_date,
    section_code: q.section_code,
    domain: q.domain,
    item_type: q.item_type,
    stem: q.stem,
    passage: q.passage,
    options: q.options.map((o) => ({ text: o.text })),
    correct_answer: null,
    explanation: null,
  });
}

/** "2026-10-06" -> "Tuesday, October 6, 2026" (UTC, so the build machine's zone never shifts it). */
export function formatSocialDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------------------------
// Maths read aloud, for the alt text
// ---------------------------------------------------------------------------------------------

/** Commands spoken as a fixed word. Anything not here (or below) makes the alt text generic. */
const SPOKEN: Record<string, string> = {
  pi: "pi",
  theta: "theta",
  alpha: "alpha",
  beta: "beta",
  cdot: "times",
  times: "times",
  div: "divided by",
  le: "is less than or equal to",
  leq: "is less than or equal to",
  ge: "is greater than or equal to",
  geq: "is greater than or equal to",
  ne: "is not equal to",
  neq: "is not equal to",
  pm: "plus or minus",
  angle: "angle",
  triangle: "triangle",
  parallel: "is parallel to",
  perp: "is perpendicular to",
  infty: "infinity",
  "%": "percent",
  $: "dollars",
};
const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad"]);

class Unspeakable extends Error {}

/** One LaTeX formula in words, or Unspeakable. */
function speakLatex(latex: string): string {
  let i = 0;

  const command = (): string => {
    i += 1; // the backslash
    const letters = /^[A-Za-z]+/.exec(latex.slice(i));
    if (letters) {
      i += letters[0].length;
      return letters[0];
    }
    const ch = latex[i];
    if (ch === undefined) throw new Unspeakable("trailing backslash");
    i += 1;
    return ch;
  };

  const group = (): string => {
    while (latex[i] === " ") i += 1;
    if (latex[i] === "{") {
      i += 1;
      const out = sequence("}");
      i += 1; // the closing brace
      return out;
    }
    if (latex[i] === "\\") return spokenCommand(command());
    const ch = latex[i];
    if (ch === undefined) throw new Unspeakable("missing argument");
    i += 1;
    return ch;
  };

  const rawGroup = (): string => {
    if (latex[i] !== "{") throw new Unspeakable("\\text without braces");
    const end = latex.indexOf("}", i);
    if (end === -1) throw new Unspeakable("unclosed \\text");
    const text = latex.slice(i + 1, end);
    i = end + 1;
    return text;
  };

  const spokenCommand = (name: string): string => {
    const word = SPOKEN[name];
    if (word !== undefined) return ` ${word} `;
    if (SPACES.has(name)) return " ";
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac": {
        const top = group();
        const bottom = group();
        return ` ${top} over ${bottom} `;
      }
      case "sqrt":
        if (latex[i] === "[") throw new Unspeakable("nth root");
        return ` the square root of ${group()} `;
      case "overline":
        return ` segment ${group()} `;
      case "text":
      case "textrm":
      case "mathrm":
      case "mathit":
        return rawGroup();
      case "left":
      case "right":
        return "";
      case "circ":
        return " degrees ";
      default:
        throw new Unspeakable(`\\${name}`);
    }
  };

  const sequence = (until: string | null): string => {
    let out = "";
    while (i < latex.length) {
      const ch = latex[i];
      if (until !== null && ch === until) return out;
      if (ch === "}") throw new Unspeakable("unbalanced brace");
      if (ch === "\\") {
        out += spokenCommand(command());
      } else if (ch === "{") {
        out += group();
      } else if (ch === "^") {
        i += 1;
        const power = group().trim();
        out +=
          power === "2"
            ? " squared "
            : power === "3"
              ? " cubed "
              : power === "degrees"
                ? " degrees "
                : ` to the power ${power} `;
      } else if (ch === "_") {
        i += 1;
        out += ` sub ${group().trim()} `;
      } else {
        out += ch;
        i += 1;
      }
    }
    if (until !== null) throw new Unspeakable("unclosed group");
    return out;
  };

  return sequence(null);
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:?!])/g, "$1")
    .trim();
}

/**
 * Mixed text and maths in words, or null when some maths is outside the fixed table. Runs of
 * underscores (a fill-in blank) are read as "[blank]".
 */
export function speakMixedText(content: string): string | null {
  let out = "";
  for (const token of tokenizeMathContent(content)) {
    if (token.type === "text") {
      out += token.content.replace(/_{2,}/g, " [blank] ");
      continue;
    }
    try {
      out += speakLatex(token.content);
    } catch (err: unknown) {
      if (err instanceof Unspeakable) return null;
      throw err;
    }
  }
  return tidy(out);
}

// ---------------------------------------------------------------------------------------------
// Caption and alt text
// ---------------------------------------------------------------------------------------------

function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

function fullAltText(input: QotdSocialInput, opening: string): string | null {
  const parts: string[] = [opening];
  if (input.passage && input.passage.trim().length > 0) {
    const passage = speakMixedText(input.passage);
    if (passage === null) return null;
    parts.push(`Passage: ${sentence(passage)}`);
  }
  const stem = speakMixedText(input.stem);
  if (stem === null) return null;
  parts.push(sentence(stem));
  if (input.item_type === "mcq") {
    for (const [index, option] of input.options.entries()) {
      const text = speakMixedText(option.text);
      if (text === null) return null;
      parts.push(`${"ABCD"[index]}: ${sentence(text)}`);
    }
  } else {
    parts.push("Student-produced response.");
  }
  parts.push(`Answer it free at ${QOTD_SOCIAL_URL}.`);
  return parts.join(" ");
}

/** The approved caption (owner decision 2026-10-07) and the alt text for both images. */
export function buildSocialCopy(input: QotdSocialInput): QotdSocialCopy {
  const parsed = qotdSocialInputSchema.parse(input);
  const section = QOTD_SECTION_NAME[parsed.section_code];
  const caption = [
    `SAT Question of the Day: ${section}, ${parsed.domain}.`,
    `Give it a try, then answer it free at ${QOTD_SOCIAL_URL}`,
    HASHTAGS[parsed.section_code],
  ].join("\n\n");
  const opening = `SAT Question of the Day from Lyceon, ${formatSocialDate(parsed.qotd_date)}. ${section}, ${parsed.domain}.`;
  const full = fullAltText(parsed, opening);
  const altText =
    full !== null && full.length <= QOTD_ALT_TEXT_MAX
      ? full
      : `${opening} The image shows the question${
          parsed.item_type === "mcq" ? " and its four answer choices" : ""
        }. Answer it free at ${QOTD_SOCIAL_URL}.`;
  return qotdSocialCopySchema.parse({ caption, alt_text: altText });
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

/**
 * A question not fit to post as it stands. Found on the live 2026-10-07 question, whose stem
 * repeats its passage word for word, so the prompt itself is missing: posted, it would ask
 * nothing. That is a bank content defect, fixed in the bank; here the day is refused rather than
 * posted broken.
 */
export function socialInputProblems(input: QotdSocialInput): string[] {
  const passage = input.passage?.trim() ?? "";
  return passage.length > 0 && input.stem.trim() === passage
    ? ["input: the stem repeats the passage word for word (no question prompt)"]
    : [];
}

/** Wording that reveals or points at an answer. "Answer it free" is the call to action, not one. */
const REVEAL_PATTERNS: readonly RegExp[] = [
  /\b(?:correct|right|best)\s+(?:answer|choice|option|response)s?\b/gi,
  /\banswers?\s+(?:is|was|are|=|:)/gi,
  /\b(?:is|was)\s+(?:correct|right|incorrect|wrong)\b/gi,
  /\bsolutions?\b/gi,
  /\bexplanations?\b/gi,
  /\bspoiler\b/gi,
];

function questionText(input: QotdSocialInput): string {
  return [
    input.stem,
    input.passage ?? "",
    ...input.options.map((o) => o.text),
    speakMixedText(input.stem) ?? "",
    speakMixedText(input.passage ?? "") ?? "",
    ...input.options.map((o) => speakMixedText(o.text) ?? ""),
  ].join(" \n ");
}

function count(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

/**
 * Reveal wording in `text` beyond what the question itself already says (an SAT stem may
 * legitimately contain "Which choice is the best response").
 */
export function revealWording(
  text: string,
  input: QotdSocialInput,
): string | null {
  const question = questionText(input);
  for (const pattern of REVEAL_PATTERNS) {
    if (count(pattern, text) > count(pattern, question)) {
      const hit = [...text.matchAll(pattern)][0]?.[0] ?? pattern.source;
      return `reveal wording "${hit}"`;
    }
  }
  return null;
}

/** Problems with a day's caption and alt text that need no answer to find. Empty = publishable. */
export function socialCopyProblems(
  copy: QotdSocialCopy,
  input: QotdSocialInput,
): string[] {
  const problems: string[] = [];
  for (const [field, text] of [
    ["caption", copy.caption],
    ["alt_text", copy.alt_text],
  ] as const) {
    const banned = firstBannedPhrase(text);
    if (banned) problems.push(`${field}: banned phrase (${banned.why})`);
    const outcome = firstUnapprovedOutcome(text);
    if (outcome)
      problems.push(`${field}: unapproved outcome claim (${outcome.why})`);
    const reveal = revealWording(text, input);
    if (reveal) problems.push(`${field}: ${reveal}`);
  }
  return problems;
}

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const p = normalize(phrase).trim();
  return p.length > 0 && haystack.includes(` ${p} `);
}

const EXPLANATION_WINDOW = 8;

/**
 * Every way the caption, alt text or card text gives away the revealed answer of `day`.
 * Empty = no leak found. `card_text` is the card's visible text (innerText of the rendered
 * card).
 */
export function socialAssetLeaks(
  output: { caption: string; alt_text: string; card_text: string },
  day: QotdArchiveResponse,
): string[] {
  const input = socialInputFromArchive(day);
  const question = normalize(questionText(input));
  const leaks: string[] = [];
  const fields = [
    ["caption", output.caption],
    ["alt_text", output.alt_text],
    ["card", output.card_text],
  ] as const;

  const explanationWords = normalize(day.question.explanation)
    .trim()
    .split(" ");
  for (const [field, text] of fields) {
    const haystack = normalize(text);

    // 1. Any run of the explanation not already in the question.
    for (let k = 0; k + EXPLANATION_WINDOW <= explanationWords.length; k += 1) {
      const window = explanationWords
        .slice(k, k + EXPLANATION_WINDOW)
        .join(" ");
      if (
        haystack.includes(` ${window} `) &&
        !question.includes(` ${window} `)
      ) {
        leaks.push(`${field}: carries the explanation ("${window}")`);
        break;
      }
    }

    // 2. A grid-in answer the question does not already contain.
    const keyed = day.question.correct_answer;
    if (
      day.question.item_type === "grid_in" &&
      keyed !== null &&
      containsPhrase(haystack, keyed) &&
      !containsPhrase(question, keyed)
    ) {
      leaks.push(`${field}: carries the grid-in answer "${keyed}"`);
    }

    // 3. Reveal wording.
    const reveal = revealWording(text, input);
    if (reveal) leaks.push(`${field}: ${reveal}`);
  }

  // 4. MCQ: the caption names no choice; the alt text and card show all four or none, so no
  //    one choice is singled out.
  if (day.question.item_type === "mcq") {
    const correct = day.question.options.find(
      (o) => o.id === day.question.correct_option_id,
    );
    if (correct && containsPhrase(normalize(output.caption), correct.text)) {
      leaks.push(`caption: names the correct choice "${correct.text}"`);
    }
    for (const [field, text] of fields.slice(1)) {
      const haystack = normalize(text);
      const shown = day.question.options.filter((o) =>
        containsPhrase(haystack, o.text),
      ).length;
      if (shown !== 0 && shown !== day.question.options.length) {
        leaks.push(
          `${field}: shows ${shown} of the ${day.question.options.length} choices`,
        );
      }
    }
  }
  return leaks;
}
