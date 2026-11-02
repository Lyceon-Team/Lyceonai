/**
 * The QOTD breakdown pilot: yesterday's Question of the Day as a short worked video, by template.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): render a
 *       breakdown of YESTERDAY's QOTD with the worked-example pipeline; HARD RULE "the breakdown
 *       uses the stored option_order and correct_display_letter for that QOTD date, never the
 *       question's original order"; a deterministic script (no generated text): hook, question
 *       read, the explanation's sentences as steps, the answer by its stored display letter; the
 *       hook passes H1-H6; the fallback rule (a)-(d) with a stable code per reason; captions and
 *       keywords in the SCL-262 format through shared/social/posts.ts, the CC BY 4.0 music credit
 *       on every caption; a 14-day window, off by default; SCL-258 (the stored order), SCL-262,
 *       SCL-265, SCL-266] | @implemented [2026-11-02]
 *
 * plain English: every function is pure.
 *   * The question comes ONLY from yesterday's public archive payload (GET /api/public/qotd/:date,
 *     the shape scripts/qotd-social/generate.ts reads): its options are in the day's stored order
 *     (qotd_schedule.option_order, projected by shared/qotd/projection.ts qotdServedChoices) and
 *     `correct_letter` is the stored correct_display_letter. breakdownQuestion letters the
 *     choices A-D by that position and takes the stored letter as the key; it refuses a day whose
 *     correct choice is not at the stored letter (order_mismatch). The canonical key
 *     (correct_option_id) is used only to find that choice, never as a letter.
 *   * breakdownScript: the hook (fixed spoken line; the on-screen line is "Yesterday's SAT
 *     question: " + the stem's question sentence, so H3 holds), the question read (passage, stem,
 *     each choice under its display letter), one step per explanation sentence, then "The answer
 *     is <display letter>: <choice>." No trap. Maths is spoken through spokenMathText.
 *   * breakdownSkipCode: the fallback rule's (b) and (c), before anything is voiced.
 *   * breakdownCopy: the SCL-262 captions through the one caption builder, the music credit last.
 */
import {
  qotdBreakdownPilotSchema,
  type QotdBreakdownPilot,
  type QotdBreakdownSkipCode,
  type QotdBreakdownWindow,
} from "../../packages/shared/src/qotd-breakdown-schema";
import type {
  QotdArchiveResponse,
  QotdOption,
} from "../../packages/shared/src/qotd-schema";
import type {
  CompositionQuestion,
  CompositionScript,
} from "../../scripts/worked-examples/composition";
import { tokenizeMathContent } from "../math/tokenize";
import {
  nextSatTest,
  qotdHeadline,
  socialDateWarnings,
  socialFacebookCaption,
  socialInstagramCaption,
  socialKeywords,
  socialTiktokCaption,
  type SocialSection,
} from "../social/posts";
import {
  captionProblems,
  hookPeopleProblem,
  hookProblems,
  hookStatisticProblem,
  publicPhraseProblem,
  type HookQuestion,
} from "../worked-examples/rules";
import { plainMathText, spokenMathText } from "./plain-math";
import { stemRepeatsPassage } from "./projection";
import { qotdReadabilityProblem } from "./readability";
import { QOTD_SECTION_NAME } from "./social";

/**
 * The pilot window (Karl sets both dates in the merge PR: 14 days from his merge). Both null =
 * off, the default: the workflow step does nothing.
 */
export const QOTD_BREAKDOWN_PILOT: QotdBreakdownPilot =
  qotdBreakdownPilotSchema.parse({ start: null, end: null });

/** Where `postedOn` (the QOTD posting day) sits against the window. `paused` wins over all. */
export function pilotWindow(
  pilot: QotdBreakdownPilot,
  postedOn: string,
  paused: boolean,
): QotdBreakdownWindow {
  if (paused) return "paused";
  if (pilot.start === null || pilot.end === null) return "off";
  if (postedOn < pilot.start) return "not_started";
  if (postedOn > pilot.end) return "ended";
  return "active";
}

/** What the run log and summary say for a window that does not post. */
export const QOTD_BREAKDOWN_WINDOW_NOTE: Record<
  Exclude<QotdBreakdownWindow, "active">,
  string
> = {
  off: "pilot off (no dates set)",
  not_started: "pilot not started",
  ended: "pilot ended",
  paused: "pilot paused (QOTD_BREAKDOWN_PAUSED)",
};

/** The Slack notice's reason for each code: fixed text, never question content. */
export const QOTD_BREAKDOWN_SKIP_REASON: Record<QotdBreakdownSkipCode, string> =
  {
    script_too_long: "the voiced script runs over 60 s",
    script_too_short: "the voiced script runs under 30 s",
    mp4_check_failed: "the MP4 failed the 30-60 s video check",
    letter_named:
      "the explanation or a choice names a letter, which the shuffled order makes wrong",
    grid_in: "a grid-in has no choices to break down",
    too_long_to_read: "the question is over the quick-read length",
    paired_passage: "a paired passage",
    stem_repeats_passage: "the stem repeats the passage (no question prompt)",
    no_explanation: "the day has no explanation",
    too_many_steps: "the explanation has more than six sentences",
    content_rules: "a content rule failed (hook rules H1-H6, caption rules)",
    voice_check_failed: "a voiced line failed the transcription or audio check",
    hyperframes_check_failed: "hyperframes check failed",
    layout_check_failed: "the layout check failed (safe area or blank paper)",
    render_failed: "the render failed",
    withheld: "yesterday is withheld or missing on the archive",
    order_mismatch:
      "the stored letter does not match the stored order (nothing rendered)",
    build_failed: "the breakdown build did not finish",
  };

/** "Breakdown skipped: <reason> (<code>)", the notice's one line. */
export function breakdownSkipLine(code: QotdBreakdownSkipCode): string {
  return `Breakdown skipped: ${QOTD_BREAKDOWN_SKIP_REASON[code]} (${code})`;
}

/** The most explanation sentences a breakdown voices (the voice manifest keys step-1..6). */
export const QOTD_BREAKDOWN_MAX_STEPS = 6;

/**
 * A letter named as a choice: "choice B", "options A and C", "answer is D", "Answer: C", "(C)",
 * "B)". The letter must be a capital A-D standing alone, so "a number", "f(A)" and "Dr." pass.
 */
const LETTER_NAMED: readonly RegExp[] = [
  /\b(?:[Cc]hoices?|[Oo]ptions?|[Aa]nswers?|[Ll]etters?)\s+(?:(?:is|was|are)\s+)?\(?[A-D]\)?(?![\w'’])/,
  /\b[Aa]nswers?\s*:\s*\(?[A-D]\)?(?![\w'’])/,
  /(?<![\w$\\])\([A-D]\)/,
  /(?:^|[\s"“'‘])[A-D]\)(?=[\s,.;:]|$)/,
];

/** Whether `text` names a choice by its letter (fallback rule (b)). */
export function namesALetter(text: string): boolean {
  return LETTER_NAMED.some((re) => re.test(text));
}

/**
 * Whole sentences of raw question text: split at a space after . ! or ? (and any closing quote or
 * bracket) that is outside $...$ maths, so "$3.5$" never splits. Escaped characters are skipped.
 */
export function explanationSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return [];
  const out: string[] = [];
  let start = 0;
  let inMath = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "$") {
      inMath = !inMath;
      continue;
    }
    if (!inMath && ch === " " && /[.!?]["”’)]*$/.test(clean.slice(start, i))) {
      out.push(clean.slice(start, i));
      start = i + 1;
    }
  }
  out.push(clean.slice(start));
  return out.filter((s) => s.trim().length > 0);
}

/**
 * Fallback rules (b) and (c), checked before anything is voiced: the first that holds, or null.
 * (c) reuses the QOTD's own suitability rules (shared/qotd/readability.ts, the scheduler's and
 * the social generator's, and stemRepeatsPassage).
 */
export function breakdownSkipCode(
  day: QotdArchiveResponse,
): QotdBreakdownSkipCode | null {
  const q = day.question;
  // The QOTD's own rule decides multiple choice (a grid-in is its not_multiple_choice).
  const unreadable = qotdReadabilityProblem({
    section: q.section_code,
    itemType: q.item_type,
    stem: q.stem,
    passage: q.passage,
  });
  if (unreadable === "not_multiple_choice") return "grid_in";
  if (unreadable === "paired_passage") return "paired_passage";
  if (stemRepeatsPassage(q.stem, q.passage)) return "stem_repeats_passage";
  if (unreadable !== null) return "too_long_to_read";
  const sentences = explanationSentences(q.explanation);
  if (sentences.length === 0) return "no_explanation";
  if (
    namesALetter(q.explanation) ||
    q.options.some((o) => namesALetter(o.text))
  )
    return "letter_named";
  if (sentences.length > QOTD_BREAKDOWN_MAX_STEPS) return "too_many_steps";
  return null;
}

const DISPLAY_LETTERS = ["A", "B", "C", "D"] as const;
type DisplayLetter = (typeof DISPLAY_LETTERS)[number];

/** The breakdown's question: the choices in the stored order, lettered by position. */
export type BreakdownQuestion = HookQuestion &
  CompositionQuestion & {
    /** The stored order, as canonical keys (for the record only; never a letter). */
    option_order: QotdOption["id"][];
  };

/**
 * The day's question as the breakdown shows it: options in the archive's (stored) order, each
 * lettered A-D by its position, and the key = the stored display letter (`correct_letter`).
 * Refused (order_mismatch) when the correct choice (found by its canonical id) is not at the
 * stored letter, or the stored letter is missing: the hard rule is the stored row, and there is
 * no fallback to the canonical order.
 */
export function breakdownQuestion(
  day: QotdArchiveResponse,
):
  | { ok: true; question: BreakdownQuestion }
  | { ok: false; code: "order_mismatch" } {
  const q = day.question;
  const stored = q.correct_letter;
  const index = q.options.findIndex((o) => o.id === q.correct_option_id);
  const shown: DisplayLetter | undefined = DISPLAY_LETTERS[index];
  if (
    q.options.length !== 4 ||
    stored === null ||
    stored === undefined ||
    shown !== stored
  )
    return { ok: false, code: "order_mismatch" };
  const options: BreakdownQuestion["options"] = [];
  for (const [k, key] of DISPLAY_LETTERS.entries()) {
    const option = q.options[k];
    if (!option) return { ok: false, code: "order_mismatch" };
    options.push({ key, text: option.text });
  }
  return {
    ok: true,
    question: {
      id: `QOTD ${day.qotd_date}`,
      stem: q.stem,
      passage: q.passage,
      options,
      correct_answer: stored,
      option_order: q.options.map((o) => o.id),
    },
  };
}

/** The spoken hook (fixed): passes H1, H2, H4-H6; H3 is the on-screen line's. */
export const QOTD_BREAKDOWN_HOOK_VOICE =
  "Yesterday's SAT question. Did you get it?";
/** The on-screen hook's opening; the stem's question sentence follows it. */
export const QOTD_BREAKDOWN_HOOK_PREFIX = "Yesterday's SAT question: ";
/** The on-screen hook's cap (the worked-example hook line's). */
export const QOTD_BREAKDOWN_HOOK_MAX = 90;
/** A notepad line's cap (the worked-example notepad line's). */
export const QOTD_BREAKDOWN_NOTEPAD_MAX = 32;

/** The stem's last sentence in plain text: the question it asks. */
function questionSentence(stem: string): string {
  const all = explanationSentences(stem);
  return plainMathText(all[all.length - 1] ?? stem);
}

/**
 * "Yesterday's SAT question: <the stem's question>", at most 90 characters: cut at the last
 * whole word and ended with "…" when longer. It shows the puzzle (H3) and ends in "?" or "…"
 * (H4).
 */
export function breakdownHookLine(stem: string): string {
  const full = `${QOTD_BREAKDOWN_HOOK_PREFIX}${questionSentence(stem)}`;
  if (full.length <= QOTD_BREAKDOWN_HOOK_MAX) return full;
  const head = full.slice(0, QOTD_BREAKDOWN_HOOK_MAX);
  const cut = head.slice(0, head.lastIndexOf(" ")).replace(/[\s,;:—–-]+$/, "");
  return `${cut}…`;
}

/** A step's notepad line: the sentence's last formula in plain text, when it fits; else "Step k". */
function stepNotepad(sentence: string, k: number): string {
  const maths = tokenizeMathContent(sentence).filter((t) => t.type === "math");
  const last = maths[maths.length - 1];
  const text = last ? plainMathText(`$${last.content}$`) : "";
  return text.length > 0 && text.length <= QOTD_BREAKDOWN_NOTEPAD_MAX
    ? text
    : `Step ${k}`;
}

function spokenSentence(text: string): string {
  const s = spokenMathText(text);
  return /[.?!]$/.test(s) ? s : `${s}.`;
}

/**
 * The deterministic script: hook, question read, the explanation's sentences as steps, the answer
 * under its stored display letter. No trap. Built only from a question breakdownQuestion has
 * accepted, so every letter in it is the stored one.
 */
export function breakdownScript(
  day: QotdArchiveResponse,
  question: BreakdownQuestion,
): CompositionScript {
  const correct = question.options.find(
    (o) => o.key === question.correct_answer,
  );
  if (!correct)
    throw new Error("breakdownScript: no choice at the stored letter");
  const read = [
    ...(question.passage && question.passage.trim() !== ""
      ? [spokenSentence(question.passage)]
      : []),
    spokenSentence(question.stem),
    ...question.options.map((o) => `${o.key}: ${spokenSentence(o.text)}`),
  ].join(" ");
  const correctPlain = plainMathText(correct.text);
  const notepad = `${question.correct_answer}) ${correctPlain}`;
  return {
    hook: {
      line: breakdownHookLine(question.stem),
      voice: QOTD_BREAKDOWN_HOOK_VOICE,
    },
    question_voice: read,
    steps: explanationSentences(day.question.explanation).map((s, k) => ({
      notepad: stepNotepad(s, k + 1),
      voice: spokenSentence(s),
    })),
    answer: {
      notepad:
        notepad.length <= QOTD_BREAKDOWN_NOTEPAD_MAX
          ? notepad
          : `${question.correct_answer})`,
      voice: `The answer is ${question.correct_answer}: ${spokenSentence(correct.text)}`,
    },
    trap: null,
  };
}

/**
 * The content rules (fallback (d)): H1-H6 on the hook, and on every spoken line the rules the
 * worked examples apply to theirs (no claims about people, no statistics, no banned public-copy
 * phrase).
 */
export function breakdownContentProblems(
  script: CompositionScript,
  question: BreakdownQuestion,
): string[] {
  const out = [...hookProblems(script.hook, question)];
  const spoken = [
    script.question_voice,
    ...script.steps.map((s) => s.voice),
    script.answer.voice,
  ];
  for (const text of spoken) {
    const p =
      hookPeopleProblem(text) ??
      hookStatisticProblem(text) ??
      publicPhraseProblem(text);
    if (p) out.push(p.replace(/^H\d /, ""));
  }
  return out;
}

export type BreakdownCopy = {
  label: string;
  headline: string;
  caption: string;
  instagram_caption: string;
  facebook_caption: string;
  keywords: string[];
  warnings: string[];
};

/**
 * The SCL-262 captions and TikTok keywords, through the one caption builder: the QOTD headline
 * (the test month is the posting day's, as the carousel's), the music credit as the trailing line
 * of each caption (its CC BY 4.0 licence). Refused with problems on any caption rule.
 */
export function breakdownCopy(
  day: QotdArchiveResponse,
  postedOn: string,
  musicCredit: string,
): { ok: true; copy: BreakdownCopy } | { ok: false; problems: string[] } {
  const section: SocialSection = QOTD_SECTION_NAME[day.question.section_code];
  const test = nextSatTest(postedOn);
  const headline = qotdHeadline(test, section);
  const caption = socialTiktokCaption(headline, test, section, [musicCredit]);
  const instagram = socialInstagramCaption(headline, test, section, [
    musicCredit,
  ]);
  const facebook = socialFacebookCaption(headline, test, section, [
    musicCredit,
  ]);
  const keywords = socialKeywords(postedOn, section, day.question.domain);
  const problems = [
    ...captionProblems(caption, musicCredit, headline).map(
      (p) => `tiktok ${p}`,
    ),
    ...captionProblems(instagram, musicCredit, headline).map(
      (p) => `instagram ${p}`,
    ),
    ...captionProblems(facebook, musicCredit, headline).map(
      (p) => `facebook ${p}`,
    ),
    ...(keywords.ok ? [] : [`tiktok ${keywords.error}`]),
  ];
  if (problems.length > 0 || !keywords.ok) return { ok: false, problems };
  return {
    ok: true,
    copy: {
      label: `QOTD breakdown · ${day.qotd_date} · ${section}`,
      headline,
      caption,
      instagram_caption: instagram,
      facebook_caption: facebook,
      keywords: keywords.keywords,
      warnings: socialDateWarnings(postedOn),
    },
  };
}
