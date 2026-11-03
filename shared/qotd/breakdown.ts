/**
 * The QOTD breakdown pilot: yesterday's Question of the Day as a short worked video, from a script
 * Karl approved by merge.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): render a
 *       breakdown of YESTERDAY's QOTD with the worked-example pipeline; HARD RULE "the breakdown
 *       uses the stored option_order and correct_display_letter for that QOTD date, never the
 *       question's original order"; the fallback rule (a)-(d) with a stable code per reason;
 *       captions and keywords in the SCL-262 format through shared/social/posts.ts, the CC BY 4.0
 *       music credit on every caption; SCL-258, SCL-262, SCL-265, SCL-266. Karl's rulings on
 *       #1398, 2026-11-02: the templated script (the question read aloud plus the explanation's
 *       sentences) broke "the voice never reads the screen" and is replaced by AUTHORED scripts,
 *       one per scheduled date, approved by his merge into `social`; the authored script owns the
 *       hook (a challenge to the viewer), the one-sentence setup, the key move, the trap ("here's
 *       where people slip"), the answer and a quick check, then the kit's call to action, under
 *       the worked examples' rules H1-H6, S1, S2 and the trap opener, reused, not forked; no
 *       approved script = the fallback with `no_approved_script`; the pilot runs 2026-11-09 to
 *       2026-11-22] | @implemented [2026-11-02, authored scripts 2026-11-02]
 *
 * plain English: every function is pure.
 *   * The question comes ONLY from the day as the public archive serves it
 *     (GET /api/public/qotd/:date: its options in the day's stored order, `correct_letter` the
 *     stored correct_display_letter). breakdownQuestion letters the choices A-D by that position
 *     and takes the stored letter as the key; it refuses a day whose correct choice is not at the
 *     stored letter (order_mismatch). The canonical key (correct_option_id) only finds that choice.
 *   * scheduledDay builds the same day for the authoring check, before it is served: the seed
 *     question and a stored order and letter, through the real projection (toArchiveResponse,
 *     which refuses an order or letter that does not fit the question). So the authoring check
 *     and the render letter the question by one function.
 *   * scriptOrderProblem is the hard rule at render: the approved script's option_order and
 *     correct_display_letter must equal the stored row the archive serves, or nothing renders.
 *   * The script's content rules are the worked examples' own (shared/worked-examples/rules.ts
 *     scriptProblems), run against that question.
 *   * breakdownCopy: the SCL-262 captions through the one caption builder, the music credit last.
 */
import {
  qotdBreakdownPilotSchema,
  type QotdBreakdownPilot,
  type QotdBreakdownScript,
  type QotdBreakdownSkipCode,
  type QotdBreakdownWindow,
} from "../../packages/shared/src/qotd-breakdown-schema";
import type {
  QotdArchiveResponse,
  QotdOption,
} from "../../packages/shared/src/qotd-schema";
import { isoWeekCycle } from "../content/schedule";
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
import { captionProblems, type HookQuestion } from "../worked-examples/rules";
import type { SeedQuestion } from "../worked-examples/seed-question";
import {
  QotdServedOrderError,
  stemRepeatsPassage,
  toArchiveResponse,
} from "./projection";
import { qotdReadabilityProblem } from "./readability";
import { QOTD_SECTION_NAME } from "./social";

/**
 * The pilot window, as QOTD posting days (the day a breakdown of the day before posts): Karl's
 * ruling on #1398, 2026-11-02, "start 2026-11-09 and end 2026-11-22", 14 days inclusive. So the
 * QOTD days broken down are 2026-11-08 to 2026-11-21.
 */
export const QOTD_BREAKDOWN_PILOT: QotdBreakdownPilot =
  qotdBreakdownPilotSchema.parse({ start: "2026-11-09", end: "2026-11-22" });

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
    grid_in: "a grid-in has no choices to break down",
    too_long_to_read: "the question is over the quick-read length",
    paired_passage: "a paired passage",
    stem_repeats_passage: "the stem repeats the passage (no question prompt)",
    content_rules:
      "a content rule failed (hook rules H1-H6, the verbatim rule S1-S2, caption rules)",
    voice_check_failed:
      "the committed voice does not match the script or fails the audio check",
    hyperframes_check_failed: "hyperframes check failed",
    layout_check_failed: "the layout check failed (safe area or blank paper)",
    render_failed: "the render failed",
    withheld: "yesterday is withheld or missing on the archive",
    no_approved_script: "no approved script for the day",
    order_mismatch:
      "the script's option order or letter differs from the stored row (nothing rendered)",
    build_failed: "the breakdown build did not finish",
  };

/** "Breakdown skipped: <reason> (<code>)", the notice's one line. */
export function breakdownSkipLine(code: QotdBreakdownSkipCode): string {
  return `Breakdown skipped: ${QOTD_BREAKDOWN_SKIP_REASON[code]} (${code})`;
}

/**
 * The only voice a breakdown is spoken in: Kokoro am_michael (Karl's ruling on #1398,
 * 2026-11-02, "with am_michael"; the worked examples' default since SCL-267), never the clone.
 */
export const QOTD_BREAKDOWN_VOICE_PROFILE = "am_michael";

/** Where a day's script lives on `social`: content/qotd-breakdowns/<ISO week>/<qotd_date>. */
export const QOTD_BREAKDOWN_CONTENT_DIR = "content/qotd-breakdowns";

export function breakdownScriptDir(qotdDate: string): string {
  return `${QOTD_BREAKDOWN_CONTENT_DIR}/${isoWeekCycle(qotdDate)}/${qotdDate}`;
}

/**
 * Fallback rule (c), checked before anything else: the first that holds, or null. It reuses the
 * QOTD's own suitability rules (shared/qotd/readability.ts, the scheduler's and the social
 * generator's, and stemRepeatsPassage).
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
  return null;
}

const DISPLAY_LETTERS = ["A", "B", "C", "D"] as const;
type DisplayLetter = (typeof DISPLAY_LETTERS)[number];

/** The breakdown's question: the choices in the stored order, lettered by position. */
export type BreakdownQuestion = HookQuestion & {
  /** The stored order, as canonical keys (compared with the script's; never a letter). */
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

/**
 * The day as the archive will serve it, built for the authoring check from the seed question and a
 * stored order and letter (the schedule export's, or the script's own): the real projection
 * (toArchiveResponse, through qotdServedChoices) letters it, and refuses an order that is not a
 * permutation of the choices or a letter that is not where the correct choice lands. The message
 * names no key or letter: the inputs may be a future day's.
 */
export function scheduledDay(
  seed: SeedQuestion,
  qotdDate: string,
  order: readonly string[],
  letter: string,
): { ok: true; day: QotdArchiveResponse } | { ok: false; problem: string } {
  try {
    return {
      ok: true,
      day: toArchiveResponse({
        qotd_date: qotdDate,
        question_id: seed.id,
        section: seed.section,
        domain: seed.domain,
        skill_codes: seed.skill_codes,
        difficulty: null,
        item_type: seed.item_type,
        stem: seed.stem,
        passage: seed.passage,
        options: seed.options,
        correct_answer: seed.correct_answer,
        correct_variants: null,
        explanation: null,
        option_order: [...order],
        correct_display_letter: letter,
      }),
    };
  } catch (e: unknown) {
    if (e instanceof QotdServedOrderError)
      return {
        ok: false,
        problem:
          "the option_order and correct_display_letter do not fit the question (not a permutation of its choices, or the letter is not where its key lands)",
      };
    throw e;
  }
}

/**
 * THE hard rule at render: the approved script names the stored row the archive serves for its
 * date: the same option order (canonical keys) and the same display letter. Null when it does.
 * The message names no value (the day has passed, but the notice and logs carry codes only).
 */
export function scriptOrderProblem(
  script: Pick<
    QotdBreakdownScript,
    "qotd_date" | "option_order" | "correct_display_letter"
  >,
  day: QotdArchiveResponse,
  question: BreakdownQuestion,
): string | null {
  if (script.qotd_date !== day.qotd_date)
    return "the script is for another day";
  if (script.option_order.join(",") !== question.option_order.join(","))
    return "the script's option_order differs from the stored row";
  if (script.correct_display_letter !== question.correct_answer)
    return "the script's correct_display_letter differs from the stored row";
  return null;
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
