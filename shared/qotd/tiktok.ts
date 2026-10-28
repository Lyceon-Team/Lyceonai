/**
 * Yesterday's Question of the Day as a TikTok photo carousel: the data, the copy and the layout.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting": a past day's answer is public on
 *       its archive page), §11; owner brief "QOTD social: TikTok 3-slide carousel + fixed answer
 *       order + CTA-first caption + short title" (Karl, 2026-10-23)] | @implemented [2026-10-23]
 *
 * plain English:
 *   * buildTiktokCarousel turns yesterday's PUBLIC archive payload into the three slides' data:
 *     slide 1 the question (the strict no-answer input, choices in the day's stored order,
 *     SCL-258), slide 3 the served correct letter and choice (or the grid-in value) and a short
 *     "Why". It refuses any day but the one before the posted day, so today's answer can never
 *     reach a slide, and it refuses a day whose served letter is not the letter slide 1 shows for
 *     that choice.
 *   * tiktokWhy: the explanation as plain text (the reveal's plainMathText), cut to the most
 *     whole sentences (at most three) that fit in 300 characters. When even the first sentence
 *     is longer, it is cut at the last word boundary that fits, followed by "…" and "Full
 *     explanation on lyceon.ai", so every day gets a carousel (Karl's ruling 2026-10-26 on
 *     #1308; until then such a day had no carousel, about 1.4% of the bank). The note-only
 *     fallback is now only for a withheld or missing yesterday and for a slide that cannot fit.
 *   * The caption and title are fixed wording (Karl, 2026-10-23); the title names the date and
 *     section only, never question text, and is hard-capped at 90 characters.
 *   * QOTD_TIKTOK_SAFE: where TikTok draws its own controls over a 1080x1920 photo (top ~8%: the
 *     tabs; bottom ~19%: caption, sound and dots; right ~14%: like, comment, share). Content sits
 *     in a column from 6.5% in from the left to 15.5% in from the right, vertically centred in
 *     the band between. Checked 2026-10-23 against published third-party overlays (TikTok
 *     publishes no photo-mode spec): those put the clear area at roughly 131px top, 367px
 *     bottom and 120px right, which these fractions contain.
 */
import {
  QOTD_TIKTOK_TITLE_MAX,
  QOTD_TIKTOK_WHY_MAX,
  previousQotdDate,
  qotdTiktokCarouselSchema,
  type QotdArchiveResponse,
  type QotdRevealAnswer,
  type QotdTiktokCarousel,
} from "../../packages/shared/src/qotd-schema";
import { plainMathText } from "./plain-math";
import { QOTD_SECTION_NAME, socialInputFromArchive } from "./social";

export const QOTD_TIKTOK_SIZE = { width: 1080, height: 1920 } as const;

/** Fractions of the frame TikTok covers (top, bottom, right) and the content column's insets. */
export const QOTD_TIKTOK_SAFE = {
  top: 0.08,
  bottom: 0.19,
  right: 0.14,
  columnLeft: 0.065,
  columnRight: 0.155,
} as const;

/** The safe band and column in pixels, rounded outwards (towards more margin). */
export function tiktokSafePx(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const { width, height } = QOTD_TIKTOK_SIZE;
  return {
    top: Math.ceil(height * QOTD_TIKTOK_SAFE.top),
    bottom: Math.ceil(height * QOTD_TIKTOK_SAFE.bottom),
    left: Math.ceil(width * QOTD_TIKTOK_SAFE.columnLeft),
    right: Math.ceil(width * QOTD_TIKTOK_SAFE.columnRight),
  };
}

/** The caption, follow line first (Karl, 2026-10-23). */
export const QOTD_TIKTOK_CAPTION = [
  "Follow for daily SAT questions 👆",
  "Lock in your answer, then swipe. Today's question is live on lyceon.ai.",
  "#SAT #SATprep #digitalSAT #studytok",
].join("\n\n");

/** "2026-10-22" -> "Oct 22" (UTC, so the build machine's zone never shifts it). */
export function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** At most 90 characters, cut at the last whole word (and no trailing separator) if longer. */
export function capTiktokTitle(text: string): string {
  if (text.length <= QOTD_TIKTOK_TITLE_MAX) return text;
  const cut = text.slice(0, QOTD_TIKTOK_TITLE_MAX + 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s·]+$/, "");
}

/**
 * "SAT Question of the Day · Oct 22 · Reading and Writing": the date and section only, never
 * question text, hard-capped at 90 characters.
 */
export function buildTiktokTitle(
  qotdDate: string,
  sectionCode: "M" | "RW",
): string {
  return capTiktokTitle(
    `SAT Question of the Day · ${formatShortDate(qotdDate)} · ${QOTD_SECTION_NAME[sectionCode]}`,
  );
}

/**
 * Whole sentences: split only at a space that follows . ! or ? (and any closing quote or
 * bracket), so "3.5" or "x.y" never splits and no text is dropped.
 */
function sentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return [];
  const ended = /[.!?]["”’)]*$/.test(clean) ? clean : `${clean}.`;
  return ended.split(/(?<=[.!?]["”’)]*) /);
}

/** What follows a first sentence cut short (Karl, 2026-10-26). */
export const QOTD_TIKTOK_WHY_MORE = "… Full explanation on lyceon.ai";

/**
 * The first sentence cut at the last word boundary that leaves room for "…" and "Full
 * explanation on lyceon.ai" within 300 characters (trailing commas and the like dropped before
 * the ellipsis). A single word longer than the room, which no explanation has, is cut where the
 * room ends.
 */
function cutFirstSentence(sentence: string): string {
  const room = QOTD_TIKTOK_WHY_MAX - QOTD_TIKTOK_WHY_MORE.length;
  const head = sentence.slice(0, room + 1);
  const space = head.lastIndexOf(" ");
  const cut = (
    space > 0 ? head.slice(0, space) : sentence.slice(0, room)
  ).replace(/[\s,;:—–-]+$/, "");
  return `${cut}${QOTD_TIKTOK_WHY_MORE}`;
}

/**
 * The "Why:" line from the explanation in plain text, at most 300 characters: as many whole
 * sentences (at most three) as fit, or, when the first sentence alone is longer, that sentence
 * cut at a word boundary and pointed at the full explanation on lyceon.ai. Null only for an
 * empty explanation.
 */
export function tiktokWhy(explanation: string): string | null {
  const all = sentences(plainMathText(explanation));
  const first = all[0];
  if (first === undefined) return null;
  if (first.length > QOTD_TIKTOK_WHY_MAX) return cutFirstSentence(first);
  let out = "";
  for (const sentence of all.slice(0, 3)) {
    const next = out === "" ? sentence : `${out} ${sentence}`;
    if (next.length > QOTD_TIKTOK_WHY_MAX) break;
    out = next;
  }
  return out;
}

export type TiktokCarouselResult =
  | { ok: true; carousel: QotdTiktokCarousel }
  | { ok: false; reason: "invalid"; problem: string };

/**
 * The carousel for the day before `postedDate`, from that day's public archive payload. Refused
 * for any other day: the carousel is yesterday's, never today's (Karl, 2026-10-23).
 */
export function buildTiktokCarousel(
  day: QotdArchiveResponse,
  postedDate: string,
): TiktokCarouselResult {
  const yesterday = previousQotdDate(postedDate);
  if (day.qotd_date !== yesterday) {
    return {
      ok: false,
      reason: "invalid",
      problem: `tiktok: the archive day is ${day.qotd_date}, not yesterday (${yesterday})`,
    };
  }
  const question = socialInputFromArchive(day);
  const q = day.question;
  let answer: QotdRevealAnswer;
  if (q.item_type === "mcq") {
    const index = q.options.findIndex((o) => o.id === q.correct_option_id);
    const correct = q.options[index];
    if (!correct) {
      return {
        ok: false,
        reason: "invalid",
        problem: "tiktok: the archive day names no correct choice",
      };
    }
    // Slide 1 letters by position; slide 3 must name the same letter for the same choice. The
    // served letter is the archive's correct_letter, from the day's stored order (SCL-258).
    const shown = (["A", "B", "C", "D"] as const)[index];
    if (
      shown === undefined ||
      (q.correct_letter !== undefined && shown !== q.correct_letter)
    ) {
      return {
        ok: false,
        reason: "invalid",
        problem: `tiktok: the correct choice is shown in position ${shown ?? "?"}, not at the served letter ${q.correct_letter ?? "(none)"}`,
      };
    }
    answer = { kind: "choice", letter: shown, text: correct.text };
  } else {
    const value = q.correct_answer?.trim() ?? "";
    if (value === "") {
      return {
        ok: false,
        reason: "invalid",
        problem: "tiktok: the archive day has no keyed answer",
      };
    }
    answer = { kind: "value", value };
  }
  const why = tiktokWhy(q.explanation);
  if (why === null) {
    return {
      ok: false,
      reason: "invalid",
      problem: "tiktok: the archive day has no explanation",
    };
  }
  const parsed = qotdTiktokCarouselSchema.safeParse({
    question,
    section: QOTD_SECTION_NAME[q.section_code],
    answer,
    why,
  });
  return parsed.success
    ? { ok: true, carousel: parsed.data }
    : {
        ok: false,
        reason: "invalid",
        problem: `tiktok: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      };
}
