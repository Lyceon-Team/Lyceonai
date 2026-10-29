/**
 * Yesterday's reveal and today's suggested Reddit post, for the daily QOTD Slack post.
 *
 * @spec [Doc 10A §7 ("no answer is revealed before submitting": a past day's answer is public on
 *       its archive page), Doc 10B (Reddit posting stays manual); owner brief "QOTD Slack post —
 *       add yesterday's reveal (for r/satquestions)" (Karl, 2026-10-15)] | @implemented [2026-10-15]
 *
 * plain English: Karl posts today's question on r/satquestions each morning and comments
 * yesterday's answer on yesterday's post. The Slack post hands him both, ready to paste.
 *   - The reveal is built ONLY from yesterday's public archive payload (`QotdArchiveResponse`,
 *     GET /api/public/qotd/:date, which the server refuses for today and later). `buildReveal`
 *     refuses any day but the one before the posted day, so today's answer cannot become a
 *     reveal even if the wrong day were fetched.
 *   - A day the archive does not publish (a repaired question, owner 2026-10-08) is `withheld`:
 *     the notice says so and carries nothing else.
 *   - The Reddit post is the title and one call-to-action line (owner brief 2026-10-28; the
 *     question is in the posted image), built from the social input (the pre-submit shape), so it
 *     can carry no answer; it is also put through the leak check with the caption and alt text
 *     (generate.ts).
 *   - Maths in the reveal is written as plain text people read on Reddit, which does not render LaTeX:
 *     `$\frac{a}{b}$` becomes "(a)/(b)", `x^{2}` becomes "x^2", `\sqrt{x}` becomes "√(x)".
 */
import {
  previousQotdDate,
  qotdRedditPostSchema,
  qotdRevealSchema,
  type QotdArchiveResponse,
  type QotdRedditPost,
  type QotdReveal,
  type QotdRevealAnswer,
  type QotdSocialInput,
} from "../../packages/shared/src/qotd-schema";
import { BASE_URL } from "../seo/structured-data";
import { plainMathText } from "./plain-math";
import { QOTD_SECTION_NAME, formatSocialDate } from "./social";
import { funnelPhase, linkCtaLine } from "../social/funnel";

/** A past day's public page (the same URL the archive's meta tags use). */
export function qotdArchiveUrl(date: string): string {
  return `${BASE_URL}/sat-question-of-the-day/${date}`;
}

// ---------------------------------------------------------------------------------------------
// Yesterday's reveal
// ---------------------------------------------------------------------------------------------

export type RevealResult =
  | { ok: true; reveal: QotdReveal }
  | { ok: false; problem: string };

/**
 * The reveal for the day before `postedDate`, from that day's public archive payload. Refused
 * for any other day: the reveal is yesterday's, never today's (owner brief 2026-10-15).
 */
export function buildReveal(
  day: QotdArchiveResponse,
  postedDate: string,
): RevealResult {
  const yesterday = previousQotdDate(postedDate);
  if (day.qotd_date !== yesterday) {
    return {
      ok: false,
      problem: `reveal: the archive day is ${day.qotd_date}, not yesterday (${yesterday})`,
    };
  }
  const q = day.question;
  let answer: QotdRevealAnswer;
  if (q.item_type === "mcq") {
    const correct = q.options.find((o) => o.id === q.correct_option_id);
    if (!correct) {
      return {
        ok: false,
        problem: "reveal: the archive day names no correct choice",
      };
    }
    answer = {
      kind: "choice",
      letter: correct.id,
      text: plainMathText(correct.text),
    };
  } else {
    if (q.correct_answer === null || q.correct_answer.trim() === "") {
      return {
        ok: false,
        problem: "reveal: the archive day has no keyed answer",
      };
    }
    answer = { kind: "value", value: q.correct_answer.trim() };
  }
  const parsed = qotdRevealSchema.safeParse({
    status: "revealed",
    qotd_date: day.qotd_date,
    section: QOTD_SECTION_NAME[q.section_code],
    domain: q.domain,
    answer,
    explanation: plainMathText(q.explanation),
    archive_url: qotdArchiveUrl(day.qotd_date),
  });
  return parsed.success
    ? { ok: true, reveal: parsed.data }
    : {
        ok: false,
        problem: `reveal: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      };
}

/** Yesterday was not published on the archive (a repaired question): the notice, nothing else. */
export function withheldReveal(postedDate: string): QotdReveal {
  return qotdRevealSchema.parse({
    status: "withheld",
    qotd_date: previousQotdDate(postedDate),
  });
}

// ---------------------------------------------------------------------------------------------
// Today's Reddit post
// ---------------------------------------------------------------------------------------------

/**
 * "SAT Question of the Day: <date> (<section> · <domain>)", posted with the portrait image, and a
 * one-line call to action with the tagged /start link.
 *
 * @spec [owner brief "One funnel for every social post" (Karl, 2026-10-28) item 2: "Reddit post
 *       (4/5): title + image + one-line CTA with lyceon.ai/start?utm_source=reddit&utm_campaign=
 *       qotd. Remove the written question/choices from the body."] | @implemented [2026-10-28]
 *
 * plain English: the question is in the image, so the body no longer writes it out. The line is
 * the Dec 5 cohort's until test day (by the post's own date), then the evergreen one.
 */
export function buildRedditPost(input: QotdSocialInput): QotdRedditPost {
  const section = QOTD_SECTION_NAME[input.section_code];
  const title = `SAT Question of the Day: ${formatSocialDate(input.qotd_date)} (${section} · ${input.domain})`;
  const body = linkCtaLine(funnelPhase(input.qotd_date), "reddit", "qotd");
  return qotdRedditPostSchema.parse({ title, body });
}
